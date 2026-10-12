create table if not exists public.market_regime_governance_reviews (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),

  candidate_policy text not null,

  evidence_version text not null,

  evidence_stage text not null,

  recommendation text not null,

  completed_sample integer not null default 0,
  disagreement_sample integer not null default 0,

  v6_correct_rate numeric,
  v7_correct_rate numeric,

  v6_average_score numeric,
  v7_average_score numeric,

  v7_head_to_head_win_rate numeric,

  criteria jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,

  evidence_fingerprint text not null unique,

  production_applied boolean not null default false,
  automatic_promotion boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_regime_governance_reviews_recommendation_check
    check (
      recommendation in (
        'WAIT_FOR_FORWARD_DATA',
        'KEEP_SHADOW_INSUFFICIENT_EVIDENCE',
        'KEEP_SHADOW_MIXED_EVIDENCE',
        'REWORK_V7_CANDIDATE',
        'PAPER_GATE_REVIEW_ELIGIBLE'
      )
    ),

  constraint market_regime_governance_reviews_production_check
    check (
      production_applied = false
    ),

  constraint market_regime_governance_reviews_auto_promotion_check
    check (
      automatic_promotion = false
    )
);

create index if not exists
  idx_market_regime_governance_reviews_observed_at
on public.market_regime_governance_reviews (
  observed_at desc
);

create index if not exists
  idx_market_regime_governance_reviews_policy
on public.market_regime_governance_reviews (
  candidate_policy,
  observed_at desc
);

create index if not exists
  idx_market_regime_governance_reviews_recommendation
on public.market_regime_governance_reviews (
  recommendation,
  observed_at desc
);

comment on table public.market_regime_governance_reviews is
'Read-only governance evidence snapshots for market-regime candidates. Recommendations never automatically promote or enable production blocking.';

comment on column public.market_regime_governance_reviews.evidence_fingerprint is
'Deterministic fingerprint used to suppress duplicate governance snapshots when forward evidence has not changed.';