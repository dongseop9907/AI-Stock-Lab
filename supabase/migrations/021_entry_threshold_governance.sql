begin;

create table if not exists
  public.entry_signal_settings (
    setting_key text primary key,

    active_threshold numeric
      not null default 0.62
      check (
        active_threshold
        between 0.10 and 0.90
      ),

    previous_threshold numeric,

    applied_recommendation_id uuid
      references
        public.entry_threshold_recommendations(id)
      on delete set null,

    updated_by text
      not null default 'SYSTEM',

    updated_at timestamptz
      not null default now()
  );

insert into
  public.entry_signal_settings (
    setting_key,
    active_threshold,
    previous_threshold,
    updated_by
  )
values (
  'global',
  0.62,
  null,
  'MIGRATION'
)
on conflict (setting_key)
do nothing;

alter table
  public.entry_signal_settings
enable row level security;

revoke all
on public.entry_signal_settings
from anon, authenticated;

grant all
on public.entry_signal_settings
to service_role;


/*
 * 추천 기준점수를 승인하고 실제 설정에 적용한다.
 */
create or replace function
  public.apply_entry_threshold_recommendation(
    p_recommendation_id uuid,
    p_approved_by text
      default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recommendation
    public.entry_threshold_recommendations%rowtype;

  v_setting
    public.entry_signal_settings%rowtype;

  v_approved_by text;
begin
  v_approved_by :=
    coalesce(
      nullif(
        trim(p_approved_by),
        ''
      ),
      'DASHBOARD'
    );

  select *
  into v_recommendation
  from
    public.entry_threshold_recommendations
  where id =
    p_recommendation_id
  for update;

  if not found then
    raise exception
      'ENTRY_THRESHOLD_RECOMMENDATION_NOT_FOUND';
  end if;

  if
    v_recommendation.status <>
    'RECOMMENDED'
  then
    raise exception
      'RECOMMENDATION_NOT_APPLICABLE: %',
      v_recommendation.status;
  end if;

  if
    v_recommendation.recommended_threshold
    is null
  then
    raise exception
      'RECOMMENDED_THRESHOLD_IS_NULL';
  end if;

  if
    v_recommendation.sample_count < 30
  then
    raise exception
      'INSUFFICIENT_SAMPLE_COUNT: %',
      v_recommendation.sample_count;
  end if;

  select *
  into v_setting
  from
    public.entry_signal_settings
  where setting_key = 'global'
  for update;

  if not found then
    insert into
      public.entry_signal_settings (
        setting_key,
        active_threshold,
        previous_threshold,
        updated_by
      )
    values (
      'global',
      0.62,
      null,
      'SYSTEM'
    )
    returning *
    into v_setting;
  end if;

  update
    public.entry_signal_settings
  set
    previous_threshold =
      active_threshold,

    active_threshold =
      v_recommendation
        .recommended_threshold,

    applied_recommendation_id =
      v_recommendation.id,

    updated_by =
      v_approved_by,

    updated_at =
      now()
  where setting_key =
    'global';

  update
    public.entry_threshold_recommendations
  set
    status =
      'APPLIED',

    approved_at =
      coalesce(
        approved_at,
        now()
      ),

    approved_by =
      v_approved_by,

    applied_at =
      now(),

    updated_at =
      now()
  where id =
    v_recommendation.id;

  return jsonb_build_object(
    'ok',
    true,

    'recommendationId',
    v_recommendation.id,

    'previousThreshold',
    v_setting.active_threshold,

    'activeThreshold',
    v_recommendation
      .recommended_threshold,

    'approvedBy',
    v_approved_by
  );
end;
$$;


/*
 * 사용자가 추천을 거절한다.
 */
create or replace function
  public.reject_entry_threshold_recommendation(
    p_recommendation_id uuid,
    p_rejected_by text
      default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recommendation
    public.entry_threshold_recommendations%rowtype;

  v_rejected_by text;
begin
  v_rejected_by :=
    coalesce(
      nullif(
        trim(p_rejected_by),
        ''
      ),
      'DASHBOARD'
    );

  select *
  into v_recommendation
  from
    public.entry_threshold_recommendations
  where id =
    p_recommendation_id
  for update;

  if not found then
    raise exception
      'ENTRY_THRESHOLD_RECOMMENDATION_NOT_FOUND';
  end if;

  if
    v_recommendation.status <>
    'RECOMMENDED'
  then
    raise exception
      'RECOMMENDATION_NOT_REJECTABLE: %',
      v_recommendation.status;
  end if;

  update
    public.entry_threshold_recommendations
  set
    status =
      'REJECTED',

    approved_by =
      v_rejected_by,

    updated_at =
      now()
  where id =
    v_recommendation.id;

  return jsonb_build_object(
    'ok',
    true,

    'recommendationId',
    v_recommendation.id,

    'status',
    'REJECTED',

    'rejectedBy',
    v_rejected_by
  );
end;
$$;

revoke all
on function
  public.apply_entry_threshold_recommendation(
    uuid,
    text
  )
from public, anon, authenticated;

grant execute
on function
  public.apply_entry_threshold_recommendation(
    uuid,
    text
  )
to service_role;

revoke all
on function
  public.reject_entry_threshold_recommendation(
    uuid,
    text
  )
from public, anon, authenticated;

grant execute
on function
  public.reject_entry_threshold_recommendation(
    uuid,
    text
  )
to service_role;

notify pgrst, 'reload schema';

commit;