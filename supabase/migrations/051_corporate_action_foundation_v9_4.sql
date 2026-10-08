-- ============================================================
-- v9.4 Corporate Action Foundation
-- ============================================================
-- Research-only.
--
-- Goals:
-- 1) Store provider-neutral corporate-action events.
-- 2) Build auditable cumulative split adjustment factors.
-- 3) NEVER overwrite raw market_daily_bars.
-- 4) Fail closed for unsupported/ambiguous events.
--
-- Supported for deterministic adjustment in v9.4:
--   STOCK_SPLIT
--   REVERSE_SPLIT
--
-- Recorded but NOT automatically adjusted in v9.4:
--   CASH_DIVIDEND
--   STOCK_DIVIDEND
--   RIGHTS_ISSUE
--   SPIN_OFF
--   MERGER
--   OTHER
--
-- Price adjustment convention:
-- An event effective on date D affects historical bars strictly BEFORE D.
--
-- Example 2-for-1 split:
-- ratio_from = 1
-- ratio_to   = 2
-- price_factor = ratio_from / ratio_to = 0.5
-- share_factor = ratio_to / ratio_from = 2.0
-- ============================================================

create table if not exists public.corporate_action_events (
  id uuid primary key default gen_random_uuid(),

  stock_code text not null
    references public.stock_universe_securities(stock_code)
    on delete restrict,

  action_type text not null,

  effective_date date not null,

  ratio_from numeric,
  ratio_to numeric,

  cash_amount numeric,
  currency text,

  provider text not null,
  provider_event_id text,

  source_fingerprint text not null,

  status text not null default 'RECORDED',

  metadata jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    stock_code,
    action_type,
    effective_date,
    provider,
    source_fingerprint,
    is_validation
  ),

  constraint corporate_action_events_type_check
    check (
      action_type in (
        'STOCK_SPLIT',
        'REVERSE_SPLIT',
        'CASH_DIVIDEND',
        'STOCK_DIVIDEND',
        'RIGHTS_ISSUE',
        'SPIN_OFF',
        'MERGER',
        'OTHER'
      )
    ),

  constraint corporate_action_events_status_check
    check (
      status in (
        'RECORDED',
        'SUPPORTED',
        'UNSUPPORTED',
        'INVALID'
      )
    ),

  constraint corporate_action_events_split_ratio_check
    check (
      (
        action_type not in (
          'STOCK_SPLIT',
          'REVERSE_SPLIT'
        )
      )
      or (
        ratio_from is not null
        and ratio_to is not null
        and ratio_from > 0
        and ratio_to > 0
      )
    ),

  constraint corporate_action_events_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_events_lookup
on public.corporate_action_events (
  stock_code,
  effective_date,
  action_type
);

create table if not exists public.corporate_action_adjustment_runs (
  id uuid primary key default gen_random_uuid(),

  stock_code text not null
    references public.stock_universe_securities(stock_code)
    on delete restrict,

  version text not null default 'CORPORATE_ACTION_ADJUSTMENT_V9_4',

  status text not null default 'RUNNING',

  event_count integer not null default 0,
  supported_event_count integer not null default 0,
  unsupported_event_count integer not null default 0,

  factor_count integer not null default 0,

  summary jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  error_message text,

  constraint corporate_action_adjustment_runs_status_check
    check (
      status in (
        'RUNNING',
        'READY',
        'BLOCKED_UNSUPPORTED_ACTION',
        'FAILED'
      )
    ),

  constraint corporate_action_adjustment_runs_counts_check
    check (
      event_count >= 0
      and supported_event_count >= 0
      and unsupported_event_count >= 0
      and factor_count >= 0
    ),

  constraint corporate_action_adjustment_runs_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_adjustment_runs_lookup
on public.corporate_action_adjustment_runs (
  stock_code,
  started_at desc
);

create table if not exists public.corporate_action_adjustment_factors (
  id uuid primary key default gen_random_uuid(),

  adjustment_run_id uuid not null
    references public.corporate_action_adjustment_runs(id)
    on delete cascade,

  stock_code text not null
    references public.stock_universe_securities(stock_code)
    on delete restrict,

  effective_date date not null,

  action_event_id uuid not null
    references public.corporate_action_events(id)
    on delete restrict,

  action_type text not null,

  event_price_factor numeric not null,
  event_share_factor numeric not null,

  cumulative_price_factor numeric not null,
  cumulative_share_factor numeric not null,

  metadata jsonb not null default '{}'::jsonb,

  is_validation boolean not null default false,
  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  unique (
    adjustment_run_id,
    action_event_id
  ),

  constraint corporate_action_adjustment_factors_positive_check
    check (
      event_price_factor > 0
      and event_share_factor > 0
      and cumulative_price_factor > 0
      and cumulative_share_factor > 0
    ),

  constraint corporate_action_adjustment_factors_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_corporate_action_adjustment_factors_resolve
on public.corporate_action_adjustment_factors (
  stock_code,
  effective_date
);

create table if not exists public.corporate_action_validation_runs (
  id uuid primary key default gen_random_uuid(),

  validation_version text not null default 'CORPORATE_ACTION_VALIDATION_V9_4',

  status text not null,

  assertions jsonb not null default '{}'::jsonb,

  cleanup_succeeded boolean not null default false,

  error_message text,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint corporate_action_validation_runs_status_check
    check (
      status in (
        'PASS',
        'FAIL'
      )
    ),

  constraint corporate_action_validation_runs_production_check
    check (
      production_applied = false
    )
);

-- Research view:
-- Resolves the cumulative split factor applicable to each raw bar.
-- Raw market_daily_bars are never updated.
create or replace view public.market_daily_bars_split_adjusted_v9_4
as
with latest_ready_run as (
  select distinct on (r.stock_code)
    r.id,
    r.stock_code
  from public.corporate_action_adjustment_runs r
  where r.status = 'READY'
    and r.is_validation = false
  order by
    r.stock_code,
    r.started_at desc,
    r.id desc
),
bar_factors as (
  select
    b.stock_code,
    b.trading_date,

    coalesce(
      exp(
        sum(
          ln(
            f.event_price_factor
          )
        )
      ),
      1
    ) as split_price_factor,

    coalesce(
      exp(
        sum(
          ln(
            f.event_share_factor
          )
        )
      ),
      1
    ) as split_share_factor

  from public.market_daily_bars b

  left join latest_ready_run rr
    on rr.stock_code = b.stock_code

  left join public.corporate_action_adjustment_factors f
    on f.adjustment_run_id = rr.id
   and f.stock_code = b.stock_code
   and f.effective_date > b.trading_date
   and f.is_validation = false

  group by
    b.stock_code,
    b.trading_date
)
select
  b.stock_code,
  b.trading_date,

  b.open_price as raw_open_price,
  b.high_price as raw_high_price,
  b.low_price as raw_low_price,
  b.close_price as raw_close_price,
  b.volume as raw_volume,

  bf.split_price_factor,
  bf.split_share_factor,

  b.open_price * bf.split_price_factor as adjusted_open_price,
  b.high_price * bf.split_price_factor as adjusted_high_price,
  b.low_price * bf.split_price_factor as adjusted_low_price,
  b.close_price * bf.split_price_factor as adjusted_close_price,
  b.volume * bf.split_share_factor as adjusted_volume

from public.market_daily_bars b
join bar_factors bf
  on bf.stock_code = b.stock_code
 and bf.trading_date = b.trading_date;

create or replace function public.finish_corporate_action_adjustment_run_v9_4(
  p_run_id uuid,
  p_status text,
  p_factor_count integer,
  p_summary jsonb default '{}'::jsonb,
  p_error_message text default null
)
returns void
language plpgsql
as $$
begin
  update public.corporate_action_adjustment_runs
  set
    status = p_status,
    factor_count = greatest(
      coalesce(
        p_factor_count,
        0
      ),
      0
    ),
    summary = coalesce(
      p_summary,
      '{}'::jsonb
    ),
    error_message = p_error_message,
    finished_at = now()
  where id = p_run_id;
end;
$$;

comment on table public.corporate_action_events is
'v9.4 provider-neutral corporate-action event registry. Raw daily bars are never overwritten.';

comment on table public.corporate_action_adjustment_factors is
'v9.4 deterministic split/reverse-split adjustment factors. Unsupported actions fail closed.';

comment on view public.market_daily_bars_split_adjusted_v9_4 is
'Research-only split-adjusted OHLCV projection over raw market_daily_bars. Event effective date adjusts bars strictly before that date.';
