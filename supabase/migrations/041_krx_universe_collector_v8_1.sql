-- ============================================================
-- v8.1 KRX/KIS Master Universe Collector
-- ============================================================
-- Uses Korea Investment & Securities public domestic-stock master files
-- as an observed current-universe source.
--
-- Important:
-- - This creates current point-in-time observations from the day collected.
-- - It does NOT fabricate historical membership before the first observation.
-- - Historical backfill remains a separate v8.x task.
-- ============================================================

create table if not exists public.stock_universe_sync_runs (
  id uuid primary key default gen_random_uuid(),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  as_of_date date not null,

  status text not null default 'RUNNING',

  source text not null,
  source_version text,

  kospi_raw_count integer,
  kospi_member_count integer,

  kosdaq_raw_count integer,
  kosdaq_member_count integer,

  combined_member_count integer,

  snapshots jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint stock_universe_sync_runs_status_check
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'FAILED'
      )
    ),

  constraint stock_universe_sync_runs_count_check
    check (
      coalesce(kospi_raw_count, 0) >= 0
      and coalesce(kospi_member_count, 0) >= 0
      and coalesce(kosdaq_raw_count, 0) >= 0
      and coalesce(kosdaq_member_count, 0) >= 0
      and coalesce(combined_member_count, 0) >= 0
    ),

  constraint stock_universe_sync_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_stock_universe_sync_runs_started
on public.stock_universe_sync_runs (
  started_at desc
);

create index if not exists
  idx_stock_universe_sync_runs_date_status
on public.stock_universe_sync_runs (
  as_of_date desc,
  status
);

comment on table public.stock_universe_sync_runs is
'v8.1 audit log for observed current KOSPI/KOSDAQ universe collection from KIS public master files.';

comment on column public.stock_universe_sync_runs.production_applied is
'Hard safety flag. Universe collection does not alter production trading behavior.';
