-- 057_historical_pit_db_compiler_v9_3b_2.sql
create or replace function public.compile_historical_universe_intervals_v9_3b_2(
  p_compilation_run_id uuid,
  p_universe_code text,
  p_provider text,
  p_calendar_index_code text,
  p_start_date date,
  p_end_date date,
  p_is_validation boolean default false
)
returns table (
  compiled_interval_count integer,
  end_exclusive date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expected_dates integer;
  v_import_rows integer;
  v_distinct_import_dates integer;
  v_end_exclusive date;
  v_inserted integer;
begin
  if p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'V9_3B_2_INVALID_DATE_RANGE';
  end if;

  select count(*)
  into v_expected_dates
  from (
    select distinct b.trading_date
    from public.market_index_daily_bars b
    where b.index_code = p_calendar_index_code
      and b.trading_date between p_start_date and p_end_date
  ) d;

  select count(*), count(distinct i.as_of_date)
  into v_import_rows, v_distinct_import_dates
  from public.historical_universe_snapshot_imports i
  where i.universe_code = p_universe_code
    and i.provider = p_provider
    and i.coverage_status = 'COMPLETE'
    and i.status = 'IMPORTED'
    and i.is_validation = p_is_validation
    and i.as_of_date between p_start_date and p_end_date;

  if v_expected_dates = 0 then
    raise exception 'V9_3B_2_EMPTY_TRADING_CALENDAR';
  end if;

  if v_import_rows <> v_expected_dates
     or v_distinct_import_dates <> v_expected_dates then
    raise exception
      'V9_3B_2_SNAPSHOT_COVERAGE_CHANGED expected=% importRows=% distinctDates=%',
      v_expected_dates, v_import_rows, v_distinct_import_dates;
  end if;

  select b.trading_date
  into v_end_exclusive
  from public.market_index_daily_bars b
  where b.index_code = p_calendar_index_code
    and b.trading_date > p_end_date
  order by b.trading_date asc
  limit 1;

  if v_end_exclusive is null then
    v_end_exclusive := p_end_date + 1;
  end if;

  delete from public.historical_universe_compiled_memberships m
  where m.compilation_run_id = p_compilation_run_id;

  with calendar as (
    select
      d.trading_date,
      row_number() over (order by d.trading_date)::bigint as trading_seq,
      lead(d.trading_date, 1, v_end_exclusive)
        over (order by d.trading_date) as next_trading_date
    from (
      select distinct b.trading_date
      from public.market_index_daily_bars b
      where b.index_code = p_calendar_index_code
        and b.trading_date between p_start_date and p_end_date
    ) d
  ),
  complete_imports as (
    select i.id as import_id, i.as_of_date
    from public.historical_universe_snapshot_imports i
    where i.universe_code = p_universe_code
      and i.provider = p_provider
      and i.coverage_status = 'COMPLETE'
      and i.status = 'IMPORTED'
      and i.is_validation = p_is_validation
      and i.as_of_date between p_start_date and p_end_date
  ),
  base as (
    select
      c.trading_seq,
      c.trading_date,
      c.next_trading_date,
      i.import_id,
      r.stock_code,
      r.stock_name,
      r.market,
      r.sector,
      r.security_type,
      r.listed,
      r.tradable,
      md5(
        jsonb_build_array(
          r.stock_name,
          r.market,
          r.sector,
          r.security_type,
          r.listed,
          r.tradable
        )::text
      ) as metadata_signature
    from calendar c
    join complete_imports i
      on i.as_of_date = c.trading_date
    join public.historical_universe_snapshot_rows r
      on r.import_id = i.import_id
  ),
  lagged as (
    select
      b.*,
      lag(b.trading_seq) over (
        partition by b.stock_code order by b.trading_seq
      ) as previous_trading_seq,
      lag(b.metadata_signature) over (
        partition by b.stock_code order by b.trading_seq
      ) as previous_metadata_signature
    from base b
  ),
  marked as (
    select
      l.*,
      case
        when l.previous_trading_seq is null then 1
        when l.trading_seq <> l.previous_trading_seq + 1 then 1
        when l.metadata_signature is distinct from l.previous_metadata_signature then 1
        else 0
      end as starts_new_interval
    from lagged l
  ),
  numbered as (
    select
      m.*,
      sum(m.starts_new_interval) over (
        partition by m.stock_code
        order by m.trading_seq
        rows between unbounded preceding and current row
      ) as interval_group
    from marked m
  ),
  intervals as (
    select
      n.stock_code,
      n.interval_group,
      min(n.trading_date) as valid_from,
      (array_agg(n.next_trading_date order by n.trading_seq desc))[1] as valid_to,
      (array_agg(n.stock_name order by n.trading_seq))[1] as stock_name,
      (array_agg(n.market order by n.trading_seq))[1] as market,
      (array_agg(n.sector order by n.trading_seq))[1] as sector,
      (array_agg(n.security_type order by n.trading_seq))[1] as security_type,
      (array_agg(n.listed order by n.trading_seq))[1] as listed,
      (array_agg(n.tradable order by n.trading_seq))[1] as tradable,
      count(*)::integer as evidence_snapshot_count,
      (array_agg(n.import_id order by n.trading_seq))[1] as first_import_id,
      (array_agg(n.import_id order by n.trading_seq desc))[1] as last_import_id,
      min(n.trading_date) as first_evidence_date,
      max(n.trading_date) as last_evidence_date
    from numbered n
    group by n.stock_code, n.interval_group
  )
  insert into public.historical_universe_compiled_memberships (
    compilation_run_id,
    universe_code,
    stock_code,
    stock_name,
    market,
    sector,
    security_type,
    listed,
    tradable,
    valid_from,
    valid_to,
    evidence_type,
    source_provider,
    source_import_ids,
    metadata,
    is_validation,
    production_applied
  )
  select
    p_compilation_run_id,
    p_universe_code,
    i.stock_code,
    i.stock_name,
    i.market,
    i.sector,
    i.security_type,
    i.listed,
    i.tradable,
    i.valid_from,
    i.valid_to,
    'DAILY_COMPLETE_SNAPSHOT_COMPACT',
    p_provider,
    case
      when i.first_import_id = i.last_import_id
        then array[i.first_import_id]::uuid[]
      else array[i.first_import_id, i.last_import_id]::uuid[]
    end,
    jsonb_build_object(
      'intervalSemantics', '[valid_from,valid_to)',
      'compilerVersion', 'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2',
      'evidenceSnapshotCount', i.evidence_snapshot_count,
      'firstEvidenceDate', i.first_evidence_date,
      'lastEvidenceDate', i.last_evidence_date,
      'sourceImportIdPolicy', 'FIRST_LAST_ONLY',
      'dailyRawSnapshotsRetained', true,
      'canonicalPromotion', false
    ),
    p_is_validation,
    false
  from intervals i;

  get diagnostics v_inserted = row_count;

  update public.historical_universe_compilation_runs r
  set
    status = 'READY',
    compiled_interval_count = v_inserted,
    metadata =
      coalesce(r.metadata, '{}'::jsonb)
      ||
      jsonb_build_object(
        'compilerVersion', 'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2',
        'executionMode', 'DB_SET_BASED',
        'sourceImportIdPolicy', 'FIRST_LAST_ONLY',
        'dailyRawSnapshotsRetained', true
      ),
    error_message = null,
    finished_at = now()
  where r.id = p_compilation_run_id;

  return query
  select v_inserted, v_end_exclusive;
end;
$$;
