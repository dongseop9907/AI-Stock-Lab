begin;

create table if not exists
  public.trading_system_controls (
    control_key text primary key,

    automation_enabled boolean
      not null default true,

    paper_order_enabled boolean
      not null default false,

    real_order_enabled boolean
      not null default false,

    emergency_stop boolean
      not null default false,

    emergency_reason text,

    max_orders_per_cycle integer
      not null default 1
      check (
        max_orders_per_cycle
        between 1 and 5
      ),

    updated_by text
      not null default 'SYSTEM',

    updated_at timestamptz
      not null default now()
  );

insert into
  public.trading_system_controls (
    control_key,
    automation_enabled,
    paper_order_enabled,
    real_order_enabled,
    emergency_stop,
    max_orders_per_cycle,
    updated_by
  )
values (
  'global',
  true,
  false,
  false,
  false,
  1,
  'MIGRATION'
)
on conflict (control_key)
do nothing;

alter table
  public.trading_system_controls
enable row level security;

revoke all
on public.trading_system_controls
from anon, authenticated;

grant all
on public.trading_system_controls
to service_role;

notify pgrst, 'reload schema';

commit;