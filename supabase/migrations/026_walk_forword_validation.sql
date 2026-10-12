create table if not exists public.walk_forward_runs (
  id uuid primary key default gen_random_uuid(),

  strategy_name text not null
    default 'ENTRY_THRESHOLD_WALK_FORWARD',

  strategy_version text not null
    default 'v3',

  status text not null
    default 'RUNNING',

  started_at timestamptz not null
    default now(),

  finished_at timestamptz,

  fold_count integer not null
    default 0,

  oos_compound_return numeric,
  oos_average_return numeric,
  oos_worst_drawdown numeric,
  oos_average_sharpe numeric,

  oos_total_trades integer,
  oos_weighted_win_rate numeric,

  selected_thresholds jsonb
    not null default '[]'::jsonb,

  config jsonb
    not null default '{}'::jsonb,

  error_message text,

  created_at timestamptz not null
    default now(),

  constraint walk_forward_runs_status_check
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'FAILED'
      )
    )
);

create table if not exists public.walk_forward_folds (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    references public.walk_forward_runs(id)
    on delete cascade,

  fold_number integer not null,

  validation_start date not null,
  validation_end date not null,

  test_start date not null,
  test_end date not null,

  selected_threshold numeric not null,

  validation_score numeric,

  validation_backtest_run_id uuid
    references public.backtest_runs(id)
    on delete set null,

  test_backtest_run_id uuid
    references public.backtest_runs(id)
    on delete set null,

  validation_metrics jsonb
    not null default '{}'::jsonb,

  test_metrics jsonb
    not null default '{}'::jsonb,

  candidate_results jsonb
    not null default '[]'::jsonb,

  created_at timestamptz not null
    default now(),

  constraint walk_forward_folds_unique
    unique (
      run_id,
      fold_number
    )
);

create index if not exists
  idx_walk_forward_runs_created_at
on public.walk_forward_runs (
  created_at desc
);

create index if not exists
  idx_walk_forward_folds_run
on public.walk_forward_folds (
  run_id,
  fold_number
);