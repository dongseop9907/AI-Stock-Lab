begin;

alter table public.daily_performance_reports
add column if not exists
  telegram_notified_at timestamptz;

alter table public.daily_performance_reports
add column if not exists
  telegram_message_id bigint;

alter table public.daily_performance_reports
add column if not exists
  telegram_notification_error text;

notify pgrst, 'reload schema';

commit;