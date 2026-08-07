-- ============================================================
-- v8.2 Universe Eligibility + Liquidity/Data-Coverage Screen
-- ============================================================
-- This stage is deliberately observational.
--
-- It answers:
--   "Of the point-in-time KRX universe, which names are structurally
--    eligible AND have enough market_daily_bars to evaluate liquidity?"
--
-- It does NOT:
-- - modify stocks.is_active
-- - modify trading / risk / orders
-- - assume missing bars mean illiquid
-- - fabricate historical data
-- ============================================================

create table if not exists public.stock_universe_screening_runs (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null
    references public.stock_universe_definitions(universe_code)
    on delete restrict,

  as_of_date date not null,
  market_date date,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  status text not null default 'RUNNING',

  criteria jsonb not null default '{}'::jsonb,

  total_members integer not null default 0,
  master_eligible_count integer not null default 0,
  data_ready_count integer not null default 0,
  liquidity_eligible_count integer not null default 0,
  final_eligible_count integer not null default 0,

  data_coverage_rate numeric,

  result jsonb not null default '{}'::jsonb,
  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint stock_universe_screening_runs_status_check
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'INSUFFICIENT_MARKET_DATA',
        'FAILED'
      )
    ),

  constraint stock_universe_screening_runs_counts_check
    check (
      total_members >= 0
      and master_eligible_count >= 0
      and data_ready_count >= 0
      and liquidity_eligible_count >= 0
      and final_eligible_count >= 0
    ),

  constraint stock_universe_screening_runs_coverage_check
    check (
      data_coverage_rate is null
      or (
        data_coverage_rate >= 0
        and data_coverage_rate <= 1
      )
    ),

  constraint stock_universe_screening_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_stock_universe_screening_runs_lookup
on public.stock_universe_screening_runs (
  universe_code,
  as_of_date desc,
  started_at desc
);

create table if not exists public.stock_universe_screening_results (
  run_id uuid not null
    references public.stock_universe_screening_runs(id)
    on delete cascade,

  stock_code text not null,

  stock_name text not null,
  market text,
  sector text,
  security_type text,

  listed boolean not null,
  tradable boolean not null,

  master_eligible boolean not null,
  data_ready boolean not null,
  liquidity_eligible boolean not null,
  eligible boolean not null,

  latest_bar_date date,
  latest_close numeric,

  recent_bar_count integer not null default 0,
  average_volume numeric,
  average_trading_value numeric,

  liquidity_rank integer,

  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  primary key (
    run_id,
    stock_code
  ),

  constraint stock_universe_screening_results_bar_count_check
    check (
      recent_bar_count >= 0
    ),

  constraint stock_universe_screening_results_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_stock_universe_screening_results_eligible
on public.stock_universe_screening_results (
  run_id,
  eligible,
  liquidity_rank
);

create index if not exists
  idx_stock_universe_screening_results_stock
on public.stock_universe_screening_results (
  stock_code,
  created_at desc
);

create or replace function public.compute_stock_universe_liquidity_metrics_v8_2(
  p_universe_code text,
  p_as_of_date date,
  p_market_date date,
  p_lookback_start_date date
)
returns table (
  stock_code text,
  stock_name text,
  market text,
  sector text,
  security_type text,
  listed boolean,
  tradable boolean,
  membership_metadata jsonb,
  latest_bar_date date,
  latest_close numeric,
  recent_bar_count bigint,
  average_volume numeric,
  average_trading_value numeric
)
language sql
stable
as $$
  with members as (
    select
      m.stock_code,
      m.stock_name,
      m.market,
      m.sector,
      m.security_type,
      m.listed,
      m.tradable,
      m.metadata
    from public.stock_universe_memberships m
    where m.universe_code = p_universe_code
      and m.valid_from <= p_as_of_date
      and (
        m.valid_to is null
        or m.valid_to > p_as_of_date
      )
      and m.pit_eligible = true
  ),
  bar_metrics as (
    select
      b.stock_code,
      max(b.trading_date) as latest_bar_date,
      (
        array_agg(
          b.close_price::numeric
          order by b.trading_date desc
        )
      )[1] as latest_close,
      count(*)::bigint as recent_bar_count,
      avg(b.volume::numeric) as average_volume,
      avg(
        b.close_price::numeric
        * b.volume::numeric
      ) as average_trading_value
    from public.market_daily_bars b
    where b.trading_date >= p_lookback_start_date
      and b.trading_date <= p_market_date
    group by b.stock_code
  )
  select
    m.stock_code,
    m.stock_name,
    m.market,
    m.sector,
    m.security_type,
    m.listed,
    m.tradable,
    m.metadata as membership_metadata,
    bm.latest_bar_date,
    bm.latest_close,
    coalesce(
      bm.recent_bar_count,
      0
    ) as recent_bar_count,
    bm.average_volume,
    bm.average_trading_value
  from members m
  left join bar_metrics bm
    on bm.stock_code = m.stock_code
  order by
    m.market nulls last,
    m.stock_code;
$$;

comment on table public.stock_universe_screening_runs is
'v8.2 observational point-in-time universe screening audit. INSUFFICIENT_MARKET_DATA means the structural universe exists but market_daily_bars coverage is not yet adequate for a reliable liquidity screen.';

comment on table public.stock_universe_screening_results is
'Per-security v8.2 master eligibility, daily-bar coverage and approximate close*volume liquidity metrics. Missing bars are classified as missing data, never as illiquidity.';

comment on function public.compute_stock_universe_liquidity_metrics_v8_2 is
'Aggregate recent market_daily_bars for point-in-time universe members inside PostgreSQL to avoid transferring the full bar history to the application.';
