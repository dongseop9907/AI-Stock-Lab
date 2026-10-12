-- AI Stock Lab
-- PAPER BUY Daily Loss Real DB Stress Harness V1
--
-- Service-role-only, synthetic-account-only test surface.
-- Calls the production daily-loss guard directly.
-- No broker/external API calls and no production trading function changes.

begin;

create or replace function public.run_paper_buy_daily_loss_stress_v1(
  p_account_id uuid,
  p_equity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_name text;
  v_daily_realized_pnl numeric;
begin
  select
    a.account_name,
    a.daily_realized_pnl
  into
    v_account_name,
    v_daily_realized_pnl
  from public.paper_accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'STRESS_ACCOUNT_NOT_FOUND';
  end if;

  if
    v_account_name is null or
    v_account_name not like 'AI_STOCK_LAB_STRESS_%'
  then
    raise exception 'STRESS_ACCOUNT_PREFIX_REQUIRED';
  end if;

  perform public.assert_paper_buy_daily_loss_allowed_v1(
    p_account_id,
    p_equity
  );

  return jsonb_build_object(
    'status',
      'DAILY_LOSS_GUARD_ALLOWED',
    'accountId',
      p_account_id,
    'equity',
      p_equity,
    'dailyRealizedPnl',
      v_daily_realized_pnl,
    'maxDailyLossRate',
      0.02,
    'maxDailyLossAmount',
      p_equity * 0.02
  );
end;
$$;

revoke all on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
from public, anon, authenticated;

grant execute on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
to service_role;

comment on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
is
  'Service-role-only synthetic runtime probe for the production 2% PAPER BUY daily-loss guard.';

commit;
