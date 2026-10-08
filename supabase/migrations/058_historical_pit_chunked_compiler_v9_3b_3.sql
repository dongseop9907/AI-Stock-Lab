-- ============================================================
-- 058_historical_pit_chunked_compiler_v9_3b_3.sql
-- AI Stock Lab
-- v9.3B.3 Resumable Chunked DB Historical PIT Compiler
-- ============================================================
-- Purpose:
--   Supabase/PostgREST statement_timeout can cancel the full 2.3M-row
--   v9.3B.2 set-based compile. This version processes small trading-date
--   chunks and merges only interval boundaries between chunks.
--
-- Safety:
--   * COMPLETE daily snapshot coverage is re-checked per chunk.
--   * Missing / duplicate COMPLETE snapshots fail closed.
--   * [valid_from, valid_to) semantics are preserved.
--   * Re-entry and metadata changes create distinct intervals.
--   * Only historical_universe_compiled_memberships staging is written.
--   * canonical stock_universe_memberships is never modified.
--   * production trading/risk is never modified.
-- ============================================================

create table if not exists public.historical_universe_compilation_chunks (
  id uuid primary key default gen_random_uuid(),

  compilation_run_id uuid not null
    references public.historical_universe_compilation_runs(id)
    on delete cascade,

  chunk_no integer not null,
  start_date date not null,
  end_date date not null,

  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,

  worker_id text,
  lease_expires_at timestamptz,

  chunk_interval_count integer not null default 0,
  merged_interval_count integer not null default 0,
  inserted_interval_count integer not null default 0,

  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  unique (compilation_run_id, chunk_no),

  constraint historical_universe_compilation_chunks_status_check
    check (
      status in (
        'PENDING',
        'RUNNING',
        'SUCCESS',
        'FAILED',
        'CANCELLED'
      )
    ),

  constraint historical_universe_compilation_chunks_range_check
    check (
      start_date <= end_date
      and chunk_no >= 0
      and attempt_count >= 0
      and max_attempts between 1 and 10
    )
);

create index if not exists
  idx_historical_universe_compilation_chunks_claim
on public.historical_universe_compilation_chunks (
  compilation_run_id,
  status,
  chunk_no
);

create index if not exists
  idx_historical_universe_compilation_chunks_lease
on public.historical_universe_compilation_chunks (
  compilation_run_id,
  lease_expires_at
)
where status = 'RUNNING';


create or replace function public.claim_historical_universe_compilation_chunks_v9_3b_3(
  p_compilation_run_id uuid,
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 180
)
returns setof public.historical_universe_compilation_chunks
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.historical_universe_compilation_chunks
  set
    status = 'PENDING',
    worker_id = null,
    lease_expires_at = null,
    updated_at = now(),
    error_message =
      coalesce(error_message, '')
      ||
      case
        when coalesce(error_message, '') = '' then ''
        else E'\n'
      end
      ||
      'LEASE_RECOVERED'
  where compilation_run_id = p_compilation_run_id
    and status = 'RUNNING'
    and lease_expires_at is not null
    and lease_expires_at < now();

  return query
  with candidates as (
    select c.id
    from public.historical_universe_compilation_chunks c
    join public.historical_universe_compilation_runs r
      on r.id = c.compilation_run_id
    where c.compilation_run_id = p_compilation_run_id
      and r.status = 'RUNNING'
      and (
        c.status = 'PENDING'
        or (
          c.status = 'FAILED'
          and c.attempt_count < c.max_attempts
        )
      )
    order by c.chunk_no asc
    for update of c skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  )
  update public.historical_universe_compilation_chunks c
  set
    status = 'RUNNING',
    attempt_count = c.attempt_count + 1,
    worker_id = p_worker_id,
    lease_expires_at =
      now()
      +
      make_interval(
        secs => greatest(30, coalesce(p_lease_seconds, 180))
      ),
    started_at = coalesce(c.started_at, now()),
    updated_at = now(),
    error_message = null
  from candidates x
  where c.id = x.id
  returning c.*;
end;
$$;


create or replace function public.compile_historical_universe_chunk_v9_3b_3(
  p_compilation_run_id uuid,
  p_universe_code text,
  p_provider text,
  p_calendar_index_code text,
  p_chunk_start_date date,
  p_chunk_end_date date,
  p_is_validation boolean default false
)
returns table (
  chunk_interval_count integer,
  merged_interval_count integer,
  inserted_interval_count integer,
  chunk_end_exclusive date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expected_dates integer;
  v_import_rows integer;
  v_distinct_import_dates integer;

  v_chunk_end_exclusive date;

  v_chunk_intervals integer := 0;
  v_merged integer := 0;
  v_inserted integer := 0;
begin
  if p_chunk_start_date is null
     or p_chunk_end_date is null
     or p_chunk_start_date > p_chunk_end_date then
    raise exception 'V9_3B_3_INVALID_CHUNK_RANGE';
  end if;

  select count(*)
  into v_expected_dates
  from (
    select distinct b.trading_date
    from public.market_index_daily_bars b
    where b.index_code = p_calendar_index_code
      and b.trading_date
          between p_chunk_start_date and p_chunk_end_date
  ) d;

  select
    count(*),
    count(distinct i.as_of_date)
  into
    v_import_rows,
    v_distinct_import_dates
  from public.historical_universe_snapshot_imports i
  where i.universe_code = p_universe_code
    and i.provider = p_provider
    and i.coverage_status = 'COMPLETE'
    and i.status = 'IMPORTED'
    and i.is_validation = p_is_validation
    and i.as_of_date
        between p_chunk_start_date and p_chunk_end_date;

  if v_expected_dates = 0 then
    raise exception 'V9_3B_3_EMPTY_CHUNK_CALENDAR';
  end if;

  if v_import_rows <> v_expected_dates
     or v_distinct_import_dates <> v_expected_dates then
    raise exception
      'V9_3B_3_CHUNK_COVERAGE_INVALID expected=% importRows=% distinctDates=%',
      v_expected_dates,
      v_import_rows,
      v_distinct_import_dates;
  end if;

  select b.trading_date
  into v_chunk_end_exclusive
  from public.market_index_daily_bars b
  where b.index_code = p_calendar_index_code
    and b.trading_date > p_chunk_end_date
  order by b.trading_date asc
  limit 1;

  if v_chunk_end_exclusive is null then
    v_chunk_end_exclusive := p_chunk_end_date + 1;
  end if;

  create temporary table if not exists
    pg_temp.v93b3_chunk_intervals (
      stock_code text not null,
      stock_name text not null,

      market text not null,
      sector text,
      security_type text not null,

      listed boolean not null,
      tradable boolean not null,

      valid_from date not null,
      valid_to date,

      evidence_snapshot_count integer not null,

      first_import_id uuid not null,
      last_import_id uuid not null,

      first_evidence_date date not null,
      last_evidence_date date not null,

      merge_target_id uuid
    )
  on commit drop;

  truncate table pg_temp.v93b3_chunk_intervals;

  insert into pg_temp.v93b3_chunk_intervals (
    stock_code,
    stock_name,

    market,
    sector,
    security_type,

    listed,
    tradable,

    valid_from,
    valid_to,

    evidence_snapshot_count,

    first_import_id,
    last_import_id,

    first_evidence_date,
    last_evidence_date
  )
  with calendar as (
    select
      d.trading_date,

      row_number() over (
        order by d.trading_date
      )::bigint as trading_seq,

      lead(
        d.trading_date,
        1,
        v_chunk_end_exclusive
      ) over (
        order by d.trading_date
      ) as next_trading_date

    from (
      select distinct b.trading_date
      from public.market_index_daily_bars b
      where b.index_code = p_calendar_index_code
        and b.trading_date
            between p_chunk_start_date and p_chunk_end_date
    ) d
  ),
  complete_imports as (
    select
      i.id as import_id,
      i.as_of_date

    from public.historical_universe_snapshot_imports i

    where i.universe_code = p_universe_code
      and i.provider = p_provider
      and i.coverage_status = 'COMPLETE'
      and i.status = 'IMPORTED'
      and i.is_validation = p_is_validation
      and i.as_of_date
          between p_chunk_start_date and p_chunk_end_date
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
        partition by b.stock_code
        order by b.trading_seq
      ) as previous_trading_seq,

      lag(b.metadata_signature) over (
        partition by b.stock_code
        order by b.trading_seq
      ) as previous_metadata_signature

    from base b
  ),
  marked as (
    select
      l.*,

      case
        when l.previous_trading_seq is null then 1
        when l.trading_seq <> l.previous_trading_seq + 1 then 1
        when l.metadata_signature
             is distinct from
             l.previous_metadata_signature then 1
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
  )
  select
    n.stock_code,

    (array_agg(
      n.stock_name
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.market
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.sector
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.security_type
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.listed
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.tradable
      order by n.trading_seq
    ))[1],

    min(n.trading_date),

    (array_agg(
      n.next_trading_date
      order by n.trading_seq desc
    ))[1],

    count(*)::integer,

    (array_agg(
      n.import_id
      order by n.trading_seq
    ))[1],

    (array_agg(
      n.import_id
      order by n.trading_seq desc
    ))[1],

    min(n.trading_date),
    max(n.trading_date)

  from numbered n

  group by
    n.stock_code,
    n.interval_group;

  get diagnostics
    v_chunk_intervals = row_count;

  /*
   * Merge only an interval that starts exactly at this chunk's first
   * trading date with the immediately preceding interval.
   *
   * This is enough to preserve continuity across chunk boundaries while
   * still keeping re-entry and metadata changes separate.
   */
  update pg_temp.v93b3_chunk_intervals ci
  set
    merge_target_id = e.id

  from public.historical_universe_compiled_memberships e

  where e.compilation_run_id = p_compilation_run_id
    and ci.valid_from = p_chunk_start_date

    and e.stock_code = ci.stock_code
    and e.valid_to = ci.valid_from

    and e.stock_name is not distinct from ci.stock_name
    and e.market is not distinct from ci.market
    and e.sector is not distinct from ci.sector
    and e.security_type is not distinct from ci.security_type
    and e.listed is not distinct from ci.listed
    and e.tradable is not distinct from ci.tradable;

  get diagnostics
    v_merged = row_count;

  update public.historical_universe_compiled_memberships e
  set
    valid_to = ci.valid_to,

    source_import_ids =
      case
        when coalesce(
          e.source_import_ids[1],
          ci.first_import_id
        ) = ci.last_import_id
        then array[
          coalesce(
            e.source_import_ids[1],
            ci.first_import_id
          )
        ]::uuid[]

        else array[
          coalesce(
            e.source_import_ids[1],
            ci.first_import_id
          ),
          ci.last_import_id
        ]::uuid[]
      end,

    metadata =
      coalesce(
        e.metadata,
        '{}'::jsonb
      )
      ||
      jsonb_build_object(
        'compilerVersion',
        'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3',

        'executionMode',
        'CHUNKED_DB',

        'evidenceSnapshotCount',
        coalesce(
          nullif(
            e.metadata ->> 'evidenceSnapshotCount',
            ''
          )::integer,
          0
        )
        +
        ci.evidence_snapshot_count,

        'lastEvidenceDate',
        ci.last_evidence_date,

        'sourceImportIdPolicy',
        'FIRST_LAST_ONLY',

        'dailyRawSnapshotsRetained',
        true,

        'canonicalPromotion',
        false
      )

  from pg_temp.v93b3_chunk_intervals ci

  where ci.merge_target_id = e.id;

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

    ci.stock_code,
    ci.stock_name,

    ci.market,
    ci.sector,
    ci.security_type,

    ci.listed,
    ci.tradable,

    ci.valid_from,
    ci.valid_to,

    'DAILY_COMPLETE_SNAPSHOT_CHUNKED',
    p_provider,

    case
      when ci.first_import_id = ci.last_import_id
      then array[
        ci.first_import_id
      ]::uuid[]

      else array[
        ci.first_import_id,
        ci.last_import_id
      ]::uuid[]
    end,

    jsonb_build_object(
      'intervalSemantics',
      '[valid_from,valid_to)',

      'compilerVersion',
      'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3',

      'executionMode',
      'CHUNKED_DB',

      'evidenceSnapshotCount',
      ci.evidence_snapshot_count,

      'firstEvidenceDate',
      ci.first_evidence_date,

      'lastEvidenceDate',
      ci.last_evidence_date,

      'sourceImportIdPolicy',
      'FIRST_LAST_ONLY',

      'dailyRawSnapshotsRetained',
      true,

      'canonicalPromotion',
      false
    ),

    p_is_validation,
    false

  from pg_temp.v93b3_chunk_intervals ci

  where ci.merge_target_id is null;

  get diagnostics
    v_inserted = row_count;

  return query
  select
    v_chunk_intervals,
    v_merged,
    v_inserted,
    v_chunk_end_exclusive;
end;
$$;


create or replace function public.refresh_historical_universe_compilation_v9_3b_3(
  p_compilation_run_id uuid
)
returns table (
  compilation_run_id uuid,
  status text,
  chunk_count integer,
  pending_count integer,
  running_count integer,
  success_count integer,
  failed_count integer,
  retryable_failed_count integer,
  compiled_interval_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_chunk_count integer;
  v_pending integer;
  v_running integer;
  v_success integer;
  v_failed integer;
  v_retryable_failed integer;

  v_current_status text;
  v_status text;

  v_compiled integer;
begin
  select
    count(*)::integer,
    count(*) filter (
      where c.status = 'PENDING'
    )::integer,
    count(*) filter (
      where c.status = 'RUNNING'
    )::integer,
    count(*) filter (
      where c.status = 'SUCCESS'
    )::integer,
    count(*) filter (
      where c.status = 'FAILED'
    )::integer,
    count(*) filter (
      where c.status = 'FAILED'
        and c.attempt_count < c.max_attempts
    )::integer

  into
    v_chunk_count,
    v_pending,
    v_running,
    v_success,
    v_failed,
    v_retryable_failed

  from public.historical_universe_compilation_chunks c

  where c.compilation_run_id = p_compilation_run_id;

  select r.status
  into v_current_status
  from public.historical_universe_compilation_runs r
  where r.id = p_compilation_run_id
  for update;

  if v_current_status = 'CANCELLED' then
    v_status := 'CANCELLED';

  elsif v_chunk_count > 0
        and v_success = v_chunk_count then
    v_status := 'READY';

  elsif v_pending = 0
        and v_running = 0
        and v_failed > 0
        and v_retryable_failed = 0 then
    v_status := 'FAILED';

  else
    v_status := 'RUNNING';
  end if;

  select count(*)::integer
  into v_compiled
  from public.historical_universe_compiled_memberships m
  where m.compilation_run_id = p_compilation_run_id;

  update public.historical_universe_compilation_runs r
  set
    status = v_status,

    compiled_interval_count =
      case
        when v_status = 'READY'
        then v_compiled
        else r.compiled_interval_count
      end,

    metadata =
      coalesce(
        r.metadata,
        '{}'::jsonb
      )
      ||
      jsonb_build_object(
        'compilerVersion',
        'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3',

        'executionMode',
        'CHUNKED_DB',

        'chunkCount',
        v_chunk_count,

        'successfulChunks',
        v_success,

        'failedChunks',
        v_failed,

        'sourceImportIdPolicy',
        'FIRST_LAST_ONLY',

        'dailyRawSnapshotsRetained',
        true
      ),

    error_message =
      case
        when v_status = 'FAILED'
        then coalesce(
          r.error_message,
          'V9_3B_3_ONE_OR_MORE_CHUNKS_EXHAUSTED_RETRIES'
        )

        when v_status = 'READY'
        then null

        else r.error_message
      end,

    finished_at =
      case
        when v_status in (
          'READY',
          'FAILED',
          'CANCELLED'
        )
        then coalesce(
          r.finished_at,
          now()
        )

        else null
      end

  where r.id = p_compilation_run_id;

  return query
  select
    p_compilation_run_id,
    v_status,
    v_chunk_count,
    v_pending,
    v_running,
    v_success,
    v_failed,
    v_retryable_failed,
    v_compiled;
end;
$$;

comment on table public.historical_universe_compilation_chunks is
'v9.3B.3 resumable chunk audit/queue for large historical PIT compilation.';

comment on function public.compile_historical_universe_chunk_v9_3b_3 is
'Compiles one small trading-date chunk and merges only continuous metadata-identical boundary intervals from the prior chunk.';
