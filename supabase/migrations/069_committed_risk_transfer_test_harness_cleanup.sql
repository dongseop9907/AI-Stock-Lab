drop function if exists public.committed_risk_transfer_test_reset_v1(uuid);
drop function if exists public.committed_risk_transfer_test_summary_v1(uuid, uuid);
drop function if exists public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
);
drop function if exists public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
);

drop schema if exists ai_stock_lab_transfer_test cascade;
