-- MODEL SHADOW OUTCOME CANONICAL STORAGE V1
-- No historical backfill is performed.
-- Only signals captured while the model is already in SHADOW are eligible.

create table if not exists public.model_shadow_signal_outcomes (
  id uuid primary key default gen_random_uuid(),

  signal_id uuid not null unique
    references public.ai_entry_signals(id)
    on delete cascade,

  model_id uuid not null
    references public.ai_model_versions(id)
    on delete restrict,

  stock_code text not null,

  signal_observed_at timestamptz,
  captured_at timestamptz not null default now(),

  promotion_stage_at_capture text not null,
  promotion_stage_updated_at_at_capture timestamptz not null,

  recommended_entry_price numeric,
  recommended_stop_price numeric,

  evaluation_status text not null default 'PENDING',

  entry_open_price numeric,

  return_1d numeric,
  return_3d numeric,
  return_5d numeric,

  max_return_1d numeric,
  max_return_3d numeric,
  max_return_5d numeric,

  min_return_1d numeric,
  min_return_3d numeric,
  min_return_5d numeric,

  evaluated_1d_at timestamptz,
  evaluated_3d_at timestamptz,
  evaluated_5d_at timestamptz,
  evaluated_at timestamptz,

  expires_at timestamptz,

  evidence jsonb not null default '{}'::jsonb,
  source_version text not null default 'MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint model_shadow_signal_outcomes_stage_ck
    check (promotion_stage_at_capture = 'SHADOW'),

  constraint model_shadow_signal_outcomes_status_ck
    check (
      evaluation_status in (
        'PENDING',
        'PARTIAL',
        'COMPLETED',
        'EXPIRED',
        'INVALID'
      )
    )
);

create index if not exists idx_model_shadow_signal_outcomes_model_created
  on public.model_shadow_signal_outcomes(
    model_id,
    created_at desc
  );

create index if not exists idx_model_shadow_signal_outcomes_model_status
  on public.model_shadow_signal_outcomes(
    model_id,
    evaluation_status,
    created_at desc
  );

create index if not exists idx_model_shadow_signal_outcomes_stock_captured
  on public.model_shadow_signal_outcomes(
    stock_code,
    captured_at desc
  );

create or replace function public.touch_model_shadow_signal_outcomes_updated_at_v1()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_model_shadow_signal_outcomes_updated_at_v1
  on public.model_shadow_signal_outcomes;

create trigger trg_model_shadow_signal_outcomes_updated_at_v1
before update on public.model_shadow_signal_outcomes
for each row
execute function public.touch_model_shadow_signal_outcomes_updated_at_v1();

alter table public.model_shadow_signal_outcomes
  enable row level security;

revoke all on table public.model_shadow_signal_outcomes
  from anon;

revoke all on table public.model_shadow_signal_outcomes
  from authenticated;

grant all on table public.model_shadow_signal_outcomes
  to service_role;

comment on table public.model_shadow_signal_outcomes is
'Canonical post-promotion SHADOW evidence only. No historical backfill. Rows must be captured while the linked model is in SHADOW.';
