create table if not exists public.market_data_integrity_scans (
  id uuid primary key default gen_random_uuid(),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  status text not null default 'RUNNING',

  window_start_date date not null,
  window_end_date date not null,

  canonical_trading_days integer not null default 0,
  active_stock_count integer not null default 0,

  checked_index_rows integer not null default 0,
  checked_stock_rows integer not null default 0,

  issue_count integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,

  repair_requested boolean not null default false,
  repair_attempted boolean not null default false,
  repair_succeeded boolean,

  before_summary jsonb not null default '{}'::jsonb,
  after_summary jsonb not null default '{}'::jsonb,
  repair_result jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_data_integrity_scans_status_check
    check (
      status in (
        'RUNNING',
        'CLEAN',
        'WARNING',
        'ERROR',
        'REPAIRED',
        'REPAIR_PARTIAL',
        'FAILED'
      )
    ),

  constraint market_data_integrity_scans_production_check
    check (
      production_applied = false
    )
);

create table if not exists public.market_data_integrity_issues (
  id uuid primary key default gen_random_uuid(),

  scan_id uuid not null
    references public.market_data_integrity_scans(id)
    on delete cascade,

  severity text not null,

  issue_type text not null,

  market_code text,
  stock_code text,
  trading_date date,

  repairable boolean not null default false,
  repaired boolean not null default false,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint market_data_integrity_issues_severity_check
    check (
      severity in (
        'ERROR',
        'WARNING'
      )
    )
);

create index if not exists
  idx_market_data_integrity_scans_started_at
on public.market_data_integrity_scans (
  started_at desc
);

create index if not exists
  idx_market_data_integrity_scans_status
on public.market_data_integrity_scans (
  status,
  started_at desc
);

create index if not exists
  idx_market_data_integrity_issues_scan
on public.market_data_integrity_issues (
  scan_id
);

create index if not exists
  idx_market_data_integrity_issues_type
on public.market_data_integrity_issues (
  issue_type,
  trading_date
);

create index if not exists
  idx_market_data_integrity_issues_stock
on public.market_data_integrity_issues (
  stock_code,
  trading_date
);

comment on table public.market_data_integrity_scans is
'v7.9 rolling integrity scans for market daily-bar data. These scans are data-quality infrastructure only and never change production orders.';

comment on table public.market_data_integrity_issues is
'Individual v7.9 integrity findings such as missing bars, invalid OHLC relationships, index-date mismatch, and suspicious extreme returns.';