-- ============================================================
-- v8.3 Resumable Scalable Daily-Bar Backfill
-- ============================================================
-- Goals
-- - Scale KIS daily-bar collection from 5 stocks to thousands.
-- - Persistent run/task state.
-- - Resume after process/server failure.
-- - Retry transient failures.
-- - Lease + SKIP LOCKED task claiming for concurrency safety.
-- - Preserve market_daily_bars upsert identity (stock_code,trading_date).
-- - No trading/risk/order behavior changes.
-- ============================================================

create table if not exists public.market_data_backfill_runs (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null
    references public.stock_universe_definitions(universe_code)
    on delete restrict,

  universe_as_of_date date not null,

  start_date date not null,
  end_date date not null,

  adjusted_price boolean not null default true,

  allowed_security_types text[] not null default array['COMMON']::text[],
  exclude_management boolean not null default true,
  exclude_low_liquidity_flag boolean not null default true,

  max_attempts integer not null default 3,
  request_delay_ms integer not null default 1500,

  status text not null default 'RUNNING',

  task_count integer not null default 0,
  pending_count integer not null default 0,
  running_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,

  received_rows bigint not null default 0,
  saved_rows bigint not null default 0,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  metadata jsonb not null default '{}'::jsonb,

  error_message text,

  production_applied boolean not null default false,

  constraint market_data_backfill_runs_date_check
    check (
      start_date <= end_date
    ),

  constraint market_data_backfill_runs_attempt_check
    check (
      max_attempts between 1 and 10
    ),

  constraint market_data_backfill_runs_delay_check
    check (
      request_delay_ms between 0 and 10000
    ),

  constraint market_data_backfill_runs_status_check
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'PARTIAL_FAILURE',
        'FAILED',
        'CANCELLED'
      )
    ),

  constraint market_data_backfill_runs_counts_check
    check (
      task_count >= 0
      and pending_count >= 0
      and running_count >= 0
      and success_count >= 0
      and failed_count >= 0
      and received_rows >= 0
      and saved_rows >= 0
    ),

  constraint market_data_backfill_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_data_backfill_runs_lookup
on public.market_data_backfill_runs (
  universe_code,
  universe_as_of_date desc,
  started_at desc
);

create index if not exists
  idx_market_data_backfill_runs_status
on public.market_data_backfill_runs (
  status,
  started_at desc
);

create table if not exists public.market_data_backfill_tasks (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    references public.market_data_backfill_runs(id)
    on delete cascade,

  stock_code text not null,
  stock_name text not null,
  market text,

  start_date date not null,
  end_date date not null,

  status text not null default 'PENDING',

  attempt_count integer not null default 0,

  worker_id text,
  lease_expires_at timestamptz,

  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  received_rows integer not null default 0,
  saved_rows integer not null default 0,

  last_error text,

  metadata jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  constraint market_data_backfill_tasks_date_check
    check (
      start_date <= end_date
    ),

  constraint market_data_backfill_tasks_status_check
    check (
      status in (
        'PENDING',
        'RUNNING',
        'SUCCESS',
        'FAILED',
        'CANCELLED'
      )
    ),

  constraint market_data_backfill_tasks_counts_check
    check (
      attempt_count >= 0
      and received_rows >= 0
      and saved_rows >= 0
    ),

  constraint market_data_backfill_tasks_unique
    unique (
      run_id,
      stock_code,
      start_date,
      end_date
    ),

  constraint market_data_backfill_tasks_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_data_backfill_tasks_claim
on public.market_data_backfill_tasks (
  run_id,
  status,
  attempt_count,
  stock_code
);

create index if not exists
  idx_market_data_backfill_tasks_lease
on public.market_data_backfill_tasks (
  run_id,
  lease_expires_at
)
where status = 'RUNNING';

create index if not exists
  idx_market_data_backfill_tasks_failure
on public.market_data_backfill_tasks (
  run_id,
  attempt_count desc,
  updated_at desc
)
where status = 'FAILED';

create or replace function public.claim_market_data_backfill_task_v8_3(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  run_id uuid,
  stock_code text,
  stock_name text,
  market text,
  start_date date,
  end_date date,
  attempt_count integer
)
language plpgsql
as $$
declare
  v_max_attempts integer;
  v_task_id uuid;
begin
  select r.max_attempts
    into v_max_attempts
  from public.market_data_backfill_runs r
  where r.id = p_run_id
    and r.status = 'RUNNING';

  if v_max_attempts is null then
    return;
  end if;

  -- Recover abandoned work conservatively.
  update public.market_data_backfill_tasks t
  set
    status = 'FAILED',
    worker_id = null,
    lease_expires_at = null,
    last_error = coalesce(
      t.last_error || E'\n',
      ''
    ) || 'LEASE_EXPIRED_V8_3',
    updated_at = now()
  where t.run_id = p_run_id
    and t.status = 'RUNNING'
    and t.lease_expires_at is not null
    and t.lease_expires_at < now();

  select t.id
    into v_task_id
  from public.market_data_backfill_tasks t
  where t.run_id = p_run_id
    and (
      t.status = 'PENDING'
      or (
        t.status = 'FAILED'
        and t.attempt_count < v_max_attempts
      )
    )
  order by
    case
      when t.status = 'PENDING' then 0
      else 1
    end,
    t.attempt_count asc,
    t.market nulls last,
    t.stock_code
  for update skip locked
  limit 1;

  if v_task_id is null then
    return;
  end if;

  update public.market_data_backfill_tasks t
  set
    status = 'RUNNING',
    attempt_count = t.attempt_count + 1,
    worker_id = p_worker_id,
    lease_expires_at =
      now()
      + make_interval(
          secs => least(
            greatest(
              coalesce(
                p_lease_seconds,
                180
              ),
              30
            ),
            1800
          )
        ),
    started_at = coalesce(
      t.started_at,
      now()
    ),
    finished_at = null,
    updated_at = now()
  where t.id = v_task_id;

  return query
  select
    t.id,
    t.run_id,
    t.stock_code,
    t.stock_name,
    t.market,
    t.start_date,
    t.end_date,
    t.attempt_count
  from public.market_data_backfill_tasks t
  where t.id = v_task_id;
end;
$$;

create or replace function public.refresh_market_data_backfill_run_v8_3(
  p_run_id uuid
)
returns table (
  run_id uuid,
  status text,
  task_count integer,
  pending_count integer,
  running_count integer,
  success_count integer,
  failed_count integer,
  retryable_failed_count integer,
  received_rows bigint,
  saved_rows bigint
)
language plpgsql
as $$
declare
  v_max_attempts integer;
  v_task_count integer;
  v_pending integer;
  v_running integer;
  v_success integer;
  v_failed integer;
  v_retryable integer;
  v_received bigint;
  v_saved bigint;
  v_status text;
begin
  select r.max_attempts
    into v_max_attempts
  from public.market_data_backfill_runs r
  where r.id = p_run_id;

  if v_max_attempts is null then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where t.status = 'PENDING'
    )::integer,
    count(*) filter (
      where t.status = 'RUNNING'
    )::integer,
    count(*) filter (
      where t.status = 'SUCCESS'
    )::integer,
    count(*) filter (
      where t.status = 'FAILED'
    )::integer,
    count(*) filter (
      where t.status = 'FAILED'
        and t.attempt_count < v_max_attempts
    )::integer,
    coalesce(
      sum(t.received_rows),
      0
    )::bigint,
    coalesce(
      sum(t.saved_rows),
      0
    )::bigint
  into
    v_task_count,
    v_pending,
    v_running,
    v_success,
    v_failed,
    v_retryable,
    v_received,
    v_saved
  from public.market_data_backfill_tasks t
  where t.run_id = p_run_id;

  if v_task_count = 0 then
    v_status = 'FAILED';
  elsif v_pending > 0
     or v_running > 0
     or v_retryable > 0 then
    v_status = 'RUNNING';
  elsif v_success = v_task_count then
    v_status = 'SUCCESS';
  elsif v_success > 0 then
    v_status = 'PARTIAL_FAILURE';
  else
    v_status = 'FAILED';
  end if;

  update public.market_data_backfill_runs r
  set
    status = v_status,
    task_count = v_task_count,
    pending_count = v_pending,
    running_count = v_running,
    success_count = v_success,
    failed_count = v_failed,
    received_rows = v_received,
    saved_rows = v_saved,
    finished_at =
      case
        when v_status in (
          'SUCCESS',
          'PARTIAL_FAILURE',
          'FAILED',
          'CANCELLED'
        )
        then coalesce(
          r.finished_at,
          now()
        )
        else null
      end,
    updated_at = now()
  where r.id = p_run_id;

  return query
  select
    p_run_id,
    v_status,
    v_task_count,
    v_pending,
    v_running,
    v_success,
    v_failed,
    v_retryable,
    v_received,
    v_saved;
end;
$$;

comment on table public.market_data_backfill_runs is
'v8.3 persistent daily-bar backfill jobs for point-in-time universes. Intended for thousands of KRX securities with resumable processing.';

comment on table public.market_data_backfill_tasks is
'v8.3 per-security daily-bar collection tasks. FAILED rows remain retryable until attempt_count reaches the parent run max_attempts.';

comment on function public.claim_market_data_backfill_task_v8_3 is
'Lease-based SKIP LOCKED task claim. Expired RUNNING tasks are converted to FAILED and can be retried without duplicating a successful task.';

comment on function public.refresh_market_data_backfill_run_v8_3 is
'Recalculate v8.3 run progress from task state and transition to SUCCESS/PARTIAL_FAILURE/FAILED only when no pending/running/retryable work remains.';
