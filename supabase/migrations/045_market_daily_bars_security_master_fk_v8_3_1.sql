-- ============================================================
-- v8.3.1 Market Daily Bars FK Re-parenting
-- ============================================================
-- Problem:
-- market_daily_bars.stock_code was originally created when the project
-- only had the legacy 5-row stocks table, so its FK points to stocks.
--
-- v8.1 introduced stock_universe_securities as the market-wide security
-- master. v8.3 correctly receives KIS bars for the expanded universe,
-- but inserts fail because those codes are not present in legacy stocks.
--
-- Fix:
-- Re-parent ONLY the market_daily_bars stock_code FK:
--
--   stocks(stock_code)
--        ->
--   stock_universe_securities(stock_code)
--
-- This does NOT:
-- - insert thousands of names into stocks
-- - change stocks.is_active
-- - change trading/risk/order logic
-- - change market_daily_bars PK/upsert identity
--
-- It also resets v8.3 tasks that failed solely because of this old FK,
-- so the existing run can resume instead of being recreated.
-- ============================================================

do $$
declare
  v_missing_count bigint;
begin
  if to_regclass(
    'public.market_daily_bars'
  ) is null then
    raise exception
      'V8_3_1_MARKET_DAILY_BARS_TABLE_NOT_FOUND';
  end if;

  if to_regclass(
    'public.stock_universe_securities'
  ) is null then
    raise exception
      'V8_3_1_STOCK_UNIVERSE_SECURITIES_TABLE_NOT_FOUND';
  end if;

  select count(*)
    into v_missing_count
  from (
    select distinct
      b.stock_code
    from public.market_daily_bars b
    left join public.stock_universe_securities s
      on s.stock_code = b.stock_code
    where s.stock_code is null
  ) missing;

  if v_missing_count > 0 then
    raise exception
      'V8_3_1_EXISTING_BAR_CODES_MISSING_FROM_SECURITY_MASTER: %',
      v_missing_count;
  end if;
end
$$;

alter table public.market_daily_bars
  drop constraint if exists
  market_daily_bars_stock_code_fkey;

alter table public.market_daily_bars
  add constraint
  market_daily_bars_stock_code_fkey
  foreign key (
    stock_code
  )
  references public.stock_universe_securities(
    stock_code
  )
  on update cascade
  on delete restrict
  not valid;

alter table public.market_daily_bars
  validate constraint
  market_daily_bars_stock_code_fkey;

-- ------------------------------------------------------------
-- Recover v8.3 tasks that failed only because the legacy FK rejected
-- otherwise valid KIS daily bars.
-- ------------------------------------------------------------

create temporary table if not exists
  v8_3_1_affected_runs (
    run_id uuid primary key
  )
on commit drop;

insert into v8_3_1_affected_runs (
  run_id
)
select distinct
  t.run_id
from public.market_data_backfill_tasks t
where t.status = 'FAILED'
  and t.last_error ilike
    '%market_daily_bars_stock_code_fkey%'
on conflict do nothing;

update public.market_data_backfill_tasks t
set
  status = 'PENDING',
  attempt_count = 0,
  worker_id = null,
  lease_expires_at = null,
  started_at = null,
  finished_at = null,
  updated_at = now(),
  received_rows = 0,
  saved_rows = 0,
  last_error = null,
  metadata =
    coalesce(
      t.metadata,
      '{}'::jsonb
    )
    || jsonb_build_object(
      'recoveredBy',
      'V8_3_1_MARKET_DAILY_BARS_FK_FIX',
      'recoveredAt',
      now()
    )
where t.status = 'FAILED'
  and t.last_error ilike
    '%market_daily_bars_stock_code_fkey%';

update public.market_data_backfill_runs r
set
  status = 'RUNNING',
  finished_at = null,
  error_message = null,
  updated_at = now(),
  metadata =
    coalesce(
      r.metadata,
      '{}'::jsonb
    )
    || jsonb_build_object(
      'marketDailyBarsFkVersion',
      'V8_3_1_SECURITY_MASTER',
      'fkRecoveredAt',
      now()
    )
where r.id in (
  select
    a.run_id
  from v8_3_1_affected_runs a
);

do $$
declare
  v_run record;
begin
  for v_run in
    select
      a.run_id
    from v8_3_1_affected_runs a
  loop
    perform *
    from public.refresh_market_data_backfill_run_v8_3(
      v_run.run_id
    );
  end loop;
end
$$;

comment on constraint
  market_daily_bars_stock_code_fkey
on public.market_daily_bars is
'v8.3.1: daily market bars belong to the market-wide stock_universe_securities security master, not the legacy stocks.is_active research/trading set.';
