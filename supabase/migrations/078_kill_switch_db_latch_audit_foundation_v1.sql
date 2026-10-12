begin;

do $$
declare
  v_count bigint;
begin
  if to_regclass('public.trading_system_controls') is null then
    raise exception
      using
        errcode = '42P01',
        message = 'KILL_SWITCH_FOUNDATION_REJECTED trading_system_control_missing';
  end if;

  select count(*)
  into v_count
  from public.trading_system_controls
  where control_key = 'global';

  if v_count <> 1 then
    raise exception
      using
        errcode = '23514',
        message = format(
          'KILL_SWITCH_FOUNDATION_REJECTED expected_global_control_row actual=%s',
          v_count
        );
  end if;
end;
$$;

alter table public.trading_system_controls
  add column if not exists kill_switch_version text not null
    default 'ALPHA_V3_KILL_SWITCH_V1',
  add column if not exists kill_switch_latched_at timestamptz null,
  add column if not exists kill_switch_latched_by text null,
  add column if not exists kill_switch_latch_reason text null,
  add column if not exists kill_switch_latch_source text null,
  add column if not exists kill_switch_last_reset_at timestamptz null,
  add column if not exists kill_switch_last_reset_by text null,
  add column if not exists kill_switch_last_reset_reason text null;

create table if not exists public.trading_kill_switch_events (
  id bigint generated always as identity primary key,
  control_id_text text null,
  event_type text not null,
  previous_state boolean not null,
  new_state boolean not null,
  actor text not null,
  reason text not null,
  source text not null,
  automatic boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint trading_kill_switch_events_event_type
    check (event_type in ('TRIP', 'RESET')),
  constraint trading_kill_switch_events_state_change
    check (previous_state is distinct from new_state)
);

create index if not exists
  trading_kill_switch_events_created_at_idx
on public.trading_kill_switch_events (
  created_at desc
);

create or replace function public.validate_kill_switch_transition_v1(
  p_old_state boolean,
  p_new_state boolean,
  p_reset_authorized boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
begin
  if
    p_old_state is null
    or
    p_new_state is null
  then
    return jsonb_build_object(
      'allowed', false,
      'idempotent', false,
      'reason', 'NULL_STATE_NOT_ALLOWED',
      'oldState', p_old_state,
      'newState', p_new_state,
      'resetAuthorized', p_reset_authorized,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  if p_old_state = p_new_state then
    return jsonb_build_object(
      'allowed', true,
      'idempotent', true,
      'reason', 'IDEMPOTENT_NOOP',
      'oldState', p_old_state,
      'newState', p_new_state,
      'resetAuthorized', p_reset_authorized,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  if
    p_old_state = false
    and
    p_new_state = true
  then
    return jsonb_build_object(
      'allowed', true,
      'idempotent', false,
      'reason', 'TRIP_ALLOWED',
      'oldState', p_old_state,
      'newState', p_new_state,
      'resetAuthorized', p_reset_authorized,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  if
    p_old_state = true
    and
    p_new_state = false
  then
    if p_reset_authorized then
      return jsonb_build_object(
        'allowed', true,
        'idempotent', false,
        'reason', 'AUTHORIZED_MANUAL_RESET_ALLOWED',
        'oldState', p_old_state,
        'newState', p_new_state,
        'resetAuthorized', true,
        'version', 'ALPHA_V3_KILL_SWITCH_V1'
      );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'idempotent', false,
      'reason', 'RESET_REQUIRES_AUTHORIZED_RPC',
      'oldState', p_old_state,
      'newState', p_new_state,
      'resetAuthorized', false,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'idempotent', false,
    'reason', 'UNSUPPORTED_TRANSITION',
    'oldState', p_old_state,
    'newState', p_new_state,
    'resetAuthorized', p_reset_authorized,
    'version', 'ALPHA_V3_KILL_SWITCH_V1'
  );
end;
$$;

create or replace function public.enforce_kill_switch_latch_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reset_authorized boolean := false;
  v_validation jsonb;
begin
  if
    old.emergency_stop
    is not distinct from
    new.emergency_stop
  then
    return new;
  end if;

  v_reset_authorized :=
    coalesce(
      current_setting(
        'ai_stock_lab.kill_switch_reset_authorized',
        true
      ),
      ''
    ) = '1';

  v_validation :=
    public.validate_kill_switch_transition_v1(
      old.emergency_stop,
      new.emergency_stop,
      v_reset_authorized
    );

  if
    not coalesce(
      (v_validation ->> 'allowed')::boolean,
      false
    )
  then
    raise exception
      using
        errcode = '23514',
        message = format(
          'KILL_SWITCH_TRANSITION_REJECTED old=%s new=%s reason=%s',
          old.emergency_stop,
          new.emergency_stop,
          coalesce(
            v_validation ->> 'reason',
            'UNKNOWN'
          )
        );
  end if;

  if
    old.emergency_stop = false
    and
    new.emergency_stop = true
  then
    new.kill_switch_version :=
      'ALPHA_V3_KILL_SWITCH_V1';

    new.kill_switch_latched_at :=
      coalesce(
        new.kill_switch_latched_at,
        now()
      );

    new.kill_switch_latched_by :=
      nullif(
        btrim(
          coalesce(
            new.kill_switch_latched_by,
            ''
          )
        ),
        ''
      );

    if new.kill_switch_latched_by is null then
      new.kill_switch_latched_by :=
        'LEGACY_DIRECT_WRITE';
    end if;

    new.kill_switch_latch_reason :=
      nullif(
        btrim(
          coalesce(
            new.kill_switch_latch_reason,
            ''
          )
        ),
        ''
      );

    if new.kill_switch_latch_reason is null then
      new.kill_switch_latch_reason :=
        'DIRECT_EMERGENCY_STOP_WRITE';
    end if;

    new.kill_switch_latch_source :=
      nullif(
        btrim(
          coalesce(
            new.kill_switch_latch_source,
            ''
          )
        ),
        ''
      );

    if new.kill_switch_latch_source is null then
      new.kill_switch_latch_source :=
        'DB_TRIGGER_COMPATIBILITY_PATH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.audit_kill_switch_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_trip boolean;
  v_actor text;
  v_reason text;
  v_source text;
  v_automatic boolean;
  v_metadata jsonb;
begin
  if
    old.emergency_stop
    is not distinct from
    new.emergency_stop
  then
    return new;
  end if;

  v_is_trip :=
    new.emergency_stop = true;

  if v_is_trip then
    v_actor :=
      coalesce(
        nullif(
          btrim(
            coalesce(
              new.kill_switch_latched_by,
              ''
            )
          ),
          ''
        ),
        'LEGACY_DIRECT_WRITE'
      );

    v_reason :=
      coalesce(
        nullif(
          btrim(
            coalesce(
              new.kill_switch_latch_reason,
              ''
            )
          ),
          ''
        ),
        'DIRECT_EMERGENCY_STOP_WRITE'
      );

    v_source :=
      coalesce(
        nullif(
          btrim(
            coalesce(
              new.kill_switch_latch_source,
              ''
            )
          ),
          ''
        ),
        'DB_TRIGGER_COMPATIBILITY_PATH'
      );

    v_automatic :=
      upper(v_source) not in (
        'MANUAL',
        'MANUAL_API',
        'MANUAL_CONTROL',
        'MANUAL_RESET_RPC'
      );

    v_metadata :=
      jsonb_build_object(
        'version',
        'ALPHA_V3_KILL_SWITCH_V1',
        'compatibilityPath',
        v_source = 'DB_TRIGGER_COMPATIBILITY_PATH'
      );
  else
    v_actor :=
      coalesce(
        nullif(
          btrim(
            coalesce(
              new.kill_switch_last_reset_by,
              ''
            )
          ),
          ''
        ),
        'UNKNOWN_RESET_ACTOR'
      );

    v_reason :=
      coalesce(
        nullif(
          btrim(
            coalesce(
              new.kill_switch_last_reset_reason,
              ''
            )
          ),
          ''
        ),
        'AUTHORIZED_RESET'
      );

    v_source :=
      'MANUAL_RESET_RPC';

    v_automatic :=
      false;

    v_metadata :=
      jsonb_build_object(
        'version',
        'ALPHA_V3_KILL_SWITCH_V1',
        'authorizedReset',
        true
      );
  end if;

  insert into public.trading_kill_switch_events (
    control_id_text,
    event_type,
    previous_state,
    new_state,
    actor,
    reason,
    source,
    automatic,
    metadata
  )
  values (
    new.control_key::text,
    case
      when v_is_trip
        then 'TRIP'
      else 'RESET'
    end,
    old.emergency_stop,
    new.emergency_stop,
    v_actor,
    v_reason,
    v_source,
    v_automatic,
    v_metadata
  );

  return new;
end;
$$;

drop trigger if exists
  aa_enforce_kill_switch_latch_v1
on public.trading_system_controls;

create trigger
  aa_enforce_kill_switch_latch_v1
before update of emergency_stop
on public.trading_system_controls
for each row
execute function
  public.enforce_kill_switch_latch_v1();

drop trigger if exists
  zz_audit_kill_switch_transition_v1
on public.trading_system_controls;

create trigger
  zz_audit_kill_switch_transition_v1
after update of emergency_stop
on public.trading_system_controls
for each row
execute function
  public.audit_kill_switch_transition_v1();

create or replace function public.trip_trading_kill_switch_v1(
  p_reason text,
  p_actor text,
  p_source text default 'AUTOMATION',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.trading_system_controls%rowtype;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception
      using
        errcode = '22023',
        message = 'KILL_SWITCH_TRIP_REASON_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception
      using
        errcode = '22023',
        message = 'KILL_SWITCH_TRIP_ACTOR_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_source, '')), '') is null then
    raise exception
      using
        errcode = '22023',
        message = 'KILL_SWITCH_TRIP_SOURCE_REQUIRED';
  end if;

  select *
  into v_control
  from public.trading_system_controls
  where control_key = 'global'
  for update;

  if not found then
    raise exception
      using
        errcode = 'P0002',
        message = 'TRADING_SYSTEM_CONTROL_NOT_FOUND';
  end if;

  if v_control.emergency_stop then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'alreadyLatched', true,
      'emergencyStop', true,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  update public.trading_system_controls
  set
    emergency_stop = true,
    kill_switch_version =
      'ALPHA_V3_KILL_SWITCH_V1',
    kill_switch_latched_at = now(),
    kill_switch_latched_by =
      btrim(p_actor),
    kill_switch_latch_reason =
      btrim(p_reason),
    kill_switch_latch_source =
      btrim(p_source)
  where control_key = 'global';

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'alreadyLatched', false,
    'emergencyStop', true,
    'actor', btrim(p_actor),
    'reason', btrim(p_reason),
    'source', btrim(p_source),
    'metadataAccepted',
      coalesce(p_metadata, '{}'::jsonb),
    'version', 'ALPHA_V3_KILL_SWITCH_V1'
  );
end;
$$;

create or replace function public.reset_trading_kill_switch_v1(
  p_reason text,
  p_actor text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.trading_system_controls%rowtype;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception
      using
        errcode = '22023',
        message = 'KILL_SWITCH_RESET_REASON_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception
      using
        errcode = '22023',
        message = 'KILL_SWITCH_RESET_ACTOR_REQUIRED';
  end if;

  select *
  into v_control
  from public.trading_system_controls
  where control_key = 'global'
  for update;

  if not found then
    raise exception
      using
        errcode = 'P0002',
        message = 'TRADING_SYSTEM_CONTROL_NOT_FOUND';
  end if;

  if not v_control.emergency_stop then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'alreadyReset', true,
      'emergencyStop', false,
      'version', 'ALPHA_V3_KILL_SWITCH_V1'
    );
  end if;

  perform set_config(
    'ai_stock_lab.kill_switch_reset_authorized',
    '1',
    true
  );

  update public.trading_system_controls
  set
    emergency_stop = false,
    kill_switch_version =
      'ALPHA_V3_KILL_SWITCH_V1',
    kill_switch_last_reset_at = now(),
    kill_switch_last_reset_by =
      btrim(p_actor),
    kill_switch_last_reset_reason =
      btrim(p_reason)
  where control_key = 'global';

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'alreadyReset', false,
    'emergencyStop', false,
    'actor', btrim(p_actor),
    'reason', btrim(p_reason),
    'metadataAccepted',
      coalesce(p_metadata, '{}'::jsonb),
    'version', 'ALPHA_V3_KILL_SWITCH_V1'
  );
end;
$$;

create or replace function public.get_trading_kill_switch_status_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.trading_system_controls%rowtype;
  v_event_count bigint;
begin
  select *
  into v_control
  from public.trading_system_controls
  where control_key = 'global';

  if not found then
    raise exception
      using
        errcode = 'P0002',
        message = 'TRADING_SYSTEM_CONTROL_NOT_FOUND';
  end if;

  select count(*)
  into v_event_count
  from public.trading_kill_switch_events;

  return jsonb_build_object(
    'version',
      'ALPHA_V3_KILL_SWITCH_V1',
    'controlId',
      v_control.control_key::text,
    'emergencyStop',
      v_control.emergency_stop,
    'killSwitchVersion',
      v_control.kill_switch_version,
    'latchedAt',
      v_control.kill_switch_latched_at,
    'latchedBy',
      v_control.kill_switch_latched_by,
    'latchReason',
      v_control.kill_switch_latch_reason,
    'latchSource',
      v_control.kill_switch_latch_source,
    'lastResetAt',
      v_control.kill_switch_last_reset_at,
    'lastResetBy',
      v_control.kill_switch_last_reset_by,
    'lastResetReason',
      v_control.kill_switch_last_reset_reason,
    'eventCount',
      v_event_count
  );
end;
$$;

revoke all on
  public.trading_kill_switch_events
from public, anon, authenticated;

grant select on
  public.trading_kill_switch_events
to service_role;

revoke all on function
  public.validate_kill_switch_transition_v1(
    boolean,
    boolean,
    boolean
  )
from public, anon, authenticated;

revoke all on function
  public.trip_trading_kill_switch_v1(
    text,
    text,
    text,
    jsonb
  )
from public, anon, authenticated;

revoke all on function
  public.reset_trading_kill_switch_v1(
    text,
    text,
    jsonb
  )
from public, anon, authenticated;

revoke all on function
  public.get_trading_kill_switch_status_v1()
from public, anon, authenticated;

grant execute on function
  public.validate_kill_switch_transition_v1(
    boolean,
    boolean,
    boolean
  )
to service_role;

grant execute on function
  public.trip_trading_kill_switch_v1(
    text,
    text,
    text,
    jsonb
  )
to service_role;

grant execute on function
  public.reset_trading_kill_switch_v1(
    text,
    text,
    jsonb
  )
to service_role;

grant execute on function
  public.get_trading_kill_switch_status_v1()
to service_role;

comment on table
  public.trading_kill_switch_events
is
  'Alpha V3 Kill Switch V1 immutable-style event trail for emergency_stop TRIP and authorized RESET transitions.';

comment on function
  public.reset_trading_kill_switch_v1(text, text, jsonb)
is
  'Only supported V1 reset path. Direct true->false emergency_stop writes are rejected by the latch trigger.';

commit;
