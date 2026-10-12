-- PAPER EXECUTION REALISM V2 PROTECTIVE SELL BINDING
-- Protective exits remain risk-reducing actions and are intentionally
-- not blocked by the new-risk kill switch.
begin;

create table if not exists public.paper_protective_execution_fills_v2 (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null,
  account_id uuid not null,
  stock_code text not null,
  requested_quantity integer not null,
  filled_quantity integer not null,
  remaining_quantity integer not null,
  execution_price numeric not null,
  broker_fee numeric not null default 0,
  sell_tax numeric not null default 0,
  total_transaction_cost numeric not null default 0,
  execution_source text not null,
  exit_reason text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (requested_quantity > 0),
  check (filled_quantity > 0),
  check (remaining_quantity >= 0),
  check (execution_price > 0),
  check (broker_fee >= 0),
  check (sell_tax >= 0),
  check (total_transaction_cost >= 0)
);

create index if not exists idx_paper_protective_execution_fills_v2_position
  on public.paper_protective_execution_fills_v2(position_id, observed_at desc);

create index if not exists idx_paper_protective_execution_fills_v2_stock
  on public.paper_protective_execution_fills_v2(stock_code, observed_at desc);

create or replace function public.execute_paper_protective_sell_v2(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_execution_source text default 'PAPER_EXECUTION_REALISM_V2',
  p_exit_reason text default 'PROTECTIVE_STOP'
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

commit;
