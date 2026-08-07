create table if not exists public.market_data_quality_gate_observations (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),

  status text not null,

  usable_for_forward_shadow boolean not null default false,

  expected_market_date date,

  freshness_status text,

  integrity_scan_id uuid
    references public.market_data_integrity_scans(id)
    on delete set null,

  integrity_status text,
  integrity_window_end_date date,
  integrity_finished_at timestamptz,

  effective_error_count integer,
  effective_warning_count integer,

  reasons jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  evidence_fingerprint text not null unique,

  production_applied boolean not null default false,

  created_at timestamptz not null default now(),

  constraint market_data_quality_gate_status_check
    check (
      status in (
        'PASS',
        'PASS_WITH_WARNING',
        'FAIL_FRESHNESS',
        'FAIL_NO_INTEGRITY_SCAN',
        'FAIL_SCAN_NOT_FINAL',
        'FAIL_SCAN_DATE_MISMATCH',
        'FAIL_INTEGRITY_ERRORS'
      )
    ),

  constraint market_data_quality_gate_production_check
    check (
      production_applied = false
    )
);

create index if not exists
  idx_market_data_quality_gate_observations_observed_at
on public.market_data_quality_gate_observations (
  observed_at desc
);

create index if not exists
  idx_market_data_quality_gate_observations_status
on public.market_data_quality_gate_observations (
  status,
  observed_at desc
);

create index if not exists
  idx_market_data_quality_gate_observations_market_date
on public.market_data_quality_gate_observations (
  expected_market_date desc
);

comment on table public.market_data_quality_gate_observations is
'v7.10 gate combining v7.7 freshness with the latest v7.9 integrity scan before forward-shadow evidence is accepted.';

comment on column public.market_data_quality_gate_observations.usable_for_forward_shadow is
'True only when freshness passes and the latest integrity scan covers the current expected market date with zero effective errors.';

comment on column public.market_data_quality_gate_observations.production_applied is
'Hard safety flag. v7.10 only gates forward-shadow evidence and never changes production orders.';