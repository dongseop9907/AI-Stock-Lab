-- ============================================================
-- v8.2.1 Pagination-safe Universe Screening RPC
-- ============================================================
-- Why:
-- Supabase/PostgREST can cap RPC result sets at 1000 rows.
-- v8.2 therefore observed only the first 1000 members of KRX_ALL_LISTED.
--
-- Fix:
-- Page the point-in-time membership set inside PostgreSQL with
-- deterministic ordering and explicit offset/limit arguments.
-- ============================================================

create or replace function public.compute_stock_universe_liquidity_metrics_v8_2_1(
  p_universe_code text,
  p_as_of_date date,
  p_market_date date,
  p_lookback_start_date date,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table (
  stock_code text,
  stock_name text,
  market text,
  sector text,
  security_type text,
  listed boolean,
  tradable boolean,
  membership_metadata jsonb,
  latest_bar_date date,
  latest_close numeric,
  recent_bar_count bigint,
  average_volume numeric,
  average_trading_value numeric
)
language sql
stable
as $$
  with members as (
    select
      m.stock_code,
      m.stock_name,
      m.market,
      m.sector,
      m.security_type,
      m.listed,
      m.tradable,
      m.metadata
    from public.stock_universe_memberships m
    where m.universe_code = p_universe_code
      and m.valid_from <= p_as_of_date
      and (
        m.valid_to is null
        or m.valid_to > p_as_of_date
      )
      and m.pit_eligible = true
    order by
      m.market nulls last,
      m.stock_code
    offset greatest(
      coalesce(
        p_offset,
        0
      ),
      0
    )
    limit least(
      greatest(
        coalesce(
          p_limit,
          500
        ),
        1
      ),
      1000
    )
  ),
  bar_metrics as (
    select
      b.stock_code,
      max(b.trading_date) as latest_bar_date,
      (
        array_agg(
          b.close_price::numeric
          order by b.trading_date desc
        )
      )[1] as latest_close,
      count(*)::bigint as recent_bar_count,
      avg(b.volume::numeric) as average_volume,
      avg(
        b.close_price::numeric
        * b.volume::numeric
      ) as average_trading_value
    from public.market_daily_bars b
    inner join members m
      on m.stock_code = b.stock_code
    where b.trading_date >= p_lookback_start_date
      and b.trading_date <= p_market_date
    group by b.stock_code
  )
  select
    m.stock_code,
    m.stock_name,
    m.market,
    m.sector,
    m.security_type,
    m.listed,
    m.tradable,
    m.metadata as membership_metadata,
    bm.latest_bar_date,
    bm.latest_close,
    coalesce(
      bm.recent_bar_count,
      0
    ) as recent_bar_count,
    bm.average_volume,
    bm.average_trading_value
  from members m
  left join bar_metrics bm
    on bm.stock_code = m.stock_code
  order by
    m.market nulls last,
    m.stock_code;
$$;

comment on function public.compute_stock_universe_liquidity_metrics_v8_2_1 is
'Pagination-safe v8.2.1 point-in-time universe liquidity/data-coverage RPC. Each call returns at most p_limit members in deterministic market/stock_code order, preventing PostgREST 1000-row truncation from silently shrinking the market universe.';
