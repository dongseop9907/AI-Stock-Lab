create table if not exists public.paper_trade_history (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,

  stock_code text not null
    references public.stocks(stock_code),

  source_position_id uuid not null unique,

  buy_order_id uuid,
  sell_order_id uuid
    references public.paper_order_requests(id),

  quantity integer not null
    check (quantity > 0),

  entry_price numeric(18, 2) not null
    check (entry_price > 0),

  exit_price numeric(18, 2) not null
    check (exit_price > 0),

  stop_price numeric(18, 2) not null
    check (stop_price > 0),

  entry_amount numeric(18, 2) not null,
  exit_amount numeric(18, 2) not null,

  realized_pnl numeric(18, 2) not null,
  realized_return numeric(12, 6) not null,

  exit_reason text not null
    check (
      exit_reason in (
        'STOP_LOSS',
        'TRAILING_STOP',
        'MODEL_EXIT',
        'MANUAL'
      )
    ),

  opened_at timestamptz not null,
  closed_at timestamptz not null,

  post_exit_price_1d numeric(18, 2),
  post_exit_price_5d numeric(18, 2),
  post_exit_price_20d numeric(18, 2),

  post_exit_return_1d numeric(12, 6),
  post_exit_return_5d numeric(12, 6),
  post_exit_return_20d numeric(12, 6),

  created_at timestamptz not null default now()
);

create index if not exists idx_trade_history_stock
  on public.paper_trade_history(
    stock_code,
    closed_at desc
  );

create index if not exists idx_trade_history_account
  on public.paper_trade_history(
    account_id,
    closed_at desc
  );

alter table public.paper_trade_history
  enable row level security;


create or replace function public.execute_paper_stop_loss(
  p_position_id uuid,
  p_exit_price numeric,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position public.paper_positions%rowtype;
  v_account public.paper_accounts%rowtype;
  v_existing_trade public.paper_trade_history%rowtype;

  v_entry_amount numeric(18, 2);
  v_exit_amount numeric(18, 2);
  v_realized_pnl numeric(18, 2);
  v_realized_return numeric(12, 6);

  v_risk_decision_id uuid;
  v_sell_order_id uuid;
  v_trade_id uuid;
begin
  if p_exit_price is null or p_exit_price <= 0 then
    raise exception 'INVALID_EXIT_PRICE';
  end if;

  /*
   * 같은 포지션이 동시에 두 번 매도되지 않도록 잠근다.
   */
  select *
  into v_position
  from public.paper_positions
  where id = p_position_id
  for update;

  /*
   * 이미 손절 처리된 포지션이라면 현금을 다시 증가시키지 않는다.
   */
  if not found then
    select *
    into v_existing_trade
    from public.paper_trade_history
    where source_position_id = p_position_id;

    if found then
      return jsonb_build_object(
        'alreadyClosed', true,
        'tradeId', v_existing_trade.id,
        'stockCode', v_existing_trade.stock_code,
        'quantity', v_existing_trade.quantity,
        'exitPrice', v_existing_trade.exit_price,
        'realizedPnl', v_existing_trade.realized_pnl,
        'closedAt', v_existing_trade.closed_at
      );
    end if;

    raise exception 'POSITION_NOT_FOUND';
  end if;

  /*
   * 현재가가 손절가보다 높으면 매도를 실행하지 않는다.
   */
  if p_exit_price > v_position.current_stop_price then
    raise exception 'STOP_NOT_TRIGGERED';
  end if;

  select *
  into v_account
  from public.paper_accounts
  where id = v_position.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if v_account.trading_mode <> 'PAPER' then
    raise exception 'LIVE_ACCOUNT_NOT_ALLOWED';
  end if;

  v_entry_amount :=
    v_position.average_price * v_position.quantity;

  v_exit_amount :=
    p_exit_price * v_position.quantity;

  v_realized_pnl :=
    v_exit_amount - v_entry_amount;

  if v_entry_amount > 0 then
    v_realized_return :=
      v_realized_pnl / v_entry_amount;
  else
    v_realized_return := 0;
  end if;

  /*
   * 손절 판단 내용을 위험관리 기록에 남긴다.
   */
  insert into public.risk_decisions (
    account_id,
    stock_code,
    action,
    approved,
    requested_payload,
    result_payload
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    'SELL',
    true,
    jsonb_build_object(
      'positionId', v_position.id,
      'quantity', v_position.quantity,
      'averagePrice', v_position.average_price,
      'currentStopPrice', v_position.current_stop_price,
      'observedPrice', p_exit_price,
      'observedAt', p_observed_at
    ),
    jsonb_build_object(
      'approved', true,
      'reason', 'STOP_LOSS_TRIGGERED',
      'entryAmount', v_entry_amount,
      'exitAmount', v_exit_amount,
      'realizedPnl', v_realized_pnl,
      'realizedReturn', v_realized_return
    )
  )
  returning id into v_risk_decision_id;

  /*
   * 손절 매도 주문을 체결 완료 상태로 기록한다.
   * 기존 entry_price 컬럼에는 매도 기준가격을 기록한다.
   */
  insert into public.paper_order_requests (
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
    executed_at
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    'SELL',
    v_position.quantity,
    v_position.quantity,
    p_exit_price,
    v_position.current_stop_price,
    'FILLED',
    v_risk_decision_id,
    v_position.quantity,
    p_exit_price,
    coalesce(p_observed_at, now())
  )
  returning id into v_sell_order_id;

  /*
   * 매도대금을 현금에 반영하고 실현손익을 갱신한다.
   */
  update public.paper_accounts
  set
    cash_balance =
      cash_balance + v_exit_amount,

    realized_pnl =
      realized_pnl + v_realized_pnl,

    daily_realized_pnl =
      daily_realized_pnl + v_realized_pnl,

    updated_at = now()
  where id = v_position.account_id;

  /*
   * 매도 완료 거래를 장기 학습용 기록으로 저장한다.
   */
  insert into public.paper_trade_history (
    account_id,
    stock_code,
    source_position_id,
    sell_order_id,
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
  )
  values (
    v_position.account_id,
    v_position.stock_code,
    v_position.id,
    v_sell_order_id,
    v_position.quantity,
    v_position.average_price,
    p_exit_price,
    v_position.current_stop_price,
    v_entry_amount,
    v_exit_amount,
    v_realized_pnl,
    v_realized_return,
    'STOP_LOSS',
    v_position.opened_at,
    coalesce(p_observed_at, now())
  )
  returning id into v_trade_id;

  /*
   * 전량 매도했으므로 보유 포지션에서 제거한다.
   */
  delete from public.paper_positions
  where id = v_position.id;

  return jsonb_build_object(
    'alreadyClosed', false,
    'tradeId', v_trade_id,
    'sellOrderId', v_sell_order_id,
    'accountId', v_position.account_id,
    'stockCode', v_position.stock_code,
    'status', 'FILLED',
    'exitReason', 'STOP_LOSS',
    'quantity', v_position.quantity,
    'entryPrice', v_position.average_price,
    'exitPrice', p_exit_price,
    'stopPrice', v_position.current_stop_price,
    'entryAmount', v_entry_amount,
    'exitAmount', v_exit_amount,
    'realizedPnl', v_realized_pnl,
    'realizedReturn', v_realized_return,
    'remainingCash',
      v_account.cash_balance + v_exit_amount,
    'closedAt',
      coalesce(p_observed_at, now())
  );
end;
$$;

revoke all
on function public.execute_paper_stop_loss(
  uuid,
  numeric,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.execute_paper_stop_loss(
  uuid,
  numeric,
  timestamptz
)
to service_role;