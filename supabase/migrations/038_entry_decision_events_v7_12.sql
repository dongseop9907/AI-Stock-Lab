create table if not exists public.entry_decision_events (
  id uuid primary key default gen_random_uuid(),

  automation_run_id text not null,

  batch_id uuid not null
    references public.market_regime_forward_batches(id)
    on delete cascade,

  signal_id uuid not null
    references public.ai_entry_signals(id)
    on delete cascade,

  entry_model_id uuid,

  stock_code text not null,

  decision_at timestamptz not null,
  decision_market_date date not null,
  decision_before_market_open boolean not null,

  signal_status text not null,
  qualifies boolean not null,
  forward_eligible boolean not null default false,

  score numeric,
  threshold numeric,

  snapshot_observed_at timestamptz,

  reference_price numeric,
  recommended_stop_price numeric,
  recommended_quantity integer,

  prediction_id uuid,
  prediction_generated_at timestamptz,
  prediction_date date,
  prediction_model_name text,
  prediction_model_version text,
  prediction_score numeric,
  prediction_confidence numeric,

  features jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,

  decision_fingerprint text not null,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint entry_decision_events_run_stock_unique
    unique (
      automation_run_id,
      stock_code
    ),

  constraint entry_decision_events_fingerprint_unique
    unique (
      decision_fingerprint
    ),

  constraint entry_decision_events_status_check
    check (
      signal_status in (
        'GENERATED',
        'ORDER_CREATED',
        'SKIPPED',
        'FAILED'
      )
    ),

  constraint entry_decision_events_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_entry_decision_events_created_at
on public.entry_decision_events (
  created_at desc
);

create index if not exists
  idx_entry_decision_events_run
on public.entry_decision_events (
  automation_run_id,
  created_at
);

create index if not exists
  idx_entry_decision_events_stock
on public.entry_decision_events (
  stock_code,
  decision_at desc
);

create index if not exists
  idx_entry_decision_events_prediction
on public.entry_decision_events (
  prediction_id
);

alter table public.market_regime_forward_signal_events
  add column if not exists decision_event_id uuid
    references public.entry_decision_events(id)
    on delete set null;

alter table public.market_regime_forward_signal_events
  add column if not exists decision_at timestamptz;

alter table public.market_regime_forward_signal_events
  add column if not exists decision_market_date date;

alter table public.market_regime_forward_signal_events
  add column if not exists decision_before_market_open boolean;

alter table public.market_regime_forward_signal_events
  add column if not exists prediction_id uuid;

create unique index if not exists
  uq_market_regime_forward_signal_events_decision
on public.market_regime_forward_signal_events (
  decision_event_id
);

create index if not exists
  idx_market_regime_forward_signal_events_decision_at
on public.market_regime_forward_signal_events (
  decision_at
);

alter table public.market_regime_shadow_outcomes
  add column if not exists decision_event_id uuid
    references public.entry_decision_events(id)
    on delete set null;

alter table public.market_regime_shadow_outcomes
  add column if not exists decision_at timestamptz;

alter table public.market_regime_shadow_outcomes
  add column if not exists decision_market_date date;

alter table public.market_regime_shadow_outcomes
  add column if not exists decision_before_market_open boolean;

drop index if exists
  public.uq_market_regime_shadow_outcomes_comparison_track;

drop index if exists
  public.uq_market_regime_shadow_outcomes_forward_event;

create unique index if not exists
  uq_market_regime_shadow_outcomes_forward_event
on public.market_regime_shadow_outcomes (
  forward_signal_event_id
);

create unique index if not exists
  uq_market_regime_shadow_outcomes_decision_event
on public.market_regime_shadow_outcomes (
  decision_event_id
);

create unique index if not exists
  uq_market_regime_shadow_outcomes_legacy_comparison_track
on public.market_regime_shadow_outcomes (
  comparison_id,
  signal_track_id
)
where forward_signal_event_id is null
  and decision_event_id is null;

create index if not exists
  idx_market_regime_shadow_outcomes_decision_at
on public.market_regime_shadow_outcomes (
  decision_at
);

alter table public.market_regime_forward_batches
  drop constraint if exists
    market_regime_forward_batches_status_check;

alter table public.market_regime_forward_batches
  add constraint market_regime_forward_batches_status_check
    check (
      status in (
        'OPEN',
        'READY',
        'INELIGIBLE',
        'NO_FRESH_SIGNAL',
        'NO_FORWARD_ELIGIBLE_DECISION',
        'DECISIONS_RECORDED',
        'SIGNALS_BOUND',
        'OUTCOMES_LINKED'
      )
    );

comment on table public.entry_decision_events is
'v7.12 immutable entry-decision events. A new automation-run decision remains a distinct event even when ai_entry_signals reuses/updates an older signal row.';

comment on column public.entry_decision_events.forward_eligible is
'True only when the decision qualified for forward regime evidence (GENERATED or ORDER_CREATED with qualifies=true). SKIPPED/FAILED decisions are still retained for audit.';

comment on column public.entry_decision_events.decision_before_market_open is
'Asia/Seoul decision time is strictly before 09:00. Forward evaluation may use the same trading-date open only in this case; otherwise it must start at a later trading-day open.';

comment on column public.market_regime_forward_signal_events.decision_event_id is
'v7.12 immutable decision identity. New forward signal events are created from decision events rather than requiring a newly inserted ai_entry_signals row.';

comment on column public.market_regime_shadow_outcomes.decision_at is
'v7.12 causal timestamp used by the forward evaluator to prevent entry-open timestamps that predate the actual decision.';