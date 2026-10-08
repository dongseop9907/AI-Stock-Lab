-- 056_krx_historical_pit_provider_v9_3c.sql
create table if not exists public.krx_historical_pit_import_runs (
  id uuid primary key default gen_random_uuid(),
  version text not null default 'KRX_HISTORICAL_PIT_PROVIDER_V9_3C',
  universe_code text not null default 'KRX_ALL_LISTED',
  provider text not null default 'KRX_OPEN_API_STOCK_BASE_V1',
  start_date date not null,
  end_date date not null,
  calendar_index_code text not null default '0001',
  request_delay_ms integer not null default 400,
  max_attempts integer not null default 3,
  status text not null default 'RUNNING',
  trading_date_count integer not null default 0,
  pending_count integer not null default 0,
  running_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  api_request_count integer not null default 0,
  imported_member_rows bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_validation boolean not null default false,
  production_applied boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  error_message text,
  check (status in ('RUNNING','SUCCESS','FAILED','CANCELLED')),
  check (start_date <= end_date),
  check (request_delay_ms >= 0 and max_attempts between 1 and 10),
  check (production_applied=false)
);

create index if not exists idx_krx_historical_pit_import_runs_lookup
on public.krx_historical_pit_import_runs(universe_code,start_date,end_date,started_at desc);

create table if not exists public.krx_historical_pit_import_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.krx_historical_pit_import_runs(id) on delete cascade,
  as_of_date date not null,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  worker_id text,
  lease_expires_at timestamptz,
  import_id uuid references public.historical_universe_snapshot_imports(id) on delete set null,
  reused_existing_import boolean not null default false,
  kospi_raw_count integer,
  kosdaq_raw_count integer,
  normalized_member_count integer,
  api_request_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  unique(run_id,as_of_date),
  check (status in ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')),
  check (attempt_count >= 0 and api_request_count >= 0)
);

create index if not exists idx_krx_historical_pit_import_tasks_claim
on public.krx_historical_pit_import_tasks(run_id,status,as_of_date);

create or replace function public.refresh_krx_historical_pit_import_run_v9_3c(
  p_run_id uuid
)
returns table (
  run_id uuid,
  status text,
  trading_date_count integer,
  pending_count integer,
  running_count integer,
  success_count integer,
  failed_count integer,
  api_request_count bigint,
  imported_member_rows bigint
)
language plpgsql
as $$
declare
  v_total integer;
  v_pending integer;
  v_running integer;
  v_success integer;
  v_failed integer;
  v_retryable_failed integer;
  v_max_attempts integer;
  v_api bigint;
  v_members bigint;
  v_status text;
begin
  select
    count(*)::integer,
    count(*) filter (where t.status='PENDING')::integer,
    count(*) filter (where t.status='RUNNING')::integer,
    count(*) filter (where t.status='SUCCESS')::integer,
    count(*) filter (where t.status='FAILED')::integer,
    coalesce(sum(t.api_request_count),0)::bigint,
    coalesce(sum(t.normalized_member_count) filter (where t.status='SUCCESS'),0)::bigint
  into v_total,v_pending,v_running,v_success,v_failed,v_api,v_members
  from public.krx_historical_pit_import_tasks t
  where t.run_id=p_run_id;

  select r.status, r.max_attempts
  into v_status, v_max_attempts
  from public.krx_historical_pit_import_runs r
  where r.id=p_run_id
  for update;

  select count(*)::integer
  into v_retryable_failed
  from public.krx_historical_pit_import_tasks t
  where t.run_id=p_run_id
    and t.status='FAILED'
    and t.attempt_count<v_max_attempts;

  if v_status='CANCELLED' then
    null;
  elsif v_total>0 and v_success=v_total then
    v_status:='SUCCESS';
  elsif v_pending=0 and v_running=0 and v_failed>0 and v_retryable_failed=0 then
    v_status:='FAILED';
  else
    v_status:='RUNNING';
  end if;

  update public.krx_historical_pit_import_runs r
  set status=v_status,
      trading_date_count=v_total,
      pending_count=v_pending,
      running_count=v_running,
      success_count=v_success,
      failed_count=v_failed,
      api_request_count=v_api,
      imported_member_rows=v_members,
      finished_at=case when v_status in ('SUCCESS','FAILED','CANCELLED')
                       then coalesce(r.finished_at,now()) else null end,
      updated_at=now()
  where r.id=p_run_id;

  return query select p_run_id,v_status,v_total,v_pending,v_running,v_success,v_failed,v_api,v_members;
end;
$$;

create or replace function public.claim_krx_historical_pit_tasks_v9_3c(
  p_run_id uuid,
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 180
)
returns setof public.krx_historical_pit_import_tasks
language plpgsql
as $$
begin
  update public.krx_historical_pit_import_tasks
  set status='PENDING',
      worker_id=null,
      lease_expires_at=null,
      updated_at=now(),
      error_message=coalesce(error_message,'') ||
        case when coalesce(error_message,'')='' then '' else E'\n' end ||
        'LEASE_RECOVERED'
  where run_id=p_run_id
    and status='RUNNING'
    and lease_expires_at is not null
    and lease_expires_at<now();

  return query
  with candidates as (
    select t.id
    from public.krx_historical_pit_import_tasks t
    join public.krx_historical_pit_import_runs r on r.id=t.run_id
    where t.run_id=p_run_id
      and r.status='RUNNING'
      and (
        t.status='PENDING'
        or (t.status='FAILED' and t.attempt_count<r.max_attempts)
      )
    order by t.as_of_date asc
    for update of t skip locked
    limit greatest(1,least(coalesce(p_limit,5),50))
  )
  update public.krx_historical_pit_import_tasks t
  set status='RUNNING',
      attempt_count=t.attempt_count+1,
      worker_id=p_worker_id,
      lease_expires_at=now()+make_interval(secs=>greatest(30,coalesce(p_lease_seconds,180))),
      started_at=coalesce(t.started_at,now()),
      updated_at=now(),
      error_message=null
  from candidates c
  where t.id=c.id
  returning t.*;
end;
$$;
