-- ============================================================
-- 055_market_exchange_calendar_overrides_v7_7_1.sql
-- AI Stock Lab - Market Data Freshness v7.7.1
-- ============================================================

create table if not exists public.market_exchange_calendar_overrides (
  exchange_code text not null,
  calendar_date date not null,
  is_open boolean not null,
  reason text not null,
  source text not null,
  source_reference text,
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exchange_code, calendar_date)
);

create index if not exists idx_market_exchange_calendar_overrides_verified_date
on public.market_exchange_calendar_overrides (
  exchange_code,
  verified,
  calendar_date
);

comment on table public.market_exchange_calendar_overrides is
'Explicit verified exchange-calendar exceptions used by the freshness guard. Unknown closures are not guessed.';

insert into public.market_exchange_calendar_overrides (
  exchange_code,
  calendar_date,
  is_open,
  reason,
  source,
  source_reference,
  verified,
  metadata
)
values (
  'KRX',
  date '2026-08-17',
  false,
  '2026-08-17 substitute public holiday closure.',
  'MANUAL_VERIFIED_KRX_CALENDAR',
  'KRX_PUBLIC_HOLIDAY_CLOSURE_RULE',
  true,
  jsonb_build_object(
    'patchVersion',
    'MARKET_DATA_FRESHNESS_V7_7_1',
    'purpose',
    'FIX_FALSE_STALE_ON_VERIFIED_KRX_CLOSURE'
  )
)
on conflict (exchange_code, calendar_date)
do update
set
  is_open = excluded.is_open,
  reason = excluded.reason,
  source = excluded.source,
  source_reference = excluded.source_reference,
  verified = excluded.verified,
  metadata = excluded.metadata,
  updated_at = now();
