create schema if not exists ai_stock_lab_transfer_test;

revoke all on schema ai_stock_lab_transfer_test from public;
revoke all on schema ai_stock_lab_transfer_test from anon;
revoke all on schema ai_stock_lab_transfer_test from authenticated;

create table if not exists ai_stock_lab_transfer_test.reservations (
  run_id uuid not null,
  account_key uuid not null,
  request_id uuid not null,
  proposed_risk numeric not null,
  reserved_risk numeric not null default 0,
  approved boolean not null,
  filled boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (run_id, request_id)
);

create index if not exists committed_risk_transfer_test_reservation_account_idx
on ai_stock_lab_transfer_test.reservations(run_id, account_key);

create table if not exists ai_stock_lab_transfer_test.positions (
  run_id uuid not null,
  account_key uuid not null,
  position_key uuid not null,
  stop_risk numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, position_key)
);

create index if not exists committed_risk_transfer_test_position_account_idx
on ai_stock_lab_transfer_test.positions(run_id, account_key);

create or replace function public.committed_risk_transfer_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_equity numeric,
  p_proposed_risk numeric,
  p_budget_rate numeric default 0.02,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_existing ai_stock_lab_transfer_test.reservations%rowtype;
  v_budget numeric;
  v_reserved numeric;
  v_position numeric;
  v_before numeric;
  v_after numeric;
  v_approved boolean;
begin
  if p_run_id is null
     or p_account_key is null
     or p_request_id is null then
    raise exception 'TEST_IDENTIFIERS_REQUIRED';
  end if;

  if p_equity is null
     or p_equity <= 0 then
    raise exception 'TEST_EQUITY_MUST_BE_POSITIVE';
  end if;

  if p_proposed_risk is null
     or p_proposed_risk <= 0 then
    raise exception 'TEST_PROPOSED_RISK_MUST_BE_POSITIVE';
  end if;

  if p_budget_rate is null
     or p_budget_rate <= 0
     or p_budget_rate > 1 then
    raise exception 'TEST_BUDGET_RATE_INVALID';
  end if;

  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 1000 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_existing
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and request_id = p_request_id
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'approved', v_existing.approved,
      'requestId', v_existing.request_id,
      'reservedRisk', v_existing.reserved_risk,
      'filled', v_existing.filled
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  v_budget := p_equity * p_budget_rate;

  select coalesce(sum(reserved_risk), 0)
  into v_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  v_before := v_reserved + v_position;

  v_approved :=
    v_before + p_proposed_risk <= v_budget;

  v_after :=
    v_before +
    case
      when v_approved
        then p_proposed_risk
      else 0
    end;

  insert into ai_stock_lab_transfer_test.reservations (
    run_id,
    account_key,
    request_id,
    proposed_risk,
    reserved_risk,
    approved,
    filled,
    released_at
  )
  values (
    p_run_id,
    p_account_key,
    p_request_id,
    p_proposed_risk,
    case
      when v_approved
        then p_proposed_risk
      else 0
    end,
    v_approved,
    false,
    case
      when v_approved
        then null
      else now()
    end
  );

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'approved', v_approved,
    'requestId', p_request_id,
    'reservedRisk',
      case
        when v_approved
          then p_proposed_risk
        else 0
      end,
    'positionRisk', v_position,
    'committedRiskBefore', v_before,
    'committedRiskAfter', v_after,
    'budget', v_budget
  );
end;
$$;

create or replace function public.committed_risk_transfer_test_fill_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_position_key uuid,
  p_position_risk numeric,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_reservation ai_stock_lab_transfer_test.reservations%rowtype;
  v_before_reserved numeric;
  v_before_position numeric;
  v_after_reserved numeric;
  v_after_position numeric;
begin
  if p_run_id is null
     or p_account_key is null
     or p_request_id is null
     or p_position_key is null then
    raise exception 'TEST_IDENTIFIERS_REQUIRED';
  end if;

  if p_position_risk is null
     or p_position_risk < 0 then
    raise exception 'TEST_POSITION_RISK_INVALID';
  end if;

  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 1000 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_reservation
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and request_id = p_request_id
  for update;

  if not found then
    raise exception 'TEST_RESERVATION_NOT_FOUND';
  end if;

  if not v_reservation.approved then
    raise exception 'TEST_RESERVATION_NOT_APPROVED';
  end if;

  if v_reservation.filled then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'requestId', p_request_id,
      'positionKey', p_position_key
    );
  end if;

  select coalesce(sum(reserved_risk), 0)
  into v_before_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_before_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  insert into ai_stock_lab_transfer_test.positions (
    run_id,
    account_key,
    position_key,
    stop_risk,
    created_at,
    updated_at
  )
  values (
    p_run_id,
    p_account_key,
    p_position_key,
    p_position_risk,
    now(),
    now()
  )
  on conflict (run_id, position_key)
  do update set
    stop_risk = excluded.stop_risk,
    updated_at = now();

  update ai_stock_lab_transfer_test.reservations
  set
    filled = true,
    reserved_risk = 0,
    released_at = now()
  where run_id = p_run_id
    and request_id = p_request_id;

  select coalesce(sum(reserved_risk), 0)
  into v_after_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_after_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'requestId', p_request_id,
    'positionKey', p_position_key,
    'reservationRiskBefore', v_reservation.reserved_risk,
    'positionRiskApplied', p_position_risk,
    'committedRiskBefore',
      v_before_reserved + v_before_position,
    'committedRiskAfter',
      v_after_reserved + v_after_position,
    'reservedRiskAfter', v_after_reserved,
    'positionRiskAfter', v_after_position
  );
end;
$$;

create or replace function public.committed_risk_transfer_test_summary_v1(
  p_run_id uuid,
  p_account_key uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
  with r as (
    select
      count(*) filter (
        where approved = true
          and filled = false
          and released_at is null
      ) as active_reservation_count,
      coalesce(
        sum(reserved_risk) filter (
          where approved = true
            and filled = false
            and released_at is null
        ),
        0
      ) as reserved_risk
    from ai_stock_lab_transfer_test.reservations
    where run_id = p_run_id
      and account_key = p_account_key
  ),
  p as (
    select
      count(*) as position_count,
      coalesce(sum(stop_risk), 0) as position_risk
    from ai_stock_lab_transfer_test.positions
    where run_id = p_run_id
      and account_key = p_account_key
  )
  select pg_catalog.jsonb_build_object(
    'activeReservationCount', r.active_reservation_count,
    'reservedRisk', r.reserved_risk,
    'positionCount', p.position_count,
    'positionRisk', p.position_risk,
    'committedRisk', r.reserved_risk + p.position_risk
  )
  from r, p;
$$;

create or replace function public.committed_risk_transfer_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_reservations integer;
  v_positions integer;
begin
  delete from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id;

  get diagnostics v_positions = row_count;

  delete from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id;

  get diagnostics v_reservations = row_count;

  return pg_catalog.jsonb_build_object(
    'reservationsDeleted', v_reservations,
    'positionsDeleted', v_positions
  );
end;
$$;

revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from public;
revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from anon;
revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) to service_role;

revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from public;
revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from anon;
revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) to service_role;

revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from public;
revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from anon;
revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) to service_role;

revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from public;
revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from anon;
revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.committed_risk_transfer_test_reset_v1(
  uuid
) to service_role;
