-- AI Stock Lab
-- PAPER BUY DB Exposure Stress Harness V1
--
-- Test-only RPC surface for service_role.
-- It is intentionally restricted to accounts whose account_name begins
-- with AI_STOCK_LAB_STRESS_. It does not call any broker/external API.
--
-- Purpose:
--   1. exercise assert_paper_buy_exposure_limits_v1 through real DB RPC
--   2. insert one synthetic RISK_APPROVED pending BUY on success
--   3. allow two independent HTTP transactions to prove the account-row
--      lock closes concurrent exposure races
--
-- Production trading functions are not modified.

begin;

create or replace function public.run_paper_buy_exposure_stress_commit_v1(
  p_account_id uuid,
  p_stock_code text,
  p_requested_quantity integer,
  p_entry_price numeric,
  p_equity numeric,
  p_max_position_rate numeric,
  p_max_portfolio_exposure_rate numeric,
  p_max_sector_exposure_rate numeric,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_name text;
  v_risk_decision_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_stop_price numeric;
  v_reserved_risk numeric;
begin
  select a.account_name
  into v_account_name
  from public.paper_accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'STRESS_ACCOUNT_NOT_FOUND';
  end if;

  if
    v_account_name is null or
    v_account_name not like 'AI_STOCK_LAB_STRESS_%'
  then
    raise exception 'STRESS_ACCOUNT_PREFIX_REQUIRED';
  end if;

  if p_hold_ms is null or p_hold_ms < 0 or p_hold_ms > 500 then
    raise exception 'STRESS_HOLD_MS_INVALID';
  end if;

  /*
   * Authoritative production exposure helper.
   * It locks paper_accounts FOR UPDATE and therefore holds the account
   * serialization lock until this wrapper transaction commits/rolls back.
   */
  perform public.assert_paper_buy_exposure_limits_v1(
    p_account_id,
    p_stock_code,
    p_requested_quantity,
    p_entry_price,
    p_equity,
    p_max_position_rate,
    p_max_portfolio_exposure_rate,
    p_max_sector_exposure_rate
  );

  v_stop_price :=
    round(
      p_entry_price * 0.97,
      6
    );

  v_reserved_risk :=
    greatest(
      p_entry_price - v_stop_price,
      0
    ) *
    p_requested_quantity;

  insert into public.risk_decisions (
    account_id,
    stock_code,
    action,
    approved,
    requested_payload,
    result_payload
  )
  values (
    p_account_id,
    p_stock_code,
    'BUY',
    true,
    jsonb_build_object(
      'test',
        'PAPER_BUY_DB_EXPOSURE_STRESS_V1',
      'synthetic',
        true,
      'persistent',
        false,
      'requestedQuantity',
        p_requested_quantity,
      'entryPrice',
        p_entry_price
    ),
    jsonb_build_object(
      'approved',
        true,
      'reason',
        'DB_EXPOSURE_STRESS_SYNTHETIC'
    )
  )
  returning id
  into v_risk_decision_id;

  insert into public.paper_order_requests (
    id,
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
    reserved_risk_amount,
    reserved_risk_at,
    committed_risk_reason,
    committed_risk_snapshot
  )
  values (
    v_order_id,
    p_account_id,
    p_stock_code,
    'BUY',
    p_requested_quantity,
    p_requested_quantity,
    p_entry_price,
    v_stop_price,
    'RISK_APPROVED',
    v_risk_decision_id,
    0,
    v_reserved_risk,
    now(),
    'DB_EXPOSURE_STRESS_SYNTHETIC',
    jsonb_build_object(
      'test',
        'PAPER_BUY_DB_EXPOSURE_STRESS_V1',
      'synthetic',
        true,
      'persistent',
        false
    )
  );

  if p_hold_ms > 0 then
    perform pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  return jsonb_build_object(
    'status',
      'STRESS_ORDER_CREATED',
    'orderId',
      v_order_id,
    'riskDecisionId',
      v_risk_decision_id,
    'accountId',
      p_account_id,
    'stockCode',
      p_stock_code,
    'requestedQuantity',
      p_requested_quantity,
    'entryPrice',
      p_entry_price,
    'orderAmount',
      p_requested_quantity * p_entry_price
  );
end;
$$;

revoke all on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
from public, anon, authenticated;

grant execute on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
to service_role;

comment on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
is
  'Service-role-only synthetic DB exposure stress RPC. Restricted to AI_STOCK_LAB_STRESS_* PAPER accounts. Calls the production exposure guard and inserts one synthetic pending BUY only when the guard permits it.';

commit;
