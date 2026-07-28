create table if not exists public.ai_model_versions (
  id uuid primary key default gen_random_uuid(),

  model_name text not null,
  model_version text not null,

  purpose text not null
    check (
      purpose in (
        'STOCK_SELECTION',
        'ENTRY_TIMING',
        'STOP_LOSS',
        'TRAILING_STOP',
        'TEST'
      )
    ),

  status text not null default 'CANDIDATE'
    check (
      status in (
        'CANDIDATE',
        'APPROVED',
        'REJECTED',
        'RETIRED'
      )
    ),

  training_trade_count integer not null default 0
    check (training_trade_count >= 0),

  training_data_from timestamptz,
  training_data_to timestamptz,

  metrics jsonb not null default '{}'::jsonb,

  artifact_uri text,
  description text,

  created_at timestamptz not null default now(),
  evaluated_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,

  unique (
    model_name,
    model_version,
    purpose
  )
);

create unique index if not exists
  idx_one_approved_model_per_purpose
on public.ai_model_versions(purpose)
where status = 'APPROVED';


create table if not exists public.ai_model_validation_runs (
  id uuid primary key default gen_random_uuid(),

  candidate_model_id uuid not null
    references public.ai_model_versions(id)
    on delete cascade,

  incumbent_model_id uuid
    references public.ai_model_versions(id)
    on delete set null,

  validation_rule_version text not null,

  passed boolean not null,

  candidate_score numeric(12, 8) not null,
  incumbent_score numeric(12, 8),

  absolute_rules_passed boolean not null,
  comparison_rules_passed boolean not null,

  rules jsonb not null,
  metrics_snapshot jsonb not null,

  failure_reasons jsonb not null
    default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_model_validation_candidate
  on public.ai_model_validation_runs(
    candidate_model_id,
    created_at desc
  );

create index if not exists idx_model_validation_created
  on public.ai_model_validation_runs(
    created_at desc
  );

alter table public.ai_model_versions
  enable row level security;

alter table public.ai_model_validation_runs
  enable row level security;


create or replace function public.promote_ai_model(
  p_model_id uuid,
  p_validation_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model public.ai_model_versions%rowtype;
  v_validation public.ai_model_validation_runs%rowtype;
begin
  select *
  into v_model
  from public.ai_model_versions
  where id = p_model_id
  for update;

  if not found then
    raise exception 'MODEL_NOT_FOUND';
  end if;

  if v_model.status <> 'CANDIDATE' then
    raise exception 'MODEL_NOT_CANDIDATE';
  end if;

  select *
  into v_validation
  from public.ai_model_validation_runs
  where id = p_validation_run_id
    and candidate_model_id = p_model_id
    and passed = true
  for update;

  if not found then
    raise exception 'PASSED_VALIDATION_NOT_FOUND';
  end if;

  /*
   * 같은 목적의 기존 승인 모델은 자동 은퇴 처리한다.
   */
  update public.ai_model_versions
  set
    status = 'RETIRED',
    evaluated_at = now()
  where purpose = v_model.purpose
    and status = 'APPROVED'
    and id <> v_model.id;

  update public.ai_model_versions
  set
    status = 'APPROVED',
    evaluated_at = now(),
    approved_at = now(),
    rejected_at = null
  where id = v_model.id;

  return jsonb_build_object(
    'modelId', v_model.id,
    'modelName', v_model.model_name,
    'modelVersion', v_model.model_version,
    'purpose', v_model.purpose,
    'status', 'APPROVED',
    'validationRunId', v_validation.id,
    'approvedAt', now()
  );
end;
$$;

revoke all
on function public.promote_ai_model(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.promote_ai_model(uuid, uuid)
to service_role;