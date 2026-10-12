create table if not exists public.market_regime_shadow_comparisons (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),

  v6_market_date date,
  v7_market_date date,

  comparison_eligible boolean not null default false,

  agreement_state text not null,

  v6_regime text not null,
  v6_would_block boolean not null default false,
  v6_breadth_20 numeric,
  v6_avg_return_20 numeric,
  v6_source text,
  v6_latest_snapshot_observed_at timestamptz,

  v7_policy text not null,
  v7_would_block boolean not null default false,
  v7_inputs_complete boolean not null default false,

  v7_breadth_20 numeric,
  v7_breadth_60 numeric,

  v7_kospi_return_20 numeric,
  v7_kospi_return_60 numeric,

  v7_kosdaq_return_20 numeric,
  v7_kosdaq_return_60 numeric,

  v7_average_volatility_20 numeric,

  v7_kospi_drawdown_60 numeric,
  v7_kosdaq_drawdown_60 numeric,

  production_applied boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint market_regime_shadow_comparisons_v6_regime_check
    check (
      v6_regime in (
        'BULL',
        'NEUTRAL',
        'BEAR',
        'UNKNOWN'
      )
    ),

  constraint market_regime_shadow_comparisons_agreement_check
    check (
      agreement_state in (
        'BOTH_BLOCK',
        'BOTH_ALLOW',
        'V6_BLOCK_V7_ALLOW',
        'V6_ALLOW_V7_BLOCK',
        'NOT_COMPARABLE_DATE_MISMATCH',
        'NOT_COMPARABLE_MISSING_INPUT'
      )
    ),

  constraint market_regime_shadow_comparisons_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_regime_shadow_comparisons_observed_at
on public.market_regime_shadow_comparisons (
  observed_at desc
);

create index if not exists
  idx_market_regime_shadow_comparisons_dates
on public.market_regime_shadow_comparisons (
  v7_market_date desc,
  v6_market_date desc
);

create index if not exists
  idx_market_regime_shadow_comparisons_policy
on public.market_regime_shadow_comparisons (
  v7_policy,
  observed_at desc
);

create index if not exists
  idx_market_regime_shadow_comparisons_agreement
on public.market_regime_shadow_comparisons (
  agreement_state,
  observed_at desc
);

comment on table public.market_regime_shadow_comparisons is
'Forward-shadow comparison between v6 ACTIVE_STOCK_PROXY regime and v7 candidate policy. It must never directly block production orders.';

comment on column public.market_regime_shadow_comparisons.comparison_eligible is
'True only when v6 and v7 inputs are complete and refer to the same market date.';

comment on column public.market_regime_shadow_comparisons.production_applied is
'Hard safety flag. This table is observation-only and must remain false.';