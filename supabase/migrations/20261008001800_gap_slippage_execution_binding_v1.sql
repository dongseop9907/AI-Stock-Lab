begin;

alter table public.paper_order_requests
  add column if not exists execution_price numeric null,
  add column if not exists execution_price_observed_at timestamptz null,
  add column if not exists execution_price_source text null,
  add column if not exists execution_rejection_reason text null,
  add column if not exists execution_risk_snapshot jsonb null;

alter table public.paper_order_requests
  drop constraint if exists paper_order_requests_execution_price_positive;

alter table public.paper_order_requests
  add constraint paper_order_requests_execution_price_positive
  check (
    execution_price is null
    or execution_price > 0
  );

create or replace function public.execute_paper_buy_order_with_execution_price_v1(
  p_order_id uuid,
  p_execution_price numeric,
  p_execution_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set search_path = public
as $$
declare
  v_execution_drift_rate numeric;
  v_execution_stop_distance_rate numeric;
  v_execution_risk_amount numeric;
  v_execution_block_reason text;
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
    p_execution_price * v_order.approved_quantity;

  
  if p_execution_price is null or p_execution_price <= 0 then
    v_execution_block_reason := 'EXECUTION_PRICE_INVALID';
  elsif p_execution_observed_at is null then
    v_execution_block_reason := 'EXECUTION_OBSERVED_AT_REQUIRED';
  elsif p_execution_observed_at > clock_timestamp() + interval '30 seconds' then
    v_execution_block_reason := 'EXECUTION_SNAPSHOT_FROM_FUTURE';
  elsif p_execution_observed_at < clock_timestamp() - interval '10 minutes' then
    v_execution_block_reason := 'EXECUTION_SNAPSHOT_STALE';
  elsif v_order.entry_price is null or v_order.entry_price <= 0 then
    v_execution_block_reason := 'PLANNED_ENTRY_PRICE_INVALID';
  elsif v_order.stop_price is null or v_order.stop_price <= 0 then
    v_execution_block_reason := 'STOP_PRICE_INVALID';
  elsif p_execution_price <= v_order.stop_price then
    v_execution_block_reason := 'EXECUTION_PRICE_NOT_ABOVE_STOP';
  else
    v_execution_drift_rate :=
      (p_execution_price - v_order.entry_price) / v_order.entry_price;

    v_execution_stop_distance_rate :=
      (p_execution_price - v_order.stop_price) / p_execution_price;

    v_execution_risk_amount :=
      greatest(0, p_execution_price - v_order.stop_price)
      * v_order.approved_quantity;

    if v_execution_drift_rate > 0.01 then
      v_execution_block_reason := 'ADVERSE_ENTRY_DRIFT_EXCEEDED';
    elsif v_execution_stop_distance_rate < 0.01 then
      v_execution_block_reason := 'STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION';
    elsif v_execution_stop_distance_rate > 0.05 then
      v_execution_block_reason := 'STOP_DISTANCE_TOO_FAR_AT_EXECUTION';
    elsif v_execution_risk_amount >
      coalesce(v_order.reserved_risk_amount, 0) + 0.01 then
      v_execution_block_reason := 'ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK';
    end if;
  end if;

  if v_execution_block_reason is not null then
    update public.paper_order_requests
    set
      status = 'FAILED',
      execution_price = p_execution_price,
      execution_price_observed_at = p_execution_observed_at,
      execution_price_source = 'MARKET_SNAPSHOT_CLOSE',
      execution_rejection_reason = v_execution_block_reason,
      execution_risk_snapshot = jsonb_build_object(
        'plannedEntryPrice', v_order.entry_price,
        'executionPrice', p_execution_price,
        'stopPrice', v_order.stop_price,
        'approvedQuantity', v_order.approved_quantity,
        'reservedRiskAmount', coalesce(v_order.reserved_risk_amount, 0),
        'actualRiskAmount', v_execution_risk_amount,
        'driftRate', v_execution_drift_rate,
        'stopDistanceRate', v_execution_stop_distance_rate,
        'allowed', false,
        'blockReason', v_execution_block_reason
      )
    where id = v_order.id;

    return jsonb_build_object(
      'status', 'FAILED',
      'orderId', v_order.id,
      'stockCode', v_order.stock_code,
      'executionPrice', p_execution_price,
      'reason', v_execution_block_reason,
      'gapSlippageBlocked', true
    );
  end if;

  update public.paper_order_requests
  set
    execution_price = p_execution_price,
    execution_price_observed_at = p_execution_observed_at,
    execution_price_source = 'MARKET_SNAPSHOT_CLOSE',
    execution_rejection_reason = null,
    execution_risk_snapshot = jsonb_build_object(
      'plannedEntryPrice', v_order.entry_price,
      'executionPrice', p_execution_price,
      'stopPrice', v_order.stop_price,
      'approvedQuantity', v_order.approved_quantity,
      'reservedRiskAmount', coalesce(v_order.reserved_risk_amount, 0),
      'actualRiskAmount', v_execution_risk_amount,
      'driftRate', v_execution_drift_rate,
      'stopDistanceRate', v_execution_stop_distance_rate,
      'allowed', true
    )
  where id = v_order.id;

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
        p_execution_price * v_order.approved_quantity
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
      p_execution_price,
      v_order.stop_price
    from public.stocks s
    where s.stock_code = v_order.stock_code;

    if not found then
      raise exception 'STOCK_NOT_FOUND';
    end if;

    v_new_quantity := v_order.approved_quantity;
    v_new_average_price := p_execution_price;
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
    'filledPrice', p_execution_price,
    'orderAmount', v_order_amount,
    'remainingCash', v_account.cash_balance - v_order_amount,
    'positionQuantity', v_new_quantity,
    'averagePrice', round(v_new_average_price, 2),
    'stopPrice', v_new_stop_price,
    'executedAt', now()
  );
end;
$$;

revoke all on function public.execute_paper_buy_order_with_execution_price_v1(uuid, numeric, timestamptz)
from public;

grant execute on function public.execute_paper_buy_order_with_execution_price_v1(uuid, numeric, timestamptz)
to service_role;

commit;
