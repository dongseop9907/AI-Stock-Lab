create table if not exists public.paper_trade_evaluations (
  id uuid primary key default gen_random_uuid(),

  trade_id uuid not null
    references public.paper_trade_history(id)
    on delete cascade,

  evaluation_version text not null,

  evaluation_stage text not null
    check (
      evaluation_stage in (
        'DAY_1',
        'DAY_5',
        'DAY_20'
      )
    ),

  verdict text not null
    check (
      verdict in (
        'PENDING',
        'PROTECTED_CAPITAL',
        'EARLY_EXIT',
        'MIXED',
        'NEUTRAL'
      )
    ),

  quality_score numeric(8, 6) not null
    check (
      quality_score >= -1
      and quality_score <= 1
    ),

  reason text not null,
  metrics jsonb not null,

  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (
    trade_id,
    evaluation_version
  )
);

create index if not exists idx_trade_evaluations_trade
  on public.paper_trade_evaluations(
    trade_id,
    evaluated_at desc
  );

create index if not exists idx_trade_evaluations_verdict
  on public.paper_trade_evaluations(
    verdict,
    evaluated_at desc
  );

alter table public.paper_trade_evaluations
  enable row level security;