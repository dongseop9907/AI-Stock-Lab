begin;

alter table public.trading_automation_runs
add column if not exists
  telegram_alerted_at timestamptz;

alter table public.trading_automation_runs
add column if not exists
  telegram_message_id bigint;

alter table public.trading_automation_runs
add column if not exists
  telegram_alert_error text;

create index if not exists
  trading_automation_runs_telegram_alert_idx
on public.trading_automation_runs (
  telegram_alerted_at desc
)
where telegram_alerted_at is not null;

notify pgrst, 'reload schema';

commit;