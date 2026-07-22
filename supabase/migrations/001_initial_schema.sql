create extension if not exists vector with schema extensions;

create table if not exists public.stocks (
  stock_code text primary key,
  stock_name text not null,
  market text not null,
  sector text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.market_snapshots (
  id bigint generated always as identity primary key,
  stock_code text not null references public.stocks(stock_code),
  observed_at timestamptz not null,
  open_price numeric,
  high_price numeric,
  low_price numeric,
  close_price numeric,
  volume numeric,
  market_return numeric,
  sector_return numeric,
  raw_payload jsonb not null default '{}'::jsonb,
  unique(stock_code, observed_at)
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  stock_code text not null references public.stocks(stock_code),
  predicted_at timestamptz not null,
  horizon_days integer not null check (horizon_days > 0),
  direction text not null check (direction in ('UP', 'DOWN', 'NEUTRAL')),
  probability numeric not null check (probability between 0 and 1),
  expected_excess_return numeric,
  market_regime text,
  thesis jsonb not null,
  model_name text not null,
  model_version text not null,
  feature_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(stock_code, predicted_at, horizon_days, model_version)
);

create table if not exists public.prediction_outcomes (
  id bigint generated always as identity primary key,
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  evaluated_at timestamptz not null,
  stock_return numeric not null,
  market_return numeric,
  sector_return numeric,
  excess_return numeric,
  max_drawdown numeric,
  direction_correct boolean,
  observed_facts jsonb not null default '[]'::jsonb,
  unique(prediction_id, evaluated_at)
);

create table if not exists public.postmortems (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  outcome_id bigint references public.prediction_outcomes(id) on delete set null,
  valid_hypotheses jsonb not null default '[]'::jsonb,
  invalid_hypotheses jsonb not null default '[]'::jsonb,
  missed_factors jsonb not null default '[]'::jsonb,
  causal_hypotheses jsonb not null default '[]'::jsonb,
  lesson_text text not null,
  lesson_embedding extensions.vector(768),
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  config jsonb not null,
  status text not null default 'research' check (status in ('research', 'paper', 'live', 'retired')),
  created_at timestamptz not null default now(),
  unique(name, version)
);

create table if not exists public.trade_orders (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid references public.predictions(id) on delete set null,
  broker text not null,
  account_mode text not null check (account_mode in ('PAPER', 'LIVE')),
  stock_code text not null references public.stocks(stock_code),
  side text not null check (side in ('BUY', 'SELL')),
  quantity numeric not null check (quantity > 0),
  requested_price numeric,
  filled_price numeric,
  status text not null,
  broker_order_id text,
  fee numeric default 0,
  tax numeric default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  filled_at timestamptz
);

create index if not exists idx_market_snapshots_stock_time on public.market_snapshots(stock_code, observed_at desc);
create index if not exists idx_predictions_stock_time on public.predictions(stock_code, predicted_at desc);
create index if not exists idx_outcomes_prediction on public.prediction_outcomes(prediction_id);
create index if not exists idx_postmortems_embedding on public.postmortems using hnsw (lesson_embedding vector_cosine_ops);
