begin;

-- ============================================================
-- PAPER BUY V5 IDEMPOTENT REPLAY RUNTIME REGRESSION V1.1
-- FIX: paper_order_requests.risk_decision_id is NOT NULL.
--
-- This replaces ONLY the service-role regression function.
-- Production V5/V4/V3/V2 trading functions are unchanged.
-- All fixture rows remain inside an intentional rollback
-- subtransaction.
-- ============================================================

create or replace function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_account_cash_before numeric;
  v_account_cash_after_rollback numeric;

  v_stock_code text;
  v_sector text;

  v_risk_decision_id uuid;

  v_order_id uuid :=
    gen_random_uuid();

  v_position_id uuid :=
    gen_random_uuid();

  v_execution_price numeric :=
    10000;

  v_observed_at timestamptz :=
    clock_timestamp();

  v_source text :=
    'ROLLBACK_REGRESSION_FIXTURE';

  v_provenance jsonb :=
    jsonb_build_object(
      'test',
        'PAPER_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_1',

      'synthetic',
        true,

      'persistent',
        false
    );

  v_fill_quantity integer :=
    1;

  v_broker_fee numeric :=
    10;

  v_fingerprint text;

  v_stored_result jsonb;
  v_replay_result jsonb;

  v_cash_before_replay numeric;
  v_cash_after_replay numeric;

  v_position_quantity_before integer;
  v_position_quantity_after integer;

  v_position_average_before numeric;
  v_position_average_after numeric;

  v_order_filled_before integer;
  v_order_filled_after integer;

  v_order_fill_count_before integer;
  v_order_fill_count_after integer;

  v_order_fee_before numeric;
  v_order_fee_after numeric;

  v_ledger_before integer;
  v_ledger_after integer;

  v_risk_rows_after_rollback integer;
  v_order_rows_after_rollback integer;
  v_position_rows_after_rollback integer;
  v_ledger_rows_after_rollback integer;

  v_inner_assertions_pass boolean :=
    false;

  v_rollback_sentinel_caught boolean :=
    false;

  v_sentinel constant text :=
    'AI_STOCK_LAB_BUY_V5_REPLAY_TEST_ROLLBACK_SENTINEL';
begin
  if to_regprocedure(
    'public.execute_paper_buy_order_with_execution_price_v5(uuid,numeric,timestamp with time zone,text,jsonb,integer,numeric)'
  ) is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_BLOCKED',

      'reason',
        'BUY_V5_RPC_NOT_FOUND'
    );
  end if;


  select
    a.id,
    a.cash_balance
  into
    v_account_id,
    v_account_cash_before
  from public.paper_accounts a
  where a.trading_mode =
      'PAPER'
  order by
    a.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_BLOCKED',

      'reason',
        'NO_PAPER_ACCOUNT_AVAILABLE'
    );
  end if;


  select
    s.stock_code,
    coalesce(
      s.sector,
      'TEST'
    )
  into
    v_stock_code,
    v_sector
  from public.stocks s
  where not exists (
    select 1
    from public.paper_positions p
    where p.account_id =
        v_account_id
      and p.stock_code =
        s.stock_code
  )
  order by
    s.stock_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_BLOCKED',

      'reason',
        'NO_UNUSED_STOCK_AVAILABLE_FOR_ROLLBACK_FIXTURE'
    );
  end if;


  v_fingerprint :=
    md5(
      v_order_id::text
      || '|'
      || (
        extract(
          epoch
          from v_observed_at
        )::numeric(30, 6)
      )::text
      || '|'
      || trim_scale(
        v_execution_price
      )::text
      || '|'
      || trim(
        v_source
      )
      || '|'
      || v_fill_quantity::text
      || '|'
      || trim_scale(
        v_broker_fee
      )::text
      || '|'
      || md5(
        v_provenance::text
      )
    );


  v_stored_result :=
    jsonb_build_object(
      'alreadyFilled',
        false,

      'orderId',
        v_order_id,

      'accountId',
        v_account_id,

      'stockCode',
        v_stock_code,

      'status',
        'RISK_APPROVED',

      'filledQuantity',
        1,

      'filledPrice',
        v_execution_price,

      'positionQuantity',
        1,

      'averagePrice',
        v_execution_price,

      'testFixture',
        true
    );


  /*
   * Exception blocks are PostgreSQL subtransactions.
   * The final sentinel intentionally rolls back:
   *   risk_decisions
   *   paper_order_requests
   *   paper_positions
   *   paper_buy_execution_events_v1
   */
  begin
    insert into
      public.risk_decisions (
        account_id,
        stock_code,
        action,
        approved,
        requested_payload,
        result_payload
      )
    values (
      v_account_id,
      v_stock_code,
      'BUY',
      true,
      jsonb_build_object(
        'test',
          'PAPER_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_1',

        'orderId',
          v_order_id,

        'synthetic',
          true,

        'persistent',
          false
      ),
      jsonb_build_object(
        'approved',
          true,

        'reason',
          'ROLLBACK_REGRESSION_FIXTURE'
      )
    )
    returning id
    into v_risk_decision_id;


    insert into
      public.paper_order_requests (
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
        execution_price,
        execution_price_observed_at,
        execution_price_source,
        execution_broker_fee,
        execution_transaction_cost,
        execution_fill_count
      )
    values (
      v_order_id,
      v_account_id,
      v_stock_code,
      'BUY',
      2,
      2,
      v_execution_price,
      9000,
      'FAILED',
      v_risk_decision_id,
      1,
      v_execution_price,
      v_observed_at,
      v_execution_price,
      v_observed_at,
      v_source,
      v_broker_fee,
      v_broker_fee,
      1
    );


    insert into
      public.paper_positions (
        id,
        account_id,
        stock_code,
        sector,
        quantity,
        average_price,
        current_stop_price,
        entry_order_id
      )
    values (
      v_position_id,
      v_account_id,
      v_stock_code,
      v_sector,
      1,
      v_execution_price,
      9000,
      v_order_id
    );


    insert into
      public.paper_buy_execution_events_v1 (
        order_id,
        event_fingerprint,
        execution_observed_at,
        execution_price,
        execution_price_source,
        fill_quantity,
        broker_fee,
        execution_provenance,
        execution_result
      )
    values (
      v_order_id,
      v_fingerprint,
      v_observed_at,
      v_execution_price,
      v_source,
      v_fill_quantity,
      v_broker_fee,
      v_provenance,
      v_stored_result
    );


    select
      a.cash_balance
    into
      v_cash_before_replay
    from public.paper_accounts a
    where a.id =
      v_account_id;


    select
      p.quantity,
      p.average_price
    into
      v_position_quantity_before,
      v_position_average_before
    from public.paper_positions p
    where p.id =
      v_position_id;


    select
      o.filled_quantity,
      o.execution_fill_count,
      o.execution_broker_fee
    into
      v_order_filled_before,
      v_order_fill_count_before,
      v_order_fee_before
    from public.paper_order_requests o
    where o.id =
      v_order_id;


    select
      count(*)::integer
    into
      v_ledger_before
    from public.paper_buy_execution_events_v1 e
    where e.order_id =
        v_order_id
      and e.event_fingerprint =
        v_fingerprint;


    select
      public.execute_paper_buy_order_with_execution_price_v5(
        p_order_id =>
          v_order_id,

        p_execution_price =>
          v_execution_price,

        p_execution_observed_at =>
          v_observed_at,

        p_execution_price_source =>
          v_source,

        p_execution_provenance =>
          v_provenance,

        p_fill_quantity =>
          v_fill_quantity,

        p_broker_fee =>
          v_broker_fee
      )
    into
      v_replay_result;


    select
      a.cash_balance
    into
      v_cash_after_replay
    from public.paper_accounts a
    where a.id =
      v_account_id;


    select
      p.quantity,
      p.average_price
    into
      v_position_quantity_after,
      v_position_average_after
    from public.paper_positions p
    where p.id =
      v_position_id;


    select
      o.filled_quantity,
      o.execution_fill_count,
      o.execution_broker_fee
    into
      v_order_filled_after,
      v_order_fill_count_after,
      v_order_fee_after
    from public.paper_order_requests o
    where o.id =
      v_order_id;


    select
      count(*)::integer
    into
      v_ledger_after
    from public.paper_buy_execution_events_v1 e
    where e.order_id =
        v_order_id
      and e.event_fingerprint =
        v_fingerprint;


    if coalesce(
      v_replay_result ->> 'idempotentReplay',
      'false'
    ) <> 'true' then
      raise exception
        'ASSERT_SECOND_CALL_NOT_IDEMPOTENT_REPLAY';
    end if;


    if v_ledger_before <> 1
      or v_ledger_after <> 1
    then
      raise exception
        'ASSERT_LEDGER_COUNT_CHANGED before=% after=%',
        v_ledger_before,
        v_ledger_after;
    end if;


    if v_cash_after_replay
      is distinct from
      v_cash_before_replay
    then
      raise exception
        'ASSERT_CASH_CHANGED_ON_REPLAY before=% after=%',
        v_cash_before_replay,
        v_cash_after_replay;
    end if;


    if v_position_quantity_after
      is distinct from
      v_position_quantity_before
      or v_position_average_after
      is distinct from
      v_position_average_before
    then
      raise exception
        'ASSERT_POSITION_CHANGED_ON_REPLAY';
    end if;


    if v_order_filled_after
      is distinct from
      v_order_filled_before
      or v_order_fill_count_after
      is distinct from
      v_order_fill_count_before
      or v_order_fee_after
      is distinct from
      v_order_fee_before
    then
      raise exception
        'ASSERT_ORDER_EXECUTION_ACCUMULATORS_CHANGED_ON_REPLAY';
    end if;


    v_inner_assertions_pass :=
      true;


    raise exception
      using
        errcode =
          'P0001',

        message =
          v_sentinel;

  exception
    when raise_exception then
      if sqlerrm =
          v_sentinel
        and v_inner_assertions_pass
      then
        v_rollback_sentinel_caught :=
          true;
      else
        raise;
      end if;
  end;


  select
    count(*)::integer
  into
    v_risk_rows_after_rollback
  from public.risk_decisions r
  where r.id =
    v_risk_decision_id;


  select
    count(*)::integer
  into
    v_order_rows_after_rollback
  from public.paper_order_requests o
  where o.id =
    v_order_id;


  select
    count(*)::integer
  into
    v_position_rows_after_rollback
  from public.paper_positions p
  where p.id =
    v_position_id;


  select
    count(*)::integer
  into
    v_ledger_rows_after_rollback
  from public.paper_buy_execution_events_v1 e
  where e.order_id =
      v_order_id
    and e.event_fingerprint =
      v_fingerprint;


  select
    a.cash_balance
  into
    v_account_cash_after_rollback
  from public.paper_accounts a
  where a.id =
    v_account_id;


  if not v_rollback_sentinel_caught then
    raise exception
      'ASSERT_ROLLBACK_SENTINEL_NOT_CAUGHT';
  end if;


  if v_risk_rows_after_rollback <> 0
    or v_order_rows_after_rollback <> 0
    or v_position_rows_after_rollback <> 0
    or v_ledger_rows_after_rollback <> 0
  then
    raise exception
      'ASSERT_FIXTURE_ROWS_PERSISTED_AFTER_ROLLBACK';
  end if;


  if v_account_cash_after_rollback
    is distinct from
    v_account_cash_before
  then
    raise exception
      'ASSERT_ACCOUNT_CASH_CHANGED_AFTER_ROLLBACK';
  end if;


  return jsonb_build_object(
    'status',
      'AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_PASS',

    'classification',
      'BUY_V5_EXACT_REPLAY_RUNTIME_IDEMPOTENCY_AND_ROLLBACK_PROVEN',

    'checks',
      jsonb_build_object(
        'riskDecisionFixtureCreatedInsideRollbackScope',
          v_risk_decision_id is not null,

        'replayReturnedIdempotentReplayTrue',
          true,

        'ledgerStayedExactlyOneRowInsideFixture',
          (
            v_ledger_before = 1
            and v_ledger_after = 1
          ),

        'cashUnchangedOnReplay',
          (
            v_cash_after_replay
            is not distinct from
            v_cash_before_replay
          ),

        'positionUnchangedOnReplay',
          (
            v_position_quantity_after
              is not distinct from
              v_position_quantity_before
            and
            v_position_average_after
              is not distinct from
              v_position_average_before
          ),

        'orderFilledQuantityUnchangedOnReplay',
          (
            v_order_filled_after
              is not distinct from
              v_order_filled_before
          ),

        'orderFillCountUnchangedOnReplay',
          (
            v_order_fill_count_after
              is not distinct from
              v_order_fill_count_before
          ),

        'orderBrokerFeeUnchangedOnReplay',
          (
            v_order_fee_after
              is not distinct from
              v_order_fee_before
          ),

        'rollbackSentinelCaught',
          v_rollback_sentinel_caught,

        'fixtureRiskDecisionRemoved',
          (
            v_risk_rows_after_rollback = 0
          ),

        'fixtureOrderRemoved',
          (
            v_order_rows_after_rollback = 0
          ),

        'fixturePositionRemoved',
          (
            v_position_rows_after_rollback = 0
          ),

        'fixtureLedgerRemoved',
          (
            v_ledger_rows_after_rollback = 0
          ),

        'accountCashRestoredAfterRollback',
          (
            v_account_cash_after_rollback
              is not distinct from
              v_account_cash_before
          )
      ),

    'fixture',
      jsonb_build_object(
        'riskDecisionId',
          v_risk_decision_id,

        'orderId',
          v_order_id,

        'positionId',
          v_position_id,

        'accountId',
          v_account_id,

        'stockCode',
          v_stock_code,

        'eventFingerprint',
          v_fingerprint,

        'persistent',
          false
      ),

    'replayResult',
      v_replay_result,

    'safety',
      jsonb_build_object(
        'transactionLocalFixtureWrites',
          true,

        'fixtureWritesRolledBack',
          true,

        'persistentRiskDecisionRows',
          v_risk_rows_after_rollback,

        'persistentOrderRows',
          v_order_rows_after_rollback,

        'persistentPositionRows',
          v_position_rows_after_rollback,

        'persistentLedgerRows',
          v_ledger_rows_after_rollback,

        'realTradingEnabled',
          false
      )
  );
end;
$$;


revoke all
on function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
from public;


revoke all
on function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
from anon;


revoke all
on function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
from authenticated;


grant execute
on function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
to service_role;


comment on function
  public.run_paper_buy_v5_idempotent_replay_runtime_regression_v1()
is
  'Service-role-only rollback regression for exact PAPER BUY V5 event replay. V1.1 adds a transaction-local risk_decisions fixture required by paper_order_requests.risk_decision_id NOT NULL.';


notify pgrst, 'reload schema';

commit;
