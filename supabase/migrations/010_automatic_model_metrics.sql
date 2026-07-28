begin;


/* =========================================================
   1. 모델 지표 관리 컬럼
   ========================================================= */

alter table public.ai_model_versions
  add column if not exists validation_trade_count integer
    not null default 0
    check (validation_trade_count >= 0);

alter table public.ai_model_versions
  add column if not exists metrics_source text
    not null default 'MANUAL'
    check (
      metrics_source in (
        'MANUAL',
        'AUTOMATIC'
      )
    );

alter table public.ai_model_versions
  add column if not exists metrics_calculated_at timestamptz;


/* =========================================================
   2. 모델별 자동 검증 지표 뷰
   ========================================================= */

create or replace view public.ai_model_validation_metrics
as

with trade_base as (
  select
    t.id,
    t.model_id,
    t.closed_at,

    coalesce(
      t.realized_return,
      0
    )::numeric as trade_return,

    coalesce(
      t.realized_pnl,
      0
    )::numeric as realized_pnl

  from public.paper_trade_history t

  where t.model_id is not null
),


ordered_returns as (
  select
    id,
    model_id,
    closed_at,
    trade_return,
    realized_pnl,

    /*
     * 거래 수익률을 복리 방식으로 누적한다.
     */
    exp(
      sum(
        ln(
          greatest(
            1 + trade_return,
            0.000001
          )
        )
      ) over (
        partition by model_id
        order by closed_at, id
        rows between unbounded preceding
        and current row
      )
    ) as equity_factor

  from trade_base
),


return_paths as (
  select
    *,

    max(equity_factor) over (
      partition by model_id
      order by closed_at, id
      rows between unbounded preceding
      and current row
    ) as peak_equity_factor

  from ordered_returns
),


drawdown_rows as (
  select
    *,

    case
      when peak_equity_factor > 0
      then
        greatest(
          0,
          1 -
          (
            equity_factor
            /
            peak_equity_factor
          )
        )

      else 0
    end as drawdown

  from return_paths
),


trade_aggregates as (
  select
    model_id,

    count(*)::integer
      as sample_size,

    avg(trade_return)
      as average_return,

    count(*) filter (
      where realized_pnl > 0
    )::integer as winning_trade_count,

    count(*) filter (
      where realized_pnl < 0
    )::integer as losing_trade_count,

    count(*) filter (
      where realized_pnl = 0
    )::integer as breakeven_trade_count,

    coalesce(
      sum(realized_pnl) filter (
        where realized_pnl > 0
      ),
      0
    ) as total_profit,

    coalesce(
      sum(realized_pnl) filter (
        where realized_pnl < 0
      ),
      0
    ) as total_loss,

    coalesce(
      max(drawdown),
      0
    ) as max_drawdown

  from drawdown_rows

  group by model_id
),


latest_evaluations as (
  select distinct on (e.trade_id)
    e.trade_id,
    e.quality_score,
    e.verdict,
    e.evaluated_at

  from public.paper_trade_evaluations e

  order by
    e.trade_id,
    e.evaluated_at desc
),


evaluation_aggregates as (
  select
    t.model_id,

    count(*)::integer
      as evaluated_trade_count,

    avg(e.quality_score)
      as stop_quality_score

  from latest_evaluations e

  join public.paper_trade_history t
    on t.id = e.trade_id

  where t.model_id is not null

  group by t.model_id
)


select
  m.id as model_id,
  m.model_name,
  m.model_version,
  m.purpose,
  m.status,

  coalesce(
    t.sample_size,
    0
  )::integer as sample_size,

  coalesce(
    t.average_return,
    0
  )::numeric as average_return,

  case
    when coalesce(
      t.sample_size,
      0
    ) > 0
    then
      coalesce(
        t.winning_trade_count,
        0
      )::numeric
      /
      t.sample_size

    else 0
  end as win_rate,

  /*
   * 손실 거래가 없고 이익 거래가 있으면
   * 표시 가능한 상한값 3으로 처리한다.
   */
  case
    when abs(
      coalesce(
        t.total_loss,
        0
      )
    ) > 0
    then
      least(
        10,
        coalesce(
          t.total_profit,
          0
        )
        /
        abs(t.total_loss)
      )

    when coalesce(
      t.winning_trade_count,
      0
    ) > 0
    then 3

    else 0
  end::numeric as profit_factor,

  coalesce(
    t.max_drawdown,
    0
  )::numeric as max_drawdown,

  coalesce(
    e.evaluated_trade_count,
    0
  )::integer as evaluated_trade_count,

  /*
   * 매도 후 평가가 하나도 없으면 -1로 처리한다.
   * 기존 검증 기준에서 자동으로 승인되지 않게 하기 위함이다.
   */
  case
    when coalesce(
      e.evaluated_trade_count,
      0
    ) = 0
    then -1

    else coalesce(
      e.stop_quality_score,
      -1
    )
  end::numeric as stop_quality_score,

  coalesce(
    t.winning_trade_count,
    0
  )::integer as winning_trade_count,

  coalesce(
    t.losing_trade_count,
    0
  )::integer as losing_trade_count,

  coalesce(
    t.breakeven_trade_count,
    0
  )::integer as breakeven_trade_count

from public.ai_model_versions m

left join trade_aggregates t
  on t.model_id = m.id

left join evaluation_aggregates e
  on e.model_id = m.id;


/* =========================================================
   3. 모델 지표 자동 갱신 함수
   ========================================================= */

create or replace function public.refresh_ai_model_metrics(
  p_model_id uuid default null
)
returns table (
  refreshed_model_id uuid,
  refreshed_model_name text,
  refreshed_model_version text,
  refreshed_sample_size integer,
  refreshed_metrics jsonb,
  refreshed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_model_id is not null
    and not exists (
      select 1
      from public.ai_model_versions m
      where m.id = p_model_id
    )
  then
    raise exception 'MODEL_NOT_FOUND';
  end if;

  return query

  with updated_models as (
    update public.ai_model_versions m

    set
      validation_trade_count =
        v.sample_size,

      metrics =
        jsonb_strip_nulls(
          coalesce(
            m.metrics,
            '{}'::jsonb
          )
          ||
          jsonb_build_object(
            'sampleSize',
              v.sample_size,

            'averageReturn',
              v.average_return,

            'profitFactor',
              v.profit_factor,

            'maxDrawdown',
              v.max_drawdown,

            'stopQualityScore',
              v.stop_quality_score,

            'winRate',
              v.win_rate,

            'evaluatedTradeCount',
              v.evaluated_trade_count,

            'winningTradeCount',
              v.winning_trade_count,

            'losingTradeCount',
              v.losing_trade_count,

            'breakevenTradeCount',
              v.breakeven_trade_count
          )
        ),

      metrics_source = 'AUTOMATIC',
      metrics_calculated_at = now()

    from public.ai_model_validation_metrics v

    where m.id = v.model_id
      and (
        p_model_id is null
        or m.id = p_model_id
      )

    returning
      m.id,
      m.model_name,
      m.model_version,
      m.validation_trade_count,
      m.metrics,
      m.metrics_calculated_at
  )

  select
    u.id,
    u.model_name,
    u.model_version,
    u.validation_trade_count,
    u.metrics,
    u.metrics_calculated_at

  from updated_models u;
end;
$$;


/* =========================================================
   4. 권한 설정
   ========================================================= */

revoke all
on function public.refresh_ai_model_metrics(uuid)
from public, anon, authenticated;

grant execute
on function public.refresh_ai_model_metrics(uuid)
to service_role;


/* =========================================================
   5. PostgREST 스키마 캐시 갱신
   ========================================================= */

notify pgrst, 'reload schema';


commit;