-- v9.6.1 / v9.6.2 verification helpers

select
  count(distinct m.stock_code)
    as missing_historical_security_master_codes
from public.historical_universe_compiled_memberships m
left join public.stock_universe_securities s
  on s.stock_code = m.stock_code
where m.compilation_run_id =
  '294e193f-fc56-42cd-a972-a6ddbed56769'
  and m.is_validation = false
  and m.production_applied = false
  and m.listed = true
  and s.stock_code is null;

select *
from public.historical_security_master_reconciliation_runs
where compilation_run_id =
  '294e193f-fc56-42cd-a972-a6ddbed56769'
order by started_at desc
limit 5;

select
  id,
  status,
  task_count,
  pending_count,
  running_count,
  success_count,
  failed_count,
  received_rows,
  saved_rows,
  start_date,
  end_date,
  metadata
from public.market_data_backfill_runs
where metadata ->> 'version' =
  'PIT_AWARE_HISTORICAL_MARKET_BACKFILL_V9_6_2'
order by started_at desc
limit 10;
