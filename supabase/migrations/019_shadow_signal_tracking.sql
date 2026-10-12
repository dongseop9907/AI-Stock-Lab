begin;

create table if not exists
  public.shadow_signal_tracks (
    id uuid primary key
      default gen_random_uuid(),

    signal_id uuid not null
      references public.ai_entry_signals(id)
      on delete cascade,

    model_id uuid,

    stock_code text not null,

    signal_status text not null,

    signal_score numeric,

    signal_observed_at timestamptz
      not null,

    reference_price numeric
      not null
      check (reference_price > 0),

    price_30m numeric,
    observed_30m_at timestamptz,
    return_30m numeric,

    price_60m numeric,
    observed_60m_at timestamptz,
    return_60m numeric,

    close_price numeric,
    close_observed_at timestamptz,
    close_return numeric,

    max_price numeric,
    max_return numeric,

    min_price numeric,
    min_return numeric,

    evaluation_status text
      not null
      default 'PENDING'
      check (
        evaluation_status in (
          'PENDING',
          'PARTIAL',
          'COMPLETE',
          'EXPIRED',
          'INVALID'
        )
      ),

    decision_label text
      not null
      default 'UNKNOWN'
      check (
        decision_label in (
          'UNKNOWN',
          'GOOD_SKIP',
          'BAD_SKIP',
          'GOOD_ENTRY',
          'BAD_ENTRY'
        )
      ),

    last_snapshot_at timestamptz,
    last_evaluated_at timestamptz,
    completed_at timestamptz,

    details jsonb
      not null
      default '{}'::jsonb,

    created_at timestamptz
      not null
      default now(),

    updated_at timestamptz
      not null
      default now(),

    constraint
      shadow_signal_tracks_signal_id_key
      unique (signal_id)
  );

create index if not exists
  shadow_signal_tracks_status_idx
on public.shadow_signal_tracks (
  evaluation_status,
  signal_observed_at
);

create index if not exists
  shadow_signal_tracks_stock_idx
on public.shadow_signal_tracks (
  stock_code,
  signal_observed_at desc
);

create index if not exists
  shadow_signal_tracks_model_idx
on public.shadow_signal_tracks (
  model_id,
  signal_observed_at desc
);

create index if not exists
  shadow_signal_tracks_decision_idx
on public.shadow_signal_tracks (
  decision_label,
  completed_at desc
);

alter table
  public.shadow_signal_tracks
enable row level security;

revoke all
on public.shadow_signal_tracks
from anon, authenticated;

grant all
on public.shadow_signal_tracks
to service_role;

notify pgrst, 'reload schema';

commit;