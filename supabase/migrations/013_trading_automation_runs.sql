begin;

create table if not exists public.trading_automation_runs (
  id uuid primary key default gen_random_uuid(),

  trigger_type text not null default 'MANUAL'
    check (
      trigger_type in (
        'MANUAL',
        'SCHEDULED'
      )
    ),

  status text not null default 'RUNNING'
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'PARTIAL_FAILURE',
        'FAILED'
      )
    ),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  steps jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,

  error_message text,

  created_at timestamptz not null default now()
);

create index if not exists
  trading_automation_runs_started_at_idx
on public.trading_automation_runs (
  started_at desc
);

create index if not exists
  trading_automation_runs_status_idx
on public.trading_automation_runs (
  status
);

alter table public.trading_automation_runs
enable row level security;

revoke all
on public.trading_automation_runs
from anon, authenticated;

grant select, insert, update
on public.trading_automation_runs
to service_role;

notify pgrst, 'reload schema';

commit;