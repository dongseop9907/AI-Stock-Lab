create schema if not exists ai_stock_lab_lock_order_test;

revoke all on schema ai_stock_lab_lock_order_test from public;
revoke all on schema ai_stock_lab_lock_order_test from anon;
revoke all on schema ai_stock_lab_lock_order_test from authenticated;

create table if not exists ai_stock_lab_lock_order_test.state (
  run_id uuid not null,
  account_key uuid not null,
  row_key uuid not null,
  reserve_count integer not null default 0,
  fill_count integer not null default 0,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (run_id, row_key)
);

create index if not exists fill_lock_order_test_account_idx
on ai_stock_lab_lock_order_test.state(run_id, account_key);

create or replace function public.fill_lock_order_test_setup_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
begin
  insert into ai_stock_lab_lock_order_test.state (
    run_id,
    account_key,
    row_key
  )
  values (
    p_run_id,
    p_account_key,
    p_row_key
  )
  on conflict (run_id, row_key)
  do nothing;

  return pg_catalog.jsonb_build_object(
    'ok', true
  );
end;
$$;

create or replace function public.fill_lock_order_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid,
  p_hold_ms integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_row ai_stock_lab_lock_order_test.state%rowtype;
begin
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
  into v_row
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id
    and row_key = p_row_key
  for update;

  if not found then
    raise exception 'TEST_ROW_NOT_FOUND';
  end if;

  if v_row.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  update ai_stock_lab_lock_order_test.state
  set
    reserve_count = reserve_count + 1,
    version = version + 1,
    updated_at = now()
  where run_id = p_run_id
    and row_key = p_row_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'operation', 'reserve'
  );
end;
$$;

create or replace function public.fill_lock_order_test_fill_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid,
  p_hold_ms integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_row ai_stock_lab_lock_order_test.state%rowtype;
begin
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
  into v_row
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id
    and row_key = p_row_key
  for update;

  if not found then
    raise exception 'TEST_ROW_NOT_FOUND';
  end if;

  if v_row.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  update ai_stock_lab_lock_order_test.state
  set
    fill_count = fill_count + 1,
    version = version + 1,
    updated_at = now()
  where run_id = p_run_id
    and row_key = p_row_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'operation', 'fill'
  );
end;
$$;

create or replace function public.fill_lock_order_test_summary_v1(
  p_run_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
  select pg_catalog.jsonb_build_object(
    'rowCount', count(*),
    'reserveCount', coalesce(sum(reserve_count), 0),
    'fillCount', coalesce(sum(fill_count), 0),
    'version', coalesce(sum(version), 0)
  )
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id;
$$;

create or replace function public.fill_lock_order_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return pg_catalog.jsonb_build_object(
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from public;
revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from anon;
revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) to service_role;

revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from public;
revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from anon;
revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_summary_v1(
  uuid
) to service_role;

revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from public;
revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from anon;
revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_reset_v1(
  uuid
) to service_role;
