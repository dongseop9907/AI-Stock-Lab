begin;

-- ============================================================
-- PAPER Protective SELL Closed Replay V1
--
-- Adds canonical V4 wrapper:
-- - active position: lock row, delegate unchanged execution to V3
-- - already closed position: deterministically return latest/final
--   trade_history row by closed_at desc, id desc
--
-- No synthetic order/fill is created by the closed replay path.
-- ============================================================

create or replace function public.execute_paper_protective_sell_v4(
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
  v_position_id uuid;
  v_existing_trade public.paper_trade_history%rowtype;
  v_result jsonb;
begin
  if p_position_id is null then
    raise exception 'PROTECTIVE_SELL_POSITION_ID_REQUIRED';
  end if;

  /*
   * Concurrency invariant:
   * Lock the live position before delegating to V3.
   *
   * If a concurrent final exit is in progress, this SELECT waits.
   * After the competing transaction commits, either:
   *   - the position still exists and we delegate safely, or
   *   - no row is returned and the deterministic closed-replay
   *     branch below observes committed trade history.
   */
  select p.id
  into v_position_id
  from public.paper_positions p
  where p.id = p_position_id
  for update;

  if found then
    select public.execute_paper_protective_sell_v3(
      p_position_id =>
        p_position_id,

      p_exit_price =>
        p_exit_price,

      p_observed_at =>
        p_observed_at,

      p_execution_source =>
        p_execution_source,

      p_execution_provenance =>
        p_execution_provenance,

      p_fill_quantity =>
        p_fill_quantity,

      p_broker_fee =>
        p_broker_fee,

      p_sell_tax =>
        p_sell_tax,

      p_exit_reason =>
        p_exit_reason
    )
    into v_result;

    return v_result;
  end if;

  /*
   * source_position_id is intentionally multi-row after the
   * partial-exit repair.
   *
   * Return the final/latest persisted exit deterministically.
   */
  select *
  into v_existing_trade
  from public.paper_trade_history t
  where t.source_position_id = p_position_id
  order by
    t.closed_at desc nulls last,
    t.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'alreadyClosed',
        true,

      'tradeId',
        v_existing_trade.id,

      'stockCode',
        v_existing_trade.stock_code,

      'quantity',
        v_existing_trade.quantity,

      'exitPrice',
        v_existing_trade.exit_price,

      'realizedPnl',
        v_existing_trade.realized_pnl,

      'closedAt',
        v_existing_trade.closed_at,

      'replayResolution',
        'FINAL_TRADE_BY_CLOSED_AT_DESC_ID_DESC',

      'replayVersion',
        'PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1'
    );
  end if;

  /*
   * Preserve canonical V3/V2 error behavior for a position that
   * has neither a live row nor persisted trade history.
   */
  select public.execute_paper_protective_sell_v3(
    p_position_id =>
      p_position_id,

    p_exit_price =>
      p_exit_price,

    p_observed_at =>
      p_observed_at,

    p_execution_source =>
      p_execution_source,

    p_execution_provenance =>
      p_execution_provenance,

    p_fill_quantity =>
      p_fill_quantity,

    p_broker_fee =>
      p_broker_fee,

    p_sell_tax =>
      p_sell_tax,

    p_exit_reason =>
      p_exit_reason
  )
  into v_result;

  return v_result;
end;
$$;


revoke all
on function public.execute_paper_protective_sell_v4(
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


grant execute
on function public.execute_paper_protective_sell_v4(
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


comment on function public.execute_paper_protective_sell_v4(
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
is
  'Protective SELL V4: locks active position then delegates to V3; already-closed replay returns latest/final trade deterministically by closed_at DESC NULLS LAST, id DESC.';


do $$
begin
  if to_regprocedure(
    'public.execute_paper_protective_sell_v4(uuid,numeric,timestamp with time zone,text,jsonb,integer,numeric,numeric,text)'
  ) is null then
    raise exception
      'PAPER_PROTECTIVE_SELL_V4_DEPLOYMENT_CHECK_FAILED';
  end if;
end;
$$;


notify pgrst, 'reload schema';

commit;
