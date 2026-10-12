begin;


/* =========================================================
   모의투자 상태 초기화
   - 시장 시세 보존
   - 등록 종목 보존
   - AI 모델 보존
   - 모의주문·포지션·거래·평가만 초기화
   ========================================================= */

create or replace function public.reset_paper_trading_state(
  p_confirmation text,
  p_account_name text default 'default-paper'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_initial_amount numeric;

  v_signal_count integer := 0;
  v_evaluation_count integer := 0;
  v_adjustment_count integer := 0;
  v_trade_count integer := 0;
  v_position_count integer := 0;
  v_order_count integer := 0;
  v_decision_count integer := 0;
begin
  /*
   * 실수로 호출되는 것을 막기 위한 확인 문구
   */
  if p_confirmation <> 'RESET_PAPER_ACCOUNT' then
    raise exception 'RESET_CONFIRMATION_REQUIRED';
  end if;

  /*
   * 초기화 대상 계좌 잠금
   */
  select id
  into v_account_id
  from public.paper_accounts
  where account_name = p_account_name
  for update;

  if not found then
    raise exception 'PAPER_ACCOUNT_NOT_FOUND';
  end if;


  /* =======================================================
     삭제 전 개수 기록
     ======================================================= */

  select count(*)
  into v_order_count
  from public.paper_order_requests
  where account_id = v_account_id;

  select count(*)
  into v_position_count
  from public.paper_positions
  where account_id = v_account_id;

  select count(*)
  into v_trade_count
  from public.paper_trade_history
  where account_id = v_account_id;

  select count(*)
  into v_decision_count
  from public.risk_decisions
  where account_id = v_account_id;

  select count(*)
  into v_evaluation_count
  from public.paper_trade_evaluations e
  join public.paper_trade_history t
    on t.id = e.trade_id
  where t.account_id = v_account_id;

  /*
   * 현재 프로젝트는 기본 모의계좌 하나를 사용하므로
   * 진입 신호는 전체 초기화한다.
   */
  select count(*)
  into v_signal_count
  from public.ai_entry_signals;


  /* =======================================================
     종속 데이터부터 삭제
     ======================================================= */

  delete from public.ai_entry_signals
  where true;

  delete from public.paper_trade_evaluations e
  using public.paper_trade_history t
  where e.trade_id = t.id
    and t.account_id = v_account_id;


  /*
   * 트레일링 손절 조정 테이블이 존재하는 경우 처리한다.
   * 테이블 구조 차이에도 대응하도록 동적 SQL을 사용한다.
   */
  if to_regclass(
    'public.paper_stop_adjustments'
  ) is not null then

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'paper_stop_adjustments'
        and column_name = 'account_id'
    ) then
      execute
        'select count(*)
         from public.paper_stop_adjustments
         where account_id = $1'
      into v_adjustment_count
      using v_account_id;

      execute
        'delete from public.paper_stop_adjustments
         where account_id = $1'
      using v_account_id;

    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'paper_stop_adjustments'
        and column_name = 'position_id'
    ) then
      execute
        'select count(*)
         from public.paper_stop_adjustments a
         join public.paper_positions p
           on p.id = a.position_id
         where p.account_id = $1'
      into v_adjustment_count
      using v_account_id;

      execute
        'delete from public.paper_stop_adjustments a
         using public.paper_positions p
         where a.position_id = p.id
           and p.account_id = $1'
      using v_account_id;
    end if;
  end if;


  delete from public.paper_trade_history
  where account_id = v_account_id;

  /*
   * paper_positions가 entry_order_id를 참조할 수 있으므로
   * 주문보다 포지션을 먼저 삭제한다.
   */
  delete from public.paper_positions
  where account_id = v_account_id;

  delete from public.paper_order_requests
  where account_id = v_account_id;

  delete from public.risk_decisions
  where account_id = v_account_id;


  /* =======================================================
     실제 초기자금 컬럼 탐색
     ======================================================= */

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'initial_cash'
  ) then
    execute
      'select initial_cash
       from public.paper_accounts
       where id = $1'
    into v_initial_amount
    using v_account_id;

  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'initial_balance'
  ) then
    execute
      'select initial_balance
       from public.paper_accounts
       where id = $1'
    into v_initial_amount
    using v_account_id;

  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'initial_capital'
  ) then
    execute
      'select initial_capital
       from public.paper_accounts
       where id = $1'
    into v_initial_amount
    using v_account_id;

  else
    raise exception 'INITIAL_ACCOUNT_AMOUNT_COLUMN_NOT_FOUND';
  end if;


  /* =======================================================
     현금잔액 초기화
     ======================================================= */

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'cash_balance'
  ) then
    execute
      'update public.paper_accounts
       set cash_balance = $1
       where id = $2'
    using v_initial_amount, v_account_id;

  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'cash'
  ) then
    execute
      'update public.paper_accounts
       set cash = $1
       where id = $2'
    using v_initial_amount, v_account_id;

  else
    raise exception 'ACCOUNT_CASH_COLUMN_NOT_FOUND';
  end if;


  /* =======================================================
     손익 컬럼 초기화
     ======================================================= */

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'realized_pnl'
  ) then
    execute
      'update public.paper_accounts
       set realized_pnl = 0
       where id = $1'
    using v_account_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'daily_pnl'
  ) then
    execute
      'update public.paper_accounts
       set daily_pnl = 0
       where id = $1'
    using v_account_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_accounts'
      and column_name = 'updated_at'
  ) then
    execute
      'update public.paper_accounts
       set updated_at = now()
       where id = $1'
    using v_account_id;
  end if;


  /*
   * 거래가 삭제되었으므로 모델의 자동 성과 지표도 갱신한다.
   */
  if to_regprocedure(
    'public.refresh_ai_model_metrics(uuid)'
  ) is not null then
    perform public.refresh_ai_model_metrics(
      null::uuid
    );
  end if;


  return jsonb_build_object(
    'accountId', v_account_id,
    'accountName', p_account_name,
    'restoredCash', v_initial_amount,

    'deleted', jsonb_build_object(
      'signals', v_signal_count,
      'evaluations', v_evaluation_count,
      'stopAdjustments', v_adjustment_count,
      'trades', v_trade_count,
      'positions', v_position_count,
      'orders', v_order_count,
      'riskDecisions', v_decision_count
    ),

    'preserved', jsonb_build_object(
      'marketSnapshots', true,
      'stocks', true,
      'models', true
    ),

    'resetAt', now()
  );
end;
$$;


revoke all
on function public.reset_paper_trading_state(
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.reset_paper_trading_state(
  text,
  text
)
to service_role;


notify pgrst, 'reload schema';

commit;