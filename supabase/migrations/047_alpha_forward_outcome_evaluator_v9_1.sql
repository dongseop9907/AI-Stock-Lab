-- v9.1 Alpha Forward Outcome Evaluator
-- Research-only. Entry is next trading day's OPEN. Missing future bars remain pending.

create table if not exists public.alpha_forward_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.alpha_research_experiments(id) on delete cascade,
  evaluation_version text not null default 'ALPHA_FORWARD_EVALUATOR_V9_1',
  status text not null default 'RUNNING',
  signal_count integer not null default 0,
  expected_outcome_count integer not null default 0,
  completed_outcome_count integer not null default 0,
  pending_outcome_count integer not null default 0,
  invalid_outcome_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  production_applied boolean not null default false,
  constraint alpha_forward_eval_status_check check (
    status in ('RUNNING','WAITING_FOR_FORWARD_DATA','DEVELOPING','MATURE','FAILED')
  ),
  constraint alpha_forward_eval_production_check check (production_applied = false)
);

create table if not exists public.alpha_forward_outcomes (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.alpha_research_experiments(id) on delete cascade,
  signal_id uuid not null references public.alpha_research_signals(id) on delete cascade,
  stock_code text not null references public.stock_universe_securities(stock_code) on delete restrict,
  signal_date date not null,
  signal_rank integer not null,
  selected boolean not null,
  horizon_trading_days integer not null,
  entry_date date,
  entry_open numeric,
  exit_date date,
  exit_close numeric,
  raw_return numeric,
  status text not null,
  evaluation_version text not null default 'ALPHA_FORWARD_EVALUATOR_V9_1',
  metadata jsonb not null default '{}'::jsonb,
  production_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(signal_id,horizon_trading_days),
  constraint alpha_forward_horizon_check check (horizon_trading_days in (1,3,5,10,20)),
  constraint alpha_forward_status_check check (status in ('PENDING_FUTURE_DATA','COMPLETED','INVALID_PRICE')),
  constraint alpha_forward_production_check check (production_applied = false)
);

create index if not exists idx_alpha_forward_outcomes_exp
on public.alpha_forward_outcomes(experiment_id,horizon_trading_days,status);

create or replace function public.compute_alpha_forward_outcomes_v9_1(
  p_experiment_id uuid
)
returns table (
  signal_id uuid,
  experiment_id uuid,
  stock_code text,
  signal_date date,
  signal_rank integer,
  selected boolean,
  horizon_trading_days integer,
  entry_date date,
  entry_open numeric,
  exit_date date,
  exit_close numeric,
  raw_return numeric,
  outcome_status text
)
language sql
stable
as $$
  with signal_base as (
    select id as signal_id, experiment_id, stock_code, signal_date, rank as signal_rank, selected
    from public.alpha_research_signals
    where experiment_id = p_experiment_id
  ),
  future_bars as (
    select
      s.signal_id,
      b.trading_date,
      b.open_price::numeric as open_price,
      b.close_price::numeric as close_price,
      row_number() over(partition by s.signal_id order by b.trading_date) as rn
    from signal_base s
    join public.market_daily_bars b
      on b.stock_code = s.stock_code
     and b.trading_date > s.signal_date
  ),
  horizons(h) as (values (1),(3),(5),(10),(20)),
  resolved as (
    select
      s.signal_id,s.experiment_id,s.stock_code,s.signal_date,s.signal_rank,s.selected,h.h as horizon_trading_days,
      max(f.trading_date) filter(where f.rn=1) as entry_date,
      max(f.open_price) filter(where f.rn=1) as entry_open,
      max(f.trading_date) filter(where f.rn=h.h) as exit_date,
      max(f.close_price) filter(where f.rn=h.h) as exit_close
    from signal_base s
    cross join horizons h
    left join future_bars f on f.signal_id=s.signal_id and f.rn<=h.h
    group by s.signal_id,s.experiment_id,s.stock_code,s.signal_date,s.signal_rank,s.selected,h.h
  )
  select
    r.signal_id,r.experiment_id,r.stock_code,r.signal_date,r.signal_rank,r.selected,r.horizon_trading_days,
    r.entry_date,r.entry_open,r.exit_date,r.exit_close,
    case when r.entry_open>0 and r.exit_close>0 then r.exit_close/r.entry_open-1 else null end,
    case
      when r.entry_date is null or r.exit_date is null then 'PENDING_FUTURE_DATA'
      when r.entry_open is null or r.entry_open<=0 or r.exit_close is null or r.exit_close<=0 then 'INVALID_PRICE'
      else 'COMPLETED'
    end
  from resolved r
  order by r.signal_rank,r.horizon_trading_days;
$$;
