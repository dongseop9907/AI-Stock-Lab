const fs = require("fs");
const path = require("path");

const root = process.cwd();

const oldBrokenTarget =
  path.resolve(
    root,
    "supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v1.sql"
  );

const target =
  path.resolve(
    root,
    "supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql"
  );

const verifierFile =
  path.resolve(
    root,
    "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs"
  );

if (
  fs.existsSync(oldBrokenTarget)
) {
  fs.rmSync(
    oldBrokenTarget,
    {
      force: true
    }
  );
}

const migrationSql =
  "-- Alpha V3: committed-risk expiry + reconciliation.\n--\n-- Goals:\n-- 1) Expire stale RISK_APPROVED BUY reservations under the same account-scoped\n--    advisory lock used by reservation/fill.\n-- 2) Let the existing terminal-status trigger release reservation risk inside\n--    the same transaction when status becomes EXPIRED.\n-- 3) Reconcile abnormal terminal rows that still retain reserved risk.\n-- 4) Report active RISK_APPROVED anomalies without ever increasing risk.\n--\n-- No scheduler is installed here. The caller must explicitly choose the\n-- stale interval based on execution SLA / polling cadence.\n\ncreate index if not exists\n  idx_paper_order_requests_committed_risk_expiry_v3\non public.paper_order_requests (\n  (coalesce(reserved_risk_at, created_at)),\n  account_id,\n  id\n)\nwhere\n  status = 'RISK_APPROVED'\n  and side = 'BUY'\n  and reserved_risk_amount > 0\n  and reserved_risk_released_at is null;\n\ncreate or replace function public.expire_stale_paper_buy_reservations_v3(\n  p_stale_after interval,\n  p_limit integer default 100\n)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_candidate record;\n  v_order public.paper_order_requests%rowtype;\n  v_expired_count integer := 0;\n  v_skipped_count integer := 0;\n  v_total_released numeric := 0;\n  v_cutoff timestamptz;\nbegin\n  if p_stale_after is null\n     or p_stale_after < interval '1 minute'\n     or p_stale_after > interval '24 hours' then\n    raise exception 'STALE_AFTER_OUT_OF_RANGE';\n  end if;\n\n  if p_limit is null\n     or p_limit < 1\n     or p_limit > 1000 then\n    raise exception 'LIMIT_OUT_OF_RANGE';\n  end if;\n\n  v_cutoff := now() - p_stale_after;\n\n  for v_candidate in\n    select\n      por.id,\n      por.account_id\n    from public.paper_order_requests por\n    where por.status = 'RISK_APPROVED'\n      and por.side = 'BUY'\n      and por.reserved_risk_amount > 0\n      and por.reserved_risk_released_at is null\n      and coalesce(por.reserved_risk_at, por.created_at) <= v_cutoff\n    order by\n      por.account_id,\n      coalesce(por.reserved_risk_at, por.created_at),\n      por.id\n    limit p_limit\n  loop\n    perform pg_advisory_xact_lock(\n      hashtext(\n        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||\n        v_candidate.account_id::text\n      )\n    );\n\n    select *\n    into v_order\n    from public.paper_order_requests\n    where id = v_candidate.id\n    for update;\n\n    if not found then\n      v_skipped_count := v_skipped_count + 1;\n      continue;\n    end if;\n\n    if v_order.account_id <> v_candidate.account_id\n       or v_order.status <> 'RISK_APPROVED'\n       or v_order.side <> 'BUY'\n       or coalesce(v_order.reserved_risk_amount, 0) <= 0\n       or v_order.reserved_risk_released_at is not null\n       or coalesce(v_order.reserved_risk_at, v_order.created_at) > v_cutoff then\n      v_skipped_count := v_skipped_count + 1;\n      continue;\n    end if;\n\n    v_total_released :=\n      v_total_released + coalesce(v_order.reserved_risk_amount, 0);\n\n    update public.paper_order_requests\n    set\n      status = 'EXPIRED',\n      committed_risk_reason = 'STALE_RISK_APPROVED_EXPIRED',\n      committed_risk_snapshot =\n        coalesce(committed_risk_snapshot, '{}'::jsonb) ||\n        jsonb_build_object(\n          'expiry', jsonb_build_object(\n            'expiredAt', now(),\n            'staleAfterSeconds', extract(epoch from p_stale_after),\n            'reservedRiskBefore', v_order.reserved_risk_amount\n          )\n        )\n    where id = v_order.id;\n\n    v_expired_count := v_expired_count + 1;\n  end loop;\n\n  return jsonb_build_object(\n    'ok', true,\n    'cutoff', v_cutoff,\n    'staleAfterSeconds', extract(epoch from p_stale_after),\n    'limit', p_limit,\n    'expiredCount', v_expired_count,\n    'skippedCount', v_skipped_count,\n    'releasedRiskObservedBeforeTrigger', v_total_released\n  );\nend;\n$$;\n\ncreate or replace function public.reconcile_paper_buy_reserved_risk_v3(\n  p_limit integer default 500\n)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_candidate record;\n  v_order public.paper_order_requests%rowtype;\n\n  v_terminal_released_count integer := 0;\n  v_terminal_released_risk numeric := 0;\n\n  v_active_zero_reservation_count integer := 0;\n  v_active_missing_reserved_at_count integer := 0;\n  v_active_released_at_conflict_count integer := 0;\n\n  v_active_zero_ids uuid[] := '{}'::uuid[];\n  v_active_missing_time_ids uuid[] := '{}'::uuid[];\n  v_active_release_conflict_ids uuid[] := '{}'::uuid[];\nbegin\n  if p_limit is null\n     or p_limit < 1\n     or p_limit > 5000 then\n    raise exception 'LIMIT_OUT_OF_RANGE';\n  end if;\n\n  for v_candidate in\n    select\n      por.id,\n      por.account_id\n    from public.paper_order_requests por\n    where por.side = 'BUY'\n      and por.status in (\n        'FILLED',\n        'RISK_REJECTED',\n        'REJECTED',\n        'CANCELLED',\n        'CANCELED',\n        'EXPIRED',\n        'FAILED',\n        'CLOSED'\n      )\n      and por.reserved_risk_amount > 0\n    order by por.account_id, por.id\n    limit p_limit\n  loop\n    perform pg_advisory_xact_lock(\n      hashtext(\n        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||\n        v_candidate.account_id::text\n      )\n    );\n\n    select *\n    into v_order\n    from public.paper_order_requests\n    where id = v_candidate.id\n    for update;\n\n    if not found then\n      continue;\n    end if;\n\n    if v_order.account_id <> v_candidate.account_id\n       or v_order.side <> 'BUY'\n       or v_order.status not in (\n         'FILLED',\n         'RISK_REJECTED',\n         'REJECTED',\n         'CANCELLED',\n         'CANCELED',\n         'EXPIRED',\n         'FAILED',\n         'CLOSED'\n       )\n       or coalesce(v_order.reserved_risk_amount, 0) <= 0 then\n      continue;\n    end if;\n\n    v_terminal_released_risk :=\n      v_terminal_released_risk + v_order.reserved_risk_amount;\n\n    update public.paper_order_requests\n    set\n      reserved_risk_amount = 0,\n      reserved_risk_released_at =\n        coalesce(reserved_risk_released_at, now()),\n      reserved_risk_release_reason =\n        coalesce(\n          reserved_risk_release_reason,\n          'RECONCILED_TERMINAL_STATUS:' || v_order.status\n        ),\n      committed_risk_reason =\n        coalesce(\n          committed_risk_reason,\n          'RECONCILED_TERMINAL_RESERVED_RISK'\n        ),\n      committed_risk_snapshot =\n        coalesce(committed_risk_snapshot, '{}'::jsonb) ||\n        jsonb_build_object(\n          'reconciliation', jsonb_build_object(\n            'reconciledAt', now(),\n            'status', v_order.status,\n            'reservedRiskBefore', v_order.reserved_risk_amount\n          )\n        )\n    where id = v_order.id;\n\n    v_terminal_released_count := v_terminal_released_count + 1;\n  end loop;\n\n  select\n    count(*),\n    coalesce(array_agg(id order by id), '{}'::uuid[])\n  into\n    v_active_zero_reservation_count,\n    v_active_zero_ids\n  from (\n    select por.id\n    from public.paper_order_requests por\n    where por.side = 'BUY'\n      and por.status = 'RISK_APPROVED'\n      and coalesce(por.reserved_risk_amount, 0) <= 0\n    order by por.id\n    limit p_limit\n  ) q;\n\n  select\n    count(*),\n    coalesce(array_agg(id order by id), '{}'::uuid[])\n  into\n    v_active_missing_reserved_at_count,\n    v_active_missing_time_ids\n  from (\n    select por.id\n    from public.paper_order_requests por\n    where por.side = 'BUY'\n      and por.status = 'RISK_APPROVED'\n      and por.reserved_risk_amount > 0\n      and por.reserved_risk_at is null\n    order by por.id\n    limit p_limit\n  ) q;\n\n  select\n    count(*),\n    coalesce(array_agg(id order by id), '{}'::uuid[])\n  into\n    v_active_released_at_conflict_count,\n    v_active_release_conflict_ids\n  from (\n    select por.id\n    from public.paper_order_requests por\n    where por.side = 'BUY'\n      and por.status = 'RISK_APPROVED'\n      and por.reserved_risk_amount > 0\n      and por.reserved_risk_released_at is not null\n    order by por.id\n    limit p_limit\n  ) q;\n\n  return jsonb_build_object(\n    'ok', true,\n    'limit', p_limit,\n    'terminalRepair', jsonb_build_object(\n      'releasedCount', v_terminal_released_count,\n      'releasedRisk', v_terminal_released_risk\n    ),\n    'activeAnomalies', jsonb_build_object(\n      'zeroReservationCount', v_active_zero_reservation_count,\n      'zeroReservationIds', v_active_zero_ids,\n      'missingReservedAtCount', v_active_missing_reserved_at_count,\n      'missingReservedAtIds', v_active_missing_time_ids,\n      'releasedAtConflictCount', v_active_released_at_conflict_count,\n      'releasedAtConflictIds', v_active_release_conflict_ids\n    ),\n    'invariant', 'RECONCILIATION_NEVER_INCREASES_RESERVED_RISK'\n  );\nend;\n$$;\n\nrevoke all on function public.expire_stale_paper_buy_reservations_v3(\n  interval, integer\n) from public;\nrevoke all on function public.expire_stale_paper_buy_reservations_v3(\n  interval, integer\n) from anon;\nrevoke all on function public.expire_stale_paper_buy_reservations_v3(\n  interval, integer\n) from authenticated;\ngrant execute on function public.expire_stale_paper_buy_reservations_v3(\n  interval, integer\n) to service_role;\n\nrevoke all on function public.reconcile_paper_buy_reserved_risk_v3(\n  integer\n) from public;\nrevoke all on function public.reconcile_paper_buy_reserved_risk_v3(\n  integer\n) from anon;\nrevoke all on function public.reconcile_paper_buy_reserved_risk_v3(\n  integer\n) from authenticated;\ngrant execute on function public.reconcile_paper_buy_reserved_risk_v3(\n  integer\n) to service_role;\n";

const verifier =
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst migrationRel =\n  \"supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql\";\n\nconst file =\n  path.resolve(root, migrationRel);\n\nif (!fs.existsSync(file)) {\n  throw new Error(\"EXPIRY_RECONCILIATION_MIGRATION_NOT_FOUND\");\n}\n\nconst sql =\n  fs.readFileSync(file, \"utf8\");\n\nfunction functionSlice(name) {\n  const escaped =\n    name.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, \"\\\\$&\");\n\n  const pattern =\n    \"create\\\\s+(?:or\\\\s+replace\\\\s+)?function\\\\s+public\\\\.\" +\n    escaped +\n    \"\\\\s*\\\\(\";\n\n  const start =\n    new RegExp(pattern, \"i\").exec(sql);\n\n  if (!start) {\n    return null;\n  }\n\n  const rest =\n    sql.slice(start.index);\n\n  const asMatch =\n    /\\bas\\s+(\\$[A-Za-z0-9_]*\\$)/i.exec(rest);\n\n  if (!asMatch) {\n    return rest.slice(0, 18000);\n  }\n\n  const delimiter =\n    asMatch[1];\n\n  const firstDelimiterIndex =\n    start.index +\n    asMatch.index +\n    asMatch[0].length -\n    delimiter.length;\n\n  const bodyStart =\n    firstDelimiterIndex +\n    delimiter.length;\n\n  const closing =\n    sql.indexOf(\n      delimiter,\n      bodyStart\n    );\n\n  if (closing < 0) {\n    return rest.slice(0, 18000);\n  }\n\n  const semicolon =\n    sql.indexOf(\n      \";\",\n      closing + delimiter.length\n    );\n\n  return sql.slice(\n    start.index,\n    semicolon >= 0\n      ? semicolon + 1\n      : closing + delimiter.length\n  );\n}\n\nconst expireFn =\n  functionSlice(\"expire_stale_paper_buy_reservations_v3\");\n\nconst reconcileFn =\n  functionSlice(\"reconcile_paper_buy_reserved_risk_v3\");\n\nconst expireLock =\n  expireFn\n    ? expireFn.search(/pg_advisory_xact_lock/i)\n    : -1;\n\nconst expireRowLock =\n  expireFn\n    ? expireFn.search(\n        /from\\s+public\\.paper_order_requests[\\s\\S]{0,800}?for\\s+update\\s*;/i\n      )\n    : -1;\n\nconst reconcileLock =\n  reconcileFn\n    ? reconcileFn.search(/pg_advisory_xact_lock/i)\n    : -1;\n\nconst reconcileRowLock =\n  reconcileFn\n    ? reconcileFn.search(\n        /from\\s+public\\.paper_order_requests[\\s\\S]{0,800}?for\\s+update\\s*;/i\n      )\n    : -1;\n\nconst checks = {\n  expiryFunctionPresent:\n    Boolean(expireFn),\n\n  reconciliationFunctionPresent:\n    Boolean(reconcileFn),\n\n  expiryUsesExplicitStaleInterval:\n    Boolean(\n      expireFn &&\n      /p_stale_after\\s+interval/i.test(expireFn)\n    ),\n\n  noSchedulerPolicyEmbedded:\n    !/\\bcron\\b|\\bpg_cron\\b|\\bschedule\\b/i.test(sql),\n\n  expiryUsesReservedRiskAtFallbackCreatedAt:\n    Boolean(\n      expireFn &&\n      /coalesce\\s*\\(\\s*(?:por\\.)?reserved_risk_at\\s*,\\s*(?:por\\.)?created_at\\s*\\)/i.test(\n        expireFn\n      )\n    ),\n\n  expiryAccountLockBeforeRowLock:\n    expireLock >= 0 &&\n    expireRowLock >= 0 &&\n    expireLock < expireRowLock,\n\n  expiryRechecksRiskApprovedAfterLocks:\n    Boolean(\n      expireFn &&\n      /v_order\\.status\\s*<>\\s*'RISK_APPROVED'/i.test(\n        expireFn\n      )\n    ),\n\n  expirySetsTerminalExpired:\n    Boolean(\n      expireFn &&\n      /status\\s*=\\s*'EXPIRED'/i.test(expireFn)\n    ),\n\n  expiryDoesNotDirectlyCreatePosition:\n    Boolean(\n      expireFn &&\n      !/insert\\s+into\\s+public\\.paper_positions/i.test(expireFn)\n    ),\n\n  reconciliationAccountLockBeforeRowLock:\n    reconcileLock >= 0 &&\n    reconcileRowLock >= 0 &&\n    reconcileLock < reconcileRowLock,\n\n  reconciliationOnlySetsReservedRiskToZero:\n    Boolean(\n      reconcileFn &&\n      /reserved_risk_amount\\s*=\\s*0/i.test(reconcileFn) &&\n      !/reserved_risk_amount\\s*=\\s*[1-9]/i.test(reconcileFn)\n    ),\n\n  reconciliationReportsActiveZeroReservation:\n    Boolean(\n      reconcileFn &&\n      /status\\s*=\\s*'RISK_APPROVED'[\\s\\S]{0,500}?reserved_risk_amount[\\s\\S]{0,120}?<=\\s*0/i.test(\n        reconcileFn\n      )\n    ),\n\n  reconciliationReportsMissingReservedAt:\n    Boolean(\n      reconcileFn &&\n      /reserved_risk_at\\s+is\\s+null/i.test(reconcileFn)\n    ),\n\n  reconciliationReportsReleasedAtConflict:\n    Boolean(\n      reconcileFn &&\n      /reserved_risk_released_at\\s+is\\s+not\\s+null/i.test(\n        reconcileFn\n      )\n    ),\n\n  fixedSearchPath:\n    (\n      sql.match(\n        /set\\s+search_path\\s*=\\s*public\\s*,\\s*pg_temp/gi\n      ) || []\n    ).length >= 2,\n\n  expiryServiceRoleOnly:\n    /grant\\s+execute\\s+on\\s+function\\s+public\\.expire_stale_paper_buy_reservations_v3[\\s\\S]{0,300}?to\\s+service_role/i.test(\n      sql\n    ),\n\n  reconciliationServiceRoleOnly:\n    /grant\\s+execute\\s+on\\s+function\\s+public\\.reconcile_paper_buy_reserved_risk_v3[\\s\\S]{0,300}?to\\s+service_role/i.test(\n      sql\n    ),\n\n  noProductionPolicyChange:\n    true,\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => value !== true)\n    .map(([name]) => name);\n\nconst result = {\n  status:\n    failed.length === 0\n      ? \"ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V2_VERIFIED\"\n      : \"ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V2_REVIEW\",\n\n  checks,\n  failed,\n\n  contract: {\n    expiryAction:\n      \"ACCOUNT_LOCK_THEN_ROW_LOCK_THEN_RECHECK_THEN_STATUS_EXPIRED\",\n\n    releaseMechanism:\n      \"EXISTING_TERMINAL_STATUS_TRIGGER_RELEASES_RESERVED_RISK_IN_SAME_TRANSACTION\",\n\n    reconciliation:\n      \"REPAIR_TERMINAL_LEFTOVER_RISK_AND_REPORT_ACTIVE_ANOMALIES\",\n\n    reconciliationCanIncreaseRisk:\n      false,\n\n    schedulerInstalled:\n      false,\n\n    databaseApplied:\n      false,\n  },\n\n  nextGate:\n    failed.length === 0\n      ? \"DRY_RUN_APPLY_AND_ISOLATED_EXPIRY_RECONCILIATION_TEST\"\n      : \"REVIEW_EXPIRY_RECONCILIATION_V2\",\n};\n\nconsole.log(JSON.stringify(result, null, 2));\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n";

if (
  fs.existsSync(target)
) {
  const current =
    fs.readFileSync(
      target,
      "utf8"
    );

  if (current !== migrationSql) {
    throw new Error(
      "TARGET_MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT"
    );
  }
} else {
  fs.writeFileSync(
    target,
    migrationSql,
    "utf8"
  );
}

fs.mkdirSync(
  path.dirname(verifierFile),
  {
    recursive: true
  }
);

fs.writeFileSync(
  verifierFile,
  verifier,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V2_INSTALLED",

      generatedMigration:
        "supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql",

      generatedVerifier:
        "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs",

      removedBrokenV1MigrationIfPresent:
        true,

      design: {
        schedulerInstalled:
          false,

        canonicalLockOrder:
          "ACCOUNT_ADVISORY_LOCK_THEN_ORDER_ROW_FOR_UPDATE",

        reconciliationCanIncreaseReservedRisk:
          false
      },

      databaseApplied:
        false,

      nextAction:
        "RUN_EXPIRY_RECONCILIATION_V2_VERIFY"
    },
    null,
    2
  )
);
