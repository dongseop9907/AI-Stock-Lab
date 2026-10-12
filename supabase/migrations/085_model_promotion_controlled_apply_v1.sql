-- MODEL PROMOTION CONTROLLED APPLY V1
-- Purpose:
--   1) force every promotion_stage change through one audited RPC
--   2) enforce manual approval for live-capable promotions and DEGRADED recovery
--   3) preserve global real trading controls as a separate gate
--   4) never mutate orders / positions

create or replace function public.enforce_model_promotion_stage_transition_v1()
returns trigger
language plpgsql
as $$
declare
  v_controlled text;
  v_manual text;
  v_allowed boolean := false;
  v_manual_required boolean := false;
begin
  if new.promotion_stage is not distinct from old.promotion_stage then
    return new;
  end if;

  v_controlled :=
    current_setting(
      'app.model_promotion_controlled_apply_v1',
      true
    );

  if coalesce(v_controlled, '') <> '1' then
    raise exception
      'MODEL_PROMOTION_DIRECT_STAGE_UPDATE_BLOCKED:%->%',
      old.promotion_stage,
      new.promotion_stage;
  end if;

  v_allowed :=
    (old.promotion_stage = 'EXPERIMENTAL' and new.promotion_stage = 'CANDIDATE')
    or
    (old.promotion_stage = 'CANDIDATE' and new.promotion_stage = 'SHADOW')
    or
    (old.promotion_stage = 'SHADOW' and new.promotion_stage = 'PAPER')
    or
    (old.promotion_stage = 'PAPER' and new.promotion_stage = 'LIMITED_LIVE')
    or
    (old.promotion_stage = 'LIMITED_LIVE' and new.promotion_stage = 'PRODUCTION')
    or
    (
      old.promotion_stage in (
        'EXPERIMENTAL',
        'CANDIDATE',
        'SHADOW',
        'PAPER',
        'LIMITED_LIVE',
        'PRODUCTION'
      )
      and new.promotion_stage = 'DEGRADED'
    )
    or
    (
      old.promotion_stage in (
        'EXPERIMENTAL',
        'CANDIDATE',
        'SHADOW',
        'PAPER',
        'LIMITED_LIVE'
      )
      and new.promotion_stage = 'DISABLED'
    )
    or
    (
      old.promotion_stage = 'DEGRADED'
      and new.promotion_stage = 'SHADOW'
    );

  if not v_allowed then
    raise exception
      'MODEL_PROMOTION_INVALID_TRANSITION:%->%',
      old.promotion_stage,
      new.promotion_stage;
  end if;

  v_manual_required :=
    (
      old.promotion_stage = 'PAPER'
      and new.promotion_stage = 'LIMITED_LIVE'
    )
    or
    (
      old.promotion_stage = 'LIMITED_LIVE'
      and new.promotion_stage = 'PRODUCTION'
    )
    or
    (
      old.promotion_stage = 'DEGRADED'
      and new.promotion_stage = 'SHADOW'
    );

  if v_manual_required then
    v_manual :=
      current_setting(
        'app.model_promotion_manual_approval_v1',
        true
      );

    if coalesce(v_manual, '') <> '1' then
      raise exception
        'MODEL_PROMOTION_MANUAL_APPROVAL_REQUIRED:%->%',
        old.promotion_stage,
        new.promotion_stage;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.apply_model_promotion_transition_v1(
  p_model_id uuid,
  p_to_stage text,
  p_actor text,
  p_reason text,
  p_manual_approval_confirmed boolean default false,
  p_evidence jsonb default '{}'::jsonb
)
returns table (
  event_id uuid,
  model_id uuid,
  from_stage text,
  to_stage text,
  decision text,
  manual_required boolean,
  applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model public.ai_model_versions%rowtype;
  v_from_stage text;
  v_allowed boolean := false;
  v_manual_required boolean := false;
  v_event_id uuid;
begin
  if p_model_id is null then
    raise exception
      'MODEL_PROMOTION_MODEL_ID_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception
      'MODEL_PROMOTION_ACTOR_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception
      'MODEL_PROMOTION_REASON_REQUIRED';
  end if;

  if p_to_stage not in (
    'EXPERIMENTAL',
    'CANDIDATE',
    'SHADOW',
    'PAPER',
    'LIMITED_LIVE',
    'PRODUCTION',
    'DEGRADED',
    'DISABLED'
  ) then
    raise exception
      'MODEL_PROMOTION_TARGET_STAGE_INVALID:%',
      p_to_stage;
  end if;

  select *
  into v_model
  from public.ai_model_versions
  where id = p_model_id
  for update;

  if not found then
    raise exception
      'MODEL_PROMOTION_MODEL_NOT_FOUND:%',
      p_model_id;
  end if;

  v_from_stage :=
    v_model.promotion_stage;

  if v_from_stage = 'DISABLED' then
    v_allowed := false;
  else
    v_allowed :=
      (v_from_stage = 'EXPERIMENTAL' and p_to_stage = 'CANDIDATE')
      or
      (v_from_stage = 'CANDIDATE' and p_to_stage = 'SHADOW')
      or
      (v_from_stage = 'SHADOW' and p_to_stage = 'PAPER')
      or
      (v_from_stage = 'PAPER' and p_to_stage = 'LIMITED_LIVE')
      or
      (v_from_stage = 'LIMITED_LIVE' and p_to_stage = 'PRODUCTION')
      or
      (
        v_from_stage in (
          'EXPERIMENTAL',
          'CANDIDATE',
          'SHADOW',
          'PAPER',
          'LIMITED_LIVE',
          'PRODUCTION'
        )
        and p_to_stage = 'DEGRADED'
      )
      or
      (
        v_from_stage in (
          'EXPERIMENTAL',
          'CANDIDATE',
          'SHADOW',
          'PAPER',
          'LIMITED_LIVE'
        )
        and p_to_stage = 'DISABLED'
      )
      or
      (
        v_from_stage = 'DEGRADED'
        and p_to_stage = 'SHADOW'
      );
  end if;

  v_manual_required :=
    (
      v_from_stage = 'PAPER'
      and p_to_stage = 'LIMITED_LIVE'
    )
    or
    (
      v_from_stage = 'LIMITED_LIVE'
      and p_to_stage = 'PRODUCTION'
    )
    or
    (
      v_from_stage = 'DEGRADED'
      and p_to_stage = 'SHADOW'
    );

  if not v_allowed then
    insert into public.model_promotion_events (
      model_id,
      from_stage,
      to_stage,
      transition_kind,
      decision,
      requires_manual_approval,
      manual_approval_confirmed,
      actor,
      reason,
      evidence
    )
    values (
      p_model_id,
      v_from_stage,
      p_to_stage,
      'CONTROLLED_APPLY_V1',
      'BLOCKED',
      v_manual_required,
      coalesce(p_manual_approval_confirmed, false),
      p_actor,
      'INVALID_TRANSITION:' || p_reason,
      coalesce(p_evidence, '{}'::jsonb)
    )
    returning id
    into v_event_id;

    return query
    select
      v_event_id,
      p_model_id,
      v_from_stage,
      p_to_stage,
      'BLOCKED'::text,
      v_manual_required,
      false;

    return;
  end if;

  if
    v_manual_required
    and not coalesce(
      p_manual_approval_confirmed,
      false
    )
  then
    insert into public.model_promotion_events (
      model_id,
      from_stage,
      to_stage,
      transition_kind,
      decision,
      requires_manual_approval,
      manual_approval_confirmed,
      actor,
      reason,
      evidence
    )
    values (
      p_model_id,
      v_from_stage,
      p_to_stage,
      'CONTROLLED_APPLY_V1',
      'BLOCKED',
      true,
      false,
      p_actor,
      'MANUAL_APPROVAL_REQUIRED:' || p_reason,
      coalesce(p_evidence, '{}'::jsonb)
    )
    returning id
    into v_event_id;

    return query
    select
      v_event_id,
      p_model_id,
      v_from_stage,
      p_to_stage,
      'BLOCKED'::text,
      true,
      false;

    return;
  end if;

  perform set_config(
    'app.model_promotion_controlled_apply_v1',
    '1',
    true
  );

  perform set_config(
    'app.model_promotion_manual_approval_v1',
    case
      when coalesce(
        p_manual_approval_confirmed,
        false
      )
      then '1'
      else '0'
    end,
    true
  );

  update public.ai_model_versions
  set
    promotion_stage =
      p_to_stage,
    promotion_stage_updated_at =
      now(),
    promotion_stage_reason =
      p_reason
  where id =
    p_model_id;

  insert into public.model_promotion_events (
    model_id,
    from_stage,
    to_stage,
    transition_kind,
    decision,
    requires_manual_approval,
    manual_approval_confirmed,
    actor,
    reason,
    evidence
  )
  values (
    p_model_id,
    v_from_stage,
    p_to_stage,
    'CONTROLLED_APPLY_V1',
    'APPLIED',
    v_manual_required,
    coalesce(
      p_manual_approval_confirmed,
      false
    ),
    p_actor,
    p_reason,
    coalesce(
      p_evidence,
      '{}'::jsonb
    )
  )
  returning id
  into v_event_id;

  return query
  select
    v_event_id,
    p_model_id,
    v_from_stage,
    p_to_stage,
    'APPLIED'::text,
    v_manual_required,
    true;
end;
$$;

revoke all on function public.apply_model_promotion_transition_v1(
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb
) from public;

revoke all on function public.apply_model_promotion_transition_v1(
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb
) from anon;

revoke all on function public.apply_model_promotion_transition_v1(
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb
) from authenticated;

grant execute on function public.apply_model_promotion_transition_v1(
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb
) to service_role;

comment on function public.apply_model_promotion_transition_v1(
  uuid,
  text,
  text,
  text,
  boolean,
  jsonb
)
is
'MODEL_PROMOTION_CONTROLLED_APPLY_V1: audited promotion transition RPC. Does not enable real trading; global trading controls remain authoritative.';
