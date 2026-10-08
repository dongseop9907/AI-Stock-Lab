drop function if exists public.fill_lock_order_test_reset_v1(uuid);
drop function if exists public.fill_lock_order_test_summary_v1(uuid);
drop function if exists public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
);

drop schema if exists ai_stock_lab_lock_order_test cascade;
