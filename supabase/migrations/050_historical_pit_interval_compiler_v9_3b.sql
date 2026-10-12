-- ============================================================
-- v9.3B Historical PIT Interval Compiler + Validation Harness
-- ============================================================
-- KRX API key is NOT required.
--
-- This stage:
-- 1) requires one COMPLETE historical snapshot for every trading date,
-- 2) compiles daily snapshots into [valid_from, valid_to) intervals,
-- 3) writes only to a STAGING membership table,
-- 4) includes a synthetic validation audit table.
--
-- Canonical stock_universe_memberships remain untouched.
-- ============================================================

create table if not exists public.historical_universe_compilation_runs (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null,
  provider text not null,

  calendar_index_code text not null default '0001',

  start_date date not null,
  end_date date not null,

  status text not null default 'RUNNING',

  expected_trading_dates integer not null default 0,
  imported_complete_dates integer not null default 0,
  missing_trading_dates integer not null default 0,
  duplicate_complete_dates integer not null default 0,

  compiled_interval_count integer not null default 0,

  metadata jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  error_message text,

  constraint historical_universe_compilation_runs_status_check
    check (
      status in (
        'RUNNING',
        'READY',
        'BLOCKED_SNAPSHOT_COVERAGE',
        'FAILED'
      )
    ),

  constraint historical_universe_compilation_runs_date_check
    check (
      start_date <= end_date
    ),

  constraint historical_universe_compilation_runs_counts_check
    check (
      expected_trading_dates >= 0
      and imported_complete_dates >= 0
      and missing_trading_dates >= 0
      and duplicate_complete_dates >= 0
      and compiled_interval_count >= 0
    ),

  constraint historical_universe_compilation_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_universe_compilation_runs_lookup
on public.historical_universe_compilation_runs (
  universe_code,
  provider,
  start_date,
  end_date,
  started_at desc
);

create table if not exists public.historical_universe_compiled_memberships (
  id uuid primary key default gen_random_uuid(),

  compilation_run_id uuid not null
    references public.historical_universe_compilation_runs(id)
    on delete cascade,

  universe_code text not null,

  stock_code text not null,
  stock_name text not null,

  market text not null,
  sector text,
  security_type text not null,

  listed boolean not null,
  tradable boolean not null,

  valid_from date not null,
  valid_to date not null,

  evidence_type text not null default 'DAILY_COMPLETE_SNAPSHOT',
  source_provider text not null,

  source_import_ids uuid[] not null default '{}'::uuid[],

  metadata jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    compilation_run_id,
    stock_code,
    valid_from
  ),

  constraint historical_universe_compiled_memberships_interval_check
    check (
      valid_from < valid_to
    ),

  constraint historical_universe_compiled_memberships_market_check
    check (
      market in (
        'KOSPI',
        'KOSDAQ',
        'KONEX',
        'UNKNOWN'
      )
    ),

  constraint historical_universe_compiled_memberships_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_universe_compiled_memberships_resolve
on public.historical_universe_compiled_memberships (
  universe_code,
  valid_from,
  valid_to,
  stock_code
);

create table if not exists public.historical_universe_validation_runs (
  id uuid primary key default gen_random_uuid(),

  validation_version text not null default 'HISTORICAL_PIT_INTERVAL_VALIDATION_V9_3B',

  status text not null,

  compilation_run_id uuid,

  assertions jsonb not null default '{}'::jsonb,

  cleanup_succeeded boolean not null default false,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint historical_universe_validation_runs_status_check
    check (
      status in (
        'PASS',
        'FAIL'
      )
    ),

  constraint historical_universe_validation_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_universe_validation_runs_created
on public.historical_universe_validation_runs (
  created_at desc
);

-- DB-clock finish helper for compilation audit.
create or replace function public.finish_historical_universe_compilation_v9_3b(
  p_compilation_run_id uuid,
  p_status text,
  p_compiled_interval_count integer,
  p_error_message text default null
)
returns void
language plpgsql
as $$
begin
  update public.historical_universe_compilation_runs
  set
    status = p_status,
    compiled_interval_count = greatest(
      coalesce(
        p_compiled_interval_count,
        0
      ),
      0
    ),
    error_message = p_error_message,
    finished_at = now()
  where id = p_compilation_run_id;
end;
$$;

comment on table public.historical_universe_compilation_runs is
'v9.3B audit for converting COMPLETE daily historical snapshots into staging PIT intervals. Missing or duplicate dates fail closed.';

comment on table public.historical_universe_compiled_memberships is
'v9.3B staging PIT intervals using [valid_from, valid_to) semantics. Canonical stock_universe_memberships are not modified.';

comment on table public.historical_universe_validation_runs is
'v9.3B synthetic positive-path validation audit for listing, delisting, re-entry and interval boundaries.';

comment on function public.finish_historical_universe_compilation_v9_3b is
'Uses database now() for compilation completion timestamps.';
