begin;


/* =========================================================
   0. 선행 테이블 확인
   ========================================================= */

do $$
begin
  if to_regclass('public.paper_positions') is null then
    raise exception
      'paper_positions 테이블이 없습니다. 이전 마이그레이션을 먼저 실행하세요.';
  end if;

  if to_regclass('public.paper_order_requests') is null then
    raise exception
      'paper_order_requests 테이블이 없습니다. 이전 마이그레이션을 먼저 실행하세요.';
  end if;

  if to_regclass('public.paper_trade_history') is null then
    raise exception
      'paper_trade_history 테이블이 없습니다. 004 마이그레이션을 먼저 실행하세요.';
  end if;

  if to_regclass('public.paper_trade_evaluations') is null then
    raise exception
      'paper_trade_evaluations 테이블이 없습니다. 006 마이그레이션을 먼저 실행하세요.';
  end if;

  if to_regclass('public.ai_model_versions') is null then
    raise exception
      'ai_model_versions 테이블이 없습니다. 007 마이그레이션을 먼저 실행하세요.';
  end if;
end;
$$;


/* =========================================================
   1. 보유 포지션에 진입 주문·모델 정보 추가
   ========================================================= */

alter table public.paper_positions
  add column if not exists entry_order_id uuid
    references public.paper_order_requests(id)
    on delete set null;

alter table public.paper_positions
  add column if not exists model_id uuid
    references public.ai_model_versions(id)
    on delete set null;

alter table public.paper_positions
  add column if not exists model_snapshot jsonb;


/* =========================================================
   2. 종료 거래에 모델 정보 추가
   ========================================================= */

alter table public.paper_trade_history
  add column if not exists model_id uuid
    references public.ai_model_versions(id)
    on delete set null;

alter table public.paper_trade_history
  add column if not exists model_snapshot jsonb;


/* =========================================================
   3. 인덱스 생성
   ========================================================= */

create index if not exists idx_paper_positions_model
  on public.paper_positions(model_id);

create index if not exists idx_paper_positions_entry_order
  on public.paper_positions(entry_order_id);

create index if not exists idx_trade_history_model
  on public.paper_trade_history(
    model_id,
    closed_at desc
  );


/* =========================================================
   4. 매수 주문 체결 후 포지션에 모델 연결
   ========================================================= */

create or replace function public.bind_model_to_filled_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position_id uuid;
  v_position_model_id uuid;
begin
  /*
   * 매수 주문이 FILLED 상태가 된 경우에만 처리한다.
   */
  if new.side <> 'BUY'
    or new.status <> 'FILLED'
  then
    return new;
  end if;

  /*
   * 이전에 생성된 모델 없는 주문은 그대로 허용한다.
   */
  if new.model_id is null then
    return new;
  end if;

  /*
   * 체결 함수가 먼저 생성하거나 갱신한 포지션을 찾는다.
   */
  select
    id,
    model_id
  into
    v_position_id,
    v_position_model_id
  from public.paper_positions
  where account_id = new.account_id
    and stock_code = new.stock_code
  for update;

  if not found then
    raise exception 'FILLED_BUY_POSITION_NOT_FOUND';
  end if;

  /*
   * 한 포지션에 서로 다른 모델의 추가매수를 섞지 않는다.
   */
  if v_position_model_id is not null
    and v_position_model_id <> new.model_id
  then
    raise exception 'POSITION_MODEL_MISMATCH';
  end if;

  update public.paper_positions
  set
    entry_order_id = coalesce(
      entry_order_id,
      new.id
    ),

    model_id = new.model_id,

    model_snapshot = coalesce(
      new.model_snapshot,
      model_snapshot
    ),

    updated_at = now()
  where id = v_position_id;

  return new;
end;
$$;


drop trigger if exists trg_bind_model_to_filled_position
on public.paper_order_requests;

create trigger trg_bind_model_to_filled_position
after update of status
on public.paper_order_requests
for each row
when (
  new.status = 'FILLED'
  and new.side = 'BUY'
)
execute function public.bind_model_to_filled_position();


/* =========================================================
   5. 거래 종료 시 포지션의 모델을 거래기록에 복사
   ========================================================= */

create or replace function public.attach_model_to_trade_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_order_id uuid;
  v_model_id uuid;
  v_model_snapshot jsonb;
begin
  /*
   * 손절 매도 함수는 거래기록을 넣은 뒤 포지션을 삭제하므로
   * BEFORE INSERT 시점에는 원본 포지션이 존재한다.
   */
  select
    entry_order_id,
    model_id,
    model_snapshot
  into
    v_entry_order_id,
    v_model_id,
    v_model_snapshot
  from public.paper_positions
  where id = new.source_position_id;

  if found then
    new.buy_order_id = coalesce(
      new.buy_order_id,
      v_entry_order_id
    );

    new.model_id = coalesce(
      new.model_id,
      v_model_id
    );

    new.model_snapshot = coalesce(
      new.model_snapshot,
      v_model_snapshot
    );
  end if;

  return new;
end;
$$;


drop trigger if exists trg_attach_model_to_trade_history
on public.paper_trade_history;

create trigger trg_attach_model_to_trade_history
before insert
on public.paper_trade_history
for each row
execute function public.attach_model_to_trade_history();


/* =========================================================
   6. 기존 보유 포지션에 과거 매수 모델 연결
   ========================================================= */

with latest_position_orders as (
  select distinct on (p.id)
    p.id as position_id,
    o.id as entry_order_id,
    o.model_id,
    o.model_snapshot

  from public.paper_positions p

  join public.paper_order_requests o
    on o.account_id = p.account_id
    and o.stock_code = p.stock_code
    and o.side = 'BUY'
    and o.status = 'FILLED'
    and o.model_id is not null

  where p.model_id is null

  order by
    p.id,
    o.executed_at desc nulls last,
    o.created_at desc
)

update public.paper_positions p
set
  entry_order_id = source.entry_order_id,
  model_id = source.model_id,
  model_snapshot = source.model_snapshot,
  updated_at = now()

from latest_position_orders source

where p.id = source.position_id;


/* =========================================================
   7. 기존 종료 거래에 과거 매수 모델 연결
   ========================================================= */

with latest_trade_orders as (
  select distinct on (t.id)
    t.id as trade_id,
    o.id as buy_order_id,
    o.model_id,
    o.model_snapshot

  from public.paper_trade_history t

  join public.paper_order_requests o
    on o.account_id = t.account_id
    and o.stock_code = t.stock_code
    and o.side = 'BUY'
    and o.status = 'FILLED'
    and o.model_id is not null
    and coalesce(
      o.executed_at,
      o.created_at
    ) <= t.closed_at

  where t.model_id is null

  order by
    t.id,
    coalesce(
      o.executed_at,
      o.created_at
    ) desc
)

update public.paper_trade_history t
set
  buy_order_id = coalesce(
    t.buy_order_id,
    source.buy_order_id
  ),

  model_id = coalesce(
    t.model_id,
    source.model_id
  ),

  model_snapshot = coalesce(
    t.model_snapshot,
    source.model_snapshot
  )

from latest_trade_orders source

where t.id = source.trade_id;


/* =========================================================
   8. 모델별 성과 집계 뷰 생성
   ========================================================= */

create or replace view public.ai_model_performance_summary
as

with order_stats as (
  select
    model_id,

    count(*) filter (
      where side = 'BUY'
    ) as buy_order_count,

    count(*) filter (
      where side = 'BUY'
        and approved_quantity > 0
    ) as risk_approved_count,

    count(*) filter (
      where side = 'BUY'
        and status = 'RISK_REJECTED'
    ) as risk_rejected_count,

    count(*) filter (
      where side = 'BUY'
        and status = 'FILLED'
    ) as filled_buy_count

  from public.paper_order_requests

  where model_id is not null

  group by model_id
),


trade_stats as (
  select
    model_id,

    count(*) as closed_trade_count,

    count(*) filter (
      where realized_pnl > 0
    ) as winning_trade_count,

    count(*) filter (
      where realized_pnl < 0
    ) as losing_trade_count,

    count(*) filter (
      where realized_pnl = 0
    ) as breakeven_trade_count,

    coalesce(
      sum(realized_pnl),
      0
    ) as total_realized_pnl,

    avg(realized_pnl)
      as average_realized_pnl,

    avg(realized_return)
      as average_realized_return,

    max(realized_return)
      as best_trade_return,

    min(realized_return)
      as worst_trade_return,

    /*
     * 총이익 / 총손실 절댓값
     * 손실 거래가 없으면 NULL로 둔다.
     */
    case
      when abs(
        coalesce(
          sum(realized_pnl) filter (
            where realized_pnl < 0
          ),
          0
        )
      ) > 0
      then
        coalesce(
          sum(realized_pnl) filter (
            where realized_pnl > 0
          ),
          0
        )
        /
        abs(
          sum(realized_pnl) filter (
            where realized_pnl < 0
          )
        )

      else null
    end as profit_factor

  from public.paper_trade_history

  where model_id is not null

  group by model_id
),


latest_evaluations as (
  /*
   * 여러 평가 버전이 존재할 수 있으므로
   * 거래별 가장 최근 평가만 사용한다.
   */
  select distinct on (trade_id)
    trade_id,
    evaluation_stage,
    verdict,
    quality_score,
    evaluated_at

  from public.paper_trade_evaluations

  order by
    trade_id,
    evaluated_at desc
),


evaluation_stats as (
  select
    t.model_id,

    count(*) as evaluated_trade_count,

    avg(e.quality_score)
      as average_stop_quality_score,

    count(*) filter (
      where e.verdict = 'PENDING'
    ) as pending_evaluation_count,

    count(*) filter (
      where e.verdict = 'PROTECTED_CAPITAL'
    ) as protected_capital_count,

    count(*) filter (
      where e.verdict = 'EARLY_EXIT'
    ) as early_exit_count,

    count(*) filter (
      where e.verdict = 'MIXED'
    ) as mixed_exit_count,

    count(*) filter (
      where e.verdict = 'NEUTRAL'
    ) as neutral_exit_count,

    count(*) filter (
      where e.evaluation_stage = 'DAY_1'
    ) as day_1_evaluation_count,

    count(*) filter (
      where e.evaluation_stage = 'DAY_5'
    ) as day_5_evaluation_count,

    count(*) filter (
      where e.evaluation_stage = 'DAY_20'
    ) as day_20_evaluation_count

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
  m.training_trade_count,

  /* 주문 통계 */
  coalesce(
    o.buy_order_count,
    0
  ) as buy_order_count,

  coalesce(
    o.risk_approved_count,
    0
  ) as risk_approved_count,

  coalesce(
    o.risk_rejected_count,
    0
  ) as risk_rejected_count,

  coalesce(
    o.filled_buy_count,
    0
  ) as filled_buy_count,

  case
    when coalesce(
      o.buy_order_count,
      0
    ) > 0
    then
      o.risk_approved_count::numeric
      /
      o.buy_order_count
    else null
  end as risk_approval_rate,

  /* 종료 거래 통계 */
  coalesce(
    t.closed_trade_count,
    0
  ) as closed_trade_count,

  coalesce(
    t.winning_trade_count,
    0
  ) as winning_trade_count,

  coalesce(
    t.losing_trade_count,
    0
  ) as losing_trade_count,

  coalesce(
    t.breakeven_trade_count,
    0
  ) as breakeven_trade_count,

  case
    when coalesce(
      t.closed_trade_count,
      0
    ) > 0
    then
      t.winning_trade_count::numeric
      /
      t.closed_trade_count
    else null
  end as win_rate,

  coalesce(
    t.total_realized_pnl,
    0
  ) as total_realized_pnl,

  t.average_realized_pnl,
  t.average_realized_return,
  t.best_trade_return,
  t.worst_trade_return,
  t.profit_factor,

  /* 손절 평가 통계 */
  coalesce(
    e.evaluated_trade_count,
    0
  ) as evaluated_trade_count,

  e.average_stop_quality_score,

  coalesce(
    e.pending_evaluation_count,
    0
  ) as pending_evaluation_count,

  coalesce(
    e.protected_capital_count,
    0
  ) as protected_capital_count,

  coalesce(
    e.early_exit_count,
    0
  ) as early_exit_count,

  coalesce(
    e.mixed_exit_count,
    0
  ) as mixed_exit_count,

  coalesce(
    e.neutral_exit_count,
    0
  ) as neutral_exit_count,

  coalesce(
    e.day_1_evaluation_count,
    0
  ) as day_1_evaluation_count,

  coalesce(
    e.day_5_evaluation_count,
    0
  ) as day_5_evaluation_count,

  coalesce(
    e.day_20_evaluation_count,
    0
  ) as day_20_evaluation_count,

  /* 모델 메타데이터 */
  m.created_at,
  m.evaluated_at,
  m.approved_at,
  m.rejected_at

from public.ai_model_versions m

left join order_stats o
  on o.model_id = m.id

left join trade_stats t
  on t.model_id = m.id

left join evaluation_stats e
  on e.model_id = m.id;


/* =========================================================
   9. PostgREST 스키마 캐시 갱신
   ========================================================= */

notify pgrst, 'reload schema';


commit;