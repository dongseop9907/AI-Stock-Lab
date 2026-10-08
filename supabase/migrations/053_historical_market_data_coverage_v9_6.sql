-- ============================================================
-- v9.6 Historical Market Data Coverage Evaluator
-- ============================================================
-- Research-only, fail-closed.
--
-- Purpose:
-- Measure whether market_daily_bars is sufficiently complete for the
-- exact Historical PIT membership intervals that a later OOS backtest
-- would use.
--
-- It NEVER substitutes today's universe when historical PIT is missing.
-- ============================================================

create table if not exists public.historical_market_data_coverage_runs (
  id uuid primary key default gen_random_uuid(),

  version text not null default 'HISTORICAL_MARKET_DATA_COVERAGE_V9_6',

  universe_code text not null,

  compilation_run_id uuid
    references public.historical_universe_compilation_runs(id)
    on delete restrict,

  start_date date not null,
  end_date date not null,

  status text not null default 'RUNNING',

  observed_member_count integer not null default 0,
  data_ready_member_count integer not null default 0,

  expected_bar_count bigint not null default 0,
  available_bar_count bigint not null default 0,
  missing_bar_count bigint not null default 0,

  overall_bar_coverage_rate numeric not null default 0,
  ready_member_rate numeric not null default 0,

  minimum_overall_bar_coverage_rate numeric not null default 0.95,
  minimum_per_member_coverage_rate numeric not null default 0.80,
  minimum_ready_member_rate numeric not null default 0.80,

  summary jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  error_message text,

  constraint historical_market_data_coverage_runs_status_check
    check (
      status in (
        'RUNNING',
        'BLOCKED_PIT',
        'COMPLETE',
        'INSUFFICIENT_DATA',
        'FAILED'
      )
    ),

  constraint historical_market_data_coverage_runs_date_check
    check (
      start_date <= end_date
    ),

  constraint historical_market_data_coverage_runs_rate_check
    check (
      overall_bar_coverage_rate between 0 and 1
      and ready_member_rate between 0 and 1
      and minimum_overall_bar_coverage_rate between 0 and 1
      and minimum_per_member_coverage_rate between 0 and 1
      and minimum_ready_member_rate between 0 and 1
    ),

  constraint historical_market_data_coverage_runs_counts_check
    check (
      observed_member_count >= 0
      and data_ready_member_count >= 0
      and expected_bar_count >= 0
      and available_bar_count >= 0
      and missing_bar_count >= 0
    ),

  constraint historical_market_data_coverage_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_market_data_coverage_runs_lookup
on public.historical_market_data_coverage_runs (
  universe_code,
  start_date,
  end_date,
  started_at desc
);

create table if not exists public.historical_market_data_coverage_results (
  id uuid primary key default gen_random_uuid(),

  coverage_run_id uuid not null
    references public.historical_market_data_coverage_runs(id)
    on delete cascade,

  stock_code text not null,

  stock_name text not null,
  market text not null,

  first_expected_date date,
  last_expected_date date,

  first_available_date date,
  last_available_date date,

  expected_bars integer not null default 0,
  available_bars integer not null default 0,
  missing_bars integer not null default 0,

  coverage_rate numeric not null default 0,

  data_ready boolean not null default false,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    coverage_run_id,
    stock_code
  ),

  constraint historical_market_data_coverage_results_counts_check
    check (
      expected_bars >= 0
      and available_bars >= 0
      and missing_bars >= 0
      and coverage_rate between 0 and 1
    ),

  constraint historical_market_data_coverage_results_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_historical_market_data_coverage_results_lookup
on public.historical_market_data_coverage_results (
  coverage_run_id,
  data_ready,
  coverage_rate
);

create table if not exists public.historical_market_data_coverage_validation_runs (
  id uuid primary key default gen_random_uuid(),

  validation_version text not null default 'HISTORICAL_MARKET_DATA_COVERAGE_VALIDATION_V9_6',

  status text not null,

  assertions jsonb not null default '{}'::jsonb,

  cleanup_succeeded boolean not null default false,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint historical_market_data_coverage_validation_status_check
    check (
      status in (
        'PASS',
        'FAIL'
      )
    ),

  constraint historical_market_data_coverage_validation_production_check
    check (
      production_applied = false
    )
);

-- ============================================================
-- Per-security PIT-aware coverage computation.
-- Uses only the supplied READY compilation run.
-- p_offset / p_limit protects against PostgREST row caps.
-- ============================================================

create or replace function public.compute_historical_market_data_coverage_v9_6(
  p_compilation_run_id uuid,
  p_start_date date,
  p_end_date date,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table (
  stock_code text,
  stock_name text,
  market text,
  first_expected_date date,
  last_expected_date date,
  first_available_date date,
  last_available_date date,
  expected_bars bigint,
  available_bars bigint,
  missing_bars bigint,
  coverage_rate numeric
)
language sql
stable
as $$
  with run_info as (
    select
      r.calendar_index_code
    from public.historical_universe_compilation_runs r
    where r.id = p_compilation_run_id
      and r.status = 'READY'
    limit 1
  ),
  securities as (
    select
      m.stock_code,
      max(m.stock_name) as stock_name,
      max(m.market) as market
    from public.historical_universe_compiled_memberships m
    where m.compilation_run_id = p_compilation_run_id
      and m.listed = true
      and m.valid_from <= p_end_date
      and m.valid_to > p_start_date
    group by m.stock_code
    order by m.stock_code
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  ),
  expected as (
    select
      s.stock_code,
      s.stock_name,
      s.market,
      c.trading_date
    from securities s
    join public.historical_universe_compiled_memberships m
      on m.compilation_run_id = p_compilation_run_id
     and m.stock_code = s.stock_code
     and m.listed = true
    cross join run_info r
    join public.market_index_daily_bars c
      on c.index_code = r.calendar_index_code
     and c.trading_date >= greatest(m.valid_from, p_start_date)
     and c.trading_date < least(m.valid_to, p_end_date + 1)
  ),
  dedup_expected as (
    select distinct
      e.stock_code,
      e.stock_name,
      e.market,
      e.trading_date
    from expected e
  ),
  joined as (
    select
      e.stock_code,
      e.stock_name,
      e.market,
      e.trading_date,
      case
        when b.stock_code is not null
         and b.open_price is not null
         and b.high_price is not null
         and b.low_price is not null
         and b.close_price is not null
         and b.volume is not null
         and b.open_price > 0
         and b.high_price > 0
         and b.low_price > 0
         and b.close_price > 0
         and b.volume >= 0
        then 1
        else 0
      end as available
    from dedup_expected e
    left join public.market_daily_bars b
      on b.stock_code = e.stock_code
     and b.trading_date = e.trading_date
  )
  select
    j.stock_code,
    max(j.stock_name) as stock_name,
    max(j.market) as market,

    min(j.trading_date) as first_expected_date,
    max(j.trading_date) as last_expected_date,

    min(j.trading_date)
      filter (where j.available = 1) as first_available_date,

    max(j.trading_date)
      filter (where j.available = 1) as last_available_date,

    count(*)::bigint as expected_bars,

    sum(j.available)::bigint as available_bars,

    (
      count(*) -
      sum(j.available)
    )::bigint as missing_bars,

    case
      when count(*) = 0
        then 0
      else
        sum(j.available)::numeric /
        count(*)::numeric
    end as coverage_rate

  from joined j
  group by j.stock_code
  order by j.stock_code;
$$;

create or replace function public.finish_historical_market_data_coverage_run_v9_6(
  p_run_id uuid,
  p_status text,
  p_observed_member_count integer,
  p_data_ready_member_count integer,
  p_expected_bar_count bigint,
  p_available_bar_count bigint,
  p_missing_bar_count bigint,
  p_overall_bar_coverage_rate numeric,
  p_ready_member_rate numeric,
  p_summary jsonb default '{}'::jsonb,
  p_error_message text default null
)
returns void
language plpgsql
as $$
begin
  update public.historical_market_data_coverage_runs
  set
    status = p_status,
    observed_member_count = greatest(coalesce(p_observed_member_count,0),0),
    data_ready_member_count = greatest(coalesce(p_data_ready_member_count,0),0),
    expected_bar_count = greatest(coalesce(p_expected_bar_count,0),0),
    available_bar_count = greatest(coalesce(p_available_bar_count,0),0),
    missing_bar_count = greatest(coalesce(p_missing_bar_count,0),0),
    overall_bar_coverage_rate = greatest(least(coalesce(p_overall_bar_coverage_rate,0),1),0),
    ready_member_rate = greatest(least(coalesce(p_ready_member_rate,0),1),0),
    summary = coalesce(p_summary,'{}'::jsonb),
    error_message = p_error_message,
    finished_at = now()
  where id = p_run_id;
end;
$$;

comment on table public.historical_market_data_coverage_runs is
'v9.6 PIT-aware audit of historical OHLCV completeness. Missing PIT fails closed; current universe is never substituted.';

comment on table public.historical_market_data_coverage_results is
'v9.6 per-security expected-vs-available OHLCV coverage over the exact compiled historical membership intervals.';

comment on function public.compute_historical_market_data_coverage_v9_6 is
'Computes expected trading-day bars from staging PIT intervals and compares them with raw market_daily_bars.';
