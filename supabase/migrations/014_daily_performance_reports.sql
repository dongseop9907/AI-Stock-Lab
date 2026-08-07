begin;

create table if not exists public.daily_performance_reports (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,

  report_date date not null,

  account_equity numeric not null default 0,
  cash_balance numeric not null default 0,
  position_market_value numeric not null default 0,
  open_position_count integer not null default 0,

  realized_pnl_day numeric not null default 0,
  closed_trades integer not null default 0,
  winning_trades integer not null default 0,
  losing_trades integer not null default 0,
  breakeven_trades integer not null default 0,
  win_rate numeric,

  automation_runs integer not null default 0,
  automation_successes integer not null default 0,
  automation_failures integer not null default 0,

  alert_level text not null default 'NORMAL'
    check (
      alert_level in (
        'NORMAL',
        'WARNING',
        'CRITICAL'
      )
    ),

  alert_messages jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,

  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    account_id,
    report_date
  )
);

create index if not exists
  daily_performance_reports_date_idx
on public.daily_performance_reports (
  report_date desc
);

create index if not exists
  daily_performance_reports_alert_idx
on public.daily_performance_reports (
  alert_level,
  report_date desc
);

alter table public.daily_performance_reports
enable row level security;

revoke all
on public.daily_performance_reports
from anon, authenticated;

grant select, insert, update
on public.daily_performance_reports
to service_role;

notify pgrst, 'reload schema';

commit;