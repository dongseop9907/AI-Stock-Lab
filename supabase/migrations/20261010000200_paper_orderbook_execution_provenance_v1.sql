-- PAPER ORDERBOOK EXECUTION PROVENANCE V1
-- Thin V3 wrapper around the already-verified V2 PAPER BUY fill RPC.
--
-- Goals:
-- 1. Preserve all existing V2 execution/risk/partial-fill semantics.
-- 2. Persist the actual execution price source used by Realism V2.
-- 3. Preserve orderbook/realism provenance on successful new fills.
-- 4. Keep provenance persistence atomic with the V2 fill.
-- 5. Never rewrite an already-filled historical order on a duplicate call.

begin;

create or replace function public.execute_paper_buy_order_with_execution_price_v3(
  p_order_id uuid,
  p_execution_price numeric,
  p_execution_observed_at timestamptz,
  p_execution_price_source text,
  p_execution_provenance jsonb,
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_updated_rows integer := 0;
begin
  if p_execution_price_source is null
     or btrim(p_execution_price_source) = '' then
    raise exception 'EXECUTION_PRICE_SOURCE_REQUIRED';
  end if;

  if p_execution_price_source not in (
    'BEST_ASK',
    'REFERENCE_PLUS_SYNTHETIC_SPREAD'
  ) then
    raise exception
      'UNSUPPORTED_PAPER_BUY_EXECUTION_PRICE_SOURCE:%',
      p_execution_price_source;
  end if;

  if p_execution_provenance is null
     or jsonb_typeof(p_execution_provenance) <> 'object' then
    raise exception 'EXECUTION_PROVENANCE_OBJECT_REQUIRED';
  end if;

  if octet_length(p_execution_provenance::text) > 131072 then
    raise exception 'EXECUTION_PROVENANCE_TOO_LARGE';
  end if;

  /*
   * Canonical fill/risk/account/position behavior stays in V2.
   * Any exception raised below remains in the same PostgreSQL transaction,
   * so the V2 mutation is rolled back if provenance cannot be persisted.
   */
  select public.execute_paper_buy_order_with_execution_price_v2(
    p_order_id =>
      p_order_id,

    p_execution_price =>
      p_execution_price,

    p_execution_observed_at =>
      p_execution_observed_at,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee
  )
  into v_result;

  /*
   * Idempotent duplicate call: V2 explicitly reports alreadyFilled=true.
   * Never replace historical provenance with data from a later duplicate call.
   */
  if coalesce(
    v_result ->> 'alreadyFilled',
    'false'
  ) = 'true' then
    return v_result;
  end if;

  /*
   * V2 can return a normal FAILED result for its execution guards.
   * This V1 binding intentionally targets successful PAPER fills only.
   */
  if coalesce(
    v_result ->> 'status',
    ''
  ) not in (
    'FILLED',
    'RISK_APPROVED'
  ) then
    return v_result;
  end if;

  update public.paper_order_requests
  set
    execution_price_source =
      p_execution_price_source,

    execution_risk_snapshot =
      coalesce(
        execution_risk_snapshot,
        '{}'::jsonb
      )
      ||
      jsonb_build_object(
        'executionProvenanceVersion',
        'PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1',

        'executionProvenance',
        p_execution_provenance
      )
  where id =
    p_order_id
    and status in (
      'FILLED',
      'RISK_APPROVED'
    );

  get diagnostics
    v_updated_rows =
      row_count;

  if v_updated_rows <> 1 then
    raise exception
      'EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE:%',
      v_updated_rows;
  end if;

  return
    v_result
    ||
    jsonb_build_object(
      'executionProvenancePersisted',
      true,

      'executionPriceSource',
      p_execution_price_source,

      'executionProvenanceVersion',
      'PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1'
    );
end;
$$;

revoke all on function public.execute_paper_buy_order_with_execution_price_v3(
  uuid,
  numeric,
  timestamptz,
  text,
  jsonb,
  integer,
  numeric
)
from public;

grant execute on function public.execute_paper_buy_order_with_execution_price_v3(
  uuid,
  numeric,
  timestamptz,
  text,
  jsonb,
  integer,
  numeric
)
to service_role;

commit;
