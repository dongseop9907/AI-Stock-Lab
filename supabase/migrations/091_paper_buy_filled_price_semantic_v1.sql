-- PAPER BUY FILLED PRICE SEMANTIC V1
-- Thin V4 wrapper around the verified BUY V3 RPC.
--
-- Problem:
--   V2 persists paper_order_requests.filled_price = entry_price
--   while returning filledPrice = p_execution_price.
--
-- Correct semantic:
--   paper_order_requests.filled_price is the cumulative quantity-weighted
--   execution price across all successful fills for the order.
--
-- Safety:
--   - V2 risk/account/position/partial-fill behavior remains untouched.
--   - V3 provenance behavior remains untouched.
--   - V4 locks and captures the pre-fill order state, delegates V3,
--     then corrects only filled_price in the same PostgreSQL transaction.
--   - Any semantic correction failure rolls back the delegated V3/V2 fill.

begin;

create or replace function public.execute_paper_buy_order_with_execution_price_v4(
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
  v_prior_filled_quantity integer := 0;
  v_prior_filled_price numeric;
  v_prior_status text;

  v_result jsonb;

  v_total_filled_quantity integer := 0;
  v_new_fill_quantity integer := 0;
  v_cumulative_filled_price numeric;

  v_updated_rows integer := 0;
begin
  /*
   * Capture the exact pre-fill state under the same row lock used by the
   * canonical execution path. PostgreSQL row locks are transaction-scoped;
   * the nested V3 -> V2 lock is re-entrant for this transaction.
   */
  select
    greatest(
      0,
      coalesce(filled_quantity, 0)
    ),
    filled_price,
    status
  into
    v_prior_filled_quantity,
    v_prior_filled_price,
    v_prior_status
  from public.paper_order_requests
  where id =
    p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  /*
   * Canonical execution remains V3 -> V2.
   * V3 preserves provenance atomically with the fill.
   */
  select public.execute_paper_buy_order_with_execution_price_v3(
    p_order_id =>
      p_order_id,

    p_execution_price =>
      p_execution_price,

    p_execution_observed_at =>
      p_execution_observed_at,

    p_execution_price_source =>
      p_execution_price_source,

    p_execution_provenance =>
      p_execution_provenance,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee
  )
  into v_result;

  /*
   * Duplicate call after an already-completed order:
   * V3/V2 has made no new fill, so historical filled_price must not move.
   */
  if coalesce(
    v_result ->> 'alreadyFilled',
    'false'
  ) = 'true' then
    return v_result;
  end if;

  /*
   * Only a successful new partial/final fill gets semantic correction.
   */
  if coalesce(
    v_result ->> 'status',
    ''
  ) not in (
    'RISK_APPROVED',
    'FILLED'
  ) then
    return v_result;
  end if;

  begin
    v_total_filled_quantity :=
      (v_result ->> 'filledQuantity')::integer;
  exception
    when others then
      raise exception
        'BUY_FILLED_PRICE_TOTAL_FILLED_QUANTITY_INVALID';
  end;

  if v_total_filled_quantity <= 0 then
    raise exception
      'BUY_FILLED_PRICE_TOTAL_FILLED_QUANTITY_INVALID';
  end if;

  v_new_fill_quantity :=
    v_total_filled_quantity -
    v_prior_filled_quantity;

  if v_new_fill_quantity <= 0 then
    raise exception
      'BUY_FILLED_PRICE_NEW_FILL_QUANTITY_INVALID:%',
      v_new_fill_quantity;
  end if;

  if p_execution_price is null
     or p_execution_price <= 0 then
    raise exception
      'BUY_FILLED_PRICE_EXECUTION_PRICE_INVALID';
  end if;

  /*
   * First fill:
   *   cumulative average = this execution price.
   *
   * Later partial fill:
   *   ((prior cumulative avg * prior qty)
   *      + (new execution price * new qty))
   *    / total filled qty
   */
  if v_prior_filled_quantity = 0 then
    v_cumulative_filled_price :=
      p_execution_price;
  else
    /*
     * Fail closed rather than silently using planned entry_price as
     * historical execution evidence.
     */
    if v_prior_filled_price is null
       or v_prior_filled_price <= 0 then
      raise exception
        'BUY_FILLED_PRICE_PRIOR_CUMULATIVE_PRICE_INVALID';
    end if;

    v_cumulative_filled_price :=
      (
        v_prior_filled_price *
          v_prior_filled_quantity
        +
        p_execution_price *
          v_new_fill_quantity
      )
      /
      v_total_filled_quantity;
  end if;

  if v_cumulative_filled_price is null
     or v_cumulative_filled_price <= 0 then
    raise exception
      'BUY_FILLED_PRICE_CUMULATIVE_PRICE_INVALID';
  end if;

  update public.paper_order_requests
  set
    filled_price =
      v_cumulative_filled_price
  where id =
      p_order_id
    and filled_quantity =
      v_total_filled_quantity;

  get diagnostics
    v_updated_rows =
      row_count;

  if v_updated_rows <> 1 then
    raise exception
      'BUY_FILLED_PRICE_PERSISTENCE_LOST_RACE:%',
      v_updated_rows;
  end if;

  return
    v_result
    ||
    jsonb_build_object(
      'filledPrice',
      v_cumulative_filled_price,

      'latestExecutionPrice',
      p_execution_price,

      'cumulativeFilledPrice',
      v_cumulative_filled_price,

      'filledPriceSemanticVersion',
      'PAPER_BUY_FILLED_PRICE_WEIGHTED_AVERAGE_V1'
    );
end;
$$;

revoke all on function public.execute_paper_buy_order_with_execution_price_v4(
  uuid,
  numeric,
  timestamptz,
  text,
  jsonb,
  integer,
  numeric
)
from public;

grant execute on function public.execute_paper_buy_order_with_execution_price_v4(
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
