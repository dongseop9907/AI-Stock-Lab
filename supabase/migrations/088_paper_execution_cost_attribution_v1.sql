begin;

alter table public.paper_trade_history
  add column if not exists gross_pnl numeric(18, 2) null,
  add column if not exists entry_broker_fee numeric(18, 2) null,
  add column if not exists exit_broker_fee numeric(18, 2) null,
  add column if not exists sell_tax numeric(18, 2) null,
  add column if not exists total_transaction_cost numeric(18, 2) null,
  add column if not exists net_pnl numeric(18, 2) null,
  add column if not exists gross_return numeric null,
  add column if not exists net_return numeric null,
  add column if not exists entry_slippage_amount numeric(18, 2) null,
  add column if not exists entry_slippage_rate numeric null,
  add column if not exists cost_attribution_complete boolean not null default false,
  add column if not exists cost_model_version text null,
  add column if not exists cost_attribution_snapshot jsonb null;

alter table public.paper_trade_history
  drop constraint if exists paper_trade_history_costs_nonnegative_v1;

alter table public.paper_trade_history
  add constraint paper_trade_history_costs_nonnegative_v1
  check (
    coalesce(entry_broker_fee, 0) >= 0
    and coalesce(exit_broker_fee, 0) >= 0
    and coalesce(sell_tax, 0) >= 0
    and coalesce(total_transaction_cost, 0) >= 0
  );

create or replace function public.apply_paper_trade_cost_attribution_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buy_order public.paper_order_requests%rowtype;

  v_entry_amount numeric;
  v_exit_amount numeric;

  v_entry_broker_fee numeric := 0;
  v_entry_execution_value numeric := 0;
  v_effective_broker_fee_rate numeric := null;

  v_exit_broker_fee numeric := 0;
  v_sell_tax numeric := 0;
  v_total_transaction_cost numeric := 0;

  v_gross_pnl numeric := 0;
  v_net_pnl numeric := 0;

  v_entry_slippage_amount numeric := null;
  v_entry_slippage_rate numeric := null;

  v_sell_tax_rate constant numeric := 0.002;
  v_fallback_broker_fee_rate constant numeric := 0.00015;

  v_entry_fee_source text := 'MISSING';
  v_exit_fee_rate_source text := 'FALLBACK_BASE_REALISTIC';
begin
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

  if new.buy_order_id is not null then
    select *
    into v_buy_order
    from public.paper_order_requests
    where id = new.buy_order_id;

    if found then
      v_entry_broker_fee :=
        greatest(
          0,
          coalesce(
            v_buy_order.execution_broker_fee,
            0
          )
        );

      if v_buy_order.execution_broker_fee is not null then
        v_entry_fee_source :=
          'BUY_ORDER_EXECUTION_BROKER_FEE';
      end if;

      v_entry_execution_value :=
        coalesce(
          v_buy_order.execution_price,
          v_buy_order.filled_price,
          v_buy_order.entry_price,
          0
        )
        *
        greatest(
          0,
          coalesce(
            v_buy_order.filled_quantity,
            v_buy_order.approved_quantity,
            v_buy_order.requested_quantity,
            0
          )
        );

      if (
        v_entry_execution_value > 0
        and v_entry_broker_fee >= 0
      ) then
        v_effective_broker_fee_rate :=
          v_entry_broker_fee
          /
          v_entry_execution_value;

        v_exit_fee_rate_source :=
          'DERIVED_FROM_BUY_EXECUTION';
      end if;

      if (
        v_buy_order.execution_price is not null
        and v_buy_order.entry_price is not null
        and v_buy_order.execution_price > 0
        and v_buy_order.entry_price > 0
        and new.quantity > 0
      ) then
        v_entry_slippage_amount :=
          round(
            (
              v_buy_order.execution_price
              -
              v_buy_order.entry_price
            )
            *
            new.quantity,
            2
          );

        v_entry_slippage_rate :=
          (
            v_buy_order.execution_price
            -
            v_buy_order.entry_price
          )
          /
          v_buy_order.entry_price;
      end if;
    end if;
  end if;

  if (
    v_effective_broker_fee_rate is null
    or v_effective_broker_fee_rate < 0
    or v_effective_broker_fee_rate > 0.01
  ) then
    v_effective_broker_fee_rate :=
      v_fallback_broker_fee_rate;

    v_exit_fee_rate_source :=
      'FALLBACK_BASE_REALISTIC';
  end if;

  v_exit_broker_fee :=
    round(
      greatest(
        0,
        v_exit_amount
      )
      *
      v_effective_broker_fee_rate,
      2
    );

  v_sell_tax :=
    round(
      greatest(
        0,
        v_exit_amount
      )
      *
      v_sell_tax_rate,
      2
    );

  v_gross_pnl :=
    round(
      v_exit_amount
      -
      v_entry_amount,
      2
    );

  v_total_transaction_cost :=
    round(
      v_entry_broker_fee
      +
      v_exit_broker_fee
      +
      v_sell_tax,
      2
    );

  v_net_pnl :=
    round(
      v_gross_pnl
      -
      v_total_transaction_cost,
      2
    );

  new.gross_pnl :=
    v_gross_pnl;

  new.entry_broker_fee :=
    round(
      v_entry_broker_fee,
      2
    );

  new.exit_broker_fee :=
    v_exit_broker_fee;

  new.sell_tax :=
    v_sell_tax;

  new.total_transaction_cost :=
    v_total_transaction_cost;

  new.net_pnl :=
    v_net_pnl;

  new.gross_return :=
    case
      when v_entry_amount > 0
        then v_gross_pnl / v_entry_amount
      else null
    end;

  new.net_return :=
    case
      when v_entry_amount > 0
        then v_net_pnl / v_entry_amount
      else null
    end;

  new.entry_slippage_amount :=
    v_entry_slippage_amount;

  new.entry_slippage_rate :=
    v_entry_slippage_rate;

  new.cost_attribution_complete :=
    (
      new.buy_order_id is not null
      and v_entry_fee_source = 'BUY_ORDER_EXECUTION_BROKER_FEE'
      and v_entry_amount > 0
      and v_exit_amount > 0
    );

  new.cost_model_version :=
    'PAPER_EXECUTION_COST_ATTRIBUTION_V1';

  new.cost_attribution_snapshot :=
    jsonb_build_object(
      'version',
        'PAPER_EXECUTION_COST_ATTRIBUTION_V1',

      'entryFeeSource',
        v_entry_fee_source,

      'exitFeeRateSource',
        v_exit_fee_rate_source,

      'effectiveBrokerFeeRate',
        v_effective_broker_fee_rate,

      'fallbackBrokerFeeRate',
        v_fallback_broker_fee_rate,

      'sellTaxRate',
        v_sell_tax_rate,

      'slippageAccounting',
        'EXECUTION_PRICE_EMBEDDED_NOT_DOUBLE_COUNTED_AS_TRANSACTION_COST',

      'entryExecutionValue',
        v_entry_execution_value,

      'entryAmount',
        v_entry_amount,

      'exitAmount',
        v_exit_amount,

      'grossPnl',
        v_gross_pnl,

      'entryBrokerFee',
        v_entry_broker_fee,

      'exitBrokerFee',
        v_exit_broker_fee,

      'sellTax',
        v_sell_tax,

      'totalTransactionCost',
        v_total_transaction_cost,

      'netPnl',
        v_net_pnl,

      'entrySlippageAmount',
        v_entry_slippage_amount,

      'entrySlippageRate',
        v_entry_slippage_rate
    );

  return new;
end;
$$;

drop trigger if exists trg_paper_trade_cost_attribution_v1
on public.paper_trade_history;

create trigger trg_paper_trade_cost_attribution_v1
before insert or update of
  buy_order_id,
  quantity,
  entry_price,
  exit_price,
  entry_amount,
  exit_amount
on public.paper_trade_history
for each row
execute function public.apply_paper_trade_cost_attribution_v1();

comment on function public.apply_paper_trade_cost_attribution_v1()
is
  'PAPER Execution Cost Attribution V1: preserves legacy realized_pnl, records gross/net PnL and explicit broker fee/sell tax costs, derives exit broker fee rate from linked buy execution when possible, and never double-counts execution-price slippage as transaction cost.';

commit;
