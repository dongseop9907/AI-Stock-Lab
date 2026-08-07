create table if not exists public.market_regime_observations (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),
  market_date date,

  regime text not null,
  would_block_by_regime boolean not null default false,

  breadth_20 numeric,
  avg_return_20 numeric,

  sample_size integer not null default 0,
  return_sample_size integer not null default 0,

  stock_codes jsonb not null default '[]'::jsonb,

  source text not null default 'ACTIVE_STOCK_PROXY_V1',
  reason text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint market_regime_observations_regime_check
    check (
      regime in (
        'BULL',
        'NEUTRAL',
        'BEAR',
        'UNKNOWN'
      )
    )
);

create index if not exists idx_market_regime_observations_observed_at
  on public.market_regime_observations(observed_at desc);

create index if not exists idx_market_regime_observations_regime
  on public.market_regime_observations(regime, observed_at desc);

create index if not exists idx_market_regime_observations_market_date
  on public.market_regime_observations(market_date desc);