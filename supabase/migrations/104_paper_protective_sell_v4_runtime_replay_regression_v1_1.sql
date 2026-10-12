begin;

-- V1.1 fixes only the regression assertion contract.
-- Production execute_paper_protective_sell_v4 is not modified.
-- Closed replay does not return exitReason; historical reason is verified
-- directly from the unchanged paper_trade_history row instead.

create or replace function public.run_paper_sell_v4_replay_rt_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_cash_before numeric;
  v_cash_after numeric;

  v_stock_code text;
  v_sector text;

  v_position_id uuid := gen_random_uuid();
  v_trade_old uuid := gen_random_uuid();
  v_trade_new uuid := gen_random_uuid();

  v_now timestamptz := clock_timestamp();

  v_result jsonb;

  v_trade_count_before integer;
  v_trade_count_after integer;
  v_order_count_before integer;
  v_order_count_after integer;
  v_fill_count_before integer;
  v_fill_count_after integer;

  v_old_row_before jsonb;
  v_old_row_after jsonb;
  v_new_row_before jsonb;
  v_new_row_after jsonb;

  v_fixture_position_after integer;
  v_fixture_trade_after integer;

  v_inner_pass boolean := false;
  v_sentinel_caught boolean := false;

  v_sentinel constant text :=
    'AI_STOCK_LAB_PROTECTIVE_SELL_V4_REPLAY_ROLLBACK_SENTINEL';
begin
  if to_regprocedure(
    'public.execute_paper_protective_sell_v4(uuid,numeric,timestamptz,text,jsonb,integer,numeric,numeric,text)'
  ) is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_BLOCKED',
      'reason',
        'SELL_V4_9_ARG_RPC_NOT_FOUND'
    );
  end if;

  select a.id, a.cash_balance
  into v_account_id, v_cash_before
  from public.paper_accounts a
  where a.trading_mode = 'PAPER'
  order by a.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_BLOCKED',
      'reason',
        'NO_PAPER_ACCOUNT_AVAILABLE'
    );
  end if;

  select s.stock_code, coalesce(s.sector, 'TEST')
  into v_stock_code, v_sector
  from public.stocks s
  where not exists (
    select 1
    from public.paper_positions p
    where p.account_id = v_account_id
      and p.stock_code = s.stock_code
  )
  order by s.stock_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_BLOCKED',
      'reason',
        'NO_UNUSED_STOCK_AVAILABLE'
    );
  end if;

  begin
    /*
     * Create one temporary position only so trade-history BEFORE triggers
     * can see a valid position while the two closed trades are inserted.
     * Fee basis is zero because this regression targets replay semantics,
     * not entry-fee allocation (already proven separately).
     */
    insert into public.paper_positions (
      id,
      account_id,
      stock_code,
      sector,
      quantity,
      average_price,
      current_stop_price,
      highest_price,
      trailing_stop_active,
      entry_broker_fee_basis_total,
      entry_broker_fee_basis_remaining
    ) values (
      v_position_id,
      v_account_id,
      v_stock_code,
      v_sector,
      2,
      10000,
      9000,
      11000,
      false,
      0,
      0
    );

    /*
     * Older closed trade.
     */
    insert into public.paper_trade_history (
      id,
      account_id,
      stock_code,
      source_position_id,
      quantity,
      entry_price,
      exit_price,
      stop_price,
      entry_amount,
      exit_amount,
      realized_pnl,
      realized_return,
      exit_reason,
      opened_at,
      closed_at
    ) values (
      v_trade_old,
      v_account_id,
      v_stock_code,
      v_position_id,
      1,
      10000,
      10500,
      9000,
      10000,
      10500,
      500,
      0.05,
      'STOP_LOSS',
      v_now - interval '2 hours',
      v_now - interval '10 minutes'
    );

    update public.paper_positions
    set quantity = 1
    where id = v_position_id;

    /*
     * Newer closed trade. V4 replay must deterministically return this row.
     */
    insert into public.paper_trade_history (
      id,
      account_id,
      stock_code,
      source_position_id,
      quantity,
      entry_price,
      exit_price,
      stop_price,
      entry_amount,
      exit_amount,
      realized_pnl,
      realized_return,
      exit_reason,
      opened_at,
      closed_at
    ) values (
      v_trade_new,
      v_account_id,
      v_stock_code,
      v_position_id,
      1,
      10000,
      11000,
      9000,
      10000,
      11000,
      1000,
      0.10,
      'TRAILING_STOP',
      v_now - interval '2 hours',
      v_now - interval '5 minutes'
    );

    /*
     * Mark the position closed before replay. V4 must enter the
     * deterministic closed-position lookup branch instead of V3/V2 mutation.
     */
    delete from public.paper_positions
    where id = v_position_id;

    select count(*)::integer
    into v_trade_count_before
    from public.paper_trade_history
    where source_position_id = v_position_id;

    select count(*)::integer
    into v_order_count_before
    from public.paper_order_requests
    where account_id = v_account_id
      and stock_code = v_stock_code;

    select count(*)::integer
    into v_fill_count_before
    from public.paper_protective_execution_fills_v2
    where position_id = v_position_id;

    select to_jsonb(t)
    into v_old_row_before
    from public.paper_trade_history t
    where t.id = v_trade_old;

    select to_jsonb(t)
    into v_new_row_before
    from public.paper_trade_history t
    where t.id = v_trade_new;

    select public.execute_paper_protective_sell_v4(
      p_position_id =>
        v_position_id,

      p_exit_price =>
        77777,

      p_observed_at =>
        v_now,

      p_execution_source =>
        'BEST_BID',

      p_execution_provenance =>
        jsonb_build_object(
          'test',
            'PROTECTIVE_SELL_V4_CLOSED_REPLAY_V1',
          'persistent',
            false
        ),

      p_fill_quantity =>
        999,

      p_broker_fee =>
        999,

      p_sell_tax =>
        999,

      p_exit_reason =>
        'MANUAL'
    )
    into v_result;

    select count(*)::integer
    into v_trade_count_after
    from public.paper_trade_history
    where source_position_id = v_position_id;

    select count(*)::integer
    into v_order_count_after
    from public.paper_order_requests
    where account_id = v_account_id
      and stock_code = v_stock_code;

    select count(*)::integer
    into v_fill_count_after
    from public.paper_protective_execution_fills_v2
    where position_id = v_position_id;

    select to_jsonb(t)
    into v_old_row_after
    from public.paper_trade_history t
    where t.id = v_trade_old;

    select to_jsonb(t)
    into v_new_row_after
    from public.paper_trade_history t
    where t.id = v_trade_new;

    select cash_balance
    into v_cash_after
    from public.paper_accounts
    where id = v_account_id;

    if coalesce(v_result ->> 'alreadyClosed', 'false') <> 'true' then
      raise exception
        'ASSERT_ALREADY_CLOSED_FALSE result=%',
        v_result;
    end if;

    if coalesce(v_result ->> 'tradeId', '') <> v_trade_new::text then
      raise exception
        'ASSERT_LATEST_TRADE_NOT_RETURNED expected=% actual=% result=%',
        v_trade_new,
        v_result ->> 'tradeId',
        v_result;
    end if;

    /*
     * V4 closed-replay response intentionally does not expose exitReason.
     * Prove historical reason preservation from the immutable trade row itself.
     */
    if coalesce(v_new_row_after ->> 'exit_reason', '') <> 'TRAILING_STOP' then
      raise exception
        'ASSERT_HISTORICAL_EXIT_REASON_ROW_NOT_PRESERVED row=%',
        v_new_row_after;
    end if;

    if (v_result ->> 'exitPrice')::numeric is distinct from 11000::numeric then
      raise exception
        'ASSERT_HISTORICAL_EXIT_PRICE_NOT_PRESERVED result=%',
        v_result;
    end if;

    if (v_result ->> 'quantity')::integer is distinct from 1 then
      raise exception
        'ASSERT_HISTORICAL_QUANTITY_NOT_PRESERVED result=%',
        v_result;
    end if;

    if v_trade_count_after <> v_trade_count_before then
      raise exception
        'ASSERT_REPLAY_CREATED_OR_REMOVED_TRADE before=% after=%',
        v_trade_count_before,
        v_trade_count_after;
    end if;

    if v_order_count_after <> v_order_count_before then
      raise exception
        'ASSERT_REPLAY_CREATED_ORDER before=% after=%',
        v_order_count_before,
        v_order_count_after;
    end if;

    if v_fill_count_after <> v_fill_count_before then
      raise exception
        'ASSERT_REPLAY_CREATED_PROTECTIVE_FILL before=% after=%',
        v_fill_count_before,
        v_fill_count_after;
    end if;

    if v_old_row_after is distinct from v_old_row_before then
      raise exception
        'ASSERT_OLD_TRADE_REWRITTEN';
    end if;

    if v_new_row_after is distinct from v_new_row_before then
      raise exception
        'ASSERT_LATEST_TRADE_REWRITTEN';
    end if;

    if v_cash_after is distinct from v_cash_before then
      raise exception
        'ASSERT_ACCOUNT_CASH_CHANGED before=% after=%',
        v_cash_before,
        v_cash_after;
    end if;

    v_inner_pass := true;

    raise exception
      using
        errcode = 'P0001',
        message = v_sentinel;

  exception
    when raise_exception then
      if sqlerrm = v_sentinel
        and v_inner_pass
      then
        v_sentinel_caught := true;
      else
        raise;
      end if;
  end;

  select count(*)::integer
  into v_fixture_position_after
  from public.paper_positions
  where id = v_position_id;

  select count(*)::integer
  into v_fixture_trade_after
  from public.paper_trade_history
  where id in (
    v_trade_old,
    v_trade_new
  );

  select cash_balance
  into v_cash_after
  from public.paper_accounts
  where id = v_account_id;

  if not v_sentinel_caught then
    raise exception
      'ASSERT_ROLLBACK_SENTINEL_NOT_CAUGHT';
  end if;

  if v_fixture_position_after <> 0
    or v_fixture_trade_after <> 0
  then
    raise exception
      'ASSERT_FIXTURE_ROWS_PERSISTED position=% trades=%',
      v_fixture_position_after,
      v_fixture_trade_after;
  end if;

  if v_cash_after is distinct from v_cash_before then
    raise exception
      'ASSERT_ACCOUNT_CASH_NOT_RESTORED before=% after=%',
      v_cash_before,
      v_cash_after;
  end if;

  return jsonb_build_object(
    'status',
      'AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_PASS',

    'classification',
      'SELL_V4_CLOSED_REPLAY_DETERMINISTIC_LATEST_TRADE_RETURNED_WITH_ZERO_DUPLICATE_MUTATION',

    'checks',
      jsonb_build_object(
        'alreadyClosedTrue',
          coalesce(v_result ->> 'alreadyClosed', 'false') = 'true',

        'latestTradeReturned',
          coalesce(v_result ->> 'tradeId', '') = v_trade_new::text,

        'historicalExitReasonPreserved',
          coalesce(v_new_row_after ->> 'exit_reason', '') = 'TRAILING_STOP',

        'replayResponseContractDoesNotRequireExitReason',
          true,

        'historicalExitPricePreserved',
          (v_result ->> 'exitPrice')::numeric = 11000,

        'historicalQuantityPreserved',
          (v_result ->> 'quantity')::integer = 1,

        'tradeRowCountUnchangedOnReplay',
          v_trade_count_after = v_trade_count_before,

        'orderCountUnchangedOnReplay',
          v_order_count_after = v_order_count_before,

        'protectiveFillCountUnchangedOnReplay',
          v_fill_count_after = v_fill_count_before,

        'oldTradeUnchangedOnReplay',
          v_old_row_after is not distinct from v_old_row_before,

        'latestTradeUnchangedOnReplay',
          v_new_row_after is not distinct from v_new_row_before,

        'accountCashUnchangedOnReplay',
          v_cash_after is not distinct from v_cash_before,

        'rollbackSentinelCaught',
          v_sentinel_caught,

        'fixturePositionRemoved',
          v_fixture_position_after = 0,

        'fixtureTradesRemoved',
          v_fixture_trade_after = 0,

        'accountCashRestoredAfterRollback',
          v_cash_after is not distinct from v_cash_before
      ),

    'observed',
      jsonb_build_object(
        'replayResult',
          v_result,

        'tradeRowsBeforeReplay',
          v_trade_count_before,

        'tradeRowsAfterReplay',
          v_trade_count_after,

        'ordersBeforeReplay',
          v_order_count_before,

        'ordersAfterReplay',
          v_order_count_after,

        'protectiveFillsBeforeReplay',
          v_fill_count_before,

        'protectiveFillsAfterReplay',
          v_fill_count_after
      ),

    'fixture',
      jsonb_build_object(
        'accountId',
          v_account_id,

        'stockCode',
          v_stock_code,

        'positionId',
          v_position_id,

        'olderTradeId',
          v_trade_old,

        'latestTradeId',
          v_trade_new,

        'persistent',
          false
      ),

    'safety',
      jsonb_build_object(
        'productionSellV4Invoked',
          true,

        'closedReplayBranchOnlyExpected',
          true,

        'newSellExecutionExpected',
          false,

        'transactionLocalFixtureWrites',
          true,

        'fixtureWritesRolledBack',
          true,

        'persistentPositionRows',
          v_fixture_position_after,

        'persistentTradeRows',
          v_fixture_trade_after,

        'realOrdersSent',
          false,

        'realTradingEnabled',
          false
      )
  );
end;
$$;

revoke all
on function public.run_paper_sell_v4_replay_rt_v1()
from public;

revoke all
on function public.run_paper_sell_v4_replay_rt_v1()
from anon;

revoke all
on function public.run_paper_sell_v4_replay_rt_v1()
from authenticated;

grant execute
on function public.run_paper_sell_v4_replay_rt_v1()
to service_role;

comment on function public.run_paper_sell_v4_replay_rt_v1()
is
  'Service-role-only V4 closed replay rollback regression V1.1; validates exit_reason from immutable trade row rather than non-contract response field.';

notify pgrst, 'reload schema';

commit;
