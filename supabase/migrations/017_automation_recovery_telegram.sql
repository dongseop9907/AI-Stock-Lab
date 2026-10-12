begin;

alter table public.trading_automation_runs
add column if not exists
  recovery_alerted_at timestamptz;

alter table public.trading_automation_runs
add column if not exists
  recovery_message_id bigint;

alter table public.trading_automation_runs
add column if not exists
  recovery_alert_error text;

alter table public.trading_automation_runs
add column if not exists
  recovered_by_run_id uuid
  references public.trading_automation_runs(id)
  on delete set null;

create index if not exists
  trading_automation_runs_unresolved_failure_idx
on public.trading_automation_runs (
  started_at desc
)
where
  trigger_type = 'SCHEDULED'
  and status in (
    'FAILED',
    'PARTIAL_FAILURE'
  )
  and telegram_alerted_at is not null
  and recovery_alerted_at is null;

notify pgrst, 'reload schema';

commit;