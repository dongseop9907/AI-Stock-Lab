begin;

create table if not exists public.paper_buy_v5_concurrency_fixtures_v1 (
  fixture_token uuid primary key,
  account_id uuid not null,
  stock_code text not null,
  risk_decision_id uuid not null,
  order_id uuid not null unique,
  baseline_cash numeric(18, 2) not null,
  entry_price numeric(18, 2) not null,
  execution_price numeric(18, 2) not null,
  stop_price numeric(18, 2) not null,
  approved_quantity integer not null,
  fill_quantity integer not null,
  broker_fee numeric(18, 2) not null,
  created_at timestamptz not null default now()
);

revoke all
on table public.paper_buy_v5_concurrency_fixtures_v1
from public;

revoke all
on table public.paper_buy_v5_concurrency_fixtures_v1
from anon;

revoke all
on table public.paper_buy_v5_concurrency_fixtures_v1
from authenticated;

grant select
on table public.paper_buy_v5_concurrency_fixtures_v1
to service_role;


create or replace function public.paper_buy_v5_conc_ready_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  if to_regprocedure(
    'public.execute_paper_buy_order_with_execution_price_v5(uuid,numeric,timestamptz,text,jsonb,integer,numeric)'
  ) is null then
    return jsonb_build_object(
      'ready', false,
      'classification', 'BLOCKED',
      'reason', 'BUY_V5_7_ARG_RPC_NOT_FOUND'
    );
  end if;

  if to_regclass(
    'public.paper_buy_execution_events_v1'
  ) is null then
    return jsonb_build_object(
      'ready', false,
      'classification', 'BLOCKED',
      'reason', 'BUY_V5_EVENT_LEDGER_NOT_FOUND'
    );
  end if;

  if exists (
    select 1
    from public.paper_buy_v5_concurrency_fixtures_v1
    where created_at >= now() - interval '15 minutes'
  ) then
    return jsonb_build_object(
      'ready', false,
      'classification', 'BLOCKED',
      'reason', 'ACTIVE_BUY_V5_CONCURRENCY_FIXTURE_EXISTS'
    );
  end if;

  begin
    perform public.assert_paper_buy_new_risk_allowed_v1();
  exception
    when others then
      v_reason := sqlerrm;

      return jsonb_build_object(
        'ready', false,
        'classification', 'NORMAL_WAIT',
        'gate', 'NEW_RISK',
        'reason', v_reason
      );
  end;

  begin
    perform public.assert_paper_buy_data_freshness_allowed_v1();
  exception
    when others then
      v_reason := sqlerrm;

      return jsonb_build_object(
        'ready', false,
        'classification', 'NORMAL_WAIT',
        'gate', 'DATA_FRESHNESS',
        'reason', v_reason
      );
  end;

  return jsonb_build_object(
    'ready', true,
    'classification', 'READY',
    'buyV5Present', true,
    'eventLedgerPresent', true,
    'newRiskGateOpen', true,
    'dataFreshnessGateOpen', true
  );
end;
$$;


create or replace function public.paper_buy_v5_conc_setup_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixture_token uuid := gen_random_uuid();
  v_risk_id uuid := gen_random_uuid();
  v_order_id uuid := gen_random_uuid();

  v_account_id uuid;
  v_baseline_cash numeric(18, 2);
  v_stock_code text;

  v_entry_price numeric(18, 2) := 10000;
  v_execution_price numeric(18, 2) := 10000;
  v_stop_price numeric(18, 2) := 9700;
  v_approved_quantity integer := 4;
  v_fill_quantity integer := 1;
  v_broker_fee numeric(18, 2) := 100;
  v_reserved_risk numeric(18, 2) := 2000;
begin
  perform public.assert_paper_buy_new_risk_allowed_v1();
  perform public.assert_paper_buy_data_freshness_allowed_v1();

  if exists (
    select 1
    from public.paper_buy_v5_concurrency_fixtures_v1
    where created_at >= now() - interval '15 minutes'
  ) then
    raise exception
      'ACTIVE_BUY_V5_CONCURRENCY_FIXTURE_EXISTS';
  end if;

  select
    a.id,
    a.cash_balance
  into
    v_account_id,
    v_baseline_cash
  from public.paper_accounts a
  where a.trading_mode = 'PAPER'
    and a.cash_balance >= 100000
  order by a.id
  limit 1
  for update;

  if not found then
    raise exception
      'NO_PAPER_ACCOUNT_WITH_SUFFICIENT_CASH';
  end if;

  select s.stock_code
  into v_stock_code
  from public.stocks s
  where not exists (
    select 1
    from public.paper_positions p
    where p.account_id = v_account_id
      and p.stock_code = s.stock_code
  )
  and not exists (
    select 1
    from public.paper_order_requests o
    where o.account_id = v_account_id
      and o.stock_code = s.stock_code
      and o.status in ('RISK_APPROVED', 'FILLED')
  )
  and not exists (
    select 1
    from public.paper_buy_v5_concurrency_fixtures_v1 f
    where f.account_id = v_account_id
      and f.stock_code = s.stock_code
  )
  order by s.stock_code
  limit 1;

  if not found then
    raise exception
      'NO_UNUSED_STOCK_FOR_BUY_V5_CONCURRENCY_FIXTURE';
  end if;

  insert into public.risk_decisions (
    id,
    account_id,
    stock_code,
    action,
    approved,
    requested_payload,
    result_payload,
    created_at
  ) values (
    v_risk_id,
    v_account_id,
    v_stock_code,
    'BUY',
    true,
    jsonb_build_object(
      'fixture',
      'BUY_V5_CONCURRENCY_STRESS_V1',
      'fixtureToken',
      v_fixture_token
    ),
    jsonb_build_object(
      'approved',
      true,
      'fixture',
      true
    ),
    now()
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
    reserved_risk_amount,
    created_at
  ) values (
    v_order_id,
    v_account_id,
    v_stock_code,
    'BUY',
    v_approved_quantity,
    v_approved_quantity,
    v_entry_price,
    v_stop_price,
    'RISK_APPROVED',
    v_risk_id,
    v_reserved_risk,
    now()
  );

  insert into public.paper_buy_v5_concurrency_fixtures_v1 (
    fixture_token,
    account_id,
    stock_code,
    risk_decision_id,
    order_id,
    baseline_cash,
    entry_price,
    execution_price,
    stop_price,
    approved_quantity,
    fill_quantity,
    broker_fee
  ) values (
    v_fixture_token,
    v_account_id,
    v_stock_code,
    v_risk_id,
    v_order_id,
    v_baseline_cash,
    v_entry_price,
    v_execution_price,
    v_stop_price,
    v_approved_quantity,
    v_fill_quantity,
    v_broker_fee
  );

  return jsonb_build_object(
    'status',
    'AI_STOCK_LAB_BUY_V5_CONCURRENCY_FIXTURE_READY',

    'fixtureToken',
    v_fixture_token,

    'accountId',
    v_account_id,

    'stockCode',
    v_stock_code,

    'riskDecisionId',
    v_risk_id,

    'orderId',
    v_order_id,

    'baselineCash',
    v_baseline_cash,

    'entryPrice',
    v_entry_price,

    'executionPrice',
    v_execution_price,

    'stopPrice',
    v_stop_price,

    'approvedQuantity',
    v_approved_quantity,

    'fillQuantity',
    v_fill_quantity,

    'brokerFee',
    v_broker_fee,

    'reservedRisk',
    v_reserved_risk,

    'persistentTestFixture',
    true,

    'naturalEvidence',
    false
  );
end;
$$;


create or replace function public.paper_buy_v5_conc_state_v1(
  p_fixture_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixture public.paper_buy_v5_concurrency_fixtures_v1%rowtype;

  v_current_cash numeric(18, 2);

  v_order_status text;
  v_filled_quantity integer;
  v_execution_fill_count integer;
  v_execution_broker_fee numeric(18, 2);
  v_filled_price numeric(18, 2);
  v_execution_price numeric(18, 2);

  v_position_count integer := 0;
  v_position_quantity integer;
  v_position_average numeric(18, 2);
  v_fee_basis_total numeric(18, 2);
  v_fee_basis_remaining numeric(18, 2);

  v_event_count integer := 0;
  v_event_fingerprints integer := 0;
begin
  select *
  into v_fixture
  from public.paper_buy_v5_concurrency_fixtures_v1
  where fixture_token = p_fixture_token;

  if not found then
    return jsonb_build_object(
      'status',
      'FIXTURE_NOT_FOUND'
    );
  end if;

  select cash_balance
  into v_current_cash
  from public.paper_accounts
  where id = v_fixture.account_id;

  select
    status,
    filled_quantity,
    execution_fill_count,
    execution_broker_fee,
    filled_price,
    execution_price
  into
    v_order_status,
    v_filled_quantity,
    v_execution_fill_count,
    v_execution_broker_fee,
    v_filled_price,
    v_execution_price
  from public.paper_order_requests
  where id = v_fixture.order_id;

  select
    count(*)::integer,
    max(quantity),
    max(average_price),
    max(entry_broker_fee_basis_total),
    max(entry_broker_fee_basis_remaining)
  into
    v_position_count,
    v_position_quantity,
    v_position_average,
    v_fee_basis_total,
    v_fee_basis_remaining
  from public.paper_positions
  where account_id = v_fixture.account_id
    and stock_code = v_fixture.stock_code;

  select
    count(*)::integer,
    count(distinct event_fingerprint)::integer
  into
    v_event_count,
    v_event_fingerprints
  from public.paper_buy_execution_events_v1
  where order_id = v_fixture.order_id;

  return jsonb_build_object(
    'status',
    'AI_STOCK_LAB_BUY_V5_CONCURRENCY_STATE',

    'fixtureToken',
    v_fixture.fixture_token,

    'accountId',
    v_fixture.account_id,

    'stockCode',
    v_fixture.stock_code,

    'orderId',
    v_fixture.order_id,

    'baselineCash',
    v_fixture.baseline_cash,

    'currentCash',
    v_current_cash,

    'cashDelta',
    v_current_cash - v_fixture.baseline_cash,

    'order',
    jsonb_build_object(
      'status',
      v_order_status,

      'filledQuantity',
      coalesce(v_filled_quantity, 0),

      'executionFillCount',
      coalesce(v_execution_fill_count, 0),

      'executionBrokerFee',
      coalesce(v_execution_broker_fee, 0),

      'filledPrice',
      v_filled_price,

      'executionPrice',
      v_execution_price
    ),

    'position',
    jsonb_build_object(
      'count',
      v_position_count,

      'quantity',
      v_position_quantity,

      'averagePrice',
      v_position_average,

      'entryFeeBasisTotal',
      v_fee_basis_total,

      'entryFeeBasisRemaining',
      v_fee_basis_remaining
    ),

    'ledger',
    jsonb_build_object(
      'rows',
      v_event_count,

      'distinctFingerprints',
      v_event_fingerprints
    )
  );
end;
$$;


create or replace function public.paper_buy_v5_conc_cleanup_v1(
  p_fixture_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixture public.paper_buy_v5_concurrency_fixtures_v1%rowtype;

  v_filled_quantity integer := 0;
  v_effective_price numeric(18, 2) := 0;
  v_broker_fee numeric(18, 2) := 0;
  v_restore_amount numeric(18, 2) := 0;

  v_cash_after numeric(18, 2);

  v_events_deleted integer := 0;
  v_positions_deleted integer := 0;
  v_orders_deleted integer := 0;
  v_risk_deleted integer := 0;
begin
  select *
  into v_fixture
  from public.paper_buy_v5_concurrency_fixtures_v1
  where fixture_token = p_fixture_token
  for update;

  if not found then
    return jsonb_build_object(
      'status',
      'AI_STOCK_LAB_BUY_V5_CONCURRENCY_CLEANUP_ALREADY_CLEAN',
      'fixtureToken',
      p_fixture_token,
      'alreadyClean',
      true
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_BUY_V5_CONCURRENCY_CLEANUP:' ||
      v_fixture.account_id::text
    )
  );

  perform 1
  from public.paper_accounts
  where id = v_fixture.account_id
  for update;

  select
    coalesce(filled_quantity, 0),
    coalesce(
      filled_price,
      execution_price,
      entry_price,
      0
    ),
    coalesce(execution_broker_fee, 0)
  into
    v_filled_quantity,
    v_effective_price,
    v_broker_fee
  from public.paper_order_requests
  where id = v_fixture.order_id;

  if found then
    v_restore_amount :=
      greatest(v_filled_quantity, 0)
      * greatest(v_effective_price, 0)
      + greatest(v_broker_fee, 0);
  end if;

  delete from public.paper_buy_execution_events_v1
  where order_id = v_fixture.order_id;

  get diagnostics v_events_deleted = row_count;

  delete from public.paper_positions
  where account_id = v_fixture.account_id
    and stock_code = v_fixture.stock_code;

  get diagnostics v_positions_deleted = row_count;

  delete from public.paper_order_requests
  where id = v_fixture.order_id;

  get diagnostics v_orders_deleted = row_count;

  delete from public.risk_decisions
  where id = v_fixture.risk_decision_id;

  get diagnostics v_risk_deleted = row_count;

  if v_restore_amount > 0 then
    update public.paper_accounts
    set
      cash_balance =
        cash_balance + v_restore_amount,
      updated_at =
        now()
    where id = v_fixture.account_id;
  end if;

  select cash_balance
  into v_cash_after
  from public.paper_accounts
  where id = v_fixture.account_id;

  delete from public.paper_buy_v5_concurrency_fixtures_v1
  where fixture_token = p_fixture_token;

  return jsonb_build_object(
    'status',
    'AI_STOCK_LAB_BUY_V5_CONCURRENCY_CLEANUP_PASS',

    'fixtureToken',
    p_fixture_token,

    'restoredAmount',
    v_restore_amount,

    'baselineCash',
    v_fixture.baseline_cash,

    'cashAfterCleanup',
    v_cash_after,

    'cashEqualsBaseline',
    v_cash_after = v_fixture.baseline_cash,

    'deleted',
    jsonb_build_object(
      'events',
      v_events_deleted,

      'positions',
      v_positions_deleted,

      'orders',
      v_orders_deleted,

      'riskDecisions',
      v_risk_deleted
    )
  );
end;
$$;


revoke all
on function public.paper_buy_v5_conc_ready_v1()
from public;

revoke all
on function public.paper_buy_v5_conc_ready_v1()
from anon;

revoke all
on function public.paper_buy_v5_conc_ready_v1()
from authenticated;

grant execute
on function public.paper_buy_v5_conc_ready_v1()
to service_role;


revoke all
on function public.paper_buy_v5_conc_setup_v1()
from public;

revoke all
on function public.paper_buy_v5_conc_setup_v1()
from anon;

revoke all
on function public.paper_buy_v5_conc_setup_v1()
from authenticated;

grant execute
on function public.paper_buy_v5_conc_setup_v1()
to service_role;


revoke all
on function public.paper_buy_v5_conc_state_v1(uuid)
from public;

revoke all
on function public.paper_buy_v5_conc_state_v1(uuid)
from anon;

revoke all
on function public.paper_buy_v5_conc_state_v1(uuid)
from authenticated;

grant execute
on function public.paper_buy_v5_conc_state_v1(uuid)
to service_role;


revoke all
on function public.paper_buy_v5_conc_cleanup_v1(uuid)
from public;

revoke all
on function public.paper_buy_v5_conc_cleanup_v1(uuid)
from anon;

revoke all
on function public.paper_buy_v5_conc_cleanup_v1(uuid)
from authenticated;

grant execute
on function public.paper_buy_v5_conc_cleanup_v1(uuid)
to service_role;


comment on table public.paper_buy_v5_concurrency_fixtures_v1
is
  'Temporary tagged PAPER-only fixture registry for BUY V5 concurrent first-seen event regression. Rows are not natural trading evidence and must be cleaned after each run.';

comment on function public.paper_buy_v5_conc_setup_v1()
is
  'Creates one committed, explicitly tagged PAPER-only BUY fixture so separate PostgREST transactions can race the same V5 execution event. Does not call V5.';

comment on function public.paper_buy_v5_conc_cleanup_v1(uuid)
is
  'Exact-token cleanup for BUY V5 concurrency test fixtures. Deletes only tagged fixture rows and compensates actual fixture BUY cash debit from persisted fill state.';

notify pgrst, 'reload schema';

commit;
