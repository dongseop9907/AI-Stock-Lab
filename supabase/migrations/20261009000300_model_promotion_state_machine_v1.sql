-- MODEL_PROMOTION_STATE_MACHINE_V1
-- Compatibility-first foundation.
-- Existing ai_model_versions.status is preserved unchanged.

alter table public.ai_model_versions
  add column if not exists promotion_stage text;

alter table public.ai_model_versions
  add column if not exists promotion_stage_updated_at timestamptz;

alter table public.ai_model_versions
  add column if not exists promotion_stage_reason text;

update public.ai_model_versions
set
  promotion_stage =
    case
      when status = 'CANDIDATE' then 'CANDIDATE'
      when status = 'APPROVED' then 'PAPER'
      when status in ('REJECTED', 'RETIRED') then 'DISABLED'
      else 'EXPERIMENTAL'
    end,
  promotion_stage_updated_at =
    coalesce(
      promotion_stage_updated_at,
      now()
    ),
  promotion_stage_reason =
    coalesce(
      promotion_stage_reason,
      'LEGACY_STATUS_INITIALIZATION'
    )
where promotion_stage is null;

alter table public.ai_model_versions
  alter column promotion_stage
  set default 'EXPERIMENTAL';

alter table public.ai_model_versions
  alter column promotion_stage
  set not null;

alter table public.ai_model_versions
  drop constraint if exists ai_model_versions_promotion_stage_check;

alter table public.ai_model_versions
  add constraint ai_model_versions_promotion_stage_check
  check (
    promotion_stage in (
      'EXPERIMENTAL',
      'CANDIDATE',
      'SHADOW',
      'PAPER',
      'LIMITED_LIVE',
      'PRODUCTION',
      'DEGRADED',
      'DISABLED'
    )
  );

create table if not exists public.model_promotion_events (
  id uuid primary key default gen_random_uuid(),

  model_id uuid not null
    references public.ai_model_versions(id)
    on delete cascade,

  from_stage text not null,
  to_stage text not null,

  transition_kind text not null,

  decision text not null
    check (
      decision in (
        'APPLIED',
        'RECOMMENDED',
        'BLOCKED'
      )
    ),

  requires_manual_approval boolean not null default false,
  manual_approval_confirmed boolean not null default false,

  actor text,
  reason text not null,

  evidence jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint model_promotion_events_from_stage_check
    check (
      from_stage in (
        'EXPERIMENTAL',
        'CANDIDATE',
        'SHADOW',
        'PAPER',
        'LIMITED_LIVE',
        'PRODUCTION',
        'DEGRADED',
        'DISABLED'
      )
    ),

  constraint model_promotion_events_to_stage_check
    check (
      to_stage in (
        'EXPERIMENTAL',
        'CANDIDATE',
        'SHADOW',
        'PAPER',
        'LIMITED_LIVE',
        'PRODUCTION',
        'DEGRADED',
        'DISABLED'
      )
    )
);

create index if not exists idx_model_promotion_events_model_created
  on public.model_promotion_events(
    model_id,
    created_at desc
  );

create or replace function public.validate_model_promotion_transition_v1(
  p_from_stage text,
  p_to_stage text
)
returns table (
  allowed boolean,
  transition_kind text,
  requires_manual_approval boolean,
  reason text
)
language plpgsql
immutable
as $$
declare
  v_next_stage text;
begin
  if p_from_stage = p_to_stage then
    return query
    select
      true,
      'NOOP'::text,
      false,
      'SAME_STAGE'::text;
    return;
  end if;

  v_next_stage :=
    case p_from_stage
      when 'EXPERIMENTAL' then 'CANDIDATE'
      when 'CANDIDATE' then 'SHADOW'
      when 'SHADOW' then 'PAPER'
      when 'PAPER' then 'LIMITED_LIVE'
      when 'LIMITED_LIVE' then 'PRODUCTION'
      else null
    end;

  if v_next_stage = p_to_stage then
    return query
    select
      true,
      'FORWARD'::text,
      (
        p_from_stage in ('PAPER', 'LIMITED_LIVE')
        or p_to_stage in ('LIMITED_LIVE', 'PRODUCTION')
      ),
      'FORWARD_ONE_STAGE'::text;
    return;
  end if;

  if
    p_from_stage in (
      'EXPERIMENTAL',
      'CANDIDATE',
      'SHADOW',
      'PAPER',
      'LIMITED_LIVE',
      'PRODUCTION'
    )
    and p_to_stage = 'DEGRADED'
  then
    return query
    select
      true,
      'DEGRADE'::text,
      false,
      'DEGRADE_ACTIVE_STAGE'::text;
    return;
  end if;

  if
    p_from_stage <> 'PRODUCTION'
    and p_from_stage <> 'DISABLED'
    and p_to_stage = 'DISABLED'
  then
    return query
    select
      true,
      'DISABLE'::text,
      false,
      'DISABLE_FROM_NON_PRODUCTION_STAGE'::text;
    return;
  end if;

  if
    p_from_stage = 'DEGRADED'
    and p_to_stage = 'SHADOW'
  then
    return query
    select
      true,
      'RECOVER'::text,
      true,
      'RECOVER_DEGRADED_TO_SHADOW'::text;
    return;
  end if;

  return query
  select
    false,
    'NOOP'::text,
    false,
    'INVALID_TRANSITION'::text;
end;
$$;

create or replace function public.enforce_model_promotion_stage_transition_v1()
returns trigger
language plpgsql
as $$
declare
  v_decision record;
begin
  if old.promotion_stage is not distinct from new.promotion_stage then
    return new;
  end if;

  select *
  into v_decision
  from public.validate_model_promotion_transition_v1(
    old.promotion_stage,
    new.promotion_stage
  );

  if coalesce(v_decision.allowed, false) is not true then
    raise exception
      'MODEL_PROMOTION_TRANSITION_NOT_ALLOWED:%->%',
      old.promotion_stage,
      new.promotion_stage;
  end if;

  new.promotion_stage_updated_at := now();

  return new;
end;
$$;

drop trigger if exists trg_ai_model_versions_promotion_stage_guard_v1
  on public.ai_model_versions;

create trigger trg_ai_model_versions_promotion_stage_guard_v1
before update of promotion_stage
on public.ai_model_versions
for each row
execute function public.enforce_model_promotion_stage_transition_v1();

comment on column public.ai_model_versions.promotion_stage is
  'Canonical model lifecycle stage. Legacy status is preserved for backward compatibility.';

comment on table public.model_promotion_events is
  'Audit log for model promotion, demotion, degradation, and disable decisions.';
