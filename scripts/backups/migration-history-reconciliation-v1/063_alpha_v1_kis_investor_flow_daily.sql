create table if not exists public.kis_investor_flow_daily (
  stock_code text not null,
  trading_date date not null,

  close_price numeric null,
  accumulated_volume numeric null,
  accumulated_trading_value numeric null,

  individual_net_buy_quantity numeric null,
  foreign_net_buy_quantity numeric null,
  institution_net_buy_quantity numeric null,

  individual_net_buy_amount numeric null,
  foreign_net_buy_amount numeric null,
  institution_net_buy_amount numeric null,

  source text not null default 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY',
  source_version text not null default 'FHPTJ04160001',

  collected_at timestamptz not null default now(),
  raw_payload jsonb null,

  primary key (stock_code, trading_date)
);

create index if not exists kis_investor_flow_daily_trading_date_idx
  on public.kis_investor_flow_daily (trading_date);

create index if not exists kis_investor_flow_daily_stock_date_idx
  on public.kis_investor_flow_daily (stock_code, trading_date desc);
