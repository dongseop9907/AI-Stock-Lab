begin;

create table if not exists public.ai_entry_signals (
  id uuid primary key default gen_random_uuid(),

  model_id uuid not null
    references public.ai_model_versions(id)
    on delete cascade,

  stock_code text not null,
  observed_at timestamptz not null,

  status text not null default 'GENERATED'
    check (
      status in (
        'GENERATED',
        'ORDER_CREATED',
        'SKIPPED',
        'FAILED'
      )
    ),

  score numeric(8, 6) not null
    check (
      score >= 0
      and score <= 1
    ),

  recommended_entry_price numeric(18, 4) not null
    check (recommended_entry_price > 0),

  recommended_stop_price numeric(18, 4) not null
    check (
      recommended_stop_price > 0
      and recommended_stop_price
        < recommended_entry_price
    ),

  recommended_quantity integer not null default 1
    check (recommended_quantity > 0),

  features jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,

  order_id uuid
    references public.paper_order_requests(id)
    on delete set null,

  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (
    model_id,
    stock_code,
    observed_at
  )
);

create index if not exists idx_entry_signals_model
  on public.ai_entry_signals(
    model_id,
    observed_at desc
  );

create index if not exists idx_entry_signals_stock
  on public.ai_entry_signals(
    stock_code,
    observed_at desc
  );

create index if not exists idx_entry_signals_status
  on public.ai_entry_signals(
    status,
    created_at desc
  );

alter table public.ai_entry_signals
  enable row level security;

notify pgrst, 'reload schema';

commit;