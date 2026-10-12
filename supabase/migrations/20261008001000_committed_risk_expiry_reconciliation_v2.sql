-- Alpha V3: committed-risk expiry + reconciliation.
--
-- Goals:
-- 1) Expire stale RISK_APPROVED BUY reservations under the same account-scoped
--    advisory lock used by reservation/fill.
-- 2) Let the existing terminal-status trigger release reservation risk inside
--    the same transaction when status becomes EXPIRED.
-- 3) Reconcile abnormal terminal rows that still retain reserved risk.
-- 4) Report active RISK_APPROVED anomalies without ever increasing risk.
--
-- No scheduler is installed here. The caller must explicitly choose the
-- stale interval based on execution SLA / polling cadence.

create index if not exists
  idx_paper_order_requests_committed_risk_expiry_v3
on public.paper_order_requests (
  (coalesce(reserved_risk_at, created_at)),
  account_id,
  id
)
where
  status = 'RISK_APPROVED'
  and side = 'BUY'
  and reserved_risk_amount > 0
  and reserved_risk_released_at is null;

create or replace function public.expire_stale_paper_buy_reservations_v3(
  p_stale_after interval,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_order public.paper_order_requests%rowtype;
  v_expired_count integer := 0;
  v_skipped_count integer := 0;
  v_total_released numeric := 0;
  v_cutoff timestamptz;
begin
  if p_stale_after is null
     or p_stale_after < interval '1 minute'
     or p_stale_after > interval '24 hours' then
    raise exception 'STALE_AFTER_OUT_OF_RANGE';
  end if;

  if p_limit is null
     or p_limit < 1
     or p_limit > 1000 then
    raise exception 'LIMIT_OUT_OF_RANGE';
  end if;

  v_cutoff := now() - p_stale_after;

  for v_candidate in
    select
      por.id,
      por.account_id
    from public.paper_order_requests por
    where por.status = 'RISK_APPROVED'
      and por.side = 'BUY'
      and por.reserved_risk_amount > 0
      and por.reserved_risk_released_at is null
      and coalesce(por.reserved_risk_at, por.created_at) <= v_cutoff
    order by
      por.account_id,
      coalesce(por.reserved_risk_at, por.created_at),
      por.id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_id::text
      )
    );

    select *
    into v_order
    from public.paper_order_requests
    where id = v_candidate.id
    for update;

    if not found then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    if v_order.account_id <> v_candidate.account_id
       or v_order.status <> 'RISK_APPROVED'
       or v_order.side <> 'BUY'
       or coalesce(v_order.reserved_risk_amount, 0) <= 0
       or v_order.reserved_risk_released_at is not null
       or coalesce(v_order.reserved_risk_at, v_order.created_at) > v_cutoff then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    v_total_released :=
      v_total_released + coalesce(v_order.reserved_risk_amount, 0);

    update public.paper_order_requests
    set
      status = 'EXPIRED',
      committed_risk_reason = 'STALE_RISK_APPROVED_EXPIRED',
      committed_risk_snapshot =
        coalesce(committed_risk_snapshot, '{}'::jsonb) ||
        jsonb_build_object(
          'expiry', jsonb_build_object(
            'expiredAt', now(),
            'staleAfterSeconds', extract(epoch from p_stale_after),
            'reservedRiskBefore', v_order.reserved_risk_amount
          )
        )
    where id = v_order.id;

    v_expired_count := v_expired_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'cutoff', v_cutoff,
    'staleAfterSeconds', extract(epoch from p_stale_after),
    'limit', p_limit,
    'expiredCount', v_expired_count,
    'skippedCount', v_skipped_count,
    'releasedRiskObservedBeforeTrigger', v_total_released
  );
end;
$$;

create or replace function public.reconcile_paper_buy_reserved_risk_v3(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_order public.paper_order_requests%rowtype;

  v_terminal_released_count integer := 0;
  v_terminal_released_risk numeric := 0;

  v_active_zero_reservation_count integer := 0;
  v_active_missing_reserved_at_count integer := 0;
  v_active_released_at_conflict_count integer := 0;

  v_active_zero_ids uuid[] := '{}'::uuid[];
  v_active_missing_time_ids uuid[] := '{}'::uuid[];
  v_active_release_conflict_ids uuid[] := '{}'::uuid[];
begin
  if p_limit is null
     or p_limit < 1
     or p_limit > 5000 then
    raise exception 'LIMIT_OUT_OF_RANGE';
  end if;

  for v_candidate in
    select
      por.id,
      por.account_id
    from public.paper_order_requests por
    where por.side = 'BUY'
      and por.status in (
        'FILLED',
        'RISK_REJECTED',
        'REJECTED',
        'CANCELLED',
        'CANCELED',
        'EXPIRED',
        'FAILED',
        'CLOSED'
      )
      and por.reserved_risk_amount > 0
    order by por.account_id, por.id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_id::text
      )
    );

    select *
    into v_order
    from public.paper_order_requests
    where id = v_candidate.id
    for update;

    if not found then
      continue;
    end if;

    if v_order.account_id <> v_candidate.account_id
       or v_order.side <> 'BUY'
       or v_order.status not in (
         'FILLED',
         'RISK_REJECTED',
         'REJECTED',
         'CANCELLED',
         'CANCELED',
         'EXPIRED',
         'FAILED',
         'CLOSED'
       )
       or coalesce(v_order.reserved_risk_amount, 0) <= 0 then
      continue;
    end if;

    v_terminal_released_risk :=
      v_terminal_released_risk + v_order.reserved_risk_amount;

    update public.paper_order_requests
    set
      reserved_risk_amount = 0,
      reserved_risk_released_at =
        coalesce(reserved_risk_released_at, now()),
      reserved_risk_release_reason =
        coalesce(
          reserved_risk_release_reason,
          'RECONCILED_TERMINAL_STATUS:' || v_order.status
        ),
      committed_risk_reason =
        coalesce(
          committed_risk_reason,
          'RECONCILED_TERMINAL_RESERVED_RISK'
        ),
      committed_risk_snapshot =
        coalesce(committed_risk_snapshot, '{}'::jsonb) ||
        jsonb_build_object(
          'reconciliation', jsonb_build_object(
            'reconciledAt', now(),
            'status', v_order.status,
            'reservedRiskBefore', v_order.reserved_risk_amount
          )
        )
    where id = v_order.id;

    v_terminal_released_count := v_terminal_released_count + 1;
  end loop;

  select
    count(*),
    coalesce(array_agg(id order by id), '{}'::uuid[])
  into
    v_active_zero_reservation_count,
    v_active_zero_ids
  from (
    select por.id
    from public.paper_order_requests por
    where por.side = 'BUY'
      and por.status = 'RISK_APPROVED'
      and coalesce(por.reserved_risk_amount, 0) <= 0
    order by por.id
    limit p_limit
  ) q;

  select
    count(*),
    coalesce(array_agg(id order by id), '{}'::uuid[])
  into
    v_active_missing_reserved_at_count,
    v_active_missing_time_ids
  from (
    select por.id
    from public.paper_order_requests por
    where por.side = 'BUY'
      and por.status = 'RISK_APPROVED'
      and por.reserved_risk_amount > 0
      and por.reserved_risk_at is null
    order by por.id
    limit p_limit
  ) q;

  select
    count(*),
    coalesce(array_agg(id order by id), '{}'::uuid[])
  into
    v_active_released_at_conflict_count,
    v_active_release_conflict_ids
  from (
    select por.id
    from public.paper_order_requests por
    where por.side = 'BUY'
      and por.status = 'RISK_APPROVED'
      and por.reserved_risk_amount > 0
      and por.reserved_risk_released_at is not null
    order by por.id
    limit p_limit
  ) q;

  return jsonb_build_object(
    'ok', true,
    'limit', p_limit,
    'terminalRepair', jsonb_build_object(
      'releasedCount', v_terminal_released_count,
      'releasedRisk', v_terminal_released_risk
    ),
    'activeAnomalies', jsonb_build_object(
      'zeroReservationCount', v_active_zero_reservation_count,
      'zeroReservationIds', v_active_zero_ids,
      'missingReservedAtCount', v_active_missing_reserved_at_count,
      'missingReservedAtIds', v_active_missing_time_ids,
      'releasedAtConflictCount', v_active_released_at_conflict_count,
      'releasedAtConflictIds', v_active_release_conflict_ids
    ),
    'invariant', 'RECONCILIATION_NEVER_INCREASES_RESERVED_RISK'
  );
end;
$$;

revoke all on function public.expire_stale_paper_buy_reservations_v3(
  interval, integer
) from public;
revoke all on function public.expire_stale_paper_buy_reservations_v3(
  interval, integer
) from anon;
revoke all on function public.expire_stale_paper_buy_reservations_v3(
  interval, integer
) from authenticated;
grant execute on function public.expire_stale_paper_buy_reservations_v3(
  interval, integer
) to service_role;

revoke all on function public.reconcile_paper_buy_reserved_risk_v3(
  integer
) from public;
revoke all on function public.reconcile_paper_buy_reserved_risk_v3(
  integer
) from anon;
revoke all on function public.reconcile_paper_buy_reserved_risk_v3(
  integer
) from authenticated;
grant execute on function public.reconcile_paper_buy_reserved_risk_v3(
  integer
) to service_role;
