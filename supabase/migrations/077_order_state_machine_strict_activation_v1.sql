begin;

do $$
declare
  v_mode text;
  v_version text;
  v_total_orders bigint;
  v_approved_orders bigint;
  v_active_reservations bigint;
  v_positions bigint;
  v_invalid_audit bigint;
begin
  select
    c.mode,
    c.version
  into
    v_mode,
    v_version
  from public.paper_order_state_machine_config c
  where c.id = 1
  for update;

  if v_mode is distinct from 'AUDIT' then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED expected_mode=AUDIT actual_mode=%s',
            coalesce(v_mode, '__NULL__')
          );
  end if;

  if
    v_version is distinct from
      'ALPHA_V3_ORDER_STATE_MACHINE_V1'
  then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED expected_version=ALPHA_V3_ORDER_STATE_MACHINE_V1 actual_version=%s',
            coalesce(v_version, '__NULL__')
          );
  end if;

  select count(*)
  into v_total_orders
  from public.paper_order_requests;

  if v_total_orders <> 0 then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED paper_order_count=%s',
            v_total_orders
          );
  end if;

  select count(*)
  into v_approved_orders
  from public.paper_order_requests
  where status = 'RISK_APPROVED';

  if v_approved_orders <> 0 then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED risk_approved_count=%s',
            v_approved_orders
          );
  end if;

  select count(*)
  into v_active_reservations
  from public.paper_order_requests
  where
    reserved_risk_amount > 0
    and
    reserved_risk_released_at is null;

  if v_active_reservations <> 0 then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED active_reservation_count=%s',
            v_active_reservations
          );
  end if;

  select count(*)
  into v_positions
  from public.paper_positions;

  if v_positions <> 0 then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED paper_position_count=%s',
            v_positions
          );
  end if;

  select count(*)
  into v_invalid_audit
  from public.paper_order_state_transition_audit
  where allowed = false;

  if v_invalid_audit <> 0 then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_STRICT_ACTIVATION_REJECTED invalid_audit_count=%s',
            v_invalid_audit
          );
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c
      on c.oid = t.tgrelid
    join pg_namespace n
      on n.oid = c.relnamespace
    where
      n.nspname = 'public'
      and
      c.relname = 'paper_order_requests'
      and
      t.tgname =
        'zz_paper_order_state_transition_audit_v1'
      and
      not t.tgisinternal
  ) then
    raise exception
      using
        errcode = '23514',
        message =
          'ORDER_STATE_STRICT_ACTIVATION_REJECTED audit_trigger_missing';
  end if;

  update public.paper_order_state_machine_config
  set
    mode = 'STRICT',
    version =
      'ALPHA_V3_ORDER_STATE_MACHINE_V1',
    updated_at = now()
  where id = 1;

  if not found then
    raise exception
      using
        errcode = '23514',
        message =
          'ORDER_STATE_STRICT_ACTIVATION_REJECTED config_row_missing';
  end if;
end;
$$;

comment on table
  public.paper_order_state_machine_config
is
  'Alpha V3 order state machine enforcement mode. STRICT activated after clean AUDIT compatibility and preactivation checks.';

commit;
