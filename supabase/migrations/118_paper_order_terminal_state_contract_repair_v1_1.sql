-- AI Stock Lab
-- #5 / PAPER Order Terminal State Contract Repair V1.1
--
-- Explicit replacement of the canonical validator contract.
-- This avoids fragile source-string mutation.
--
-- Preserved contract:
--   CREATE: RISK_APPROVED / RISK_REJECTED / FILLED allowed
--   CREATE CANCELLED blocked
--   RISK_APPROVED -> FILLED allowed
--   RISK_APPROVED -> EXPIRED allowed
--   RISK_APPROVED -> CANCELLED blocked
--   terminal states cannot transition
--   normalized identical state = idempotent no-op
--   CANCELED normalizes to CANCELLED
--   unsupported source states are rejected
--
-- Added contract:
--   RISK_APPROVED -> FAILED allowed
--   FAILED is terminal
--   FAILED retry is idempotent
--
-- DB CHECK alignment:
--   add EXPIRED and FAILED.
--
-- Production BUY/SELL execution RPCs are NOT replaced.

begin;

create or replace function
  public.validate_paper_order_state_transition_v1(
    p_old_status text,
    p_new_status text,
    p_is_insert boolean default false
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_raw text := p_old_status;
  v_new_raw text := p_new_status;

  v_old text :=
    public.normalize_paper_order_status_v1(
      p_old_status
    );

  v_new text :=
    public.normalize_paper_order_status_v1(
      p_new_status
    );

  v_allowed boolean := false;
  v_reason text := 'TRANSITION_NOT_ALLOWED';
  v_idempotent boolean := false;
begin
  if v_new is null then
    v_allowed := false;
    v_reason := 'NEW_STATUS_REQUIRED';

  elsif p_is_insert then
    if v_new in (
      'RISK_APPROVED',
      'RISK_REJECTED',
      'FILLED'
    ) then
      v_allowed := true;
      v_reason := 'CREATE_ALLOWED';
    else
      v_allowed := false;
      v_reason := 'CREATE_STATUS_NOT_ALLOWED';
    end if;

  elsif v_old is null then
    v_allowed := false;
    v_reason := 'UNSUPPORTED_FROM_STATUS';

  elsif v_old = v_new then
    v_allowed := true;
    v_reason := 'IDEMPOTENT_NOOP';
    v_idempotent := true;

  elsif v_old in (
    'RISK_REJECTED',
    'FILLED',
    'CANCELLED',
    'EXPIRED',
    'FAILED'
  ) then
    v_allowed := false;
    v_reason := 'TERMINAL_STATE_CANNOT_TRANSITION';

  elsif v_old = 'RISK_APPROVED'
    and v_new in (
      'FILLED',
      'EXPIRED',
      'FAILED'
    )
  then
    v_allowed := true;
    v_reason := 'TRANSITION_ALLOWED';

  elsif v_old not in (
    'RISK_APPROVED',
    'RISK_REJECTED',
    'FILLED',
    'CANCELLED',
    'EXPIRED',
    'FAILED'
  ) then
    v_allowed := false;
    v_reason := 'UNSUPPORTED_FROM_STATUS';

  else
    v_allowed := false;
    v_reason := 'TRANSITION_NOT_ALLOWED';
  end if;

  return jsonb_build_object(
    'to',
      v_new,

    'from',
      v_old,

    'newRaw',
      v_new_raw,

    'oldRaw',
      v_old_raw,

    'reason',
      v_reason,

    'allowed',
      v_allowed,

    'version',
      'ALPHA_V3_ORDER_STATE_MACHINE_V1',

    'isInsert',
      coalesce(p_is_insert, false),

    'idempotent',
      v_idempotent
  );
end;
$$;

alter table public.paper_order_requests
  drop constraint if exists
    paper_order_requests_status_check;

alter table public.paper_order_requests
  add constraint
    paper_order_requests_status_check
  check (
    status = any (
      array[
        'RISK_APPROVED'::text,
        'RISK_REJECTED'::text,
        'FILLED'::text,
        'CANCELLED'::text,
        'EXPIRED'::text,
        'FAILED'::text
      ]
    )
  );

create or replace function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case jsonb;

  v_failed_transition jsonb;
  v_failed_retry jsonb;
  v_failed_terminal jsonb;
  v_expired_transition jsonb;
  v_cancelled_transition jsonb;
  v_create_failed jsonb;
  v_create_filled jsonb;
  v_alias_retry jsonb;
  v_unsupported jsonb;

  v_status_constraint text;

  v_all_pass boolean := false;
begin
  select
    pg_get_constraintdef(c.oid)
  into
    v_status_constraint
  from pg_constraint c
  where c.conrelid =
      'public.paper_order_requests'::regclass
    and c.conname =
      'paper_order_requests_status_check'
    and c.contype = 'c'
  limit 1;

  if v_status_constraint is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_REVIEW',
      'reason',
        'STATUS_CHECK_NOT_FOUND'
    );
  end if;

  v_failed_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'FAILED',
      false
    );

  v_failed_retry :=
    public.validate_paper_order_state_transition_v1(
      'FAILED',
      'FAILED',
      false
    );

  v_failed_terminal :=
    public.validate_paper_order_state_transition_v1(
      'FAILED',
      'FILLED',
      false
    );

  v_expired_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'EXPIRED',
      false
    );

  v_cancelled_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'CANCELLED',
      false
    );

  v_create_failed :=
    public.validate_paper_order_state_transition_v1(
      null,
      'FAILED',
      true
    );

  v_create_filled :=
    public.validate_paper_order_state_transition_v1(
      null,
      'FILLED',
      true
    );

  v_alias_retry :=
    public.validate_paper_order_state_transition_v1(
      'CANCELED',
      'CANCELLED',
      false
    );

  v_unsupported :=
    public.validate_paper_order_state_transition_v1(
      'APPROVED',
      'RISK_APPROVED',
      false
    );

  v_all_pass :=
    coalesce(
      (v_failed_transition ->> 'allowed')::boolean,
      false
    )
    and
    (v_failed_transition ->> 'reason') =
      'TRANSITION_ALLOWED'

    and

    coalesce(
      (v_failed_retry ->> 'allowed')::boolean,
      false
    )
    and
    coalesce(
      (v_failed_retry ->> 'idempotent')::boolean,
      false
    )
    and
    (v_failed_retry ->> 'reason') =
      'IDEMPOTENT_NOOP'

    and

    not coalesce(
      (v_failed_terminal ->> 'allowed')::boolean,
      true
    )
    and
    (v_failed_terminal ->> 'reason') =
      'TERMINAL_STATE_CANNOT_TRANSITION'

    and

    coalesce(
      (v_expired_transition ->> 'allowed')::boolean,
      false
    )
    and
    (v_expired_transition ->> 'reason') =
      'TRANSITION_ALLOWED'

    and

    not coalesce(
      (v_cancelled_transition ->> 'allowed')::boolean,
      true
    )
    and
    (v_cancelled_transition ->> 'reason') =
      'TRANSITION_NOT_ALLOWED'

    and

    not coalesce(
      (v_create_failed ->> 'allowed')::boolean,
      true
    )
    and
    (v_create_failed ->> 'reason') =
      'CREATE_STATUS_NOT_ALLOWED'

    and

    coalesce(
      (v_create_filled ->> 'allowed')::boolean,
      false
    )
    and
    (v_create_filled ->> 'reason') =
      'CREATE_ALLOWED'

    and

    coalesce(
      (v_alias_retry ->> 'allowed')::boolean,
      false
    )
    and
    coalesce(
      (v_alias_retry ->> 'idempotent')::boolean,
      false
    )
    and
    (v_alias_retry ->> 'reason') =
      'IDEMPOTENT_NOOP'

    and

    not coalesce(
      (v_unsupported ->> 'allowed')::boolean,
      true
    )
    and
    (v_unsupported ->> 'reason') =
      'UNSUPPORTED_FROM_STATUS'

    and

    position(
      'FAILED'
      in upper(v_status_constraint)
    ) > 0

    and

    position(
      'EXPIRED'
      in upper(v_status_constraint)
    ) > 0;

  return jsonb_build_object(
    'status',
      case
        when v_all_pass then
          'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_PASS'
        else
          'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_REVIEW'
      end,

    'classification',
      case
        when v_all_pass then
          'FAILED_AND_EXPIRED_ORDER_STATE_CONTRACT_ALIGNED'
        else
          'ORDER_STATE_CONTRACT_REVIEW_REQUIRED'
      end,

    'statusConstraint',
      v_status_constraint,

    'checks',
      jsonb_build_object(
        'riskApprovedToFailed',
          v_failed_transition,

        'failedRetry',
          v_failed_retry,

        'failedTerminal',
          v_failed_terminal,

        'riskApprovedToExpired',
          v_expired_transition,

        'riskApprovedToCancelled',
          v_cancelled_transition,

        'createFailed',
          v_create_failed,

        'createFilled',
          v_create_filled,

        'canceledAliasRetry',
          v_alias_retry,

        'unsupportedApprovedFrom',
          v_unsupported,

        'dbConstraintAllowsFailed',
          position(
            'FAILED'
            in upper(v_status_constraint)
          ) > 0,

        'dbConstraintAllowsExpired',
          position(
            'EXPIRED'
            in upper(v_status_constraint)
          ) > 0
      ),

    'safety',
      jsonb_build_object(
        'validatorOnly',
          true,
        'paperOrderWrites',
          0,
        'positionWrites',
          0,
        'realBrokerApiInvoked',
          false,
        'realOrdersSent',
          false,
        'shadowFilesModified',
          false,
        'realTradingEnabled',
          false
      ),

    'nextGate',
      'TERMINAL_STATE_CONTRACT_RUNTIME_REVIEW'
  );
end;
$$;

revoke all on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
from public, anon, authenticated;

grant execute on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
to service_role;

comment on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
is
  'Read-only state-contract runtime regression for FAILED/EXPIRED alignment. No paper order or position writes.';

commit;
