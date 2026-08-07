create table if not exists public.market_regime_forward_batches (
  id uuid primary key default gen_random_uuid(),

  automation_run_id text not null unique,

  quality_gate_observation_id uuid
    references public.market_data_quality_gate_observations(id)
    on delete set null,

  comparison_id uuid
    references public.market_regime_shadow_comparisons(id)
    on delete set null,

  market_date date,

  quality_gate_status text,
  quality_gate_usable boolean,

  comparison_eligible boolean,
  agreement_state text,

  v6_would_block boolean,
  v7_would_block boolean,
  v7_policy text,

  status text not null default 'OPEN',

  metadata jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_regime_forward_batches_status_check
    check (
      status in (
        'OPEN',
        'READY',
        'INELIGIBLE',
        'NO_FRESH_SIGNAL',
        'SIGNALS_BOUND',
        'OUTCOMES_LINKED'
      )
    ),

  constraint market_regime_forward_batches_production_check
    check (
      production_applied = false
    )
);

create table if not exists public.market_regime_forward_signal_events (
  id uuid primary key default gen_random_uuid(),

  batch_id uuid not null
    references public.market_regime_forward_batches(id)
    on delete cascade,

  automation_run_id text not null,

  signal_id uuid not null
    references public.ai_entry_signals(id)
    on delete cascade,

  shadow_track_id uuid
    references public.shadow_signal_tracks(id)
    on delete set null,

  stock_code text not null,

  signal_status text not null,
  signal_score numeric,

  signal_observed_at timestamptz not null,
  signal_market_date date not null,

  reference_price numeric,
  signal_created_at timestamptz not null,

  metadata jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_regime_forward_signal_events_run_signal_unique
    unique (
      automation_run_id,
      signal_id
    ),

  constraint market_regime_forward_signal_events_status_check
    check (
      signal_status in (
        'GENERATED',
        'ORDER_CREATED'
      )
    ),

  constraint market_regime_forward_signal_events_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_regime_forward_batches_created_at
on public.market_regime_forward_batches (
  created_at desc
);

create index if not exists
  idx_market_regime_forward_batches_comparison
on public.market_regime_forward_batches (
  comparison_id,
  created_at desc
);

create index if not exists
  idx_market_regime_forward_signal_events_batch
on public.market_regime_forward_signal_events (
  batch_id,
  created_at
);

create index if not exists
  idx_market_regime_forward_signal_events_signal
on public.market_regime_forward_signal_events (
  signal_id
);

create index if not exists
  idx_market_regime_forward_signal_events_track
on public.market_regime_forward_signal_events (
  shadow_track_id
);

alter table public.market_regime_shadow_outcomes
  add column if not exists batch_id uuid
    references public.market_regime_forward_batches(id)
    on delete set null;

alter table public.market_regime_shadow_outcomes
  add column if not exists forward_signal_event_id uuid
    references public.market_regime_forward_signal_events(id)
    on delete set null;

alter table public.market_regime_shadow_outcomes
  add column if not exists automation_run_id text;

alter table public.market_regime_shadow_outcomes
  drop constraint if exists
    market_regime_shadow_outcomes_unique_stock_per_comparison;

create unique index if not exists
  uq_market_regime_shadow_outcomes_comparison_track
on public.market_regime_shadow_outcomes (
  comparison_id,
  signal_track_id
);

create unique index if not exists
  uq_market_regime_shadow_outcomes_forward_event
on public.market_regime_shadow_outcomes (
  forward_signal_event_id
)
where forward_signal_event_id is not null;

create index if not exists
  idx_market_regime_shadow_outcomes_batch
on public.market_regime_shadow_outcomes (
  batch_id
);

create index if not exists
  idx_market_regime_shadow_outcomes_automation_run
on public.market_regime_shadow_outcomes (
  automation_run_id
);

comment on table public.market_regime_forward_batches is
'v7.11 immutable automation-run cohort anchor. One automation run maps to the exact quality-gate and comparator state used for forward evidence.';

comment on table public.market_regime_forward_signal_events is
'v7.11 fresh signal events created inside one automation run. Reused historical ai_entry_signals are intentionally excluded.';

comment on column public.market_regime_shadow_outcomes.forward_signal_event_id is
'v7.11 causal forward-event identity. New forward outcomes should be one row per fresh signal event rather than one row per stock per comparison.';

comment on column public.market_regime_shadow_outcomes.automation_run_id is
'Automation run that causally produced the forward signal event. Historical v7.4 rows may remain null.';