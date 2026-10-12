-- ============================================================
-- 059_historical_pit_binding_v9_2_1.sql
-- AI Stock Lab
-- v9.2.1 Purged/Embargo Validation -> Historical PIT Compilation Binding
-- ============================================================
-- Purpose:
--   Bind leakage-resistant validation plans to one exact READY historical
--   PIT compilation instead of reading canonical/current memberships.
--
-- Safety:
--   * No copy/promotion into stock_universe_memberships.
--   * Missing/duplicate historical snapshot coverage fails closed.
--   * production_applied remains false.
-- ============================================================

alter table public.alpha_validation_plans
  add column if not exists pit_compilation_run_id uuid
  references public.historical_universe_compilation_runs(id)
  on delete restrict;

create index if not exists
  idx_alpha_validation_plans_pit_compilation
on public.alpha_validation_plans (
  pit_compilation_run_id,
  created_at desc
);

create or replace function public.check_historical_pit_compilation_coverage_v9_2_1(
  p_compilation_run_id uuid,
  p_universe_code text,
  p_as_of_date date,
  p_minimum_members integer default 500
)
returns table (
  member_count bigint,
  complete_member_count bigint,
  incomplete_member_count bigint,
  coverage_ready boolean,
  coverage_status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with compilation as (
    select
      r.id,
      (
        r.status = 'READY'
        and r.universe_code = p_universe_code
        and r.is_validation = false
        and r.production_applied = false
        and r.start_date <= p_as_of_date
        and r.end_date >= p_as_of_date
        and r.expected_trading_dates > 0
        and r.imported_complete_dates = r.expected_trading_dates
        and r.missing_trading_dates = 0
        and r.duplicate_complete_dates = 0
        and r.compiled_interval_count > 0
      ) as compilation_ready
    from public.historical_universe_compilation_runs r
    where r.id = p_compilation_run_id
  ),
  resolved as (
    select
      m.stock_code
    from public.historical_universe_compiled_memberships m
    join compilation c
      on c.id = m.compilation_run_id
    where m.compilation_run_id = p_compilation_run_id
      and m.universe_code = p_universe_code
      and m.is_validation = false
      and m.production_applied = false
      and m.valid_from <= p_as_of_date
      and m.valid_to > p_as_of_date
  ),
  counts as (
    select count(*)::bigint as member_count
    from resolved
  ),
  state as (
    select
      coalesce(
        (
          select c.compilation_ready
          from compilation c
          limit 1
        ),
        false
      ) as compilation_ready,
      c.member_count
    from counts c
  )
  select
    s.member_count,

    case
      when s.compilation_ready
        then s.member_count
      else 0::bigint
    end as complete_member_count,

    case
      when s.compilation_ready
        then 0::bigint
      else s.member_count
    end as incomplete_member_count,

    (
      s.compilation_ready
      and s.member_count >= greatest(
        coalesce(p_minimum_members, 500),
        1
      )
    ) as coverage_ready,

    case
      when not s.compilation_ready
        then 'INCOMPLETE_COVERAGE'
      when s.member_count = 0
        then 'NO_MEMBERS'
      when s.member_count < greatest(
        coalesce(p_minimum_members, 500),
        1
      )
        then 'TOO_FEW_MEMBERS'
      else 'READY'
    end as coverage_status

  from state s;
$$;

comment on column public.alpha_validation_plans.pit_compilation_run_id is
'v9.2.1 exact historical PIT staging compilation bound to this validation plan. Canonical/current memberships are not substituted.';

comment on function public.check_historical_pit_compilation_coverage_v9_2_1 is
'Resolves historical PIT membership from one explicitly bound READY compilation and its compiled intervals.';
