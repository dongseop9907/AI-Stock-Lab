-- ============================================================================
-- AI Stock Lab
-- Alpha V3 Data Freshness DB Create/Fill Guards V1
-- Migration: 20261008001700
--
-- Purpose
--   Defense-in-depth freshness enforcement at the database boundary.
--
-- Policy
--   PAPER BUY CREATE   => requires canonical FRESH + quality PASS
--   PAPER BUY EXECUTE  => requires canonical FRESH + quality PASS
--   Protective exits   => intentionally untouched
--   Risk maintenance   => intentionally untouched
--
-- Canonical sources
--   public.market_data_freshness_observations
--   public.market_data_quality_gate_observations
--
-- Latest row selection
--   observed_at DESC NULLS LAST,
--   created_at  DESC NULLS LAST
--
-- Fail-closed conditions
--   missing freshness row
--   missing quality-gate row
--   freshness status != FRESH
--   freshness usable_for_shadow_comparison != true
--   business_weekday_lag != 0
--   index_date_aligned != true
--   all_source_dates_aligned != true
--   expected market date missing
--   stock latest date missing
--   expected market date != stock latest date
--   quality status != PASS
--   quality freshness_status != FRESH
--   quality usable_for_forward_shadow != true
--   freshness/quality expected dates missing or mismatched
--
-- production_applied is provenance metadata only and is NOT an allow condition.
-- ============================================================================

create or replace function public.validate_paper_buy_data_freshness_v1(
  p_freshness_status text,
  p_freshness_usable boolean,
  p_expected_market_date date,
  p_stock_latest_date date,
  p_business_weekday_lag integer,
  p_index_date_aligned boolean,
  p_all_source_dates_aligned boolean,
  p_quality_status text,
  p_quality_freshness_status text,
  p_quality_usable boolean,
  p_quality_expected_market_date date
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_freshness_status text :=
    upper(trim(coalesce(p_freshness_status, '')));

  v_quality_status text :=
    upper(trim(coalesce(p_quality_status, '')));

  v_quality_freshness_status text :=
    upper(trim(coalesce(p_quality_freshness_status, '')));
begin
  if v_freshness_status <> 'FRESH' then
    return jsonb_build_object(
      'allowed', false,
      'reason',
        case
          when v_freshness_status = 'STALE'
            then 'STALE_MARKET_DATA'
          when v_freshness_status = ''
            then 'FRESHNESS_STATE_MISSING'
          else 'UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED'
        end
    );
  end if;

  if
    p_expected_market_date is null
    or p_stock_latest_date is null
    or p_quality_expected_market_date is null
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'MARKET_DATE_MISSING'
    );
  end if;

  if
    p_index_date_aligned is distinct from true
    or p_all_source_dates_aligned is distinct from true
    or p_expected_market_date <> p_stock_latest_date
    or p_expected_market_date <> p_quality_expected_market_date
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'MARKET_DATE_MISMATCH'
    );
  end if;

  if
    p_business_weekday_lag is null
    or p_business_weekday_lag <> 0
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'STALE_MARKET_DATA'
    );
  end if;

  if
    v_quality_status <> 'PASS'
    or v_quality_freshness_status <> 'FRESH'
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'QUALITY_GATE_FAILED'
    );
  end if;

  if
    p_freshness_usable is distinct from true
    or p_quality_usable is distinct from true
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'FRESHNESS_NOT_USABLE_FOR_PRODUCTION'
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'FRESH_DATA_NEW_RISK_ALLOWED'
  );
end;
$$;

revoke all on function public.validate_paper_buy_data_freshness_v1(
  text,
  boolean,
  date,
  date,
  integer,
  boolean,
  boolean,
  text,
  text,
  boolean,
  date
) from public;

grant execute on function public.validate_paper_buy_data_freshness_v1(
  text,
  boolean,
  date,
  date,
  integer,
  boolean,
  boolean,
  text,
  text,
  boolean,
  date
) to service_role;

create or replace function public.assert_paper_buy_data_freshness_allowed_v1()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_freshness public.market_data_freshness_observations%rowtype;
  v_quality public.market_data_quality_gate_observations%rowtype;
  v_decision jsonb;
  v_allowed boolean;
  v_reason text;
begin
  select f.*
  into v_freshness
  from public.market_data_freshness_observations f
  order by
    f.observed_at desc nulls last,
    f.created_at desc nulls last
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'DATA_FRESHNESS_NEW_RISK_BLOCKED:FRESHNESS_STATE_MISSING';
  end if;

  select q.*
  into v_quality
  from public.market_data_quality_gate_observations q
  order by
    q.observed_at desc nulls last,
    q.created_at desc nulls last
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'DATA_FRESHNESS_NEW_RISK_BLOCKED:QUALITY_GATE_STATE_MISSING';
  end if;

  v_decision :=
    public.validate_paper_buy_data_freshness_v1(
      v_freshness.status,
      v_freshness.usable_for_shadow_comparison,
      v_freshness.expected_market_date,
      v_freshness.stock_latest_date,
      v_freshness.business_weekday_lag,
      v_freshness.index_date_aligned,
      v_freshness.all_source_dates_aligned,
      v_quality.status,
      v_quality.freshness_status,
      v_quality.usable_for_forward_shadow,
      v_quality.expected_market_date
    );

  v_allowed :=
    coalesce(
      (v_decision ->> 'allowed')::boolean,
      false
    );

  v_reason :=
    coalesce(
      nullif(
        v_decision ->> 'reason',
        ''
      ),
      'UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED'
    );

  if not v_allowed then
    raise exception using
      errcode = 'P0001',
      message =
        'DATA_FRESHNESS_NEW_RISK_BLOCKED:' ||
        v_reason;
  end if;
end;
$$;

revoke all on function public.assert_paper_buy_data_freshness_allowed_v1()
from public;

grant execute on function public.assert_paper_buy_data_freshness_allowed_v1()
to service_role;

-- --------------------------------------------------------------------------
-- Preserve the exact current 01600 RPC bodies and add only the freshness
-- assertion immediately after the existing Kill Switch assertion.
-- --------------------------------------------------------------------------

create or replace function public.create_paper_buy_order_with_committed_risk_v3(
  p_account_id uuid,
  p_stock_code text,
  p_requested_quantity integer,
  p_entry_price numeric,
  p_stop_price numeric,
  p_risk_decision_id uuid,
  p_preflight_approved boolean,
  p_equity numeric,
  p_max_aggregate_open_risk_rate numeric default 0.02
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp

as $$
declare
  v_existing_order public.paper_order_requests%rowtype;
  v_order public.paper_order_requests%rowtype;

  v_invalid_open_stops integer := 0;
  v_open_position_risk numeric := 0;
  v_reserved_risk numeric := 0;
  v_proposed_risk numeric := 0;
  v_budget numeric := 0;
  v_committed_before numeric := 0;
  v_committed_after numeric := 0;

  v_final_approved boolean := false;
  v_status text := 'RISK_REJECTED';
  v_reason text := null;
  v_snapshot jsonb;
begin
  perform public.assert_paper_buy_new_risk_allowed_v1();

  -- Alpha V3 Data Freshness DB Guard V1:
  -- fail closed before any new-risk create/fill work proceeds.
  perform public.assert_paper_buy_data_freshness_allowed_v1();

  if p_account_id is null then
    raise exception 'ACCOUNT_ID_REQUIRED';
  end if;

  if coalesce(trim(p_stock_code), '') = '' then
    raise exception 'STOCK_CODE_REQUIRED';
  end if;

  if p_requested_quantity is null or p_requested_quantity <= 0 then
    raise exception 'REQUESTED_QUANTITY_INVALID';
  end if;

  if p_entry_price is null or p_entry_price <= 0 then
    raise exception 'ENTRY_PRICE_INVALID';
  end if;

  if p_stop_price is null or p_stop_price <= 0 then
    raise exception 'STOP_PRICE_INVALID';
  end if;

  if p_risk_decision_id is null then
    raise exception 'RISK_DECISION_ID_REQUIRED';
  end if;

  if p_equity is null or p_equity <= 0 then
    raise exception 'EQUITY_INVALID';
  end if;

  if (
    p_max_aggregate_open_risk_rate is null or
    p_max_aggregate_open_risk_rate <= 0 or
    p_max_aggregate_open_risk_rate > 1
  ) then
    raise exception 'MAX_AGGREGATE_OPEN_RISK_RATE_INVALID';
  end if;

  /*
   * One account-wide transaction lock serializes all committed BUY risk.
   * Two simultaneous approvals cannot consume the same remaining budget.
   */
  perform pg_advisory_xact_lock(
    hashtext('AI_STOCK_LAB_COMMITTED_RISK_V3:' || p_account_id::text)
  );

  /*
   * RPC-level idempotency:
   * if a network retry repeats the same risk_decision_id, return the already
   * created order instead of reserving risk again.
   */
  select *
  into v_existing_order
  from public.paper_order_requests
  where risk_decision_id = p_risk_decision_id
  order by created_at asc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'idempotent', true,
      'order', jsonb_build_object(
        'id', v_existing_order.id,
        'stock_code', v_existing_order.stock_code,
        'side', v_existing_order.side,
        'requested_quantity', v_existing_order.requested_quantity,
        'approved_quantity', v_existing_order.approved_quantity,
        'entry_price', v_existing_order.entry_price,
        'stop_price', v_existing_order.stop_price,
        'status', v_existing_order.status,
        'created_at', v_existing_order.created_at
      ),
      'committedRisk',
        coalesce(
          v_existing_order.committed_risk_snapshot,
          '{}'::jsonb
        )
    );
  end if;

  v_budget :=
    p_equity *
    p_max_aggregate_open_risk_rate;

  /*
   * Fail closed if an open position does not have a valid stop.
   */
  select
    count(*) filter (
      where current_stop_price is null
         or current_stop_price <= 0
         or average_price is null
         or average_price <= 0
         or quantity is null
         or quantity <= 0
    ),
    coalesce(
      sum(
        greatest(
          0,
          (
            average_price -
            current_stop_price
          ) *
          quantity
        )
      ) filter (
        where current_stop_price is not null
          and current_stop_price > 0
          and average_price is not null
          and average_price > 0
          and quantity is not null
          and quantity > 0
      ),
      0
    )
  into
    v_invalid_open_stops,
    v_open_position_risk
  from public.paper_positions
  where account_id = p_account_id;

  /*
   * Any positive reservation counts until it is explicitly/automatically
   * released. This intentionally fails safe even if an unusual intermediate
   * status appears.
   */
  select
    coalesce(
      sum(
        greatest(
          0,
          reserved_risk_amount
        )
      ),
      0
    )
  into v_reserved_risk
  from public.paper_order_requests
  where account_id = p_account_id
    and reserved_risk_amount > 0;

  v_proposed_risk :=
    greatest(
      0,
      (
        p_entry_price -
        p_stop_price
      ) *
      p_requested_quantity
    );

  v_committed_before :=
    v_open_position_risk +
    v_reserved_risk;

  v_committed_after :=
    v_committed_before +
    v_proposed_risk;

  if p_preflight_approved is not true then
    v_final_approved := false;
    v_reason := 'PREEXISTING_RISK_VALIDATION_REJECTED';

  elsif v_invalid_open_stops > 0 then
    v_final_approved := false;
    v_reason := 'OPEN_POSITION_STOP_MISSING';

  elsif p_stop_price >= p_entry_price then
    v_final_approved := false;
    v_reason := 'STOP_NOT_BELOW_ENTRY';

  elsif v_proposed_risk <= 0 then
    v_final_approved := false;
    v_reason := 'PROPOSED_RISK_NOT_POSITIVE';

  elsif v_committed_after > v_budget + 0.000001 then
    v_final_approved := false;
    v_reason := 'AGGREGATE_COMMITTED_RISK_LIMIT_EXCEEDED';

  else
    v_final_approved := true;
    v_reason := 'COMMITTED_RISK_RESERVED';
  end if;

  if v_final_approved then
    v_status := 'RISK_APPROVED';
  else
    v_status := 'RISK_REJECTED';
  end if;

  v_snapshot :=
    jsonb_build_object(
      'maxAggregateOpenRiskRate',
        p_max_aggregate_open_risk_rate,
      'riskBudgetAmount',
        v_budget,
      'equity',
        p_equity,
      'openPositionRiskAmount',
        v_open_position_risk,
      'activeBuyReservedRiskAmount',
        v_reserved_risk,
      'committedRiskBefore',
        v_committed_before,
      'proposedTradeRiskAmount',
        v_proposed_risk,
      'committedRiskAfter',
        v_committed_after,
      'invalidOpenPositionStopCount',
        v_invalid_open_stops,
      'approved',
        v_final_approved,
      'reason',
        v_reason
    );

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
    reserved_risk_amount,
    reserved_risk_at,
    committed_risk_reason,
    committed_risk_snapshot
  )
  values (
    p_account_id,
    p_stock_code,
    'BUY',
    p_requested_quantity,
    case
      when v_final_approved
      then p_requested_quantity
      else 0
    end,
    p_entry_price,
    p_stop_price,
    v_status,
    p_risk_decision_id,
    case
      when v_final_approved
      then v_proposed_risk
      else 0
    end,
    case
      when v_final_approved
      then now()
      else null
    end,
    v_reason,
    v_snapshot
  )
  returning *
  into v_order;

  /*
   * The original risk decision is the pre-commit decision. If committed risk
   * rejects the order, final approval must also be false in the audit row.
   */
  if not v_final_approved then
    update public.risk_decisions
    set approved = false
    where id = p_risk_decision_id;
  end if;

  return jsonb_build_object(
    'idempotent', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'stock_code', v_order.stock_code,
      'side', v_order.side,
      'requested_quantity', v_order.requested_quantity,
      'approved_quantity', v_order.approved_quantity,
      'entry_price', v_order.entry_price,
      'stop_price', v_order.stop_price,
      'status', v_order.status,
      'created_at', v_order.created_at
    ),
    'committedRisk',
      v_snapshot
  );
end;
$$;

create or replace function public.execute_paper_buy_order(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set search_path = public
as $$
declare
  v_order public.paper_order_requests%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_positions%rowtype;

  v_order_amount numeric(18, 2);
  v_new_quantity integer;
  v_new_average_price numeric(18, 2);
  v_new_stop_price numeric(18, 2);
begin
  perform public.assert_paper_buy_new_risk_allowed_v1();

  -- Alpha V3 Data Freshness DB Guard V1:
  -- fail closed before any new-risk create/fill work proceeds.
  perform public.assert_paper_buy_data_freshness_allowed_v1();

  /*
   * 같은 주문이 동시에 두 번 체결되지 않도록
   * 주문 행을 잠근다.
   */
    -- Lock ordering invariant:
  -- account advisory lock -> order row FOR UPDATE.
  -- The account id is read without a row lock only to derive the shared
  -- committed-risk lock key. The canonical row is then re-read FOR UPDATE.
  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      coalesce(
        (
          select por.account_id::text
          from public.paper_order_requests por
          where por.id = p_order_id
        ),
        'MISSING_ORDER:' || p_order_id::text
      )
    )
  );

select *
  into v_order
  from public.paper_order_requests
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
if v_order.side <> 'BUY' then
    raise exception 'ONLY_BUY_ORDER_SUPPORTED';
  end if;

  /*
   * 이미 체결된 주문은 다시 현금을 차감하지 않는다.
   */
  if v_order.status = 'FILLED' then
    return jsonb_build_object(
      'alreadyFilled', true,
      'orderId', v_order.id,
      'status', v_order.status,
      'filledQuantity', v_order.filled_quantity,
      'filledPrice', v_order.filled_price,
      'executedAt', v_order.executed_at
    );
  end if;

  if v_order.status <> 'RISK_APPROVED' then
    raise exception 'ORDER_NOT_RISK_APPROVED';
  end if;

  if v_order.approved_quantity <= 0 then
    raise exception 'APPROVED_QUANTITY_IS_ZERO';
  end if;

  if v_order.stop_price is null then
    raise exception 'STOP_PRICE_IS_REQUIRED';
  end if;

  /*
   * 체결 중 잔액이 변경되지 않도록 계좌 행을 잠근다.
   */
  select *
  into v_account
  from public.paper_accounts
  where id = v_order.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if v_account.trading_mode <> 'PAPER' then
    raise exception 'LIVE_ACCOUNT_NOT_ALLOWED';
  end if;

  v_order_amount :=
    v_order.entry_price * v_order.approved_quantity;

  if v_account.cash_balance < v_order_amount then
    raise exception 'INSUFFICIENT_CASH_AT_EXECUTION';
  end if;

  /*
   * 기존 보유 종목이 있다면 평균 매수가를 다시 계산한다.
   */
  select *
  into v_position
  from public.paper_positions
  where account_id = v_order.account_id
    and stock_code = v_order.stock_code
  for update;

  if found then
    v_new_quantity :=
      v_position.quantity + v_order.approved_quantity;

    v_new_average_price :=
      (
        v_position.average_price * v_position.quantity
        +
        v_order.entry_price * v_order.approved_quantity
      ) / v_new_quantity;

    /*
     * 추가매수하더라도 기존 손절가보다 아래로 내리지 않는다.
     */
    v_new_stop_price :=
      greatest(
        v_position.current_stop_price,
        v_order.stop_price
      );

    update public.paper_positions
    set
      quantity = v_new_quantity,
      average_price = round(v_new_average_price, 2),
      current_stop_price = v_new_stop_price,
      updated_at = now()
    where id = v_position.id;

  else
    insert into public.paper_positions (
      account_id,
      stock_code,
      sector,
      quantity,
      average_price,
      current_stop_price
    )
    select
      v_order.account_id,
      v_order.stock_code,
      s.sector,
      v_order.approved_quantity,
      v_order.entry_price,
      v_order.stop_price
    from public.stocks s
    where s.stock_code = v_order.stock_code;

    if not found then
      raise exception 'STOCK_NOT_FOUND';
    end if;

    v_new_quantity := v_order.approved_quantity;
    v_new_average_price := v_order.entry_price;
    v_new_stop_price := v_order.stop_price;
  end if;

  update public.paper_accounts
  set
    cash_balance = cash_balance - v_order_amount,
    updated_at = now()
  where id = v_order.account_id;

  update public.paper_order_requests
  set
    status = 'FILLED',
    filled_quantity = approved_quantity,
    filled_price = entry_price,
    executed_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'alreadyFilled', false,
    'orderId', v_order.id,
    'accountId', v_order.account_id,
    'stockCode', v_order.stock_code,
    'status', 'FILLED',
    'filledQuantity', v_order.approved_quantity,
    'filledPrice', v_order.entry_price,
    'orderAmount', v_order_amount,
    'remainingCash', v_account.cash_balance - v_order_amount,
    'positionQuantity', v_new_quantity,
    'averagePrice', round(v_new_average_price, 2),
    'stopPrice', v_new_stop_price,
    'executedAt', now()
  );
end;
$$;
