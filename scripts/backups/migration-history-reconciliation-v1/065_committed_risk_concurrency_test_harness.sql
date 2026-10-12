create schema if not exists ai_stock_lab_test;
revoke all on schema ai_stock_lab_test from public;
revoke all on schema ai_stock_lab_test from anon;
revoke all on schema ai_stock_lab_test from authenticated;

create table if not exists ai_stock_lab_test.committed_risk_reservations (
  run_id uuid not null,
  account_key uuid not null,
  request_id uuid not null,
  proposed_risk numeric not null,
  reserved_risk numeric not null default 0,
  approved boolean not null,
  committed_before numeric not null,
  committed_after numeric not null,
  budget numeric not null,
  created_at timestamptz not null default now(),
  primary key (run_id, request_id)
);

create index if not exists committed_risk_test_run_account_idx
on ai_stock_lab_test.committed_risk_reservations(run_id, account_key);

create or replace function public.committed_risk_concurrency_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_equity numeric,
  p_proposed_risk numeric,
  p_budget_rate numeric default 0.02,
  p_hold_ms integer default 35
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
declare
  v_existing ai_stock_lab_test.committed_risk_reservations%rowtype;
  v_budget numeric;
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
     or p_hold_ms > 500 then
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
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and request_id = p_request_id
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'approved', v_existing.approved,
      'requestId', v_existing.request_id,
      'proposedRisk', v_existing.proposed_risk,
      'reservedRisk', v_existing.reserved_risk,
      'committedRiskBefore', v_existing.committed_before,
      'committedRiskAfter', v_existing.committed_after,
      'budget', v_existing.budget
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  v_budget :=
    p_equity * p_budget_rate;

  select coalesce(sum(reserved_risk), 0)
  into v_before
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true;

  v_approved :=
    v_before + p_proposed_risk <= v_budget;

  v_after :=
    v_before +
    case
      when v_approved
        then p_proposed_risk
      else 0
    end;

  insert into ai_stock_lab_test.committed_risk_reservations (
    run_id,
    account_key,
    request_id,
    proposed_risk,
    reserved_risk,
    approved,
    committed_before,
    committed_after,
    budget
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
    v_before,
    v_after,
    v_budget
  );

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'approved', v_approved,
    'requestId', p_request_id,
    'proposedRisk', p_proposed_risk,
    'reservedRisk',
      case
        when v_approved
          then p_proposed_risk
        else 0
      end,
    'committedRiskBefore', v_before,
    'committedRiskAfter', v_after,
    'budget', v_budget
  );
end;
$$;

create or replace function public.committed_risk_concurrency_test_summary_v1(
  p_run_id uuid,
  p_account_key uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
  select pg_catalog.jsonb_build_object(
    'rowCount', count(*),
    'approvedCount',
      count(*) filter (where approved),
    'rejectedCount',
      count(*) filter (where not approved),
    'reservedRisk',
      coalesce(sum(reserved_risk), 0),
    'maxCommittedAfter',
      coalesce(max(committed_after), 0),
    'budget',
      coalesce(max(budget), 0)
  )
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and account_key = p_account_key;
$$;

create or replace function public.committed_risk_concurrency_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return pg_catalog.jsonb_build_object(
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from public;
revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from anon;
revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) to service_role;

revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from public;
revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from anon;
revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) to service_role;

revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from public;
revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from anon;
revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) to service_role;
