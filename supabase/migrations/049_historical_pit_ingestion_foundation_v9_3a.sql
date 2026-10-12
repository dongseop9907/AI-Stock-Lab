-- v9.3A Historical PIT Ingestion Foundation
-- KRX-key independent. Raw historical snapshots only.
-- Canonical stock_universe_memberships are intentionally untouched.

create table if not exists public.historical_universe_snapshot_imports (
  id uuid primary key default gen_random_uuid(),
  universe_code text not null,
  as_of_date date not null,
  provider text not null,
  provider_version text not null,
  coverage_status text not null default 'UNKNOWN',
  expected_member_count integer,
  observed_member_count integer not null default 0,
  source_fingerprint text not null,
  status text not null default 'RUNNING',
  metadata jsonb not null default '{}'::jsonb,
  is_validation boolean not null default false,
  production_applied boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  unique(universe_code,as_of_date,provider,source_fingerprint,is_validation),
  check (coverage_status in ('COMPLETE','PARTIAL','UNKNOWN')),
  check (status in ('RUNNING','IMPORTED','FAILED')),
  check (production_applied=false)
);

create index if not exists idx_historical_universe_snapshot_imports_lookup
on public.historical_universe_snapshot_imports(universe_code,as_of_date,status,is_validation);

create table if not exists public.historical_universe_snapshot_rows (
  import_id uuid not null references public.historical_universe_snapshot_imports(id) on delete cascade,
  stock_code text not null,
  stock_name text not null,
  market text not null,
  sector text,
  security_type text not null default 'UNKNOWN',
  listed boolean not null default true,
  tradable boolean not null default true,
  listing_date date,
  delisting_date date,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(import_id,stock_code),
  check (market in ('KOSPI','KOSDAQ','KONEX','UNKNOWN'))
);

create index if not exists idx_historical_universe_snapshot_rows_code
on public.historical_universe_snapshot_rows(stock_code,import_id);

create or replace function public.finish_historical_universe_import_v9_3a(
  p_import_id uuid,
  p_status text,
  p_observed_member_count integer,
  p_error_message text default null
)
returns void
language plpgsql
as $$
begin
  update public.historical_universe_snapshot_imports
  set status=p_status,
      observed_member_count=greatest(coalesce(p_observed_member_count,0),0),
      error_message=p_error_message,
      finished_at=now()
  where id=p_import_id;
end;
$$;

comment on table public.historical_universe_snapshot_imports is
'v9.3A provider-neutral historical PIT raw snapshot audit. No canonical PIT membership mutation.';
comment on function public.finish_historical_universe_import_v9_3a is
'Uses DB now() to avoid Node/DB audit timestamp skew.';
