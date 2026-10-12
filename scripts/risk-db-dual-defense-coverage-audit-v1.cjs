const fs = require("fs");
const path = require("path");

const root = process.cwd();
const migrationDir = path.resolve(root, "supabase/migrations");

if (!fs.existsSync(migrationDir)) {
  throw new Error("MIGRATION_DIR_NOT_FOUND");
}

const files = fs
  .readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const targets = [
  "create_paper_buy_order_with_committed_risk_v3",
  "execute_paper_buy_order",
  "release_paper_buy_risk_v3",
  "expire_stale_paper_buy_reservations_v3",
  "reconcile_paper_buy_reserved_risk_v3",
];

function latestFunctionDefinition(functionName) {
  const defs = [];

  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${functionName}\\s*\\(`,
    "ig"
  );

  for (const file of files) {
    const abs = path.join(migrationDir, file);
    const src = fs.readFileSync(abs, "utf8");

    let match;
    while ((match = re.exec(src))) {
      const start = match.index;
      const tail = src.slice(start);

      let end = tail.search(/\n\s*(?:grant|revoke|comment\s+on|create\s+(?:or\s+replace\s+)?function|commit;|--\s*[-=]{3,})/i);

      if (end < 0) {
        end = Math.min(tail.length, 24000);
      }

      defs.push({
        file,
        text: tail.slice(0, end),
      });
    }
  }

  return defs.length ? defs.at(-1) : null;
}

const latestFunctions = Object.fromEntries(
  targets.map((name) => [name, latestFunctionDefinition(name)])
);

const allSql = files.map((file) => ({
  file,
  text: fs.readFileSync(path.join(migrationDir, file), "utf8"),
}));

const tableGuardSurface = [];

for (const { file, text } of allSql) {
  const lower = text.toLowerCase();

  if (
    !lower.includes("paper_order_requests") &&
    !lower.includes("paper_positions")
  ) {
    continue;
  }

  const signals = {
    checkConstraint:
      /\bcheck\s*\(/i.test(text),
    trigger:
      /\bcreate\s+(?:constraint\s+)?trigger\b/i.test(text),
    advisoryLock:
      /pg_advisory_xact_lock/i.test(text),
    aggregateBudget:
      /max_aggregate_open_risk_rate|aggregate.*risk|reserved_risk_amount/i.test(text),
    terminalRelease:
      /reserved_risk_released_at|release_terminal_paper_order_reserved_risk/i.test(text),
    stateMachine:
      /illegal.*transition|status.*transition|terminal.*immutable|RISK_APPROVED.*RISK_REJECTED.*FILLED|CANCELLED|EXPIRED/i.test(text),
    killSwitch:
      /emergency_stop/i.test(text),
    freshness:
      /freshness|quality_gate|data_quality/i.test(text),
    gapSlippage:
      /execution_price|adverse.*drift|actual_trade_risk|reserved.*risk/i.test(text),
  };

  if (Object.values(signals).some(Boolean)) {
    tableGuardSurface.push({
      file,
      signals,
    });
  }
}

function has(text, patterns) {
  if (!text) return false;
  return patterns.some((p) => p.test(text));
}

function body(name) {
  return latestFunctions[name]?.text ?? "";
}

const createBody = body("create_paper_buy_order_with_committed_risk_v3");
const fillBody = body("execute_paper_buy_order");
const releaseBody = body("release_paper_buy_risk_v3");
const expireBody = body("expire_stale_paper_buy_reservations_v3");
const reconcileBody = body("reconcile_paper_buy_reserved_risk_v3");

const coverage = {
  reservationRpcAtomicLock: has(createBody, [
    /pg_advisory_xact_lock/i,
  ]),
  aggregateCommittedRiskBudget: has(createBody, [
    /max_aggregate_open_risk_rate/i,
    /reserved_risk_amount/i,
  ]),
  openPositionRiskIncluded: has(createBody, [
    /paper_positions/i,
    /stop_price/i,
    /current_stop_price/i,
  ]),
  activeBuyReservedRiskIncluded: has(createBody, [
    /paper_order_requests/i,
    /reserved_risk_amount/i,
    /RISK_APPROVED/i,
  ]),
  preflightApprovalRequired: has(createBody, [
    /p_preflight_approved/i,
  ]),
  stopBelowEntryCreateGuard: has(createBody, [
    /p_stop_price\s*>=\s*p_entry_price/i,
    /stop.*below.*entry/i,
  ]),
  positiveQuantityCreateGuard: has(createBody, [
    /p_requested_quantity\s*<=\s*0/i,
    /quantity.*positive/i,
  ]),
  killSwitchCreateGuard: has(createBody, [
    /emergency_stop/i,
  ]),
  freshnessCreateGuard: has(createBody, [
    /freshness/i,
    /quality_gate/i,
  ]),
  fillAtomicLock: has(fillBody, [
    /pg_advisory_xact_lock/i,
  ]),
  fillRequiresRiskApproved: has(fillBody, [
    /RISK_APPROVED/i,
  ]),
  fillKillSwitchGuard: has(fillBody, [
    /emergency_stop/i,
  ]),
  fillFreshnessGuard: has(fillBody, [
    /freshness/i,
    /quality_gate/i,
  ]),
  fillGapSlippageGuard: has(fillBody, [
    /execution_price/i,
    /reserved_risk_amount/i,
    /actual.*risk/i,
    /adverse.*drift/i,
  ]),
  releaseRpcPresent: Boolean(releaseBody),
  expiryRpcPresent: Boolean(expireBody),
  reconcileRpcPresent: Boolean(reconcileBody),
  terminalReleaseTriggerPresent:
    tableGuardSurface.some((x) =>
      x.signals.trigger &&
      x.signals.terminalRelease
    ),
  dbCheckConstraintPresent:
    tableGuardSurface.some((x) =>
      x.signals.checkConstraint
    ),
  dbStateMachineGuardPresent:
    tableGuardSurface.some((x) =>
      x.signals.stateMachine
    ),
};

const likelyGaps = [];

if (!coverage.dbCheckConstraintPresent) {
  likelyGaps.push(
    "RAW_TABLE_ROW_INVARIANTS_NOT_PROVEN_BY_CHECK_CONSTRAINT"
  );
}

if (!coverage.dbStateMachineGuardPresent) {
  likelyGaps.push(
    "DIRECT_STATUS_UPDATE_STATE_MACHINE_GUARD_NOT_PROVEN"
  );
}

if (!coverage.terminalReleaseTriggerPresent) {
  likelyGaps.push(
    "TERMINAL_STATUS_RESERVED_RISK_RELEASE_TRIGGER_NOT_PROVEN"
  );
}

if (!coverage.stopBelowEntryCreateGuard) {
  likelyGaps.push(
    "CREATE_RPC_STOP_BELOW_ENTRY_GUARD_NOT_PROVEN"
  );
}

if (!coverage.positiveQuantityCreateGuard) {
  likelyGaps.push(
    "CREATE_RPC_POSITIVE_QUANTITY_GUARD_NOT_PROVEN"
  );
}

const details = {
  status: "RISK_DB_DUAL_DEFENSE_COVERAGE_AUDIT_V1_COMPLETE",
  latestDefinitions: Object.fromEntries(
    Object.entries(latestFunctions).map(([name, def]) => [
      name,
      def
        ? {
            file: def.file,
            length: def.text.length,
          }
        : null,
    ])
  ),
  coverage,
  likelyGaps,
  guardMigrations: tableGuardSurface,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
  },
  fullDetails: "logs/risk-db-dual-defense-coverage-audit-v1.json",
  nextGate: likelyGaps.length
    ? "VERIFY_ONLY_LIKELY_GAPS_BEFORE_MIGRATION_DESIGN"
    : "RISK_DB_DUAL_DEFENSE_ALREADY_COVERED_NO_NEW_MIGRATION_NEEDED",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(root, details.fullDetails),
  JSON.stringify(details, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: details.status,
      latestDefinitions: details.latestDefinitions,
      coverage,
      likelyGaps,
      nextGate: details.nextGate,
      details: details.fullDetails,
    },
    null,
    2
  )
);
