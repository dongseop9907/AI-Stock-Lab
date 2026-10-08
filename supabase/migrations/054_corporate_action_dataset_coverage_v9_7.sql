-- ============================================================
-- v9.7 Corporate Action Dataset Coverage Evaluator
-- ============================================================
-- Research-only, fail-closed.
--
-- IMPORTANT:
-- Corporate actions are sparse. "No event row" does NOT prove that
-- no event happened. Therefore coverage must come from explicit
-- provider/source coverage evidence, not from absence of events.
--
-- A COMPLETE assertion requires:
-- 1) READY historical PIT compilation covering the requested range.
-- 2) COMPLETE provider coverage window covering the requested range.
-- 3) provider coverage includes every PIT market used in that range.
-- 4) provider coverage includes every required action type.
--
-- Current universe is never substituted for missing historical PIT.
-- ============================================================

create table if not exists public.corporate_action_source_coverage_windows (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null,

  provider text not null,
  provider_version text not null,

  start_date date not null,
  end_date date not null,

  coverage_status text not null default 'UNKNOWN',

  markets jsonb not null default '[]'::jsonb,
  action_types jsonb not null default '[]'::jsonb,

  source_fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    universe_code,
    provider,
    start_date,
    end_date,
    source_fingerprint,
    is_validation
  ),

  constraint corporate_action_source_coverage_windows_status_check
    check (
      coverage_status in (
        'COMPLETE',
        'PARTIAL',
        'UNKNOWN'
      )
    ),

  constraint corporate_action_source_coverage_windows_date_check
    check (
      start_date <= end_date
    ),

  constraint corporate_action_source_coverage_windows_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_source_coverage_windows_lookup
on public.corporate_action_source_coverage_windows (
  universe_code,
  start_date,
  end_date,
  created_at desc
);

create table if not exists public.corporate_action_dataset_coverage_runs (
  id uuid primary key default gen_random_uuid(),

  version text not null default 'CORPORATE_ACTION_DATASET_COVERAGE_V9_7',

  universe_code text not null,

  compilation_run_id uuid
    references public.historical_universe_compilation_runs(id)
    on delete restrict,

  source_coverage_window_id uuid
    references public.corporate_action_source_coverage_windows(id)
    on delete restrict,

  start_date date not null,
  end_date date not null,

  status text not null default 'RUNNING',

  pit_member_count integer not null default 0,

  pit_markets jsonb not null default '[]'::jsonb,
  required_action_types jsonb not null default '[]'::jsonb,

  missing_markets jsonb not null default '[]'::jsonb,
  missing_action_types jsonb not null default '[]'::jsonb,

  summary jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  error_message text,

  constraint corporate_action_dataset_coverage_runs_status_check
    check (
      status in (
        'RUNNING',
        'BLOCKED_PIT',
        'BLOCKED_SOURCE_COVERAGE',
        'COMPLETE',
        'PARTIAL',
        'FAILED'
      )
    ),

  constraint corporate_action_dataset_coverage_runs_date_check
    check (
      start_date <= end_date
    ),

  constraint corporate_action_dataset_coverage_runs_count_check
    check (
      pit_member_count >= 0
    ),

  constraint corporate_action_dataset_coverage_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_dataset_coverage_runs_lookup
on public.corporate_action_dataset_coverage_runs (
  universe_code,
  start_date,
  end_date,
  started_at desc
);

create table if not exists public.corporate_action_dataset_coverage_validation_runs (
  id uuid primary key default gen_random_uuid(),

  validation_version text not null default 'CORPORATE_ACTION_DATASET_COVERAGE_VALIDATION_V9_7',

  status text not null,

  assertions jsonb not null default '{}'::jsonb,

  cleanup_succeeded boolean not null default false,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint corporate_action_dataset_coverage_validation_status_check
    check (
      status in (
        'PASS',
        'FAIL'
      )
    ),

  constraint corporate_action_dataset_coverage_validation_production_check
    check (
      production_applied = false
    )
);

create or replace function public.finish_corporate_action_dataset_coverage_run_v9_7(
  p_run_id uuid,
  p_status text,
  p_pit_member_count integer,
  p_pit_markets jsonb,
  p_required_action_types jsonb,
  p_missing_markets jsonb,
  p_missing_action_types jsonb,
  p_summary jsonb default '{}'::jsonb,
  p_error_message text default null
)
returns void
language plpgsql
as $$
begin
  update public.corporate_action_dataset_coverage_runs
  set
    status = p_status,
    pit_member_count = greatest(coalesce(p_pit_member_count,0),0),
    pit_markets = coalesce(p_pit_markets,'[]'::jsonb),
    required_action_types = coalesce(p_required_action_types,'[]'::jsonb),
    missing_markets = coalesce(p_missing_markets,'[]'::jsonb),
    missing_action_types = coalesce(p_missing_action_types,'[]'::jsonb),
    summary = coalesce(p_summary,'{}'::jsonb),
    error_message = p_error_message,
    finished_at = now()
  where id = p_run_id;
end;
$$;

comment on table public.corporate_action_source_coverage_windows is
'Explicit provider evidence that a date range, set of markets, and set of corporate-action types were covered. Absence of event rows is never treated as coverage evidence.';

comment on table public.corporate_action_dataset_coverage_runs is
'v9.7 fail-closed evaluation of real corporate-action dataset coverage against exact historical PIT markets and required action types.';
