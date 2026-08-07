create table if not exists public.market_regime_shadow_outcomes (
  id uuid primary key default gen_random_uuid(),

  comparison_id uuid not null
    references public.market_regime_shadow_comparisons(id)
    on delete cascade,

  signal_track_id uuid not null
    references public.shadow_signal_tracks(id)
    on delete cascade,

  stock_code text not null,

  market_date date not null,
  signal_observed_at timestamptz not null,

  signal_status text,
  signal_score numeric,

  reference_price numeric,

  agreement_state text not null,

  v6_would_block boolean not null,
  v7_would_block boolean not null,

  entry_trading_date date,
  entry_open_price numeric,

  close_1d_date date,
  close_1d_price numeric,
  return_1d numeric,

  close_3d_date date,
  close_3d_price numeric,
  return_3d numeric,

  close_5d_date date,
  close_5d_price numeric,
  return_5d numeric,

  max_high_5d numeric,
  min_low_5d numeric,
  max_return_5d numeric,
  min_return_5d numeric,

  v6_decision_score_5d numeric,
  v7_decision_score_5d numeric,

  disagreement_winner text,

  evaluation_status text not null default 'PENDING',

  evaluated_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_regime_shadow_outcomes_unique_stock_per_comparison
    unique (
      comparison_id,
      stock_code
    ),

  constraint market_regime_shadow_outcomes_evaluation_status_check
    check (
      evaluation_status in (
        'PENDING',
        'PARTIAL',
        'COMPLETED',
        'INVALID'
      )
    ),

  constraint market_regime_shadow_outcomes_winner_check
    check (
      disagreement_winner is null
      or disagreement_winner in (
        'V6',
        'V7',
        'TIE',
        'SAME_DECISION'
      )
    )
);

create index if not exists
  idx_market_regime_shadow_outcomes_status
on public.market_regime_shadow_outcomes (
  evaluation_status,
  market_date
);

create index if not exists
  idx_market_regime_shadow_outcomes_comparison
on public.market_regime_shadow_outcomes (
  comparison_id
);

create index if not exists
  idx_market_regime_shadow_outcomes_stock_date
on public.market_regime_shadow_outcomes (
  stock_code,
  market_date desc
);

comment on table public.market_regime_shadow_outcomes is
'Forward outcome attribution for v6/v7 market-regime shadow decisions. Returns are measured from next trading-day open to future closes and do not change production orders.';

comment on column public.market_regime_shadow_outcomes.v6_decision_score_5d is
'Positive means the v6 block/allow decision aligned with the 5-trading-day direction. block => -return_5d, allow => return_5d.';

comment on column public.market_regime_shadow_outcomes.v7_decision_score_5d is
'Positive means the v7 block/allow decision aligned with the 5-trading-day direction. block => -return_5d, allow => return_5d.';