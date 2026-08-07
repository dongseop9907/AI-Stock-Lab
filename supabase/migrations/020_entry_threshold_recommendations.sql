begin;

create table if not exists
  public.entry_threshold_recommendations (
    id uuid primary key
      default gen_random_uuid(),

    model_id uuid,

    analyzed_from timestamptz,
    analyzed_to timestamptz,

    current_threshold numeric
      not null,

    raw_best_threshold numeric,
    recommended_threshold numeric,

    sample_count integer
      not null default 0,

    positive_count integer
      not null default 0,

    negative_count integer
      not null default 0,

    current_objective_score numeric,
    recommended_objective_score numeric,
    objective_improvement numeric,

    status text
      not null
      check (
        status in (
          'INSUFFICIENT_DATA',
          'NO_CHANGE',
          'RECOMMENDED',
          'APPROVED',
          'REJECTED',
          'APPLIED'
        )
      ),

    metrics jsonb
      not null
      default '{}'::jsonb,

    approved_at timestamptz,
    approved_by text,

    applied_at timestamptz,

    created_at timestamptz
      not null
      default now(),

    updated_at timestamptz
      not null
      default now()
  );

create index if not exists
  entry_threshold_recommendations_created_idx
on public.entry_threshold_recommendations (
  created_at desc
);

create index if not exists
  entry_threshold_recommendations_model_idx
on public.entry_threshold_recommendations (
  model_id,
  created_at desc
);

alter table
  public.entry_threshold_recommendations
enable row level security;

revoke all
on public.entry_threshold_recommendations
from anon, authenticated;

grant all
on public.entry_threshold_recommendations
to service_role;

notify pgrst, 'reload schema';

commit;