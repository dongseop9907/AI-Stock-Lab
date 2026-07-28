alter table public.paper_order_requests
  add column if not exists filled_quantity integer
    not null default 0
    check (filled_quantity >= 0);

alter table public.paper_order_requests
  add column if not exists filled_price numeric(18, 2);

alter table public.paper_order_requests
  add column if not exists executed_at timestamptz;


create or replace function public.execute_paper_buy_order(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.paper_order_requests%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_positions%rowtype;

  v_order_amount numeric(18, 2);
  v_new_quantity integer;
  v_new_average_price numeric(18, 2);
  v_new_stop_price numeric(18, 2);
begin
  /*
   * 같은 주문이 동시에 두 번 체결되지 않도록
   * 주문 행을 잠근다.
   */
  select *
  into v_order
  from public.paper_order_requests
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.side <> 'BUY' then
    raise exception 'ONLY_BUY_ORDER_SUPPORTED';
  end if;

  /*
   * 이미 체결된 주문은 다시 현금을 차감하지 않는다.
   */
  if v_order.status = 'FILLED' then
    return jsonb_build_object(
      'alreadyFilled', true,
      'orderId', v_order.id,
      'status', v_order.status,
      'filledQuantity', v_order.filled_quantity,
      'filledPrice', v_order.filled_price,
      'executedAt', v_order.executed_at
    );
  end if;

  if v_order.status <> 'RISK_APPROVED' then
    raise exception 'ORDER_NOT_RISK_APPROVED';
  end if;

  if v_order.approved_quantity <= 0 then
    raise exception 'APPROVED_QUANTITY_IS_ZERO';
  end if;

  if v_order.stop_price is null then
    raise exception 'STOP_PRICE_IS_REQUIRED';
  end if;

  /*
   * 체결 중 잔액이 변경되지 않도록 계좌 행을 잠근다.
   */
  select *
  into v_account
  from public.paper_accounts
  where id = v_order.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if v_account.trading_mode <> 'PAPER' then
    raise exception 'LIVE_ACCOUNT_NOT_ALLOWED';
  end if;

  v_order_amount :=
    v_order.entry_price * v_order.approved_quantity;

  if v_account.cash_balance < v_order_amount then
    raise exception 'INSUFFICIENT_CASH_AT_EXECUTION';
  end if;

  /*
   * 기존 보유 종목이 있다면 평균 매수가를 다시 계산한다.
   */
  select *
  into v_position
  from public.paper_positions
  where account_id = v_order.account_id
    and stock_code = v_order.stock_code
  for update;

  if found then
    v_new_quantity :=
      v_position.quantity + v_order.approved_quantity;

    v_new_average_price :=
      (
        v_position.average_price * v_position.quantity
        +
        v_order.entry_price * v_order.approved_quantity
      ) / v_new_quantity;

    /*
     * 추가매수하더라도 기존 손절가보다 아래로 내리지 않는다.
     */
    v_new_stop_price :=
      greatest(
        v_position.current_stop_price,
        v_order.stop_price
      );

    update public.paper_positions
    set
      quantity = v_new_quantity,
      average_price = round(v_new_average_price, 2),
      current_stop_price = v_new_stop_price,
      updated_at = now()
    where id = v_position.id;

  else
    insert into public.paper_positions (
      account_id,
      stock_code,
      sector,
      quantity,
      average_price,
      current_stop_price
    )
    select
      v_order.account_id,
      v_order.stock_code,
      s.sector,
      v_order.approved_quantity,
      v_order.entry_price,
      v_order.stop_price
    from public.stocks s
    where s.stock_code = v_order.stock_code;

    if not found then
      raise exception 'STOCK_NOT_FOUND';
    end if;

    v_new_quantity := v_order.approved_quantity;
    v_new_average_price := v_order.entry_price;
    v_new_stop_price := v_order.stop_price;
  end if;

  update public.paper_accounts
  set
    cash_balance = cash_balance - v_order_amount,
    updated_at = now()
  where id = v_order.account_id;

  update public.paper_order_requests
  set
    status = 'FILLED',
    filled_quantity = approved_quantity,
    filled_price = entry_price,
    executed_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'alreadyFilled', false,
    'orderId', v_order.id,
    'accountId', v_order.account_id,
    'stockCode', v_order.stock_code,
    'status', 'FILLED',
    'filledQuantity', v_order.approved_quantity,
    'filledPrice', v_order.entry_price,
    'orderAmount', v_order_amount,
    'remainingCash', v_account.cash_balance - v_order_amount,
    'positionQuantity', v_new_quantity,
    'averagePrice', round(v_new_average_price, 2),
    'stopPrice', v_new_stop_price,
    'executedAt', now()
  );
end;
$$;

revoke all
on function public.execute_paper_buy_order(uuid)
from public, anon, authenticated;

grant execute
on function public.execute_paper_buy_order(uuid)
to service_role;