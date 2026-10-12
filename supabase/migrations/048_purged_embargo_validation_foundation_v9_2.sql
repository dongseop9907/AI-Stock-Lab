-- ============================================================
-- v9.2 Purged / Embargoed Walk-Forward Validation Foundation
-- ============================================================
-- Goal:
-- Define leakage-resistant time-series validation folds BEFORE
-- historical Alpha backtests are allowed.
--
-- This stage creates validation PLANS only.
-- It does not train a model and does not claim performance.
--
-- Default protocol:
--   training window : 252 trading days
--   purge gap       : 20 trading days
--   test window     : 63 trading days
--   embargo gap     : 5 trading days
--   label horizon   : 20 trading days
--
-- Core safety rule:
--   purge_days >= label_horizon_days
--
-- Each test-start date is independently checked against the
-- point-in-time universe membership table. If a fold cannot resolve
-- a sufficiently broad COMPLETE universe, the whole plan remains
-- BLOCKED_PIT_COVERAGE.
-- ============================================================

create table if not exists public.alpha_validation_plans (
  id uuid primary key default gen_random_uuid(),

  protocol_name text not null,
  protocol_version text not null,

  universe_code text not null
    references public.stock_universe_definitions(universe_code)
    on delete restrict,

  calendar_index_code text not null default '0001',

  requested_start_date date not null,
  requested_end_date date not null,

  training_window_days integer not null,
  purge_days integer not null,
  test_window_days integer not null,
  embargo_days integer not null,
  label_horizon_days integer not null,

  minimum_pit_members integer not null default 500,

  status text not null default 'BUILDING',

  fold_count integer not null default 0,
  pit_ready_fold_count integer not null default 0,
  pit_blocked_fold_count integer not null default 0,

  config jsonb not null default '{}'::jsonb,
  safety jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  finished_at timestamptz,

  error_message text,

  production_applied boolean not null default false,

  constraint alpha_validation_plans_status_check
    check (
      status in (
        'BUILDING',
        'READY',
        'BLOCKED_PIT_COVERAGE',
        'INSUFFICIENT_CALENDAR_HISTORY',
        'FAILED'
      )
    ),

  constraint alpha_validation_plans_windows_check
    check (
      training_window_days >= 20
      and purge_days >= 0
      and test_window_days >= 1
      and embargo_days >= 0
      and label_horizon_days >= 1
      and purge_days >= label_horizon_days
    ),

  constraint alpha_validation_plans_date_check
    check (
      requested_start_date <= requested_end_date
    ),

  constraint alpha_validation_plans_counts_check
    check (
      fold_count >= 0
      and pit_ready_fold_count >= 0
      and pit_blocked_fold_count >= 0
      and minimum_pit_members >= 1
    ),

  constraint alpha_validation_plans_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_alpha_validation_plans_lookup
on public.alpha_validation_plans (
  universe_code,
  protocol_version,
  created_at desc
);

create table if not exists public.alpha_validation_folds (
  id uuid primary key default gen_random_uuid(),

  plan_id uuid not null
    references public.alpha_validation_plans(id)
    on delete cascade,

  fold_index integer not null,

  train_start_date date not null,
  train_end_date date not null,

  purge_start_date date,
  purge_end_date date,

  test_start_date date not null,
  test_end_date date not null,

  embargo_start_date date,
  embargo_end_date date,

  training_trading_days integer not null,
  purge_trading_days integer not null,
  test_trading_days integer not null,
  embargo_trading_days integer not null,

  pit_member_count integer not null default 0,
  pit_complete_member_count integer not null default 0,
  pit_coverage_ready boolean not null default false,
  pit_coverage_status text not null default 'UNKNOWN',

  metadata jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    plan_id,
    fold_index
  ),

  constraint alpha_validation_folds_index_check
    check (
      fold_index >= 1
    ),

  constraint alpha_validation_folds_dates_check
    check (
      train_start_date <= train_end_date
      and train_end_date < test_start_date
      and test_start_date <= test_end_date
    ),

  constraint alpha_validation_folds_counts_check
    check (
      training_trading_days >= 1
      and purge_trading_days >= 0
      and test_trading_days >= 1
      and embargo_trading_days >= 0
      and pit_member_count >= 0
      and pit_complete_member_count >= 0
    ),

  constraint alpha_validation_folds_pit_status_check
    check (
      pit_coverage_status in (
        'READY',
        'NO_MEMBERS',
        'TOO_FEW_MEMBERS',
        'INCOMPLETE_COVERAGE',
        'UNKNOWN'
      )
    ),

  constraint alpha_validation_folds_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_alpha_validation_folds_plan
on public.alpha_validation_folds (
  plan_id,
  fold_index
);

-- ============================================================
-- Point-in-time coverage check used by every test fold.
-- ============================================================

create or replace function public.check_pit_universe_coverage_v9_2(
  p_universe_code text,
  p_as_of_date date,
  p_minimum_members integer default 500
)
returns table (
  member_count bigint,
  complete_member_count bigint,
  incomplete_member_count bigint,
  coverage_ready boolean,
  coverage_status text
)
language sql
stable
as $$
  with resolved as (
    select
      m.stock_code,
      m.coverage_status
    from public.stock_universe_memberships m
    where m.universe_code = p_universe_code
      and m.valid_from <= p_as_of_date
      and (
        m.valid_to is null
        or m.valid_to > p_as_of_date
      )
      and m.pit_eligible = true
  ),
  counts as (
    select
      count(*)::bigint as member_count,
      count(*) filter (
        where coverage_status = 'COMPLETE'
      )::bigint as complete_member_count,
      count(*) filter (
        where coverage_status <> 'COMPLETE'
           or coverage_status is null
      )::bigint as incomplete_member_count
    from resolved
  )
  select
    c.member_count,
    c.complete_member_count,
    c.incomplete_member_count,

    (
      c.member_count >= greatest(
        coalesce(
          p_minimum_members,
          500
        ),
        1
      )
      and c.incomplete_member_count = 0
    ) as coverage_ready,

    case
      when c.member_count = 0
        then 'NO_MEMBERS'

      when c.member_count <
        greatest(
          coalesce(
            p_minimum_members,
            500
          ),
          1
        )
        then 'TOO_FEW_MEMBERS'

      when c.incomplete_member_count > 0
        then 'INCOMPLETE_COVERAGE'

      else 'READY'
    end as coverage_status

  from counts c;
$$;

comment on table public.alpha_validation_plans is
'v9.2 leakage-resistant validation protocol registry. Plans remain blocked until each fold test-start resolves a sufficiently broad COMPLETE point-in-time universe.';

comment on table public.alpha_validation_folds is
'v9.2 walk-forward folds with explicit train, purge, test and embargo regions measured in actual trading days.';

comment on function public.check_pit_universe_coverage_v9_2 is
'Checks whether a historical as-of date resolves a sufficiently broad COMPLETE membership interval set. Missing dates fail closed instead of substituting the current universe.';
