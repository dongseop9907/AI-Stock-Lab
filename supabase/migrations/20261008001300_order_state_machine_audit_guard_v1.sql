begin;

create table if not exists public.paper_order_state_machine_config (
  id smallint primary key default 1,
  mode text not null default 'AUDIT',
  version text not null default 'ALPHA_V3_ORDER_STATE_MACHINE_V1',
  updated_at timestamptz not null default now(),
  constraint paper_order_state_machine_config_singleton
    check (id = 1),
  constraint paper_order_state_machine_config_mode
    check (mode in ('AUDIT', 'STRICT'))
);

insert into public.paper_order_state_machine_config (
  id,
  mode,
  version,
  updated_at
)
values (
  1,
  'AUDIT',
  'ALPHA_V3_ORDER_STATE_MACHINE_V1',
  now()
)
on conflict (id)
do update set
  mode = 'AUDIT',
  version = excluded.version,
  updated_at = now();

create table if not exists public.paper_order_state_transition_audit (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null default now(),
  state_machine_version text not null,
  enforcement_mode text not null,
  event_type text not null,
  order_id_text text null,
  account_id_text text null,
  stock_code text null,
  side text null,
  old_status text null,
  new_status text null,
  normalized_old_status text null,
  normalized_new_status text null,
  allowed boolean not null,
  idempotent boolean not null default false,
  reason text not null,
  validation_payload jsonb not null default '{}'::jsonb,
  constraint paper_order_state_transition_audit_event_type
    check (event_type in ('INSERT', 'UPDATE')),
  constraint paper_order_state_transition_audit_mode
    check (enforcement_mode in ('AUDIT', 'STRICT'))
);

create index if not exists
  paper_order_state_transition_audit_observed_at_idx
on public.paper_order_state_transition_audit (
  observed_at desc
);

create index if not exists
  paper_order_state_transition_audit_allowed_idx
on public.paper_order_state_transition_audit (
  allowed,
  observed_at desc
);

create or replace function public.normalize_paper_order_status_v1(
  p_status text
)
returns text
language sql
immutable
as $$
  select
    case upper(trim(coalesce(p_status, '')))
      when 'CANCELED' then 'CANCELLED'
      when 'RISK_APPROVED' then 'RISK_APPROVED'
      when 'RISK_REJECTED' then 'RISK_REJECTED'
      when 'FILLED' then 'FILLED'
      when 'EXPIRED' then 'EXPIRED'
      when 'CANCELLED' then 'CANCELLED'
      when 'FAILED' then 'FAILED'
      else null
    end;
$$;

create or replace function public.validate_paper_order_state_transition_v1(
  p_old_status text,
  p_new_status text,
  p_is_insert boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_old text;
  v_new text;
  v_allowed boolean := false;
  v_idempotent boolean := false;
  v_reason text;
begin
  v_old :=
    public.normalize_paper_order_status_v1(
      p_old_status
    );

  v_new :=
    public.normalize_paper_order_status_v1(
      p_new_status
    );

  if v_new is null then
    v_reason := 'UNSUPPORTED_TO_STATUS';

  elsif p_is_insert then
    if v_new in (
      'RISK_APPROVED',
      'RISK_REJECTED',
      'FILLED'
    ) then
      v_allowed := true;
      v_reason := 'CREATE_ALLOWED';
    else
      v_reason := 'CREATE_STATUS_NOT_ALLOWED';
    end if;

  elsif v_old is null then
    v_reason := 'UNSUPPORTED_FROM_STATUS';

  elsif v_old = v_new then
    v_allowed := true;
    v_idempotent := true;
    v_reason := 'IDEMPOTENT_NOOP';

  elsif v_old in (
    'RISK_REJECTED',
    'FILLED',
    'EXPIRED',
    'CANCELLED',
    'FAILED'
  ) then
    v_reason := 'TERMINAL_STATE_CANNOT_TRANSITION';

  elsif
    v_old = 'RISK_APPROVED'
    and
    v_new in (
      'FILLED',
      'EXPIRED'
    )
  then
    v_allowed := true;
    v_reason := 'TRANSITION_ALLOWED';

  else
    v_reason := 'TRANSITION_NOT_ALLOWED';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'idempotent', v_idempotent,
    'from', v_old,
    'to', v_new,
    'oldRaw', p_old_status,
    'newRaw', p_new_status,
    'isInsert', p_is_insert,
    'reason', v_reason,
    'version', 'ALPHA_V3_ORDER_STATE_MACHINE_V1'
  );
end;
$$;

create or replace function public.audit_paper_order_state_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := 'AUDIT';
  v_validation jsonb;
  v_allowed boolean;
  v_idempotent boolean;
  v_reason text;
  v_old_normalized text;
  v_new_normalized text;
begin
  select c.mode
  into v_mode
  from public.paper_order_state_machine_config c
  where c.id = 1;

  v_mode :=
    coalesce(
      v_mode,
      'AUDIT'
    );

  if tg_op = 'INSERT' then
    v_validation :=
      public.validate_paper_order_state_transition_v1(
        null,
        new.status,
        true
      );
  else
    if old.status is not distinct from new.status then
      return new;
    end if;

    v_validation :=
      public.validate_paper_order_state_transition_v1(
        old.status,
        new.status,
        false
      );
  end if;

  v_allowed :=
    coalesce(
      (v_validation ->> 'allowed')::boolean,
      false
    );

  v_idempotent :=
    coalesce(
      (v_validation ->> 'idempotent')::boolean,
      false
    );

  v_reason :=
    coalesce(
      v_validation ->> 'reason',
      'UNKNOWN_VALIDATION_RESULT'
    );

  v_old_normalized :=
    v_validation ->> 'from';

  v_new_normalized :=
    v_validation ->> 'to';

  insert into public.paper_order_state_transition_audit (
    state_machine_version,
    enforcement_mode,
    event_type,
    order_id_text,
    account_id_text,
    stock_code,
    side,
    old_status,
    new_status,
    normalized_old_status,
    normalized_new_status,
    allowed,
    idempotent,
    reason,
    validation_payload
  )
  values (
    'ALPHA_V3_ORDER_STATE_MACHINE_V1',
    v_mode,
    tg_op,
    new.id::text,
    new.account_id::text,
    new.stock_code::text,
    new.side::text,
    case
      when tg_op = 'UPDATE'
        then old.status::text
      else null
    end,
    new.status::text,
    v_old_normalized,
    v_new_normalized,
    v_allowed,
    v_idempotent,
    v_reason,
    v_validation
  );

  if
    v_mode = 'STRICT'
    and
    not v_allowed
  then
    raise exception
      using
        errcode = '23514',
        message =
          format(
            'ORDER_STATE_TRANSITION_REJECTED old=%s new=%s reason=%s',
            coalesce(
              case
                when tg_op = 'UPDATE'
                  then old.status::text
                else '__CREATE__'
              end,
              '__NULL__'
            ),
            coalesce(
              new.status::text,
              '__NULL__'
            ),
            v_reason
          );
  end if;

  return new;
end;
$$;

drop trigger if exists
  zz_paper_order_state_transition_audit_v1
on public.paper_order_requests;

create trigger
  zz_paper_order_state_transition_audit_v1
after insert or update of status
on public.paper_order_requests
for each row
execute function
  public.audit_paper_order_state_transition_v1();

revoke all on
  public.paper_order_state_machine_config
from public, anon, authenticated;

revoke all on
  public.paper_order_state_transition_audit
from public, anon, authenticated;

grant select, update on
  public.paper_order_state_machine_config
to service_role;

grant select on
  public.paper_order_state_transition_audit
to service_role;

revoke all on function
  public.normalize_paper_order_status_v1(text)
from public, anon, authenticated;

revoke all on function
  public.validate_paper_order_state_transition_v1(text, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.normalize_paper_order_status_v1(text)
to service_role;

grant execute on function
  public.validate_paper_order_state_transition_v1(text, text, boolean)
to service_role;

comment on table
  public.paper_order_state_machine_config
is
  'Alpha V3 order state machine enforcement mode. V1 installs in AUDIT mode only.';

comment on table
  public.paper_order_state_transition_audit
is
  'Alpha V3 paper order state transition audit trail. Invalid transitions are observed but not blocked while mode=AUDIT.';

comment on function
  public.validate_paper_order_state_transition_v1(text, text, boolean)
is
  'Pure Alpha V3 order-state validator shared by audit trigger and verification probes.';

commit;
