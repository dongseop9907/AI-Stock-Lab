create schema if not exists ai_stock_lab_expiry_test;

revoke all on schema ai_stock_lab_expiry_test from public;
revoke all on schema ai_stock_lab_expiry_test from anon;
revoke all on schema ai_stock_lab_expiry_test from authenticated;

create table if not exists ai_stock_lab_expiry_test.orders (
  run_id uuid not null,
  id uuid not null,
  account_key uuid not null,
  status text not null,
  side text not null default 'BUY',
  reserved_risk_amount numeric not null default 0,
  reserved_risk_at timestamptz,
  reserved_risk_released_at timestamptz,
  reserved_risk_release_reason text,
  created_at timestamptz not null default now(),
  committed_risk_reason text,
  primary key (run_id, id)
);

create or replace function ai_stock_lab_expiry_test.release_terminal_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
begin
  if new.status in (
    'FILLED',
    'RISK_REJECTED',
    'REJECTED',
    'CANCELLED',
    'CANCELED',
    'EXPIRED',
    'FAILED',
    'CLOSED'
  )
  and coalesce(new.reserved_risk_amount, 0) > 0 then
    new.reserved_risk_amount := 0;
    new.reserved_risk_released_at :=
      coalesce(new.reserved_risk_released_at, now());
    new.reserved_risk_release_reason :=
      coalesce(
        new.reserved_risk_release_reason,
        'TERMINAL_STATUS:' || new.status
      );
  end if;

  return new;
end;
$$;

drop trigger if exists
  trg_expiry_test_terminal_release
on ai_stock_lab_expiry_test.orders;

create trigger
  trg_expiry_test_terminal_release
before update of status
on ai_stock_lab_expiry_test.orders
for each row
execute function ai_stock_lab_expiry_test.release_terminal_v1();

create or replace function public.expiry_test_seed_v1(
  p_run_id uuid,
  p_id uuid,
  p_account_key uuid,
  p_status text,
  p_reserved_risk numeric,
  p_age_seconds integer,
  p_reserved_at_null boolean default false,
  p_released_at_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
begin
  insert into ai_stock_lab_expiry_test.orders (
    run_id,
    id,
    account_key,
    status,
    side,
    reserved_risk_amount,
    reserved_risk_at,
    reserved_risk_released_at,
    created_at
  )
  values (
    p_run_id,
    p_id,
    p_account_key,
    p_status,
    'BUY',
    p_reserved_risk,
    case
      when p_reserved_at_null then null
      else now() - make_interval(secs => p_age_seconds)
    end,
    case
      when p_released_at_conflict then now() - interval '30 seconds'
      else null
    end,
    now() - make_interval(secs => p_age_seconds)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.expiry_test_fill_v1(
  p_run_id uuid,
  p_id uuid,
  p_account_key uuid,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_order ai_stock_lab_expiry_test.orders%rowtype;
begin
  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_order
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and id = p_id
  for update;

  if not found then
    raise exception 'TEST_ORDER_NOT_FOUND';
  end if;

  if v_order.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if v_order.status <> 'RISK_APPROVED' then
    return jsonb_build_object(
      'ok', false,
      'skipped', true,
      'status', v_order.status
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_sleep(p_hold_ms::numeric / 1000.0);
  end if;

  update ai_stock_lab_expiry_test.orders
  set status = 'FILLED'
  where run_id = p_run_id
    and id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'FILLED'
  );
end;
$$;

create or replace function public.expiry_test_expire_v1(
  p_run_id uuid,
  p_stale_after interval,
  p_limit integer default 100,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_candidate record;
  v_order ai_stock_lab_expiry_test.orders%rowtype;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_cutoff timestamptz;
begin
  v_cutoff := now() - p_stale_after;

  for v_candidate in
    select id, account_key
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and status = 'RISK_APPROVED'
      and side = 'BUY'
      and reserved_risk_amount > 0
      and reserved_risk_released_at is null
      and coalesce(reserved_risk_at, created_at) <= v_cutoff
    order by account_key, id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_key::text
      )
    );

    select *
    into v_order
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and id = v_candidate.id
    for update;

    if not found
       or v_order.account_key <> v_candidate.account_key
       or v_order.status <> 'RISK_APPROVED'
       or coalesce(v_order.reserved_risk_amount, 0) <= 0
       or v_order.reserved_risk_released_at is not null
       or coalesce(v_order.reserved_risk_at, v_order.created_at) > v_cutoff then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_hold_ms > 0 then
      perform pg_sleep(p_hold_ms::numeric / 1000.0);
    end if;

    update ai_stock_lab_expiry_test.orders
    set
      status = 'EXPIRED',
      committed_risk_reason = 'STALE_RISK_APPROVED_EXPIRED'
    where run_id = p_run_id
      and id = v_order.id;

    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object(
    'expiredCount', v_expired,
    'skippedCount', v_skipped
  );
end;
$$;

create or replace function public.expiry_test_reconcile_v1(
  p_run_id uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_candidate record;
  v_order ai_stock_lab_expiry_test.orders%rowtype;
  v_released integer := 0;
  v_released_risk numeric := 0;
  v_zero integer := 0;
  v_missing integer := 0;
  v_conflict integer := 0;
begin
  for v_candidate in
    select id, account_key
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and status in (
        'FILLED',
        'RISK_REJECTED',
        'REJECTED',
        'CANCELLED',
        'CANCELED',
        'EXPIRED',
        'FAILED',
        'CLOSED'
      )
      and reserved_risk_amount > 0
    order by account_key, id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_key::text
      )
    );

    select *
    into v_order
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and id = v_candidate.id
    for update;

    if not found
       or v_order.account_key <> v_candidate.account_key
       or v_order.status not in (
         'FILLED',
         'RISK_REJECTED',
         'REJECTED',
         'CANCELLED',
         'CANCELED',
         'EXPIRED',
         'FAILED',
         'CLOSED'
       )
       or coalesce(v_order.reserved_risk_amount, 0) <= 0 then
      continue;
    end if;

    v_released_risk :=
      v_released_risk + v_order.reserved_risk_amount;

    update ai_stock_lab_expiry_test.orders
    set
      reserved_risk_amount = 0,
      reserved_risk_released_at =
        coalesce(reserved_risk_released_at, now()),
      reserved_risk_release_reason =
        coalesce(
          reserved_risk_release_reason,
          'RECONCILED_TERMINAL_STATUS:' || v_order.status
        )
    where run_id = p_run_id
      and id = v_order.id;

    v_released := v_released + 1;
  end loop;

  select count(*)
  into v_zero
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and coalesce(reserved_risk_amount, 0) <= 0;

  select count(*)
  into v_missing
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and reserved_risk_amount > 0
    and reserved_risk_at is null;

  select count(*)
  into v_conflict
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and reserved_risk_amount > 0
    and reserved_risk_released_at is not null;

  return jsonb_build_object(
    'releasedCount', v_released,
    'releasedRisk', v_released_risk,
    'zeroReservationCount', v_zero,
    'missingReservedAtCount', v_missing,
    'releasedAtConflictCount', v_conflict
  );
end;
$$;

create or replace function public.expiry_test_get_order_v1(
  p_run_id uuid,
  p_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
  select to_jsonb(o)
  from ai_stock_lab_expiry_test.orders o
  where o.run_id = p_run_id
    and o.id = p_id;
$$;

create or replace function public.expiry_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from public;
revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from anon;
revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from authenticated;
grant execute on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) to service_role;

revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from public;
revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from anon;
revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from authenticated;
grant execute on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) to service_role;

revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from public;
revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from anon;
revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from authenticated;
grant execute on function public.expiry_test_reconcile_v1(
  uuid, integer
) to service_role;

revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from public;
revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from anon;
revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.expiry_test_get_order_v1(
  uuid, uuid
) to service_role;

revoke all on function public.expiry_test_reset_v1(
  uuid
) from public;
revoke all on function public.expiry_test_reset_v1(
  uuid
) from anon;
revoke all on function public.expiry_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.expiry_test_reset_v1(
  uuid
) to service_role;
