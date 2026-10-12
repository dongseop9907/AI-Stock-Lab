-- PAPER PROTECTIVE SELL EXECUTION PROVENANCE V1
-- Thin V3 wrapper around the verified protective SELL V2 RPC.
--
-- Goals:
-- 1. Preserve all V2 stop/trailing exit semantics and accounting.
-- 2. Persist BUY-equivalent SELL execution provenance on the exact fill row.
-- 3. Keep V2 execution + provenance persistence atomic in one transaction.
-- 4. Never rewrite historical provenance on an already-closed duplicate call.

begin;

alter table public.paper_protective_execution_fills_v2
  add column if not exists execution_provenance jsonb;

alter table public.paper_protective_execution_fills_v2
  add column if not exists execution_provenance_version text;

create or replace function public.execute_paper_protective_sell_v3(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz,
  p_execution_source text,
  p_execution_provenance jsonb,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_exit_reason text default 'PROTECTIVE_STOP'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_fill_id uuid;
  v_updated_rows integer := 0;
begin
  if p_execution_source is null
     or btrim(p_execution_source) = '' then
    raise exception 'PROTECTIVE_SELL_EXECUTION_SOURCE_REQUIRED';
  end if;

  if p_execution_source not in (
    'BEST_BID',
    'REFERENCE_MINUS_SYNTHETIC_SPREAD'
  ) then
    raise exception
      'UNSUPPORTED_PROTECTIVE_SELL_EXECUTION_SOURCE:%',
      p_execution_source;
  end if;

  if p_execution_provenance is null
     or jsonb_typeof(p_execution_provenance) <> 'object' then
    raise exception 'PROTECTIVE_SELL_EXECUTION_PROVENANCE_OBJECT_REQUIRED';
  end if;

  if octet_length(p_execution_provenance::text) > 131072 then
    raise exception 'PROTECTIVE_SELL_EXECUTION_PROVENANCE_TOO_LARGE';
  end if;

  /*
   * Canonical position locking, stop validation, accounting, partial-fill,
   * trade-history, order-history and protective-fill behavior remain in V2.
   */
  select public.execute_paper_protective_sell_v2(
    p_position_id =>
      p_position_id,

    p_exit_price =>
      p_exit_price,

    p_observed_at =>
      p_observed_at,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee,

    p_sell_tax =>
      p_sell_tax,

    p_execution_source =>
      p_execution_source,

    p_exit_reason =>
      p_exit_reason
  )
  into v_result;

  /*
   * V2 returns alreadyClosed=true for duplicate calls after the position
   * has already been fully closed. Do not rewrite historical provenance.
   */
  if coalesce(
    v_result ->> 'alreadyClosed',
    'false'
  ) = 'true' then
    return v_result;
  end if;

  /*
   * V2 inserts exactly one protective fill row for a successful new fill.
   * The position row is locked by V2, so competing successful fills for the
   * same position cannot interleave inside this transaction.
   */
  select f.id
  into v_fill_id
  from public.paper_protective_execution_fills_v2 f
  where f.position_id =
      p_position_id
    and f.execution_price =
      p_exit_price
    and f.observed_at is not distinct from
      p_observed_at
    and f.execution_source =
      p_execution_source
  order by
    f.created_at desc,
    f.id desc
  limit 1;

  if v_fill_id is null then
    raise exception
      'PROTECTIVE_SELL_EXECUTION_PROVENANCE_FILL_NOT_FOUND';
  end if;

  update public.paper_protective_execution_fills_v2
  set
    execution_provenance =
      p_execution_provenance,

    execution_provenance_version =
      'PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1'
  where id =
    v_fill_id;

  get diagnostics
    v_updated_rows =
      row_count;

  if v_updated_rows <> 1 then
    raise exception
      'PROTECTIVE_SELL_EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE:%',
      v_updated_rows;
  end if;

  return
    v_result
    ||
    jsonb_build_object(
      'executionProvenancePersisted',
      true,

      'executionPriceSource',
      p_execution_source,

      'executionProvenanceVersion',
      'PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1'
    );
end;
$$;

revoke all on function public.execute_paper_protective_sell_v3(
  uuid,
  numeric,
  timestamptz,
  text,
  jsonb,
  integer,
  numeric,
  numeric,
  text
)
from public;

grant execute on function public.execute_paper_protective_sell_v3(
  uuid,
  numeric,
  timestamptz,
  text,
  jsonb,
  integer,
  numeric,
  numeric,
  text
)
to service_role;

commit;
