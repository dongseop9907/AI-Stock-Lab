create table if not exists public.market_index_daily_bars (
  id bigserial primary key,

  market_code text not null,
  index_code text not null,
  index_name text not null,

  trading_date date not null,

  open_value numeric,
  high_value numeric,
  low_value numeric,
  close_value numeric not null,

  change_value numeric,
  change_rate numeric,

  volume numeric,
  trading_value numeric,
  market_cap numeric,

  source text not null default 'KIS_INDEX_DAILY',

  raw_payload jsonb
    not null default '{}'::jsonb,

  collected_at timestamptz
    not null default now(),

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  constraint market_index_daily_bars_market_check
    check (
      market_code in (
        'KOSPI',
        'KOSDAQ'
      )
    ),

  constraint market_index_daily_bars_close_check
    check (
      close_value > 0
    ),

  constraint market_index_daily_bars_unique
    unique (
      market_code,
      index_code,
      trading_date
    )
);

create index if not exists
  idx_market_index_daily_bars_market_date
on public.market_index_daily_bars (
  market_code,
  trading_date desc
);

create index if not exists
  idx_market_index_daily_bars_date
on public.market_index_daily_bars (
  trading_date desc
);

comment on table public.market_index_daily_bars is
'KOSPI/KOSDAQ index daily bars used by Market Regime v7 and later backtests.';

comment on column public.market_index_daily_bars.source is
'Data source/version identifier, e.g. KIS_INDEX_DAILY.';