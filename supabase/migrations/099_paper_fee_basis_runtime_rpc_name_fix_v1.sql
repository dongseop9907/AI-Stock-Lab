begin;

alter function
  public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v()
rename to
  run_paper_fee_basis_rt_v1;

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
  'Service-role-only rollback runtime regression for multi-BUY fee-basis accumulation and three-stage partial exit.';

notify pgrst, 'reload schema';

commit;
