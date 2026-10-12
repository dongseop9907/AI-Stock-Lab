begin;

-- ============================================================
-- PAPER Partial Exit + Position Entry Fee Basis V1
--
-- Goals
-- 1) allow multiple trade-history rows for one source position
-- 2) accumulate BUY broker fees at position level
-- 3) allocate remaining entry fee proportionally on partial exit
-- 4) consume rounding remainder on final exit
-- 5) preserve current V2/V3/V4 execution callers
--
-- IMPORTANT:
-- Runtime state was audited as empty before this migration.
-- Re-check that invariant inside the transaction and fail closed
-- if PAPER state changed after the audit.
-- ============================================================

do $$
begin
  if exists (
    select 1
    from public.paper_positions
    limit 1
  ) then
    raise exception
      'PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_PAPER_POSITIONS';
  end if;

  if exists (
    select 1
    from public.paper_trade_history
    limit 1
  ) then
    raise exception
      'PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_TRADE_HISTORY';
  end if;

  if exists (
    select 1
    from public.paper_order_requests
    where side = 'BUY'
      and (
        coalesce(filled_quantity, 0) > 0
        or coalesce(execution_broker_fee, 0) > 0
        or coalesce(execution_fill_count, 0) > 0
        or status = 'FILLED'
      )
    limit 1
  ) then
    raise exception
      'PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_NO_EXECUTED_BUY_ORDERS';
  end if;
end;
$$;


-- ============================================================
-- 1. Position-level cumulative / remaining BUY fee basis
-- ============================================================

alter table public.paper_positions
  add column if not exists entry_broker_fee_basis_total
    numeric(18, 2)
    not null
    default 0,

  add column if not exists entry_broker_fee_basis_remaining
    numeric(18, 2)
    not null
    default 0;


alter table public.paper_positions
  drop constraint if exists
    paper_positions_entry_fee_basis_nonnegative_v1;

alter table public.paper_positions
  add constraint
    paper_positions_entry_fee_basis_nonnegative_v1
  check (
    entry_broker_fee_basis_total >= 0
    and entry_broker_fee_basis_remaining >= 0
    and entry_broker_fee_basis_remaining
      <= entry_broker_fee_basis_total
  );


-- ============================================================
-- 2. Remove one-trade-per-position UNIQUE constraint
--
-- The initial schema defined:
--   source_position_id uuid not null unique
--
-- Drop whichever UNIQUE constraint PostgreSQL generated for the
-- single source_position_id column. Do not assume its name.
-- ============================================================

do $$
declare
  v_attnum smallint;
  v_constraint record;
begin
  select a.attnum
  into v_attnum
  from pg_attribute a
  where a.attrelid =
    'public.paper_trade_history'::regclass
    and a.attname = 'source_position_id'
    and not a.attisdropped;

  if v_attnum is null then
    raise exception
      'PAPER_TRADE_HISTORY_SOURCE_POSITION_COLUMN_NOT_FOUND';
  end if;

  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid =
      'public.paper_trade_history'::regclass
      and c.contype = 'u'
      and c.conkey =
        array[v_attnum]::smallint[]
  loop
    execute format(
      'alter table public.paper_trade_history drop constraint %I',
      v_constraint.conname
    );
  end loop;

  if exists (
    select 1
    from pg_constraint c
    where c.conrelid =
      'public.paper_trade_history'::regclass
      and c.contype = 'u'
      and c.conkey =
        array[v_attnum]::smallint[]
  ) then
    raise exception
      'PAPER_TRADE_HISTORY_SOURCE_POSITION_UNIQUE_STILL_PRESENT';
  end if;
end;
$$;


create index if not exists
  idx_paper_trade_history_source_position_v1
on public.paper_trade_history(
  source_position_id,
  closed_at desc
);


-- ============================================================
-- 3. Accumulate BUY execution fee into current position
--
-- Canonical BUY V2 updates/inserts paper_positions BEFORE it
-- updates paper_order_requests.execution_broker_fee.
--
-- Therefore this AFTER UPDATE trigger can safely add only the
-- positive fee delta for every BUY execution/partial fill.
--
-- This avoids modifying validated BUY V2/V3/V4 RPC semantics.
-- ============================================================

create or replace function
  public.accumulate_paper_position_entry_fee_basis_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fee_delta numeric(18, 2) := 0;
  v_updated integer := 0;
begin
  if new.side <> 'BUY' then
    return new;
  end if;

  v_fee_delta :=
    round(
      greatest(
        0,
        coalesce(new.execution_broker_fee, 0)
        -
        coalesce(old.execution_broker_fee, 0)
      ),
      2
    );

  if v_fee_delta <= 0 then
    return new;
  end if;

  update public.paper_positions
  set
    entry_broker_fee_basis_total =
      round(
        coalesce(entry_broker_fee_basis_total, 0)
        +
        v_fee_delta,
        2
      ),

    entry_broker_fee_basis_remaining =
      round(
        coalesce(entry_broker_fee_basis_remaining, 0)
        +
        v_fee_delta,
        2
      ),

    updated_at = now()

  where account_id = new.account_id
    and stock_code = new.stock_code;

  get diagnostics
    v_updated = row_count;

  if v_updated <> 1 then
    raise exception
      'PAPER_POSITION_ENTRY_FEE_BASIS_BINDING_FAILED account=% stock=% rows=%',
      new.account_id,
      new.stock_code,
      v_updated;
  end if;

  return new;
end;
$$;


drop trigger if exists
  trg_accumulate_paper_position_entry_fee_basis_v1
on public.paper_order_requests;


create trigger
  trg_accumulate_paper_position_entry_fee_basis_v1
after update of execution_broker_fee
on public.paper_order_requests
for each row
when (
  new.side = 'BUY'
)
execute function
  public.accumulate_paper_position_entry_fee_basis_v1();


-- ============================================================
-- 4. Allocate position-level entry fee to trade-history rows
--
-- Existing BEFORE INSERT order:
--   trg_attach_model_to_trade_history
--   trg_paper_trade_cost_attribution_v1
--
-- PostgreSQL fires same-kind triggers alphabetically.
-- This trigger starts with "trg_zz_" so it runs after the
-- existing cost-attribution trigger and can replace only the
-- ENTRY fee with authoritative position-level allocation.
--
-- INSERT:
--   - lock source position
--   - allocate fee from remaining basis
--   - decrement remaining basis atomically
--
-- UPDATE:
--   - NEVER consume fee basis again
--   - preserve OLD.entry_broker_fee
--   - recompute total/net after older trigger recalculation
-- ============================================================

create or replace function
  public.apply_paper_trade_entry_fee_basis_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_position public.paper_positions%rowtype;

  v_position_quantity integer := 0;

  v_fee_before numeric(18, 2) := 0;
  v_fee_allocated numeric(18, 2) := 0;
  v_fee_after numeric(18, 2) := 0;

  v_entry_amount numeric := 0;
  v_exit_amount numeric := 0;
begin
  -- ----------------------------------------------------------
  -- UPDATE path:
  -- Historical trade already consumed its entry fee on INSERT.
  -- Preserve that allocation and never consume position basis
  -- a second time.
  -- ----------------------------------------------------------

  if tg_op = 'UPDATE' then
    new.entry_broker_fee :=
      round(
        greatest(
          0,
          coalesce(old.entry_broker_fee, 0)
        ),
        2
      );

    new.total_transaction_cost :=
      round(
        new.entry_broker_fee
        +
        greatest(
          0,
          coalesce(new.exit_broker_fee, 0)
        )
        +
        greatest(
          0,
          coalesce(new.sell_tax, 0)
        ),
        2
      );

    new.net_pnl :=
      round(
        coalesce(new.gross_pnl, 0)
        -
        new.total_transaction_cost,
        2
      );

    v_entry_amount :=
      coalesce(
        new.entry_amount,
        new.entry_price * new.quantity,
        0
      );

    new.net_return :=
      case
        when v_entry_amount > 0
          then new.net_pnl / v_entry_amount
        else null
      end;

    new.cost_model_version :=
      'PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS';

    new.cost_attribution_snapshot :=
      coalesce(
        new.cost_attribution_snapshot,
        '{}'::jsonb
      )
      ||
      jsonb_build_object(
        'version',
          'PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS',

        'entryFeeSource',
          'POSITION_ENTRY_FEE_BASIS_V1_PRESERVED_ON_UPDATE',

        'entryBrokerFee',
          new.entry_broker_fee,

        'totalTransactionCost',
          new.total_transaction_cost,

        'netPnl',
          new.net_pnl
      );

    return new;
  end if;


  -- ----------------------------------------------------------
  -- INSERT path
  -- ----------------------------------------------------------

  select *
  into v_position
  from public.paper_positions
  where id = new.source_position_id
  for update;

  if not found then
    raise exception
      'PAPER_TRADE_ENTRY_FEE_BASIS_SOURCE_POSITION_NOT_FOUND position=%',
      new.source_position_id;
  end if;


  v_position_quantity :=
    greatest(
      0,
      coalesce(v_position.quantity, 0)
    );

  if v_position_quantity <= 0 then
    raise exception
      'PAPER_TRADE_ENTRY_FEE_BASIS_POSITION_QUANTITY_INVALID position=%',
      new.source_position_id;
  end if;


  if new.quantity <= 0
    or new.quantity > v_position_quantity
  then
    raise exception
      'PAPER_TRADE_ENTRY_FEE_BASIS_EXIT_QUANTITY_INVALID position=% exitQty=% positionQty=%',
      new.source_position_id,
      new.quantity,
      v_position_quantity;
  end if;


  v_fee_before :=
    round(
      greatest(
        0,
        coalesce(
          v_position.entry_broker_fee_basis_remaining,
          0
        )
      ),
      2
    );


  if new.quantity = v_position_quantity then

    -- Final exit consumes all remaining fee basis so rounding
    -- residue can never survive the closed position.

    v_fee_allocated :=
      v_fee_before;

  else

    v_fee_allocated :=
      least(
        v_fee_before,

        round(
          v_fee_before
          *
          new.quantity::numeric
          /
          v_position_quantity::numeric,
          2
        )
      );

  end if;


  v_fee_after :=
    round(
      greatest(
        0,
        v_fee_before - v_fee_allocated
      ),
      2
    );


  update public.paper_positions
  set
    entry_broker_fee_basis_remaining =
      v_fee_after,

    updated_at =
      now()

  where id =
    new.source_position_id;


  -- Existing cost attribution already calculated:
  --   gross_pnl
  --   exit_broker_fee
  --   sell_tax
  --
  -- Replace only entry fee and derived totals.

  new.entry_broker_fee :=
    v_fee_allocated;


  new.total_transaction_cost :=
    round(
      new.entry_broker_fee
      +
      greatest(
        0,
        coalesce(new.exit_broker_fee, 0)
      )
      +
      greatest(
        0,
        coalesce(new.sell_tax, 0)
      ),
      2
    );


  new.net_pnl :=
    round(
      coalesce(new.gross_pnl, 0)
      -
      new.total_transaction_cost,
      2
    );


  v_entry_amount :=
    coalesce(
      new.entry_amount,
      new.entry_price * new.quantity,
      0
    );


  v_exit_amount :=
    coalesce(
      new.exit_amount,
      new.exit_price * new.quantity,
      0
    );


  new.net_return :=
    case
      when v_entry_amount > 0
        then new.net_pnl / v_entry_amount
      else null
    end;


  new.cost_attribution_complete :=
    (
      v_entry_amount > 0
      and v_exit_amount > 0
    );


  new.cost_model_version :=
    'PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS';


  new.cost_attribution_snapshot :=
    coalesce(
      new.cost_attribution_snapshot,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'version',
        'PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS',

      'entryFeeSource',
        'POSITION_ENTRY_FEE_BASIS_V1',

      'positionQuantityBeforeExit',
        v_position_quantity,

      'exitQuantity',
        new.quantity,

      'entryFeeBasisTotal',
        v_position.entry_broker_fee_basis_total,

      'entryFeeBasisRemainingBefore',
        v_fee_before,

      'entryFeeAllocated',
        v_fee_allocated,

      'entryFeeBasisRemainingAfter',
        v_fee_after,

      'entryBrokerFee',
        new.entry_broker_fee,

      'exitBrokerFee',
        new.exit_broker_fee,

      'sellTax',
        new.sell_tax,

      'totalTransactionCost',
        new.total_transaction_cost,

      'grossPnl',
        new.gross_pnl,

      'netPnl',
        new.net_pnl,

      'roundingPolicy',
        'FINAL_EXIT_CONSUMES_REMAINING_ENTRY_FEE_BASIS'
    );


  return new;
end;
$$;


drop trigger if exists
  trg_zz_paper_trade_entry_fee_basis_v1
on public.paper_trade_history;


create trigger
  trg_zz_paper_trade_entry_fee_basis_v1
before insert or update of
  buy_order_id,
  quantity,
  entry_price,
  exit_price,
  entry_amount,
  exit_amount
on public.paper_trade_history
for each row
execute function
  public.apply_paper_trade_entry_fee_basis_v1();


-- ============================================================
-- 5. Deployment invariants
-- ============================================================

do $$
declare
  v_attnum smallint;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_positions'
      and column_name =
        'entry_broker_fee_basis_total'
  ) then
    raise exception
      'PAPER_ENTRY_FEE_BASIS_TOTAL_COLUMN_MISSING';
  end if;


  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_positions'
      and column_name =
        'entry_broker_fee_basis_remaining'
  ) then
    raise exception
      'PAPER_ENTRY_FEE_BASIS_REMAINING_COLUMN_MISSING';
  end if;


  select a.attnum
  into v_attnum
  from pg_attribute a
  where a.attrelid =
    'public.paper_trade_history'::regclass
    and a.attname = 'source_position_id'
    and not a.attisdropped;


  if exists (
    select 1
    from pg_constraint c
    where c.conrelid =
      'public.paper_trade_history'::regclass
      and c.contype = 'u'
      and c.conkey =
        array[v_attnum]::smallint[]
  ) then
    raise exception
      'PAPER_TRADE_HISTORY_SOURCE_POSITION_UNIQUE_DEPLOYMENT_CHECK_FAILED';
  end if;


  if to_regprocedure(
    'public.accumulate_paper_position_entry_fee_basis_v1()'
  ) is null then
    raise exception
      'PAPER_ENTRY_FEE_ACCUMULATOR_FUNCTION_MISSING';
  end if;


  if to_regprocedure(
    'public.apply_paper_trade_entry_fee_basis_v1()'
  ) is null then
    raise exception
      'PAPER_ENTRY_FEE_ALLOCATION_FUNCTION_MISSING';
  end if;


  if not exists (
    select 1
    from pg_trigger
    where tgrelid =
      'public.paper_order_requests'::regclass
      and tgname =
        'trg_accumulate_paper_position_entry_fee_basis_v1'
      and not tgisinternal
  ) then
    raise exception
      'PAPER_ENTRY_FEE_ACCUMULATOR_TRIGGER_MISSING';
  end if;


  if not exists (
    select 1
    from pg_trigger
    where tgrelid =
      'public.paper_trade_history'::regclass
      and tgname =
        'trg_zz_paper_trade_entry_fee_basis_v1'
      and not tgisinternal
  ) then
    raise exception
      'PAPER_ENTRY_FEE_ALLOCATION_TRIGGER_MISSING';
  end if;
end;
$$;


comment on column
  public.paper_positions.entry_broker_fee_basis_total
is
  'Cumulative BUY broker fee added to the current PAPER position across all BUY executions/fills.';


comment on column
  public.paper_positions.entry_broker_fee_basis_remaining
is
  'Unallocated BUY broker fee remaining on the current PAPER position. Partial exits consume proportionally; final exit consumes all remainder.';


comment on function
  public.accumulate_paper_position_entry_fee_basis_v1()
is
  'PAPER Entry Fee Basis V1: accumulates only positive execution_broker_fee deltas from BUY orders into the matching current position.';


comment on function
  public.apply_paper_trade_entry_fee_basis_v1()
is
  'PAPER Entry Fee Basis V1: allows position-level entry-fee allocation across partial exits; final exit consumes rounding remainder; update path never consumes the basis twice.';


notify pgrst, 'reload schema';

commit;
