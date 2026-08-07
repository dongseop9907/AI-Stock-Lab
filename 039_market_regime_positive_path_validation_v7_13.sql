alter table public.market_regime_forward_batches
  add column if not exists is_validation boolean not null default false;

alter table public.entry_decision_events
  add column if not exists is_validation boolean not null default false;

alter table public.market_regime_forward_signal_events
  add column if not exists is_validation boolean not null default false;

alter table public.market_regime_shadow_outcomes
  add column if not exists is_validation boolean not null default false;

create index if not exists
  idx_market_regime_forward_batches_validation
on public.market_regime_forward_batches (
  is_validation,
  created_at desc
);

create index if not exists
  idx_entry_decision_events_validation
on public.entry_decision_events (
  is_validation,
  created_at desc
);

create index if not exists
  idx_market_regime_forward_signal_events_validation
on public.market_regime_forward_signal_events (
  is_validation,
  created_at desc
);

create index if not exists
  idx_market_regime_shadow_outcomes_validation
on public.market_regime_shadow_outcomes (
  is_validation,
  evaluation_status,
  created_at desc
);

create table if not exists public.market_regime_positive_path_validation_runs (
  id uuid primary key default gen_random_uuid(),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  status text not null default 'RUNNING',

  stock_code text,

  base_trading_date date,
  next_trading_date date,

  reused_signal_id uuid,
  reused_shadow_track_id uuid,

  before_open_case jsonb not null default '{}'::jsonb,
  after_open_case jsonb not null default '{}'::jsonb,

  assertions jsonb not null default '{}'::jsonb,

  cleanup_attempted boolean not null default false,
  cleanup_succeeded boolean not null default false,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_regime_positive_path_validation_runs_status_check
    check (
      status in (
        'RUNNING',
        'PASS',
        'FAIL',
        'ERROR'
      )
    ),

  constraint market_regime_positive_path_validation_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_regime_positive_path_validation_runs_started
on public.market_regime_positive_path_validation_runs (
  started_at desc
);

create index if not exists
  idx_market_regime_positive_path_validation_runs_status
on public.market_regime_positive_path_validation_runs (
  status,
  started_at desc
);

comment on column public.market_regime_forward_batches.is_validation is
'True only for synthetic v7.13+ validation-harness cohorts. Production/forward evidence readers must ignore these rows.';

comment on column public.market_regime_shadow_outcomes.is_validation is
'True only for synthetic validation outcomes. Governance/evidence aggregation must exclude these rows.';

comment on table public.market_regime_positive_path_validation_runs is
'Audit log for v7.13 positive-path validation. The harness uses synthetic decision events against real historical daily bars, verifies causal entry timing, then removes synthetic core-table artifacts.';
