alter table public.market_regime_shadow_outcomes
  add column if not exists signal_market_date date;

create index if not exists
  idx_market_regime_shadow_outcomes_signal_market_date
on public.market_regime_shadow_outcomes (
  signal_market_date,
  stock_code
);

comment on column public.market_regime_shadow_outcomes.signal_market_date is
'Korea/Seoul calendar date of signal_observed_at. Forward evaluation must start strictly after this date, not after the regime comparison market_date.';