
begin;

create or replace function public.run_paper_fee_basis_rt_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_account_cash_before numeric;
  v_account_cash_after numeric;

  v_stock_code text;
  v_sector text;

  v_status_constraint text;
  v_exit_reason_constraint text;

  v_risk1 uuid := gen_random_uuid();
  v_risk2 uuid := gen_random_uuid();
  v_buy1 uuid := gen_random_uuid();
  v_buy2 uuid := gen_random_uuid();
  v_position uuid := gen_random_uuid();
  v_trade1 uuid := gen_random_uuid();
  v_trade2 uuid := gen_random_uuid();
  v_trade3 uuid := gen_random_uuid();

  v_now timestamptz := clock_timestamp();

  v_basis_total numeric;
  v_basis_remaining numeric;

  v_after_buy1_total numeric;
  v_after_buy1_remaining numeric;
  v_after_buy2_total numeric;
  v_after_buy2_remaining numeric;

  v_fee1 numeric;
  v_fee2 numeric;
  v_fee3 numeric;

  v_remain1 numeric;
  v_remain2 numeric;
  v_remain3 numeric;

  v_trade_count integer;
  v_entry_fee_sum numeric;
  v_bad_cost_math integer;
  v_bad_cost_model integer;
  v_bad_cost_complete integer;

  v_risk_rows_after integer;
  v_order_rows_after integer;
  v_position_rows_after integer;
  v_trade_rows_after integer;

  v_inner_pass boolean := false;
  v_sentinel_caught boolean := false;
  v_sentinel constant text := 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_ROLLBACK_SENTINEL';
begin
  select pg_get_constraintdef(c.oid)
  into v_exit_reason_constraint
  from pg_constraint c
  where c.conrelid = 'public.paper_trade_history'::regclass
    and c.conname = 'paper_trade_history_exit_reason_check'
    and c.contype = 'c'
  limit 1;

  if v_exit_reason_constraint is null then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'PAPER_TRADE_EXIT_REASON_CHECK_NOT_FOUND'
    );
  end if;

  if position('STOP_LOSS' in upper(v_exit_reason_constraint)) = 0 then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'STOP_LOSS_NOT_ALLOWED_BY_DEPLOYED_EXIT_REASON_CHECK',
      'exitReasonConstraint', v_exit_reason_constraint
    );
  end if;

  select pg_get_constraintdef(c.oid)
  into v_status_constraint
  from pg_constraint c
  where c.conrelid = 'public.paper_order_requests'::regclass
    and c.conname = 'paper_order_requests_status_check'
    and c.contype = 'c'
  limit 1;

  if v_status_constraint is null then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'PAPER_ORDER_STATUS_CHECK_NOT_FOUND'
    );
  end if;

  if position('FILLED' in upper(v_status_constraint)) = 0 then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'FILLED_NOT_ALLOWED_BY_DEPLOYED_STATUS_CHECK',
      'statusConstraint', v_status_constraint
    );
  end if;

  if to_regprocedure('public.accumulate_paper_position_entry_fee_basis_v1()') is null then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'BUY_FEE_ACCUMULATOR_NOT_FOUND'
    );
  end if;

  if to_regprocedure('public.apply_paper_trade_entry_fee_basis_v1()') is null then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'TRADE_FEE_ALLOCATOR_NOT_FOUND'
    );
  end if;

  select a.id, a.cash_balance
  into v_account_id, v_account_cash_before
  from public.paper_accounts a
  where a.trading_mode = 'PAPER'
  order by a.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'NO_PAPER_ACCOUNT_AVAILABLE'
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
      'status', 'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED',
      'reason', 'NO_UNUSED_STOCK_AVAILABLE'
    );
  end if;

  begin
    insert into public.risk_decisions (
      id, account_id, stock_code, action, approved, requested_payload, result_payload
    ) values
    (
      v_risk1, v_account_id, v_stock_code, 'BUY', true,
      jsonb_build_object('test','MULTI_BUY_FEE_BASIS_V1','buy',1,'persistent',false),
      jsonb_build_object('approved',true,'reason','ROLLBACK_REGRESSION_FIXTURE')
    ),
    (
      v_risk2, v_account_id, v_stock_code, 'BUY', true,
      jsonb_build_object('test','MULTI_BUY_FEE_BASIS_V1','buy',2,'persistent',false),
      jsonb_build_object('approved',true,'reason','ROLLBACK_REGRESSION_FIXTURE')
    );

    insert into public.paper_order_requests (
      id,
      account_id,
      stock_code,
      side,
      requested_quantity,
      approved_quantity,
      entry_price,
      stop_price,
      status,
      risk_decision_id,
      filled_quantity,
      filled_price,
      executed_at,
      reserved_risk_amount,
      execution_price,
      execution_price_observed_at,
      execution_price_source,
      execution_broker_fee,
      execution_transaction_cost,
      execution_fill_count
    ) values
    (
      v_buy1,
      v_account_id,
      v_stock_code,
      'BUY',
      100,
      100,
      10000,
      9000,
      'FILLED',
      v_risk1,
      100,
      10000,
      v_now,
      0,
      10000,
      v_now,
      'ROLLBACK_REGRESSION_FIXTURE_BUY_1',
      0,
      0,
      1
    ),
    (
      v_buy2,
      v_account_id,
      v_stock_code,
      'BUY',
      100,
      100,
      10000,
      9000,
      'FILLED',
      v_risk2,
      100,
      10000,
      v_now + interval '1 second',
      0,
      10000,
      v_now + interval '1 second',
      'ROLLBACK_REGRESSION_FIXTURE_BUY_2',
      0,
      0,
      1
    );

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
      entry_order_id,
      entry_broker_fee_basis_total,
      entry_broker_fee_basis_remaining
    ) values (
      v_position,
      v_account_id,
      v_stock_code,
      v_sector,
      200,
      10000,
      9000,
      10000,
      false,
      v_buy1,
      0,
      0
    );

    update public.paper_order_requests
    set
      execution_broker_fee = 1000,
      execution_transaction_cost = 1000
    where id = v_buy1;

    select
      p.entry_broker_fee_basis_total,
      p.entry_broker_fee_basis_remaining
    into
      v_after_buy1_total,
      v_after_buy1_remaining
    from public.paper_positions p
    where p.id = v_position;

    if v_after_buy1_total is distinct from 1000::numeric
      or v_after_buy1_remaining is distinct from 1000::numeric
    then
      raise exception
        'ASSERT_BUY1_FEE_BASIS_INVALID total=% remaining=%',
        v_after_buy1_total,
        v_after_buy1_remaining;
    end if;

    update public.paper_order_requests
    set
      execution_broker_fee = 1000,
      execution_transaction_cost = 1000
    where id = v_buy2;

    select
      p.entry_broker_fee_basis_total,
      p.entry_broker_fee_basis_remaining
    into
      v_after_buy2_total,
      v_after_buy2_remaining
    from public.paper_positions p
    where p.id = v_position;

    if v_after_buy2_total is distinct from 2000::numeric
      or v_after_buy2_remaining is distinct from 2000::numeric
    then
      raise exception
        'ASSERT_BUY2_FEE_BASIS_INVALID total=% remaining=%',
        v_after_buy2_total,
        v_after_buy2_remaining;
    end if;

    insert into public.paper_trade_history (
      id,
      account_id,
      stock_code,
      source_position_id,
      buy_order_id,
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
      v_trade1,
      v_account_id,
      v_stock_code,
      v_position,
      v_buy1,
      50,
      10000,
      11000,
      9000,
      500000,
      550000,
      50000,
      0.10,
      'STOP_LOSS',
      v_now - interval '1 hour',
      v_now + interval '2 seconds'
    );

    select
      t.entry_broker_fee,
      p.entry_broker_fee_basis_remaining
    into
      v_fee1,
      v_remain1
    from public.paper_trade_history t
    join public.paper_positions p
      on p.id = v_position
    where t.id = v_trade1;

    if v_fee1 is distinct from 500::numeric
      or v_remain1 is distinct from 1500::numeric
    then
      raise exception
        'ASSERT_EXIT1_ALLOCATION_INVALID fee=% remaining=%',
        v_fee1,
        v_remain1;
    end if;

    update public.paper_positions
    set quantity = 150
    where id = v_position;

    insert into public.paper_trade_history (
      id,
      account_id,
      stock_code,
      source_position_id,
      buy_order_id,
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
      v_trade2,
      v_account_id,
      v_stock_code,
      v_position,
      v_buy1,
      100,
      10000,
      11000,
      9000,
      1000000,
      1100000,
      100000,
      0.10,
      'STOP_LOSS',
      v_now - interval '1 hour',
      v_now + interval '3 seconds'
    );

    select
      t.entry_broker_fee,
      p.entry_broker_fee_basis_remaining
    into
      v_fee2,
      v_remain2
    from public.paper_trade_history t
    join public.paper_positions p
      on p.id = v_position
    where t.id = v_trade2;

    if v_fee2 is distinct from 1000::numeric
      or v_remain2 is distinct from 500::numeric
    then
      raise exception
        'ASSERT_EXIT2_ALLOCATION_INVALID fee=% remaining=%',
        v_fee2,
        v_remain2;
    end if;

    update public.paper_positions
    set quantity = 50
    where id = v_position;

    insert into public.paper_trade_history (
      id,
      account_id,
      stock_code,
      source_position_id,
      buy_order_id,
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
      v_trade3,
      v_account_id,
      v_stock_code,
      v_position,
      v_buy1,
      50,
      10000,
      11000,
      9000,
      500000,
      550000,
      50000,
      0.10,
      'STOP_LOSS',
      v_now - interval '1 hour',
      v_now + interval '4 seconds'
    );

    select
      t.entry_broker_fee,
      p.entry_broker_fee_basis_total,
      p.entry_broker_fee_basis_remaining
    into
      v_fee3,
      v_basis_total,
      v_remain3
    from public.paper_trade_history t
    join public.paper_positions p
      on p.id = v_position
    where t.id = v_trade3;

    if v_fee3 is distinct from 500::numeric
      or v_basis_total is distinct from 2000::numeric
      or v_remain3 is distinct from 0::numeric
    then
      raise exception
        'ASSERT_EXIT3_FINAL_REMAINDER_INVALID fee=% total=% remaining=%',
        v_fee3,
        v_basis_total,
        v_remain3;
    end if;

    select
      count(*)::integer,
      round(sum(coalesce(t.entry_broker_fee,0)),2),
      count(*) filter (
        where t.total_transaction_cost
          is distinct from
          round(
            coalesce(t.entry_broker_fee,0)
            + coalesce(t.exit_broker_fee,0)
            + coalesce(t.sell_tax,0),
            2
          )
      )::integer,
      count(*) filter (
        where t.net_pnl
          is distinct from
          round(
            coalesce(t.gross_pnl,0)
            - coalesce(t.total_transaction_cost,0),
            2
          )
      )::integer
    into
      v_trade_count,
      v_entry_fee_sum,
      v_bad_cost_math,
      v_bad_cost_complete
    from public.paper_trade_history t
    where t.source_position_id = v_position;

    select count(*)::integer
    into v_bad_cost_model
    from public.paper_trade_history t
    where t.source_position_id = v_position
      and (
        t.cost_model_version is distinct from
          'PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS'
        or t.cost_attribution_complete is distinct from true
      );

    if v_trade_count <> 3 then
      raise exception
        'ASSERT_TRADE_ROW_COUNT_INVALID count=%',
        v_trade_count;
    end if;

    if v_entry_fee_sum is distinct from 2000::numeric then
      raise exception
        'ASSERT_ENTRY_FEE_SUM_INVALID sum=%',
        v_entry_fee_sum;
    end if;

    if v_bad_cost_math <> 0 then
      raise exception
        'ASSERT_TOTAL_TRANSACTION_COST_MATH_INVALID count=%',
        v_bad_cost_math;
    end if;

    if v_bad_cost_complete <> 0 then
      raise exception
        'ASSERT_NET_PNL_MATH_INVALID count=%',
        v_bad_cost_complete;
    end if;

    if v_bad_cost_model <> 0 then
      raise exception
        'ASSERT_COST_MODEL_V2_INVALID count=%',
        v_bad_cost_model;
    end if;

    delete from public.paper_positions
    where id = v_position;

    if exists (
      select 1
      from public.paper_positions
      where id = v_position
    ) then
      raise exception
        'ASSERT_FINAL_POSITION_NOT_REMOVED';
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
  into v_risk_rows_after
  from public.risk_decisions
  where id in (v_risk1, v_risk2);

  select count(*)::integer
  into v_order_rows_after
  from public.paper_order_requests
  where id in (v_buy1, v_buy2);

  select count(*)::integer
  into v_position_rows_after
  from public.paper_positions
  where id = v_position;

  select count(*)::integer
  into v_trade_rows_after
  from public.paper_trade_history
  where id in (v_trade1, v_trade2, v_trade3);

  select cash_balance
  into v_account_cash_after
  from public.paper_accounts
  where id = v_account_id;

  if not v_sentinel_caught then
    raise exception 'ASSERT_ROLLBACK_SENTINEL_NOT_CAUGHT';
  end if;

  if v_risk_rows_after <> 0
    or v_order_rows_after <> 0
    or v_position_rows_after <> 0
    or v_trade_rows_after <> 0
  then
    raise exception
      'ASSERT_FIXTURE_ROWS_PERSISTED risks=% orders=% positions=% trades=%',
      v_risk_rows_after,
      v_order_rows_after,
      v_position_rows_after,
      v_trade_rows_after;
  end if;

  if v_account_cash_after is distinct from v_account_cash_before then
    raise exception
      'ASSERT_ACCOUNT_CASH_CHANGED before=% after=%',
      v_account_cash_before,
      v_account_cash_after;
  end if;

  return jsonb_build_object(
    'status',
      'AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_PASS',

    'classification',
      'MULTI_BUY_ENTRY_FEE_ACCUMULATION_AND_THREE_STAGE_PARTIAL_EXIT_ALLOCATION_RUNTIME_PROVEN',

    'deployedExitReasonConstraint',
      v_exit_reason_constraint,

    'fixtureExitReason',
      'STOP_LOSS',

    'deployedStatusConstraint',
      v_status_constraint,

    'checks',
      jsonb_build_object(
        'buy1FeeBasisTotal1000',
          v_after_buy1_total = 1000,

        'buy1FeeBasisRemaining1000',
          v_after_buy1_remaining = 1000,

        'buy2FeeBasisTotal2000',
          v_after_buy2_total = 2000,

        'buy2FeeBasisRemaining2000',
          v_after_buy2_remaining = 2000,

        'exit1Allocated500',
          v_fee1 = 500,

        'exit1Remaining1500',
          v_remain1 = 1500,

        'exit2Allocated1000',
          v_fee2 = 1000,

        'exit2Remaining500',
          v_remain2 = 500,

        'exit3Allocated500',
          v_fee3 = 500,

        'exit3Remaining0',
          v_remain3 = 0,

        'totalEntryFeeBasisStayed2000',
          v_basis_total = 2000,

        'threeTradeRowsAllowedForOnePosition',
          v_trade_count = 3,

        'allocatedEntryFeeSumExactly2000',
          v_entry_fee_sum = 2000,

        'transactionCostMathCorrect',
          v_bad_cost_math = 0,

        'netPnlMathCorrect',
          v_bad_cost_complete = 0,

        'allTradesUseCostModelV2AndComplete',
          v_bad_cost_model = 0,

        'finalPositionRemovedInsideFixture',
          true,

        'rollbackSentinelCaught',
          v_sentinel_caught,

        'fixtureRiskRowsRemoved',
          v_risk_rows_after = 0,

        'fixtureOrderRowsRemoved',
          v_order_rows_after = 0,

        'fixturePositionRemoved',
          v_position_rows_after = 0,

        'fixtureTradeRowsRemoved',
          v_trade_rows_after = 0,

        'accountCashUnchanged',
          v_account_cash_after is not distinct from v_account_cash_before
      ),

    'observed',
      jsonb_build_object(
        'afterBuy1',
          jsonb_build_object(
            'total', v_after_buy1_total,
            'remaining', v_after_buy1_remaining
          ),

        'afterBuy2',
          jsonb_build_object(
            'total', v_after_buy2_total,
            'remaining', v_after_buy2_remaining
          ),

        'exitAllocations',
          jsonb_build_array(v_fee1, v_fee2, v_fee3),

        'remainingSequence',
          jsonb_build_array(v_remain1, v_remain2, v_remain3),

        'tradeRows',
          v_trade_count,

        'entryFeeSum',
          v_entry_fee_sum
      ),

    'fixture',
      jsonb_build_object(
        'riskDecisionIds',
          jsonb_build_array(v_risk1, v_risk2),

        'buyOrderIds',
          jsonb_build_array(v_buy1, v_buy2),

        'positionId',
          v_position,

        'tradeIds',
          jsonb_build_array(v_trade1, v_trade2, v_trade3),

        'accountId',
          v_account_id,

        'stockCode',
          v_stock_code,

        'persistent',
          false
      ),

    'safety',
      jsonb_build_object(
        'productionBuyRpcInvoked',
          false,

        'productionSellRpcInvoked',
          false,

        'productionFeeBasisTriggersInvoked',
          true,

        'transactionLocalFixtureWrites',
          true,

        'fixtureWritesRolledBack',
          true,

        'persistentRiskRows',
          v_risk_rows_after,

        'persistentOrderRows',
          v_order_rows_after,

        'persistentPositionRows',
          v_position_rows_after,

        'persistentTradeRows',
          v_trade_rows_after,

        'realTradingEnabled',
          false
      )
  );
end;
$$;

revoke all
on function public.run_paper_fee_basis_rt_v1()
from public;

revoke all
on function public.run_paper_fee_basis_rt_v1()
from anon;

revoke all
on function public.run_paper_fee_basis_rt_v1()
from authenticated;

grant execute
on function public.run_paper_fee_basis_rt_v1()
to service_role;

comment on function public.run_paper_fee_basis_rt_v1()
is
  'Service-role-only rollback runtime regression for production multi-BUY entry fee accumulation and 50/100/50 partial-exit fee allocation. Uses real deployed triggers and leaves no fixture rows.';

notify pgrst, 'reload schema';

commit;
