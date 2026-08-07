create table if not exists public.market_data_freshness_observations (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),

  status text not null,

  usable_for_shadow_comparison boolean not null default false,

  expected_market_date date,

  kospi_latest_date date,
  kosdaq_latest_date date,

  stock_latest_date date,
  oldest_active_stock_latest_date date,

  active_stock_count integer not null default 0,
  active_stock_current_count integer not null default 0,

  business_weekday_lag integer,

  index_date_aligned boolean not null default false,
  all_source_dates_aligned boolean not null default false,
  stock_coverage_complete boolean not null default false,

  reasons jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  evidence_fingerprint text not null unique,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_data_freshness_observations_status_check
    check (
      status in (
        'FRESH',
        'STALE',
        'MISALIGNED',
        'INCOMPLETE',
        'FUTURE_DATED'
      )
    ),

  constraint market_data_freshness_observations_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_data_freshness_observations_observed_at
on public.market_data_freshness_observations (
  observed_at desc
);

create index if not exists
  idx_market_data_freshness_observations_status
on public.market_data_freshness_observations (
  status,
  observed_at desc
);

comment on table public.market_data_freshness_observations is
'Observation-only freshness guard for KOSPI/KOSDAQ and active-stock daily bars used by Market Regime v7.';

comment on column public.market_data_freshness_observations.usable_for_shadow_comparison is
'True only when required market data is complete, aligned, and fresh under the v7.7 conservative weekday heuristic.';

comment on column public.market_data_freshness_observations.production_applied is
'Hard safety flag. v7.7 is shadow/validation infrastructure and must not alter production orders.';