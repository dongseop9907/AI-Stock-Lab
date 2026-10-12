begin;

-- Repair latent protective SELL exit_reason default contract.
-- Deployed paper_trade_history CHECK allows STOP_LOSS / TRAILING_STOP / MODEL_EXIT / MANUAL.
-- Active production callers already pass STOP_LOSS or TRAILING_STOP explicitly.
-- Function bodies are copied from their canonical migrations; only the default
-- p_exit_reason value changes from invalid PROTECTIVE_STOP to allowed STOP_LOSS.

-- execute_paper_protective_sell_v2 from supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql
create or replace function public.execute_paper_protective_sell_v2(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_execution_source text default 'PAPER_EXECUTION_REALISM_V2',
  p_exit_reason text default 'STOP_LOSS'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position public.paper_positions%rowtype;
  v_original_position_quantity integer := 0;
  v_effective_fill_quantity integer := 0;
  v_remaining_position_quantity integer := 0;
  v_total_transaction_cost numeric := 0;
  v_account public.paper_accounts%rowtype;
  v_existing_trade public.paper_trade_history%rowtype;

  v_entry_amount numeric(18, 2);
  v_exit_amount numeric(18, 2);
  v_realized_pnl numeric(18, 2);
  v_realized_return numeric(12, 6);

  v_risk_decision_id uuid;
  v_sell_order_id uuid;
  v_trade_id uuid;
begin
  if p_exit_price is null or p_exit_price <= 0 then
    raise exception 'INVALID_EXIT_PRICE';
  end if;

  /*
   * 같은 포지션이 동시에 두 번 매도되지 않도록 잠근다.
   */
  select *
  into v_position
  from public.paper_positions
  where id = p_position_id
  for update;

  /*
   * 이미 손절 처리된 포지션이라면 현금을 다시 증가시키지 않는다.
   */
  if not found then
    select *
    into v_existing_trade
    from public.paper_trade_history
    where source_position_id = p_position_id;

    if found then
      return jsonb_build_object(
        'alreadyClosed', true,
        'tradeId', v_existing_trade.id,
        'stockCode', v_existing_trade.stock_code,
        'quantity', v_existing_trade.quantity,
        'exitPrice', v_existing_trade.exit_price,
        'realizedPnl', v_existing_trade.realized_pnl,
        'closedAt', v_existing_trade.closed_at
      );
    end if;

    raise exception 'POSITION_NOT_FOUND';
  end if;

  /*
   * 현재가가 손절가보다 높으면 매도를 실행하지 않는다.
   */
  if p_exit_price > v_position.current_stop_price then
    raise exception 'STOP_NOT_TRIGGERED';
  end if;

  v_original_position_quantity :=
    greatest(
      0,
      coalesce(v_position.quantity, 0)
    );

  if v_original_position_quantity <= 0 then
    raise exception 'PROTECTIVE_SELL_POSITION_QUANTITY_INVALID';
  end if;

  if p_fill_quantity is null or p_fill_quantity <= 0 then
    raise exception 'PROTECTIVE_SELL_FILL_QUANTITY_INVALID';
  end if;

  if p_fill_quantity > v_original_position_quantity then
    raise exception 'PROTECTIVE_SELL_FILL_EXCEEDS_POSITION';
  end if;

  if p_broker_fee is null or p_broker_fee < 0 then
    raise exception 'PROTECTIVE_SELL_BROKER_FEE_INVALID';
  end if;

  if p_sell_tax is null or p_sell_tax < 0 then
    raise exception 'PROTECTIVE_SELL_TAX_INVALID';
  end if;

  v_effective_fill_quantity :=
    p_fill_quantity;

  v_remaining_position_quantity :=
    v_original_position_quantity -
    v_effective_fill_quantity;

  v_total_transaction_cost :=
    p_broker_fee +
    p_sell_tax;


  select *
  into v_account
  from public.paper_accounts
  where id = v_position.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if v_account.trading_mode <> 'PAPER' then
    raise exception 'LIVE_ACCOUNT_NOT_ALLOWED';
  end if;

  v_entry_amount :=
    v_position.average_price * v_effective_fill_quantity;

  v_exit_amount :=
    p_exit_price * v_effective_fill_quantity;

  v_realized_pnl :=
    v_exit_amount - v_entry_amount;

  v_realized_pnl :=
    v_realized_pnl -
    v_total_transaction_cost;

  if v_entry_amount > 0 then
    v_realized_return :=
      v_realized_pnl / v_entry_amount;
  else
    v_realized_return := 0;
  end if;

  /*
   * 손절 판단 내용을 위험관리 기록에 남긴다.
   */
  insert into public.risk_decisions (
    account_id,
    stock_code,
    action,
    approved,
    requested_payload,
    result_payload
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    'SELL',
    true,
    jsonb_build_object(
      'positionId', v_position.id,
      'quantity', v_effective_fill_quantity,
      'averagePrice', v_position.average_price,
      'currentStopPrice', v_position.current_stop_price,
      'observedPrice', p_exit_price,
      'observedAt', p_observed_at
    ),
    jsonb_build_object(
      'approved', true,
      'reason', 'STOP_LOSS_TRIGGERED',
      'entryAmount', v_entry_amount,
      'exitAmount', v_exit_amount,
      'realizedPnl', v_realized_pnl,
      'realizedReturn', v_realized_return
    )
  )
  returning id into v_risk_decision_id;

  /*
   * 손절 매도 주문을 체결 완료 상태로 기록한다.
   * 기존 entry_price 컬럼에는 매도 기준가격을 기록한다.
   */
  insert into public.paper_order_requests (
    account_id,
    stock_code,
    side,
    requested_quantity,
    approved_quantity,
    entry_price,
    stop_price,
    status,
    risk_decision_id,
    filled_quantity,
    filled_price,
    executed_at
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    'SELL',
    v_effective_fill_quantity,
    v_effective_fill_quantity,
    p_exit_price,
    v_position.current_stop_price,
    'FILLED',
    v_risk_decision_id,
    v_effective_fill_quantity,
    p_exit_price,
    coalesce(p_observed_at, now())
  )
  returning id into v_sell_order_id;

  /*
   * 매도대금을 현금에 반영하고 실현손익을 갱신한다.
   */
  update public.paper_accounts
  set
    cash_balance =
      cash_balance + v_exit_amount,

    realized_pnl =
      realized_pnl + v_realized_pnl,

    daily_realized_pnl =
      daily_realized_pnl + v_realized_pnl,

    updated_at = now()
  where id = v_position.account_id;

  if v_total_transaction_cost > 0 then
    update public.paper_accounts
    set cash_balance =
      cash_balance -
      v_total_transaction_cost
    where id =
      v_position.account_id;
  end if;

  /*
   * 매도 완료 거래를 장기 학습용 기록으로 저장한다.
   */
  insert into public.paper_trade_history (
    account_id,
    stock_code,
    source_position_id,
    sell_order_id,
    quantity,
    entry_price,
    exit_price,
    stop_price,
    entry_amount,
    exit_amount,
    realized_pnl,
    realized_return,
    exit_reason,
    opened_at,
    closed_at
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    v_position.id,
    v_sell_order_id,
    v_effective_fill_quantity,
    v_position.average_price,
    p_exit_price,
    v_position.current_stop_price,
    v_entry_amount,
    v_exit_amount,
    v_realized_pnl,
    v_realized_return,
    'STOP_LOSS',
    v_position.opened_at,
    coalesce(p_observed_at, now())
  )
  returning id into v_trade_id;

  /*
   * 전량 매도했으므로 보유 포지션에서 제거한다.
   */
  
  insert into public.paper_protective_execution_fills_v2 (
    position_id,
    account_id,
    stock_code,
    requested_quantity,
    filled_quantity,
    remaining_quantity,
    execution_price,
    broker_fee,
    sell_tax,
    total_transaction_cost,
    execution_source,
    exit_reason,
    observed_at
  )
  values (
    p_position_id,
    v_position.account_id,
    v_position.stock_code,
    v_original_position_quantity,
    v_effective_fill_quantity,
    v_remaining_position_quantity,
    p_exit_price,
    p_broker_fee,
    p_sell_tax,
    v_total_transaction_cost,
    coalesce(
      nullif(trim(p_execution_source), ''),
      'PAPER_EXECUTION_REALISM_V2'
    ),
    coalesce(
      nullif(trim(p_exit_reason), ''),
      'PROTECTIVE_STOP'
    ),
    p_observed_at
  );

  if v_remaining_position_quantity <= 0 then
    delete from public.paper_positions
  where id = v_position.id;
  else
    update public.paper_positions
    set quantity =
      v_remaining_position_quantity
    where id =
      p_position_id;
  end if;

  return jsonb_build_object(
    'alreadyClosed', false,
    'tradeId', v_trade_id,
    'sellOrderId', v_sell_order_id,
    'accountId', v_position.account_id,
    'stockCode', v_position.stock_code,
    'status', 'FILLED',
    'exitReason', 'STOP_LOSS',
    'quantity', v_effective_fill_quantity,
    'entryPrice', v_position.average_price,
    'exitPrice', p_exit_price,
    'stopPrice', v_position.current_stop_price,
    'entryAmount', v_entry_amount,
    'exitAmount', v_exit_amount,
    'realizedPnl', v_realized_pnl,
    'realizedReturn', v_realized_return,
    'remainingCash',
      v_account.cash_balance + v_exit_amount,
    'closedAt',
      coalesce(p_observed_at, now())
  );
end;
$$;

-- execute_paper_protective_sell_v3 from supabase/migrations/20261010000300_paper_protective_sell_execution_provenance_v1.sql
create or replace function public.execute_paper_protective_sell_v3(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz,
  p_execution_source text,
  p_execution_provenance jsonb,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_exit_reason text default 'STOP_LOSS'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_fill_id uuid;
  v_updated_rows integer := 0;
begin
  if p_execution_source is null
     or btrim(p_execution_source) = '' then
    raise exception 'PROTECTIVE_SELL_EXECUTION_SOURCE_REQUIRED';
  end if;

  if p_execution_source not in (
    'BEST_BID',
    'REFERENCE_MINUS_SYNTHETIC_SPREAD'
  ) then
    raise exception
      'UNSUPPORTED_PROTECTIVE_SELL_EXECUTION_SOURCE:%',
      p_execution_source;
  end if;

  if p_execution_provenance is null
     or jsonb_typeof(p_execution_provenance) <> 'object' then
    raise exception 'PROTECTIVE_SELL_EXECUTION_PROVENANCE_OBJECT_REQUIRED';
  end if;

  if octet_length(p_execution_provenance::text) > 131072 then
    raise exception 'PROTECTIVE_SELL_EXECUTION_PROVENANCE_TOO_LARGE';
  end if;

  /*
   * Canonical position locking, stop validation, accounting, partial-fill,
   * trade-history, order-history and protective-fill behavior remain in V2.
   */
  select public.execute_paper_protective_sell_v2(
    p_position_id =>
      p_position_id,

    p_exit_price =>
      p_exit_price,

    p_observed_at =>
      p_observed_at,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee,

    p_sell_tax =>
      p_sell_tax,

    p_execution_source =>
      p_execution_source,

    p_exit_reason =>
      p_exit_reason
  )
  into v_result;

  /*
   * V2 returns alreadyClosed=true for duplicate calls after the position
   * has already been fully closed. Do not rewrite historical provenance.
   */
  if coalesce(
    v_result ->> 'alreadyClosed',
    'false'
  ) = 'true' then
    return v_result;
  end if;

  /*
   * V2 inserts exactly one protective fill row for a successful new fill.
   * The position row is locked by V2, so competing successful fills for the
   * same position cannot interleave inside this transaction.
   */
  select f.id
  into v_fill_id
  from public.paper_protective_execution_fills_v2 f
  where f.position_id =
      p_position_id
    and f.execution_price =
      p_exit_price
    and f.observed_at is not distinct from
      p_observed_at
    and f.execution_source =
      p_execution_source
  order by
    f.created_at desc,
    f.id desc
  limit 1;

  if v_fill_id is null then
    raise exception
      'PROTECTIVE_SELL_EXECUTION_PROVENANCE_FILL_NOT_FOUND';
  end if;

  update public.paper_protective_execution_fills_v2
  set
    execution_provenance =
      p_execution_provenance,

    execution_provenance_version =
      'PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1'
  where id =
    v_fill_id;

  get diagnostics
    v_updated_rows =
      row_count;

  if v_updated_rows <> 1 then
    raise exception
      'PROTECTIVE_SELL_EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE:%',
      v_updated_rows;
  end if;

  return
    v_result
    ||
    jsonb_build_object(
      'executionProvenancePersisted',
      true,

      'executionPriceSource',
      p_execution_source,

      'executionProvenanceVersion',
      'PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1'
    );
end;
$$;

-- execute_paper_protective_sell_v4 from supabase/migrations/20261011000300_paper_protective_sell_closed_replay_v1.sql
create or replace function public.execute_paper_protective_sell_v4(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz,
  p_execution_source text,
  p_execution_provenance jsonb,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_exit_reason text default 'STOP_LOSS'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_position_id uuid;
  v_existing_trade public.paper_trade_history%rowtype;
  v_result jsonb;
begin
  if p_position_id is null then
    raise exception 'PROTECTIVE_SELL_POSITION_ID_REQUIRED';
  end if;

  /*
   * Concurrency invariant:
   * Lock the live position before delegating to V3.
   *
   * If a concurrent final exit is in progress, this SELECT waits.
   * After the competing transaction commits, either:
   *   - the position still exists and we delegate safely, or
   *   - no row is returned and the deterministic closed-replay
   *     branch below observes committed trade history.
   */
  select p.id
  into v_position_id
  from public.paper_positions p
  where p.id = p_position_id
  for update;

  if found then
    select public.execute_paper_protective_sell_v3(
      p_position_id =>
        p_position_id,

      p_exit_price =>
        p_exit_price,

      p_observed_at =>
        p_observed_at,

      p_execution_source =>
        p_execution_source,

      p_execution_provenance =>
        p_execution_provenance,

      p_fill_quantity =>
        p_fill_quantity,

      p_broker_fee =>
        p_broker_fee,

      p_sell_tax =>
        p_sell_tax,

      p_exit_reason =>
        p_exit_reason
    )
    into v_result;

    return v_result;
  end if;

  /*
   * source_position_id is intentionally multi-row after the
   * partial-exit repair.
   *
   * Return the final/latest persisted exit deterministically.
   */
  select *
  into v_existing_trade
  from public.paper_trade_history t
  where t.source_position_id = p_position_id
  order by
    t.closed_at desc nulls last,
    t.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'alreadyClosed',
        true,

      'tradeId',
        v_existing_trade.id,

      'stockCode',
        v_existing_trade.stock_code,

      'quantity',
        v_existing_trade.quantity,

      'exitPrice',
        v_existing_trade.exit_price,

      'realizedPnl',
        v_existing_trade.realized_pnl,

      'closedAt',
        v_existing_trade.closed_at,

      'replayResolution',
        'FINAL_TRADE_BY_CLOSED_AT_DESC_ID_DESC',

      'replayVersion',
        'PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1'
    );
  end if;

  /*
   * Preserve canonical V3/V2 error behavior for a position that
   * has neither a live row nor persisted trade history.
   */
  select public.execute_paper_protective_sell_v3(
    p_position_id =>
      p_position_id,

    p_exit_price =>
      p_exit_price,

    p_observed_at =>
      p_observed_at,

    p_execution_source =>
      p_execution_source,

    p_execution_provenance =>
      p_execution_provenance,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee,

    p_sell_tax =>
      p_sell_tax,

    p_exit_reason =>
      p_exit_reason
  )
  into v_result;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';

commit;
