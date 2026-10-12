-- AI Stock Lab
-- #5 PAPER Accounting Numeric Reconciliation V1
-- Stop-distance fixture repair.
--
-- The previous fixture used entry=10000 and stop=9000 (10% stop distance),
-- which correctly tripped the production BUY V2 execution guard:
--   STOP_DISTANCE_TOO_FAR_AT_EXECUTION
--
-- Correct synthetic fixture:
--   entry 10000
--   stop  9700
--   qty   10
--   stop distance = 3%
--   reserved risk = (10000 - 9700) * 10 = 3000
--
-- This migration replaces TEST RPC only.
-- Production trading RPCs and status constraints are not modified.

begin;

create or replace function
  public.run_paper_accounting_numeric_reconciliation_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := gen_random_uuid();
  v_account_name text :=
    'AI_STOCK_LAB_STRESS_ACCOUNTING_' ||
    replace(gen_random_uuid()::text, '-', '');

  v_risk_id uuid := gen_random_uuid();
  v_order_id uuid := gen_random_uuid();

  v_stock_code text;
  v_sector text;

  v_position_id uuid;

  v_buy_result jsonb;
  v_sell_result jsonb;

  v_initial_cash numeric(18, 2) := 2000000.00;
  v_initial_equity numeric(18, 2) := 2000000.00;

  v_quantity integer := 10;
  v_entry_price numeric(18, 2) := 10000.00;
  v_stop_price numeric(18, 2) := 9700.00;
  v_exit_price numeric(18, 2) := 10100.00;

  v_buy_fee numeric(18, 2) := 4.14;
  v_sell_fee numeric(18, 2) := 5.00;
  v_sell_tax numeric(18, 2) := 10.00;

  v_entry_notional numeric(18, 2);
  v_exit_notional numeric(18, 2);
  v_sell_side_cost numeric(18, 2);
  v_round_trip_cost numeric(18, 2);
  v_gross_pnl numeric(18, 2);
  v_expected_account_realized numeric(18, 2);
  v_expected_trade_net numeric(18, 2);
  v_expected_cash_after_buy numeric(18, 2);
  v_expected_cash_after_sell numeric(18, 2);

  v_cash_after_buy numeric(18, 2);
  v_cash_after_sell numeric(18, 2);
  v_account_realized numeric(18, 2);
  v_account_daily_realized numeric(18, 2);

  v_position_quantity integer;
  v_position_average numeric(18, 2);
  v_fee_basis_total numeric(18, 2);
  v_fee_basis_remaining numeric(18, 2);

  v_trade_count integer;
  v_trade_quantity integer;
  v_trade_entry_price numeric(18, 2);
  v_trade_exit_price numeric(18, 2);
  v_trade_entry_fee numeric(18, 2);
  v_trade_exit_fee numeric(18, 2);
  v_trade_sell_tax numeric(18, 2);
  v_trade_total_cost numeric(18, 2);
  v_trade_gross_pnl numeric(18, 2);
  v_trade_realized_pnl numeric(18, 2);
  v_trade_net_pnl numeric(18, 2);
  v_trade_cost_model text;

  v_fill_count integer;
  v_fill_broker_fee numeric(18, 2);
  v_fill_sell_tax numeric(18, 2);
  v_fill_total_cost numeric(18, 2);

  v_position_rows_after_sell integer;

  v_persistent_account_rows integer;
  v_persistent_risk_rows integer;
  v_persistent_order_rows integer;
  v_persistent_position_rows integer;
  v_persistent_trade_rows integer;
  v_persistent_fill_rows integer;

  v_snapshot jsonb := '{}'::jsonb;
  v_failure text;
  v_inner_pass boolean := false;
  v_rollback_sentinel_caught boolean := false;

  v_sentinel constant text :=
    'AI_STOCK_LAB_ACCOUNTING_NUMERIC_RECON_V1_ROLLBACK_SENTINEL';
begin
  if to_regprocedure(
    'public.execute_paper_buy_order_with_execution_price_v2(uuid,numeric,timestamp with time zone,integer,numeric)'
  ) is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_BLOCKED',
      'reason',
        'BUY_V2_RPC_NOT_FOUND'
    );
  end if;

  if to_regprocedure(
    'public.execute_paper_protective_sell_v2(uuid,numeric,timestamp with time zone,integer,numeric,numeric,text,text)'
  ) is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_BLOCKED',
      'reason',
        'SELL_V2_RPC_NOT_FOUND'
    );
  end if;

  select
    s.stock_code,
    coalesce(s.sector, 'TEST')
  into
    v_stock_code,
    v_sector
  from public.stocks s
  order by s.stock_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_BLOCKED',
      'reason',
        'NO_STOCK_AVAILABLE'
    );
  end if;

  v_entry_notional :=
    round(v_entry_price * v_quantity, 2);

  v_exit_notional :=
    round(v_exit_price * v_quantity, 2);

  v_sell_side_cost :=
    round(v_sell_fee + v_sell_tax, 2);

  v_round_trip_cost :=
    round(v_buy_fee + v_sell_fee + v_sell_tax, 2);

  v_gross_pnl :=
    round(v_exit_notional - v_entry_notional, 2);

  v_expected_account_realized :=
    round(v_gross_pnl - v_sell_side_cost, 2);

  v_expected_trade_net :=
    round(v_gross_pnl - v_round_trip_cost, 2);

  v_expected_cash_after_buy :=
    round(
      v_initial_cash -
      v_entry_notional -
      v_buy_fee,
      2
    );

  v_expected_cash_after_sell :=
    round(
      v_initial_cash +
      v_expected_trade_net,
      2
    );

  begin
    insert into public.paper_accounts (
      id,
      account_name,
      initial_equity,
      cash_balance,
      realized_pnl,
      daily_realized_pnl,
      trading_mode,
      initial_cash
    ) values (
      v_account_id,
      v_account_name,
      v_initial_equity,
      v_initial_cash,
      0,
      0,
      'PAPER',
      v_initial_cash
    );

    insert into public.risk_decisions (
      id,
      account_id,
      stock_code,
      action,
      approved,
      requested_payload,
      result_payload
    ) values (
      v_risk_id,
      v_account_id,
      v_stock_code,
      'BUY',
      true,
      jsonb_build_object(
        'test',
          'PAPER_ACCOUNTING_NUMERIC_RECON_V1',
        'synthetic',
          true,
        'persistent',
          false
      ),
      jsonb_build_object(
        'approved',
          true,
        'reason',
          'ACCOUNTING_RECON_SYNTHETIC_FIXTURE'
      )
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
      reserved_risk_amount
    ) values (
      v_order_id,
      v_account_id,
      v_stock_code,
      'BUY',
      v_quantity,
      v_quantity,
      v_entry_price,
      v_stop_price,
      'RISK_APPROVED',
      v_risk_id,
      3000.00
    );

    select
      public.execute_paper_buy_order_with_execution_price_v2(
        p_order_id =>
          v_order_id,
        p_execution_price =>
          v_entry_price,
        p_execution_observed_at =>
          clock_timestamp(),
        p_fill_quantity =>
          v_quantity,
        p_broker_fee =>
          v_buy_fee
      )
    into
      v_buy_result;

    select
      a.cash_balance
    into
      v_cash_after_buy
    from public.paper_accounts a
    where a.id = v_account_id;

    select
      p.id,
      p.quantity,
      p.average_price,
      p.entry_broker_fee_basis_total,
      p.entry_broker_fee_basis_remaining
    into
      v_position_id,
      v_position_quantity,
      v_position_average,
      v_fee_basis_total,
      v_fee_basis_remaining
    from public.paper_positions p
    where p.account_id = v_account_id
      and p.stock_code = v_stock_code
    limit 1;

    if v_position_id is null then
      raise exception
        'ASSERT_POSITION_NOT_CREATED_AFTER_BUY';
    end if;

    if v_cash_after_buy
        is distinct from
        v_expected_cash_after_buy then
      raise exception
        'ASSERT_BUY_CASH_INVALID expected=% actual=%',
        v_expected_cash_after_buy,
        v_cash_after_buy;
    end if;

    if v_position_quantity
        is distinct from
        v_quantity then
      raise exception
        'ASSERT_POSITION_QUANTITY_INVALID expected=% actual=%',
        v_quantity,
        v_position_quantity;
    end if;

    if v_position_average
        is distinct from
        v_entry_price then
      raise exception
        'ASSERT_POSITION_AVERAGE_INVALID expected=% actual=%',
        v_entry_price,
        v_position_average;
    end if;

    if v_fee_basis_total
        is distinct from
        v_buy_fee
      or v_fee_basis_remaining
        is distinct from
        v_buy_fee then
      raise exception
        'ASSERT_POSITION_ENTRY_FEE_BASIS_INVALID expected=% total=% remaining=%',
        v_buy_fee,
        v_fee_basis_total,
        v_fee_basis_remaining;
    end if;

    select
      public.execute_paper_protective_sell_v2(
        p_position_id =>
          v_position_id,
        p_exit_price =>
          v_exit_price,
        p_observed_at =>
          clock_timestamp() + interval '1 second',
        p_fill_quantity =>
          v_quantity,
        p_broker_fee =>
          v_sell_fee,
        p_sell_tax =>
          v_sell_tax,
        p_execution_source =>
          'PAPER_EXECUTION_REALISM_V2',
        p_exit_reason =>
          'STOP_LOSS'
      )
    into
      v_sell_result;

    select
      a.cash_balance,
      a.realized_pnl,
      a.daily_realized_pnl
    into
      v_cash_after_sell,
      v_account_realized,
      v_account_daily_realized
    from public.paper_accounts a
    where a.id = v_account_id;

    select
      count(*)::integer
    into
      v_trade_count
    from public.paper_trade_history t
    where t.account_id = v_account_id
      and t.source_position_id = v_position_id;

    select
      t.quantity,
      t.entry_price,
      t.exit_price,
      t.entry_broker_fee,
      t.exit_broker_fee,
      t.sell_tax,
      t.total_transaction_cost,
      t.gross_pnl,
      t.realized_pnl,
      t.net_pnl,
      t.cost_model_version
    into
      v_trade_quantity,
      v_trade_entry_price,
      v_trade_exit_price,
      v_trade_entry_fee,
      v_trade_exit_fee,
      v_trade_sell_tax,
      v_trade_total_cost,
      v_trade_gross_pnl,
      v_trade_realized_pnl,
      v_trade_net_pnl,
      v_trade_cost_model
    from public.paper_trade_history t
    where t.account_id = v_account_id
      and t.source_position_id = v_position_id
    order by t.closed_at desc nulls last, t.id desc
    limit 1;

    select
      count(*)::integer
    into
      v_fill_count
    from public.paper_protective_execution_fills_v2 f
    where f.account_id = v_account_id
      and f.position_id = v_position_id;

    select
      f.broker_fee,
      f.sell_tax,
      f.total_transaction_cost
    into
      v_fill_broker_fee,
      v_fill_sell_tax,
      v_fill_total_cost
    from public.paper_protective_execution_fills_v2 f
    where f.account_id = v_account_id
      and f.position_id = v_position_id
    order by f.created_at desc, f.id desc
    limit 1;

    select
      count(*)::integer
    into
      v_position_rows_after_sell
    from public.paper_positions p
    where p.id = v_position_id;

    if v_cash_after_sell
        is distinct from
        v_expected_cash_after_sell then
      raise exception
        'ASSERT_FINAL_CASH_INVALID expected=% actual=%',
        v_expected_cash_after_sell,
        v_cash_after_sell;
    end if;

    if v_account_realized
        is distinct from
        v_expected_account_realized then
      raise exception
        'ASSERT_ACCOUNT_REALIZED_PNL_INVALID expected=% actual=%',
        v_expected_account_realized,
        v_account_realized;
    end if;

    if v_account_daily_realized
        is distinct from
        v_expected_account_realized then
      raise exception
        'ASSERT_ACCOUNT_DAILY_REALIZED_PNL_INVALID expected=% actual=%',
        v_expected_account_realized,
        v_account_daily_realized;
    end if;

    if v_trade_count <> 1 then
      raise exception
        'ASSERT_TRADE_HISTORY_COUNT_INVALID expected=1 actual=%',
        v_trade_count;
    end if;

    if v_fill_count <> 1 then
      raise exception
        'ASSERT_PROTECTIVE_FILL_COUNT_INVALID expected=1 actual=%',
        v_fill_count;
    end if;

    if v_position_rows_after_sell <> 0 then
      raise exception
        'ASSERT_POSITION_NOT_CLOSED rows=%',
        v_position_rows_after_sell;
    end if;

    if v_trade_quantity
        is distinct from
        v_quantity
      or v_trade_entry_price
        is distinct from
        v_entry_price
      or v_trade_exit_price
        is distinct from
        v_exit_price then
      raise exception
        'ASSERT_TRADE_PRICES_OR_QUANTITY_INVALID';
    end if;

    if v_trade_entry_fee
        is distinct from
        v_buy_fee then
      raise exception
        'ASSERT_TRADE_ENTRY_FEE_INVALID expected=% actual=%',
        v_buy_fee,
        v_trade_entry_fee;
    end if;

    if v_trade_exit_fee
        is distinct from
        v_sell_fee then
      raise exception
        'ASSERT_TRADE_EXIT_FEE_INVALID expected=% actual=%',
        v_sell_fee,
        v_trade_exit_fee;
    end if;

    if v_trade_sell_tax
        is distinct from
        v_sell_tax then
      raise exception
        'ASSERT_TRADE_SELL_TAX_INVALID expected=% actual=%',
        v_sell_tax,
        v_trade_sell_tax;
    end if;

    if v_trade_total_cost
        is distinct from
        v_round_trip_cost then
      raise exception
        'ASSERT_TRADE_TOTAL_COST_INVALID expected=% actual=%',
        v_round_trip_cost,
        v_trade_total_cost;
    end if;

    if v_trade_gross_pnl
        is distinct from
        v_gross_pnl then
      raise exception
        'ASSERT_TRADE_GROSS_PNL_INVALID expected=% actual=%',
        v_gross_pnl,
        v_trade_gross_pnl;
    end if;

    if v_trade_realized_pnl
        is distinct from
        v_expected_account_realized then
      raise exception
        'ASSERT_TRADE_LEGACY_REALIZED_PNL_INVALID expected=% actual=%',
        v_expected_account_realized,
        v_trade_realized_pnl;
    end if;

    if v_trade_net_pnl
        is distinct from
        v_expected_trade_net then
      raise exception
        'ASSERT_TRADE_NET_PNL_INVALID expected=% actual=%',
        v_expected_trade_net,
        v_trade_net_pnl;
    end if;

    if v_fill_broker_fee
        is distinct from
        v_sell_fee
      or v_fill_sell_tax
        is distinct from
        v_sell_tax
      or v_fill_total_cost
        is distinct from
        v_sell_side_cost then
      raise exception
        'ASSERT_FILL_EXIT_ONLY_COST_INVALID expected=% actual=%',
        v_sell_side_cost,
        v_fill_total_cost;
    end if;

    if round(
         v_trade_total_cost -
         v_fill_total_cost,
         2
       ) is distinct from
       v_buy_fee then
      raise exception
        'ASSERT_15_VS_19_14_DELTA_INVALID expected_entry_fee=% delta=%',
        v_buy_fee,
        round(v_trade_total_cost - v_fill_total_cost, 2);
    end if;

    v_snapshot :=
      jsonb_build_object(
        'fixture',
          jsonb_build_object(
            'accountId',
              v_account_id,
            'accountName',
              v_account_name,
            'stockCode',
              v_stock_code,
            'positionId',
              v_position_id,
            'quantity',
              v_quantity,
            'entryPrice',
              v_entry_price,
            'exitPrice',
              v_exit_price
          ),

        'expected',
          jsonb_build_object(
            'initialCash',
              v_initial_cash,
            'entryNotional',
              v_entry_notional,
            'buyFee',
              v_buy_fee,
            'cashAfterBuy',
              v_expected_cash_after_buy,
            'exitNotional',
              v_exit_notional,
            'sellFee',
              v_sell_fee,
            'sellTax',
              v_sell_tax,
            'sellSideCost',
              v_sell_side_cost,
            'grossPnl',
              v_gross_pnl,
            'accountRealizedPnl',
              v_expected_account_realized,
            'roundTripCost',
              v_round_trip_cost,
            'tradeNetPnl',
              v_expected_trade_net,
            'cashAfterSell',
              v_expected_cash_after_sell
          ),

        'observed',
          jsonb_build_object(
            'buyResult',
              v_buy_result,
            'cashAfterBuy',
              v_cash_after_buy,
            'positionQuantity',
              v_position_quantity,
            'positionAveragePrice',
              v_position_average,
            'positionEntryFeeBasisTotal',
              v_fee_basis_total,
            'positionEntryFeeBasisRemaining',
              v_fee_basis_remaining,

            'sellResult',
              v_sell_result,
            'cashAfterSell',
              v_cash_after_sell,
            'accountRealizedPnl',
              v_account_realized,
            'accountDailyRealizedPnl',
              v_account_daily_realized,

            'tradeHistory',
              jsonb_build_object(
                'count',
                  v_trade_count,
                'quantity',
                  v_trade_quantity,
                'entryPrice',
                  v_trade_entry_price,
                'exitPrice',
                  v_trade_exit_price,
                'entryBrokerFee',
                  v_trade_entry_fee,
                'exitBrokerFee',
                  v_trade_exit_fee,
                'sellTax',
                  v_trade_sell_tax,
                'totalTransactionCost',
                  v_trade_total_cost,
                'grossPnl',
                  v_trade_gross_pnl,
                'legacyRealizedPnl',
                  v_trade_realized_pnl,
                'netPnl',
                  v_trade_net_pnl,
                'costModelVersion',
                  v_trade_cost_model
              ),

            'protectiveFill',
              jsonb_build_object(
                'count',
                  v_fill_count,
                'brokerFee',
                  v_fill_broker_fee,
                'sellTax',
                  v_fill_sell_tax,
                'totalTransactionCost',
                  v_fill_total_cost
              ),

            'positionRowsAfterFullExit',
              v_position_rows_after_sell
          ),

        'semanticDifference',
          jsonb_build_object(
            'protectiveFillCost',
              v_fill_total_cost,
            'tradeHistoryRoundTripCost',
              v_trade_total_cost,
            'difference',
              round(v_trade_total_cost - v_fill_total_cost, 2),
            'expectedDifference',
              v_buy_fee,
            'meaning',
              'TRADE_HISTORY_COST_MINUS_PROTECTIVE_FILL_COST_EQUALS_ALLOCATED_BUY_ENTRY_FEE'
          )
      );

    v_inner_pass := true;

    raise exception
      using
        errcode = 'P0001',
        message = v_sentinel;

  exception
    when others then
      if sqlerrm = v_sentinel
        and v_inner_pass then
        v_rollback_sentinel_caught := true;
      else
        v_failure := sqlerrm;
      end if;
  end;

  select count(*)::integer
  into v_persistent_account_rows
  from public.paper_accounts a
  where a.id = v_account_id;

  select count(*)::integer
  into v_persistent_risk_rows
  from public.risk_decisions r
  where r.account_id = v_account_id;

  select count(*)::integer
  into v_persistent_order_rows
  from public.paper_order_requests o
  where o.account_id = v_account_id;

  select count(*)::integer
  into v_persistent_position_rows
  from public.paper_positions p
  where p.account_id = v_account_id;

  select count(*)::integer
  into v_persistent_trade_rows
  from public.paper_trade_history t
  where t.account_id = v_account_id;

  select count(*)::integer
  into v_persistent_fill_rows
  from public.paper_protective_execution_fills_v2 f
  where f.account_id = v_account_id;

  if v_failure is not null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_REVIEW',
      'classification',
        'RUNTIME_NUMERIC_RECONCILIATION_FAILED_OR_BLOCKED',
      'reason',
        v_failure,
      'snapshot',
        v_snapshot,
      'cleanup',
        jsonb_build_object(
          'rollbackSentinelCaught',
            v_rollback_sentinel_caught,
          'persistentAccountRows',
            v_persistent_account_rows,
          'persistentRiskRows',
            v_persistent_risk_rows,
          'persistentOrderRows',
            v_persistent_order_rows,
          'persistentPositionRows',
            v_persistent_position_rows,
          'persistentTradeRows',
            v_persistent_trade_rows,
          'persistentFillRows',
            v_persistent_fill_rows
        ),
      'safety',
        jsonb_build_object(
          'transactionLocalFixtureWrites',
            true,
          'fixtureWritesRolledBackOnFailure',
            true,
          'realBrokerApiInvoked',
            false,
          'realTradingEnabled',
            false
        )
    );
  end if;

  if not v_rollback_sentinel_caught
    or v_persistent_account_rows <> 0
    or v_persistent_risk_rows <> 0
    or v_persistent_order_rows <> 0
    or v_persistent_position_rows <> 0
    or v_persistent_trade_rows <> 0
    or v_persistent_fill_rows <> 0
  then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_CLEANUP_REVIEW',
      'classification',
        'NUMERIC_ASSERTIONS_PASSED_BUT_ROLLBACK_CLEANUP_NOT_PROVEN',
      'snapshot',
        v_snapshot,
      'cleanup',
        jsonb_build_object(
          'rollbackSentinelCaught',
            v_rollback_sentinel_caught,
          'persistentAccountRows',
            v_persistent_account_rows,
          'persistentRiskRows',
            v_persistent_risk_rows,
          'persistentOrderRows',
            v_persistent_order_rows,
          'persistentPositionRows',
            v_persistent_position_rows,
          'persistentTradeRows',
            v_persistent_trade_rows,
          'persistentFillRows',
            v_persistent_fill_rows
        )
    );
  end if;

  return jsonb_build_object(
    'status',
      'AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_PASS',
    'classification',
      'BUY_POSITION_SELL_CASH_HISTORY_NUMERIC_CHAIN_PROVEN',
    'checks',
      jsonb_build_object(
        'buyCashIncludesEntryFee',
          true,
        'positionBasisUsesExecutionPrice',
          true,
        'positionEntryFeeBasisMatchesBuyFee',
          true,
        'sellCashUsesExitNetOfFeeAndTax',
          true,
        'accountRealizedPnlUsesSellSideCosts',
          true,
        'tradeGrossPnlMatchesPricePnl',
          true,
        'tradeRoundTripCostIncludesEntryExitAndTax',
          true,
        'tradeNetPnlMatchesFullRoundTripEconomics',
          true,
        'protectiveFillCostIsExitOnly',
          true,
        'tradeMinusFillCostEqualsEntryFee',
          true,
        'fullExitRemovesPosition',
          true,
        'fixtureRollbackClean',
          true
      ),
    'snapshot',
      v_snapshot,
    'cleanup',
      jsonb_build_object(
        'rollbackSentinelCaught',
          v_rollback_sentinel_caught,
        'persistentAccountRows',
          v_persistent_account_rows,
        'persistentRiskRows',
          v_persistent_risk_rows,
        'persistentOrderRows',
          v_persistent_order_rows,
        'persistentPositionRows',
          v_persistent_position_rows,
        'persistentTradeRows',
          v_persistent_trade_rows,
        'persistentFillRows',
          v_persistent_fill_rows
      ),
    'safety',
      jsonb_build_object(
        'transactionLocalSyntheticPaperFixture',
          true,
        'fixtureWritesRolledBack',
          true,
        'productionTradingFunctionsModified',
          false,
        'shadowFilesModified',
          false,
        'realBrokerApiInvoked',
          false,
        'realOrdersSent',
          false,
        'realTradingEnabled',
          false
      ),
    'nextGate',
      'ACCOUNTING_RECONCILIATION_RESULT_REVIEW'
  );
end;
$$;

revoke all on function
  public.run_paper_accounting_numeric_reconciliation_v1()
from public, anon, authenticated;

grant execute on function
  public.run_paper_accounting_numeric_reconciliation_v1()
to service_role;

comment on function
  public.run_paper_accounting_numeric_reconciliation_v1()
is
  '#5 transaction-local synthetic PAPER numeric reconciliation. Fixture uses entry 10000, stop 9700 (3% distance), qty 10 and reserved risk 3000.';

commit;
