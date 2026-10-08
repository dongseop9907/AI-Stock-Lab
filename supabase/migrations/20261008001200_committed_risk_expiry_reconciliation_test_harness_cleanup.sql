drop function if exists public.expiry_test_reset_v1(uuid);
drop function if exists public.expiry_test_get_order_v1(uuid, uuid);
drop function if exists public.expiry_test_reconcile_v1(uuid, integer);
drop function if exists public.expiry_test_expire_v1(
  uuid, interval, integer, integer
);
drop function if exists public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
);

drop schema if exists ai_stock_lab_expiry_test cascade;
