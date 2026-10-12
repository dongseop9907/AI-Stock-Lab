-- MODEL SHADOW OUTCOME PIPELINE BINDING V1
-- Capture binding via DB trigger.
-- No historical backfill.
-- Only post-promotion SHADOW signals are inserted.

create or replace function public.capture_model_shadow_signal_outcome_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_stage_updated_at timestamptz;
begin
  select
    promotion_stage,
    promotion_stage_updated_at
  into
    v_stage,
    v_stage_updated_at
  from public.ai_model_versions
  where id = new.model_id;

  if v_stage is distinct from 'SHADOW' then
    return new;
  end if;

  if v_stage_updated_at is null then
    return new;
  end if;

  if new.created_at < v_stage_updated_at then
    return new;
  end if;

  insert into public.model_shadow_signal_outcomes (
    signal_id,
    model_id,
    stock_code,
    signal_observed_at,
    captured_at,
    promotion_stage_at_capture,
    promotion_stage_updated_at_at_capture,
    recommended_entry_price,
    recommended_stop_price,
    evaluation_status,
    evidence,
    source_version
  )
  values (
    new.id,
    new.model_id,
    new.stock_code,
    new.observed_at,
    new.created_at,
    'SHADOW',
    v_stage_updated_at,
    new.recommended_entry_price,
    new.recommended_stop_price,
    'PENDING',
    jsonb_build_object(
      'captureSource',
      'AI_ENTRY_SIGNALS_AFTER_INSERT_TRIGGER',
      'capturedAfterShadowPromotion',
      true
    ),
    'MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1'
  )
  on conflict (signal_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_capture_model_shadow_signal_outcome_v1
  on public.ai_entry_signals;

create trigger trg_capture_model_shadow_signal_outcome_v1
after insert on public.ai_entry_signals
for each row
execute function public.capture_model_shadow_signal_outcome_v1();

comment on function public.capture_model_shadow_signal_outcome_v1() is
'Creates canonical Shadow evidence only for ai_entry_signals inserted while the linked model is already in SHADOW. No historical backfill.';
