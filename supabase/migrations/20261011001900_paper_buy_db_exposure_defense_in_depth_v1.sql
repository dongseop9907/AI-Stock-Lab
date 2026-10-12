-- AI Stock Lab
-- PAPER BUY DB Exposure Defense-in-Depth V1
--
-- Purpose:
--   Preserve the application-level 10% ticker / 60% portfolio /
--   25% sector notional exposure policy at the authoritative
--   PostgreSQL order-create boundary.
--
-- Concurrency:
--   Locks paper_accounts row before reading exposure and inserting
--   a new risk-approved BUY order, serializing commitments per account.
--
-- Compatibility:
--   create_paper_buy_order_with_committed_risk_v3 signature is unchanged.
--   Existing callers remain compatible.
--
-- No historical rows are rewritten.

begin;

create or replace function public.assert_paper_buy_exposure_limits_v1(
  p_account_id uuid,
  p_stock_code text,
  p_requested_quantity integer,
  p_entry_price numeric,
  p_equity numeric,
  p_max_position_rate numeric default 0.10,
  p_max_portfolio_exposure_rate numeric default 0.60,
  p_max_sector_exposure_rate numeric default 0.25
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sector text;
  v_order_amount numeric := 0;

  v_position_exposure numeric := 0;
  v_portfolio_exposure numeric := 0;
  v_sector_exposure numeric := 0;

  v_pending_position_exposure numeric := 0;
  v_pending_portfolio_exposure numeric := 0;
  v_pending_sector_exposure numeric := 0;

  v_max_position_amount numeric := 0;
  v_max_portfolio_amount numeric := 0;
  v_max_sector_amount numeric := 0;
begin
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

  if p_equity is null or p_equity <= 0 then
    raise exception 'EQUITY_INVALID';
  end if;

  if
    p_max_position_rate is null or
    p_max_position_rate <= 0 or
    p_max_position_rate > 1
  then
    raise exception 'MAX_POSITION_RATE_INVALID';
  end if;

  if
    p_max_portfolio_exposure_rate is null or
    p_max_portfolio_exposure_rate <= 0 or
    p_max_portfolio_exposure_rate > 1
  then
    raise exception 'MAX_PORTFOLIO_EXPOSURE_RATE_INVALID';
  end if;

  if
    p_max_sector_exposure_rate is null or
    p_max_sector_exposure_rate <= 0 or
    p_max_sector_exposure_rate > 1
  then
    raise exception 'MAX_SECTOR_EXPOSURE_RATE_INVALID';
  end if;

  /*
   * Serialize exposure commitments per PAPER account.
   * This prevents two concurrent order-create transactions from both
   * observing the same pre-order exposure and jointly exceeding a limit.
   */
  perform 1
  from public.paper_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  select
    coalesce(
      nullif(
        trim(s.sector),
        ''
      ),
      '__UNKNOWN__'
    )
  into v_sector
  from public.stocks s
  where s.stock_code = p_stock_code
  limit 1;

  if not found then
    raise exception 'STOCK_NOT_FOUND';
  end if;

  v_order_amount :=
    p_entry_price *
    p_requested_quantity;

  v_max_position_amount :=
    p_equity *
    p_max_position_rate;

  v_max_portfolio_amount :=
    p_equity *
    p_max_portfolio_exposure_rate;

  v_max_sector_amount :=
    p_equity *
    p_max_sector_exposure_rate;

  /*
   * Filled/open position notional exposure.
   * Basis intentionally matches the application risk-manager:
   * quantity * average entry price.
   */
  select
    coalesce(
      sum(
        case
          when p.stock_code = p_stock_code
          then
            coalesce(p.quantity, 0) *
            coalesce(p.average_price, 0)
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        coalesce(p.quantity, 0) *
        coalesce(p.average_price, 0)
      ),
      0
    ),
    coalesce(
      sum(
        case
          when
            coalesce(
              nullif(
                trim(p.sector),
                ''
              ),
              '__UNKNOWN__'
            ) = v_sector
          then
            coalesce(p.quantity, 0) *
            coalesce(p.average_price, 0)
          else 0
        end
      ),
      0
    )
  into
    v_position_exposure,
    v_portfolio_exposure,
    v_sector_exposure
  from public.paper_positions p
  where
    p.account_id = p_account_id and
    coalesce(p.quantity, 0) > 0;

  /*
   * Also reserve notional exposure for active BUY orders that have not
   * yet filled completely. This closes the gap between order creation
   * and position creation.
   */
  select
    coalesce(
      sum(
        case
          when o.stock_code = p_stock_code
          then
            greatest(
              coalesce(
                o.approved_quantity,
                o.requested_quantity,
                0
              ) -
              coalesce(
                o.filled_quantity,
                0
              ),
              0
            ) *
            coalesce(
              o.entry_price,
              0
            )
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        greatest(
          coalesce(
            o.approved_quantity,
            o.requested_quantity,
            0
          ) -
          coalesce(
            o.filled_quantity,
            0
          ),
          0
        ) *
        coalesce(
          o.entry_price,
          0
        )
      ),
      0
    ),
    coalesce(
      sum(
        case
          when
            coalesce(
              nullif(
                trim(s.sector),
                ''
              ),
              '__UNKNOWN__'
            ) = v_sector
          then
            greatest(
              coalesce(
                o.approved_quantity,
                o.requested_quantity,
                0
              ) -
              coalesce(
                o.filled_quantity,
                0
              ),
              0
            ) *
            coalesce(
              o.entry_price,
              0
            )
          else 0
        end
      ),
      0
    )
  into
    v_pending_position_exposure,
    v_pending_portfolio_exposure,
    v_pending_sector_exposure
  from public.paper_order_requests o
  left join public.stocks s
    on s.stock_code = o.stock_code
  where
    o.account_id = p_account_id and
    o.status in (
      'REQUESTED',
      'RISK_APPROVED'
    );

  if
    v_position_exposure +
    v_pending_position_exposure +
    v_order_amount >
    v_max_position_amount
  then
    raise exception 'POSITION_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'currentPositionExposure',
            v_position_exposure,
          'pendingPositionExposure',
            v_pending_position_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxPositionAmount',
            v_max_position_amount
        )::text;
  end if;

  if
    v_portfolio_exposure +
    v_pending_portfolio_exposure +
    v_order_amount >
    v_max_portfolio_amount
  then
    raise exception 'PORTFOLIO_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'currentPortfolioExposure',
            v_portfolio_exposure,
          'pendingPortfolioExposure',
            v_pending_portfolio_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxPortfolioAmount',
            v_max_portfolio_amount
        )::text;
  end if;

  if
    v_sector_exposure +
    v_pending_sector_exposure +
    v_order_amount >
    v_max_sector_amount
  then
    raise exception 'SECTOR_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'sector',
            v_sector,
          'currentSectorExposure',
            v_sector_exposure,
          'pendingSectorExposure',
            v_pending_sector_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxSectorAmount',
            v_max_sector_amount
        )::text;
  end if;
end;
$$;

revoke all on function
  public.assert_paper_buy_exposure_limits_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric
  )
from public, anon, authenticated;

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

  perform public.assert_paper_buy_exposure_limits_v1(
    p_account_id,
    p_stock_code,
    p_requested_quantity,
    p_entry_price,
    p_equity
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

comment on function
  public.assert_paper_buy_exposure_limits_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric
  )
is
  'Fail-closed PAPER BUY notional exposure guard. Serializes by account and enforces ticker 10%, portfolio 60%, sector 25% defaults including active unfilled BUY commitments.';

comment on function
  public.create_paper_buy_order_with_committed_risk_v3(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    uuid,
    boolean,
    numeric,
    numeric
  )
is
  'Canonical committed-risk PAPER BUY order-create RPC with aggregate open-risk, freshness and DB notional exposure defense-in-depth.';

commit;
