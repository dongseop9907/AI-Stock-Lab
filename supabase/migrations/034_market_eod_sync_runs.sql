create table if not exists public.market_eod_sync_runs (
  id uuid primary key default gen_random_uuid(),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  status text not null default 'RUNNING',

  expected_market_date date,
  sync_start_date date,
  sync_end_date date,

  skipped boolean not null default false,
  skip_reason text,

  index_requested_markets integer not null default 0,
  index_received_rows integer not null default 0,
  index_saved_rows integer not null default 0,
  index_failure_count integer not null default 0,

  stock_requested_stocks integer not null default 0,
  stock_received_rows integer not null default 0,
  stock_saved_rows integer not null default 0,
  stock_failure_count integer not null default 0,

  freshness_before jsonb not null default '{}'::jsonb,
  freshness_after jsonb not null default '{}'::jsonb,

  result jsonb not null default '{}'::jsonb,
  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_eod_sync_runs_status_check
    check (
      status in (
        'RUNNING',
        'SKIPPED_ALREADY_FRESH',
        'SUCCESS',
        'PARTIAL_FAILURE',
        'STALE_AFTER_SYNC',
        'FAILED'
      )
    ),

  constraint market_eod_sync_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_eod_sync_runs_started_at
on public.market_eod_sync_runs (
  started_at desc
);

create index if not exists
  idx_market_eod_sync_runs_status
on public.market_eod_sync_runs (
  status,
  started_at desc
);

create index if not exists
  idx_market_eod_sync_runs_expected_market_date
on public.market_eod_sync_runs (
  expected_market_date desc
);

comment on table public.market_eod_sync_runs is
'v7.8 auditable EOD synchronization runs for active-stock and KOSPI/KOSDAQ daily bars.';

comment on column public.market_eod_sync_runs.production_applied is
'Hard safety flag. EOD synchronization updates market data only and never changes order decisions.';