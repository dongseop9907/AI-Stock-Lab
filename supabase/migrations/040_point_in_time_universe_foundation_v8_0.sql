-- ============================================================
-- v8.0 Point-in-Time Universe Foundation
-- ============================================================
-- Purpose:
-- 1) Keep the legacy stocks table untouched.
-- 2) Add explicit universe definitions.
-- 3) Persist observed universe snapshots.
-- 4) Represent membership as half-open date intervals [valid_from, valid_to).
-- 5) Never pretend we know historical membership before it was observed.
-- 6) Prepare for KRX/KIS full-universe collection in v8.1+.
-- ============================================================

create table if not exists public.stock_universe_definitions (
  universe_code text primary key,

  display_name text not null,
  description text,

  universe_type text not null,

  markets text[] not null default '{}'::text[],

  point_in_time_required boolean not null default true,
  requires_complete_coverage boolean not null default true,

  is_ready boolean not null default false,
  production_applied boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_universe_definitions_type_check
    check (
      universe_type in (
        'LEGACY_RESEARCH',
        'LISTED_MARKET',
        'TRADABLE_MARKET',
        'STRATEGY'
      )
    ),

  constraint stock_universe_definitions_production_check
    check (
      production_applied = false
    )
);

insert into public.stock_universe_definitions (
  universe_code,
  display_name,
  description,
  universe_type,
  markets,
  point_in_time_required,
  requires_complete_coverage,
  is_ready,
  production_applied,
  metadata
)
values
  (
    'LEGACY_ACTIVE_STOCKS',
    'Legacy active stocks',
    'Existing stocks.is_active=true research set. This is NOT a complete KRX market universe.',
    'LEGACY_RESEARCH',
    array['KOSPI','KOSDAQ']::text[],
    true,
    false,
    true,
    false,
    '{"source":"stocks_table","scope":"existing_project_research_set"}'::jsonb
  ),
  (
    'KRX_KOSPI_LISTED',
    'KRX KOSPI listed universe',
    'Point-in-time KOSPI listed securities. Collector/backfill is added in v8.1+.',
    'LISTED_MARKET',
    array['KOSPI']::text[],
    true,
    true,
    false,
    false,
    '{"collectorReady":false}'::jsonb
  ),
  (
    'KRX_KOSDAQ_LISTED',
    'KRX KOSDAQ listed universe',
    'Point-in-time KOSDAQ listed securities. Collector/backfill is added in v8.1+.',
    'LISTED_MARKET',
    array['KOSDAQ']::text[],
    true,
    true,
    false,
    false,
    '{"collectorReady":false}'::jsonb
  ),
  (
    'KRX_ALL_LISTED',
    'KRX KOSPI + KOSDAQ listed universe',
    'Point-in-time combined KOSPI/KOSDAQ listed securities. Collector/backfill is added in v8.1+.',
    'LISTED_MARKET',
    array['KOSPI','KOSDAQ']::text[],
    true,
    true,
    false,
    false,
    '{"collectorReady":false}'::jsonb
  )
on conflict (universe_code)
do update set
  display_name = excluded.display_name,
  description = excluded.description,
  universe_type = excluded.universe_type,
  markets = excluded.markets,
  point_in_time_required = excluded.point_in_time_required,
  requires_complete_coverage = excluded.requires_complete_coverage,
  updated_at = now();

create table if not exists public.stock_universe_securities (
  stock_code text primary key,

  stock_name text not null,

  market text,
  sector text,

  security_type text not null default 'UNKNOWN',

  listing_date date,
  delisting_date date,

  first_seen_date date,
  last_seen_date date,

  source text not null,
  source_version text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_universe_securities_security_type_check
    check (
      security_type in (
        'COMMON',
        'PREFERRED',
        'ETF',
        'ETN',
        'REIT',
        'SPAC',
        'FUND',
        'UNKNOWN',
        'OTHER'
      )
    ),

  constraint stock_universe_securities_listing_window_check
    check (
      delisting_date is null
      or listing_date is null
      or delisting_date >= listing_date
    )
);

create index if not exists
  idx_stock_universe_securities_market
on public.stock_universe_securities (
  market,
  stock_code
);

create index if not exists
  idx_stock_universe_securities_listing_window
on public.stock_universe_securities (
  listing_date,
  delisting_date
);

create table if not exists public.stock_universe_snapshots (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null
    references public.stock_universe_definitions(universe_code)
    on delete restrict,

  as_of_date date not null,

  observed_at timestamptz not null default now(),

  source text not null,
  source_version text,

  coverage_status text not null,
  member_count integer not null default 0,

  evidence_fingerprint text not null unique,

  metadata jsonb not null default '{}'::jsonb,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint stock_universe_snapshots_coverage_check
    check (
      coverage_status in (
        'COMPLETE',
        'PARTIAL',
        'UNKNOWN'
      )
    ),

  constraint stock_universe_snapshots_member_count_check
    check (
      member_count >= 0
    ),

  constraint stock_universe_snapshots_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_stock_universe_snapshots_lookup
on public.stock_universe_snapshots (
  universe_code,
  as_of_date desc,
  observed_at desc
);

create table if not exists public.stock_universe_snapshot_members (
  snapshot_id uuid not null
    references public.stock_universe_snapshots(id)
    on delete cascade,

  stock_code text not null
    references public.stock_universe_securities(stock_code)
    on delete restrict,

  stock_name text not null,

  market text,
  sector text,

  security_type text not null default 'UNKNOWN',

  listed boolean not null default true,
  tradable boolean not null default true,

  flags jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  primary key (
    snapshot_id,
    stock_code
  )
);

create index if not exists
  idx_stock_universe_snapshot_members_stock
on public.stock_universe_snapshot_members (
  stock_code,
  snapshot_id
);

create table if not exists public.stock_universe_memberships (
  id uuid primary key default gen_random_uuid(),

  universe_code text not null
    references public.stock_universe_definitions(universe_code)
    on delete restrict,

  stock_code text not null
    references public.stock_universe_securities(stock_code)
    on delete restrict,

  stock_name text not null,

  market text,
  sector text,

  security_type text not null default 'UNKNOWN',

  valid_from date not null,

  -- Exclusive end date.
  -- Example:
  -- valid_from = 2026-08-03
  -- valid_to   = 2026-08-10
  -- means member on 8/3 ... 8/9, not a member on 8/10.
  valid_to date,

  listed boolean not null default true,
  tradable boolean not null default true,

  pit_eligible boolean not null default true,

  evidence_type text not null,

  source text not null,
  source_version text,

  source_snapshot_id uuid
    references public.stock_universe_snapshots(id)
    on delete set null,

  coverage_status text not null default 'UNKNOWN',

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_universe_memberships_window_check
    check (
      valid_to is null
      or valid_to > valid_from
    ),

  constraint stock_universe_memberships_evidence_check
    check (
      evidence_type in (
        'OBSERVED_SNAPSHOT',
        'OFFICIAL_HISTORY',
        'INFERRED',
        'MANUAL'
      )
    ),

  constraint stock_universe_memberships_coverage_check
    check (
      coverage_status in (
        'COMPLETE',
        'PARTIAL',
        'UNKNOWN'
      )
    ),

  constraint stock_universe_memberships_unique_start
    unique (
      universe_code,
      stock_code,
      valid_from
    )
);

create index if not exists
  idx_stock_universe_memberships_date_lookup
on public.stock_universe_memberships (
  universe_code,
  valid_from,
  valid_to,
  stock_code
);

create index if not exists
  idx_stock_universe_memberships_open
on public.stock_universe_memberships (
  universe_code,
  stock_code
)
where valid_to is null;

create index if not exists
  idx_stock_universe_memberships_pit
on public.stock_universe_memberships (
  universe_code,
  pit_eligible,
  valid_from,
  valid_to
);

create or replace function public.resolve_stock_universe_v8(
  p_universe_code text,
  p_as_of_date date,
  p_require_pit_eligible boolean default true,
  p_require_tradable boolean default true
)
returns table (
  universe_code text,
  stock_code text,
  stock_name text,
  market text,
  sector text,
  security_type text,
  valid_from date,
  valid_to date,
  listed boolean,
  tradable boolean,
  pit_eligible boolean,
  evidence_type text,
  source text,
  source_snapshot_id uuid,
  coverage_status text
)
language sql
stable
as $$
  select
    m.universe_code,
    m.stock_code,
    m.stock_name,
    m.market,
    m.sector,
    m.security_type,
    m.valid_from,
    m.valid_to,
    m.listed,
    m.tradable,
    m.pit_eligible,
    m.evidence_type,
    m.source,
    m.source_snapshot_id,
    m.coverage_status
  from public.stock_universe_memberships m
  where m.universe_code = p_universe_code
    and m.valid_from <= p_as_of_date
    and (
      m.valid_to is null
      or m.valid_to > p_as_of_date
    )
    and (
      p_require_pit_eligible = false
      or m.pit_eligible = true
    )
    and (
      p_require_tradable = false
      or (
        m.listed = true
        and m.tradable = true
      )
    )
  order by
    m.market nulls last,
    m.stock_code;
$$;

comment on table public.stock_universe_snapshots is
'Immutable observations of a named stock universe at a specific date. COMPLETE means the source claims full coverage for that universe; PARTIAL/UNKNOWN must not be treated as a complete market universe.';

comment on table public.stock_universe_memberships is
'Point-in-time membership intervals using half-open [valid_from, valid_to) semantics. Do not backdate valid_from unless a source actually supports the historical membership.';

comment on function public.resolve_stock_universe_v8 is
'Resolve a named point-in-time universe without using today''s membership to answer a historical date.';
