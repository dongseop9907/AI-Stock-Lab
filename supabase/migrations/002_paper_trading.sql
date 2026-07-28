create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null unique,
  initial_equity numeric(18, 2) not null check (initial_equity > 0),
  cash_balance numeric(18, 2) not null check (cash_balance >= 0),
  realized_pnl numeric(18, 2) not null default 0,
  daily_realized_pnl numeric(18, 2) not null default 0,
  trading_mode text not null default 'PAPER'
    check (trading_mode in ('PAPER', 'LIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,
  stock_code text not null
    references public.stocks(stock_code),
  sector text,
  quantity integer not null check (quantity > 0),
  average_price numeric(18, 2) not null check (average_price > 0),
  current_stop_price numeric(18, 2) not null check (current_stop_price > 0),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, stock_code)
);

create table if not exists public.risk_decisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,
  stock_code text not null
    references public.stocks(stock_code),
  action text not null
    check (action in ('BUY', 'UPDATE_STOP', 'SELL')),
  approved boolean not null,
  requested_payload jsonb not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_order_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,
  stock_code text not null
    references public.stocks(stock_code),
  side text not null
    check (side in ('BUY', 'SELL')),
  requested_quantity integer not null
    check (requested_quantity > 0),
  approved_quantity integer not null default 0
    check (approved_quantity >= 0),
  entry_price numeric(18, 2) not null
    check (entry_price > 0),
  stop_price numeric(18, 2),
  status text not null
    check (
      status in (
        'RISK_APPROVED',
        'RISK_REJECTED',
        'FILLED',
        'CANCELLED'
      )
    ),
  risk_decision_id uuid not null
    references public.risk_decisions(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_paper_positions_account
  on public.paper_positions(account_id);

create index if not exists idx_risk_decisions_created
  on public.risk_decisions(created_at desc);

create index if not exists idx_paper_orders_created
  on public.paper_order_requests(created_at desc);

alter table public.paper_accounts enable row level security;
alter table public.paper_positions enable row level security;
alter table public.risk_decisions enable row level security;
alter table public.paper_order_requests enable row level security;

insert into public.paper_accounts (
  account_name,
  initial_equity,
  cash_balance,
  trading_mode
)
values (
  'default-paper',
  10000000,
  10000000,
  'PAPER'
)
on conflict (account_name) do nothing;