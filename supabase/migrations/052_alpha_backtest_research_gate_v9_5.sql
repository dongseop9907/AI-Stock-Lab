-- ============================================================
-- v9.5 Historical Alpha Backtest Research Gate
-- ============================================================
-- Purpose:
-- Prevent historical Alpha backtests from running until the
-- prerequisites that protect against false performance are present.
--
-- This stage does NOT execute a backtest.
-- It only answers: "Are we allowed to run one?"
--
-- Required evidence:
-- 1) v9.2 Purged/Embargo validation plan is READY.
-- 2) non-validation historical PIT compilation is READY.
-- 3) historical market-data coverage is COMPLETE for the requested range.
-- 4) corporate-action dataset coverage is COMPLETE for the requested range.
-- 5) latest Corporate Action synthetic validation is PASS.
--
-- All gates fail closed.
-- ============================================================

create table if not exists public.historical_market_data_coverage_assertions (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null,
  start_date date not null,
  end_date date not null,

  provider text not null,

  coverage_status text not null default 'UNKNOWN',

  observed_member_count integer not null default 0,
  data_ready_member_count integer not null default 0,
  observed_coverage_rate numeric not null default 0,
  minimum_required_rate numeric not null default 0.8,

  evidence jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint historical_market_data_coverage_assertions_status_check
    check (
      coverage_status in (
        'COMPLETE',
        'PARTIAL',
        'UNKNOWN'
      )
    ),

  constraint historical_market_data_coverage_assertions_rate_check
    check (
      observed_coverage_rate >= 0
      and observed_coverage_rate <= 1
      and minimum_required_rate >= 0
      and minimum_required_rate <= 1
    ),

  constraint historical_market_data_coverage_assertions_date_check
    check (
      start_date <= end_date
    ),

  constraint historical_market_data_coverage_assertions_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_market_data_coverage_assertions_lookup
on public.historical_market_data_coverage_assertions (
  universe_code,
  start_date,
  end_date,
  created_at desc
);

create table if not exists public.corporate_action_coverage_assertions (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null,
  start_date date not null,
  end_date date not null,

  provider text not null,

  coverage_status text not null default 'UNKNOWN',

  supported_action_types jsonb not null default '[]'::jsonb,
  unsupported_action_types jsonb not null default '[]'::jsonb,

  evidence jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint corporate_action_coverage_assertions_status_check
    check (
      coverage_status in (
        'COMPLETE',
        'PARTIAL',
        'UNKNOWN'
      )
    ),

  constraint corporate_action_coverage_assertions_date_check
    check (
      start_date <= end_date
    ),

  constraint corporate_action_coverage_assertions_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_coverage_assertions_lookup
on public.corporate_action_coverage_assertions (
  universe_code,
  start_date,
  end_date,
  created_at desc
);

create table if not exists public.alpha_backtest_research_gate_runs (
  id uuid primary key default gen_random_uuid(),

  gate_version text not null default 'ALPHA_BACKTEST_RESEARCH_GATE_V9_5',

  universe_code text not null,

  requested_start_date date not null,
  requested_end_date date not null,

  status text not null,

  checks jsonb not null default '{}'::jsonb,

  blockers jsonb not null default '[]'::jsonb,

  automatic_backtest_started boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint alpha_backtest_research_gate_runs_status_check
    check (
      status in (
        'READY',
        'BLOCKED',
        'FAILED'
      )
    ),

  constraint alpha_backtest_research_gate_runs_date_check
    check (
      requested_start_date <= requested_end_date
    ),

  constraint alpha_backtest_research_gate_runs_backtest_check
    check (
      automatic_backtest_started = false
    ),

  constraint alpha_backtest_research_gate_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_alpha_backtest_research_gate_runs_lookup
on public.alpha_backtest_research_gate_runs (
  universe_code,
  requested_start_date,
  requested_end_date,
  created_at desc
);

comment on table public.alpha_backtest_research_gate_runs is
'v9.5 fail-closed historical Alpha backtest gate. A READY result permits later research execution but never auto-starts a backtest.';

comment on table public.historical_market_data_coverage_assertions is
'Explicit evidence that broad historical OHLCV coverage is sufficient over a requested PIT universe/range.';

comment on table public.corporate_action_coverage_assertions is
'Explicit evidence that corporate-action source coverage is complete over a requested universe/range. Synthetic code validation alone is not data-coverage evidence.';
