-- ============================================================
-- 024_backtest_engine.sql
-- AI Stock Lab - Backtest & Validation Engine Foundation
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. 백테스트 실행 기록
-- ============================================================

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),

  strategy_name text not null,
  strategy_version text not null,

  status text not null default 'RUNNING'
    check (
      status in (
        'RUNNING',
        'SUCCESS',
        'FAILED'
      )
    ),

  start_at timestamptz not null,
  end_at timestamptz not null,

  initial_cash numeric not null
    check (initial_cash > 0),

  final_equity numeric,

  entry_threshold numeric
    not null default 0.62,

  stop_distance_rate numeric
    not null default 0.025,

  fee_rate numeric
    not null default 0.00015,

  tax_rate numeric
    not null default 0.0015,

  slippage_rate numeric
    not null default 0.0005,

  max_positions integer
    not null default 3,

  trade_count integer
    not null default 0,

  winning_trade_count integer
    not null default 0,

  losing_trade_count integer
    not null default 0,

  win_rate numeric,

  gross_return numeric,
  net_return numeric,

  benchmark_return numeric,
  excess_return numeric,

  average_win numeric,
  average_loss numeric,

  profit_factor numeric,

  max_drawdown numeric,

  sharpe_ratio numeric,

  deflated_sharpe_ratio numeric,

  turnover numeric,

  max_consecutive_losses integer,

  config jsonb
    not null default '{}'::jsonb,

  metrics jsonb
    not null default '{}'::jsonb,

  error_message text,

  created_at timestamptz
    not null default now(),

  finished_at timestamptz,

  constraint backtest_date_range_check
    check (end_at > start_at)
);


-- ============================================================
-- 2. 개별 백테스트 거래
-- ============================================================

create table if not exists public.backtest_trades (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    references public.backtest_runs(id)
    on delete cascade,

  stock_code text not null,

  model_id uuid,

  signal_at timestamptz not null,

  entry_at timestamptz not null,

  exit_at timestamptz,

  quantity integer not null
    check (quantity > 0),

  signal_score numeric,

  prediction_score numeric,

  prediction_confidence numeric,

  entry_price_raw numeric not null,

  entry_price_exec numeric not null,

  initial_stop_price numeric,

  exit_price_raw numeric,

  exit_price_exec numeric,

  exit_reason text,

  gross_pnl numeric,

  buy_fee numeric
    not null default 0,

  sell_fee numeric
    not null default 0,

  tax_amount numeric
    not null default 0,

  slippage_cost numeric
    not null default 0,

  net_pnl numeric,

  net_return numeric,

  holding_minutes numeric,

  metadata jsonb
    not null default '{}'::jsonb,

  created_at timestamptz
    not null default now()
);


-- ============================================================
-- 3. 시간별 자산 곡선
-- ============================================================

create table if not exists public.backtest_equity_curve (
  id bigserial primary key,

  run_id uuid not null
    references public.backtest_runs(id)
    on delete cascade,

  observed_at timestamptz not null,

  cash numeric not null,

  market_value numeric
    not null default 0,

  equity numeric not null,

  peak_equity numeric not null,

  drawdown numeric
    not null default 0,

  open_position_count integer
    not null default 0,

  positions jsonb
    not null default '[]'::jsonb,

  created_at timestamptz
    not null default now(),

  unique (
    run_id,
    observed_at
  )
);


-- ============================================================
-- 4. 데이터 품질 검사 결과
-- ============================================================

create table if not exists public.backtest_data_quality_checks (
  id uuid primary key default gen_random_uuid(),

  checked_at timestamptz
    not null default now(),

  total_snapshot_count bigint
    not null default 0,

  future_snapshot_count bigint
    not null default 0,

  test_snapshot_count bigint
    not null default 0,

  invalid_price_count bigint
    not null default 0,

  invalid_ohlc_count bigint
    not null default 0,

  duplicate_snapshot_count bigint
    not null default 0,

  passed boolean
    not null default false,

  details jsonb
    not null default '{}'::jsonb
);


-- ============================================================
-- INDEX
-- ============================================================

create index if not exists
  idx_backtest_runs_created_at
on public.backtest_runs (
  created_at desc
);


create index if not exists
  idx_backtest_trades_run_id
on public.backtest_trades (
  run_id
);


create index if not exists
  idx_backtest_trades_stock_code
on public.backtest_trades (
  stock_code
);


create index if not exists
  idx_backtest_trades_entry_at
on public.backtest_trades (
  entry_at
);


create index if not exists
  idx_backtest_equity_run_time
on public.backtest_equity_curve (
  run_id,
  observed_at
);


-- ============================================================
-- 완료 확인
-- ============================================================

select
  'backtest_runs' as table_name,
  to_regclass(
    'public.backtest_runs'
  ) as created_table

union all

select
  'backtest_trades',
  to_regclass(
    'public.backtest_trades'
  )

union all

select
  'backtest_equity_curve',
  to_regclass(
    'public.backtest_equity_curve'
  )

union all

select
  'backtest_data_quality_checks',
  to_regclass(
    'public.backtest_data_quality_checks'
  );