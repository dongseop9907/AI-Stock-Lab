create table if not exists public.market_daily_bars (
  id bigserial primary key,

  stock_code text not null
    references public.stocks(stock_code)
    on delete cascade,

  trading_date date not null,

  open_price numeric not null,
  high_price numeric not null,
  low_price numeric not null,
  close_price numeric not null,

  volume numeric not null default 0,
  trading_value numeric,

  source text not null
    default 'KIS_DAILY',

  adjusted_price boolean not null
    default true,

  raw_payload jsonb
    not null default '{}'::jsonb,

  collected_at timestamptz
    not null default now(),

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  constraint market_daily_bars_price_check
    check (
      open_price > 0
      and high_price > 0
      and low_price > 0
      and close_price > 0
    ),

  constraint market_daily_bars_ohlc_check
    check (
      high_price >= low_price
      and high_price >= open_price
      and high_price >= close_price
      and low_price <= open_price
      and low_price <= close_price
    ),

  constraint market_daily_bars_unique
    unique (
      stock_code,
      trading_date
    )
);

create index if not exists
  idx_market_daily_bars_stock_date
on public.market_daily_bars (
  stock_code,
  trading_date desc
);

create index if not exists
  idx_market_daily_bars_date
on public.market_daily_bars (
  trading_date desc
);

select
  to_regclass(
    'public.market_daily_bars'
  ) as created_table;