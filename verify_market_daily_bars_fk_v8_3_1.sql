-- v8.3.1 verification

-- 1) FK target must be stock_universe_securities(stock_code)
select
  c.conname,
  pg_get_constraintdef(
    c.oid
  ) as definition
from pg_constraint c
where c.conrelid =
  'public.market_daily_bars'::regclass
  and c.contype = 'f';

-- 2) There must be zero existing daily-bar codes missing from the master
select
  count(*) as missing_security_master_codes
from (
  select distinct
    b.stock_code
  from public.market_daily_bars b
  left join public.stock_universe_securities s
    on s.stock_code = b.stock_code
  where s.stock_code is null
) x;

-- 3) v8.3 run/task recovery check
select
  r.id,
  r.status,
  r.task_count,
  r.pending_count,
  r.running_count,
  r.success_count,
  r.failed_count,
  r.received_rows,
  r.saved_rows,
  r.updated_at
from public.market_data_backfill_runs r
order by r.started_at desc
limit 5;
