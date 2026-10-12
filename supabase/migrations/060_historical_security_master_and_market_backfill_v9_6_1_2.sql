-- ============================================================
-- 060_historical_security_master_and_market_backfill_v9_6_1_2.sql
-- AI Stock Lab
-- v9.6.1 Historical Security Master Reconciliation
-- v9.6.2 PIT-aware Historical OHLCV Backfill Planner
-- ============================================================

create table if not exists public.historical_security_master_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  compilation_run_id uuid not null
    references public.historical_universe_compilation_runs(id)
    on delete restrict,
  universe_code text not null,
  status text not null default 'RUNNING',
  observed_security_count integer not null default 0,
  existing_security_count integer not null default 0,
  inserted_security_count integer not null default 0,
  name_change_code_count integer not null default 0,
  market_change_code_count integer not null default 0,
  spac_like_code_count integer not null default 0,
  alphanumeric_code_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  production_applied boolean not null default false,
  constraint historical_security_master_reconciliation_runs_status_check
    check (status in ('RUNNING','SUCCESS','FAILED')),
  constraint historical_security_master_reconciliation_runs_production_check
    check (production_applied = false)
);

create index if not exists
  idx_historical_security_master_reconciliation_runs_lookup
on public.historical_security_master_reconciliation_runs (
  compilation_run_id,
  started_at desc
);

create or replace function public.reconcile_historical_security_master_v9_6_1(
  p_compilation_run_id uuid
)
returns table (
  reconciliation_run_id uuid,
  status text,
  observed_security_count integer,
  existing_security_count integer,
  inserted_security_count integer,
  name_change_code_count integer,
  market_change_code_count integer,
  spac_like_code_count integer,
  alphanumeric_code_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run_id uuid;
  v_universe_code text;
  v_compilation_status text;
  v_expected_dates integer;
  v_imported_dates integer;
  v_missing_dates integer;
  v_duplicate_dates integer;
  v_compiled_intervals integer;
  v_is_validation boolean;
  v_production_applied boolean;

  v_observed integer := 0;
  v_existing integer := 0;
  v_inserted integer := 0;
  v_name_changes integer := 0;
  v_market_changes integer := 0;
  v_spac_like integer := 0;
  v_alphanumeric integer := 0;
begin
  select
    r.universe_code,
    r.status,
    r.expected_trading_dates,
    r.imported_complete_dates,
    r.missing_trading_dates,
    r.duplicate_complete_dates,
    r.compiled_interval_count,
    r.is_validation,
    r.production_applied
  into
    v_universe_code,
    v_compilation_status,
    v_expected_dates,
    v_imported_dates,
    v_missing_dates,
    v_duplicate_dates,
    v_compiled_intervals,
    v_is_validation,
    v_production_applied
  from public.historical_universe_compilation_runs r
  where r.id = p_compilation_run_id;

  if v_universe_code is null then
    raise exception 'V9_6_1_COMPILATION_NOT_FOUND';
  end if;

  if v_compilation_status <> 'READY'
     or v_expected_dates <= 0
     or v_imported_dates <> v_expected_dates
     or v_missing_dates <> 0
     or v_duplicate_dates <> 0
     or v_compiled_intervals <= 0
     or v_is_validation = true
     or v_production_applied = true then
    raise exception 'V9_6_1_COMPILATION_NOT_READY';
  end if;

  insert into public.historical_security_master_reconciliation_runs (
    compilation_run_id,
    universe_code,
    status,
    metadata,
    production_applied
  )
  values (
    p_compilation_run_id,
    v_universe_code,
    'RUNNING',
    jsonb_build_object(
      'version', 'HISTORICAL_SECURITY_MASTER_RECONCILIATION_V9_6_1',
      'policy', 'INSERT_MISSING_ONLY',
      'listingDateInferred', false,
      'delistingDateInferred', false,
      'existingCurrentMasterRowsOverwritten', false,
      'historicalIdentityTruthSource',
        'historical_universe_compiled_memberships'
    ),
    false
  )
  returning id into v_run_id;

  with history as (
    select
      m.stock_code,
      count(distinct m.stock_name)::integer as distinct_name_count,
      count(distinct m.market)::integer as distinct_market_count,
      bool_or(m.stock_name ilike '%스팩%') as spac_like,
      bool_or(m.stock_code !~ '^[0-9]{6}$') as alphanumeric
    from public.historical_universe_compiled_memberships m
    where m.compilation_run_id = p_compilation_run_id
      and m.is_validation = false
      and m.production_applied = false
      and m.listed = true
    group by m.stock_code
  )
  select
    count(*)::integer,
    count(*) filter (where s.stock_code is not null)::integer,
    count(*) filter (where h.distinct_name_count > 1)::integer,
    count(*) filter (where h.distinct_market_count > 1)::integer,
    count(*) filter (where h.spac_like)::integer,
    count(*) filter (where h.alphanumeric)::integer
  into
    v_observed,
    v_existing,
    v_name_changes,
    v_market_changes,
    v_spac_like,
    v_alphanumeric
  from history h
  left join public.stock_universe_securities s
    on s.stock_code = h.stock_code;

  with base as (
    select
      m.id,
      m.stock_code,
      m.stock_name,
      m.market,
      m.sector,
      m.security_type,
      m.valid_from,
      m.valid_to,
      m.metadata,
      row_number() over (
        partition by m.stock_code
        order by m.valid_from desc, m.valid_to desc, m.id desc
      ) as latest_rank
    from public.historical_universe_compiled_memberships m
    where m.compilation_run_id = p_compilation_run_id
      and m.is_validation = false
      and m.production_applied = false
      and m.listed = true
  ),
  aggregated as (
    select
      b.stock_code,
      min(
        coalesce(
          nullif(b.metadata ->> 'firstEvidenceDate','')::date,
          b.valid_from
        )
      ) as first_seen_date,
      max(
        coalesce(
          nullif(b.metadata ->> 'lastEvidenceDate','')::date,
          b.valid_from
        )
      ) as last_seen_date,
      array_agg(distinct b.stock_name order by b.stock_name) as name_history,
      array_agg(distinct b.market order by b.market)
        filter (where b.market is not null) as market_history,
      count(*)::integer as interval_count,
      bool_or(b.stock_name ilike '%스팩%') as spac_like_history,
      bool_or(b.stock_code !~ '^[0-9]{6}$') as alphanumeric_code
    from base b
    group by b.stock_code
  ),
  latest as (
    select
      b.stock_code,
      b.stock_name,
      b.market,
      b.sector,
      coalesce(b.security_type,'UNKNOWN') as security_type
    from base b
    where b.latest_rank = 1
  )
  insert into public.stock_universe_securities (
    stock_code,
    stock_name,
    market,
    sector,
    security_type,
    listing_date,
    delisting_date,
    first_seen_date,
    last_seen_date,
    source,
    source_version,
    metadata,
    created_at,
    updated_at
  )
  select
    l.stock_code,
    l.stock_name,
    l.market,
    l.sector,
    l.security_type,
    null,
    null,
    a.first_seen_date,
    a.last_seen_date,
    'KRX_HISTORICAL_PIT_RECONCILIATION',
    'v9.6.1',
    jsonb_build_object(
      'pitCompilationRunId', p_compilation_run_id,
      'historicalOnlyMasterSeed', true,
      'identityModel', 'STOCK_CODE_REFERENCE_KEY_WITH_PIT_INTERVAL_METADATA',
      'firstPitEvidenceDate', a.first_seen_date,
      'lastPitEvidenceDate', a.last_seen_date,
      'intervalCount', a.interval_count,
      'nameHistory', to_jsonb(a.name_history),
      'marketHistory',
        to_jsonb(coalesce(a.market_history,array[]::text[])),
      'spacLikeHistory', a.spac_like_history,
      'alphanumericCode', a.alphanumeric_code,
      'listingDateInferred', false,
      'delistingDateInferred', false
    ),
    now(),
    now()
  from latest l
  join aggregated a
    on a.stock_code = l.stock_code
  left join public.stock_universe_securities s
    on s.stock_code = l.stock_code
  where s.stock_code is null
  on conflict (stock_code) do nothing;

  get diagnostics v_inserted = row_count;

  update public.historical_security_master_reconciliation_runs r
  set
    status = 'SUCCESS',
    observed_security_count = v_observed,
    existing_security_count = v_existing,
    inserted_security_count = v_inserted,
    name_change_code_count = v_name_changes,
    market_change_code_count = v_market_changes,
    spac_like_code_count = v_spac_like,
    alphanumeric_code_count = v_alphanumeric,
    metadata =
      r.metadata ||
      jsonb_build_object(
        'missingBeforeInsert', greatest(v_observed - v_existing,0),
        'missingAfterInsert',
          greatest(v_observed - v_existing - v_inserted,0)
      ),
    finished_at = now()
  where r.id = v_run_id;

  return query
  select
    v_run_id,
    'SUCCESS'::text,
    v_observed,
    v_existing,
    v_inserted,
    v_name_changes,
    v_market_changes,
    v_spac_like,
    v_alphanumeric;

exception
  when others then
    if v_run_id is not null then
      update public.historical_security_master_reconciliation_runs
      set
        status = 'FAILED',
        error_message = sqlerrm,
        finished_at = now()
      where id = v_run_id;
    end if;
    raise;
end;
$$;

create or replace function public.create_historical_market_data_backfill_v9_6_2(
  p_compilation_run_id uuid,
  p_start_date date,
  p_end_date date,
  p_stock_codes text[] default null,
  p_adjusted_price boolean default true,
  p_max_attempts integer default 3,
  p_request_delay_ms integer default 1500
)
returns table (
  run_id uuid,
  status text,
  task_count integer,
  expected_bar_count bigint,
  available_bar_count bigint,
  missing_bar_count bigint,
  selected_security_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_universe_code text;
  v_calendar_index_code text;
  v_compilation_status text;
  v_compilation_start date;
  v_compilation_end date;
  v_expected_dates integer;
  v_imported_dates integer;
  v_missing_dates integer;
  v_duplicate_dates integer;
  v_compiled_intervals integer;
  v_is_validation boolean;
  v_production_applied boolean;

  v_missing_master integer := 0;
  v_run_id uuid;
  v_task_count integer := 0;
  v_expected bigint := 0;
  v_available bigint := 0;
  v_missing bigint := 0;
  v_selected integer := 0;
begin
  if p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'V9_6_2_INVALID_DATE_RANGE';
  end if;

  select
    r.universe_code,
    r.calendar_index_code,
    r.status,
    r.start_date,
    r.end_date,
    r.expected_trading_dates,
    r.imported_complete_dates,
    r.missing_trading_dates,
    r.duplicate_complete_dates,
    r.compiled_interval_count,
    r.is_validation,
    r.production_applied
  into
    v_universe_code,
    v_calendar_index_code,
    v_compilation_status,
    v_compilation_start,
    v_compilation_end,
    v_expected_dates,
    v_imported_dates,
    v_missing_dates,
    v_duplicate_dates,
    v_compiled_intervals,
    v_is_validation,
    v_production_applied
  from public.historical_universe_compilation_runs r
  where r.id = p_compilation_run_id;

  if v_universe_code is null then
    raise exception 'V9_6_2_COMPILATION_NOT_FOUND';
  end if;

  if v_compilation_status <> 'READY'
     or v_expected_dates <= 0
     or v_imported_dates <> v_expected_dates
     or v_missing_dates <> 0
     or v_duplicate_dates <> 0
     or v_compiled_intervals <= 0
     or v_is_validation = true
     or v_production_applied = true then
    raise exception 'V9_6_2_COMPILATION_NOT_READY';
  end if;

  if p_start_date < v_compilation_start
     or p_end_date > v_compilation_end then
    raise exception 'V9_6_2_RANGE_OUTSIDE_COMPILATION';
  end if;

  select count(distinct m.stock_code)::integer
  into v_missing_master
  from public.historical_universe_compiled_memberships m
  left join public.stock_universe_securities s
    on s.stock_code = m.stock_code
  where m.compilation_run_id = p_compilation_run_id
    and m.is_validation = false
    and m.production_applied = false
    and m.listed = true
    and m.valid_from <= p_end_date
    and m.valid_to > p_start_date
    and (
      p_stock_codes is null
      or m.stock_code = any(p_stock_codes)
    )
    and s.stock_code is null;

  if v_missing_master > 0 then
    raise exception
      'V9_6_2_SECURITY_MASTER_NOT_RECONCILED missing=%',
      v_missing_master;
  end if;

  insert into public.market_data_backfill_runs (
    universe_code,
    universe_as_of_date,
    start_date,
    end_date,
    adjusted_price,
    allowed_security_types,
    exclude_management,
    exclude_low_liquidity_flag,
    max_attempts,
    request_delay_ms,
    status,
    metadata,
    production_applied
  )
  values (
    v_universe_code,
    p_end_date,
    p_start_date,
    p_end_date,
    coalesce(p_adjusted_price,true),
    array[
      'COMMON','PREFERRED','ETF','ETN','REIT',
      'SPAC','FUND','UNKNOWN','OTHER'
    ]::text[],
    false,
    false,
    greatest(1,least(coalesce(p_max_attempts,3),10)),
    greatest(0,least(coalesce(p_request_delay_ms,1500),10000)),
    'RUNNING',
    jsonb_build_object(
      'version', 'PIT_AWARE_HISTORICAL_MARKET_BACKFILL_V9_6_2',
      'source', 'KIS_DOMESTIC_DAILY',
      'purpose', 'HISTORICAL_PIT_OHLCV_COVERAGE',
      'pitCompilationRunId', p_compilation_run_id,
      'calendarIndexCode', v_calendar_index_code,
      'taskGranularity', 'COMPILED_PIT_INTERVAL',
      'onlyMissingCoverageTasksCreated', true,
      'currentUniverseSubstituted', false,
      'stockCodeFormatRestrictedToNumericSixDigits', false,
      'existingV83WorkerReused', true,
      'requestedStockCodes',
        to_jsonb(coalesce(p_stock_codes,array[]::text[]))
    ),
    false
  )
  returning id into v_run_id;

  with clipped as (
    select
      m.id as interval_id,
      m.stock_code,
      m.stock_name,
      m.market,
      m.security_type,
      greatest(m.valid_from,p_start_date) as interval_start,
      least(m.valid_to,p_end_date + 1) as interval_end_exclusive
    from public.historical_universe_compiled_memberships m
    where m.compilation_run_id = p_compilation_run_id
      and m.is_validation = false
      and m.production_applied = false
      and m.listed = true
      and m.valid_from <= p_end_date
      and m.valid_to > p_start_date
      and (
        p_stock_codes is null
        or m.stock_code = any(p_stock_codes)
      )
  ),
  ranges as (
    select
      c.*,
      (
        select min(k.trading_date)
        from public.market_index_daily_bars k
        where k.index_code = v_calendar_index_code
          and k.trading_date >= c.interval_start
          and k.trading_date < c.interval_end_exclusive
      ) as task_start_date,
      (
        select max(k.trading_date)
        from public.market_index_daily_bars k
        where k.index_code = v_calendar_index_code
          and k.trading_date >= c.interval_start
          and k.trading_date < c.interval_end_exclusive
      ) as task_end_date,
      (
        select count(*)::integer
        from public.market_index_daily_bars k
        where k.index_code = v_calendar_index_code
          and k.trading_date >= c.interval_start
          and k.trading_date < c.interval_end_exclusive
      ) as expected_bars
    from clipped c
  ),
  coverage as (
    select
      r.interval_id,
      r.stock_code,
      r.stock_name,
      r.market,
      r.security_type,
      r.task_start_date,
      r.task_end_date,
      r.expected_bars,
      count(b.stock_code) filter (
        where b.open_price > 0
          and b.high_price > 0
          and b.low_price > 0
          and b.close_price > 0
          and b.volume is not null
          and b.volume >= 0
      )::integer as available_bars
    from ranges r
    left join public.market_daily_bars b
      on b.stock_code = r.stock_code
     and b.trading_date >= r.task_start_date
     and b.trading_date <= r.task_end_date
    where r.task_start_date is not null
      and r.task_end_date is not null
      and r.expected_bars > 0
    group by
      r.interval_id,
      r.stock_code,
      r.stock_name,
      r.market,
      r.security_type,
      r.task_start_date,
      r.task_end_date,
      r.expected_bars
  )
  insert into public.market_data_backfill_tasks (
    run_id,
    stock_code,
    stock_name,
    market,
    start_date,
    end_date,
    status,
    attempt_count,
    received_rows,
    saved_rows,
    metadata,
    production_applied
  )
  select
    v_run_id,
    c.stock_code,
    c.stock_name,
    c.market,
    c.task_start_date,
    c.task_end_date,
    'PENDING',
    0,
    0,
    0,
    jsonb_build_object(
      'version', 'PIT_AWARE_HISTORICAL_MARKET_BACKFILL_V9_6_2',
      'historicalPitCompilationRunId', p_compilation_run_id,
      'historicalPitIntervalId', c.interval_id,
      'securityType', c.security_type,
      'expectedBars', c.expected_bars,
      'availableBarsAtCreate', c.available_bars,
      'missingBarsAtCreate',
        greatest(c.expected_bars - c.available_bars,0),
      'intervalSemantics', '[valid_from,valid_to)',
      'taskDateSemantics', 'INCLUSIVE_TRADING_DAY_RANGE'
    ),
    false
  from coverage c
  where c.available_bars < c.expected_bars
  on conflict (run_id,stock_code,start_date,end_date)
  do nothing;

  get diagnostics v_task_count = row_count;

  select
    count(distinct t.stock_code)::integer,
    coalesce(sum((t.metadata ->> 'expectedBars')::bigint),0)::bigint,
    coalesce(sum((t.metadata ->> 'availableBarsAtCreate')::bigint),0)::bigint,
    coalesce(sum((t.metadata ->> 'missingBarsAtCreate')::bigint),0)::bigint
  into
    v_selected,
    v_expected,
    v_available,
    v_missing
  from public.market_data_backfill_tasks t
  where t.run_id = v_run_id;

  if v_task_count = 0 then
    update public.market_data_backfill_runs
    set
      status = 'SUCCESS',
      task_count = 0,
      pending_count = 0,
      running_count = 0,
      success_count = 0,
      failed_count = 0,
      metadata =
        metadata ||
        jsonb_build_object(
          'alreadyFullyCovered', true,
          'selectedSecurityCount', v_selected,
          'expectedBarCountInTasks', v_expected,
          'availableBarCountAtCreate', v_available,
          'missingBarCountAtCreate', v_missing
        ),
      finished_at = now(),
      updated_at = now()
    where id = v_run_id;
  else
    update public.market_data_backfill_runs
    set
      metadata =
        metadata ||
        jsonb_build_object(
          'selectedSecurityCount', v_selected,
          'expectedBarCountInTasks', v_expected,
          'availableBarCountAtCreate', v_available,
          'missingBarCountAtCreate', v_missing
        ),
      updated_at = now()
    where id = v_run_id;

    perform *
    from public.refresh_market_data_backfill_run_v8_3(v_run_id);
  end if;

  return query
  select
    v_run_id,
    (
      select r.status
      from public.market_data_backfill_runs r
      where r.id = v_run_id
    ),
    v_task_count,
    v_expected,
    v_available,
    v_missing,
    v_selected;
end;
$$;

comment on table public.historical_security_master_reconciliation_runs is
'v9.6.1 audit for seeding historical/delisted PIT stock codes into the market-wide security master without overwriting current master rows.';

comment on function public.reconcile_historical_security_master_v9_6_1 is
'Insert missing historical PIT stock codes into stock_universe_securities for referential integrity. listing_date/delisting_date are never inferred from PIT window boundaries.';

comment on function public.create_historical_market_data_backfill_v9_6_2 is
'Create v8.3-compatible resumable KIS daily-bar tasks from exact historical PIT intervals, only where valid OHLCV coverage is incomplete.';
