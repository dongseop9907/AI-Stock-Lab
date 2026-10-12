const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

const targets = {
  binding:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",

  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",

  evaluator:
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",

  summary:
    "scripts/alpha-v3-true-forward-oos-summary.ts",

  krxProbe:
    "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs",

  contract:
    "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
};

function exists(rel) {
  return fs.existsSync(
    path.join(ROOT, rel)
  );
}

function read(rel) {
  try {
    return fs.readFileSync(
      path.join(ROOT, rel),
      "utf8"
    );
  } catch {
    return "";
  }
}

const source = {};

for (const [key, rel] of Object.entries(targets)) {
  source[key] = read(rel);
}

const runtimeGraph =
  [
    source.binding,
    source.producer,
    source.collector,
    source.evaluator,
    source.summary,
    source.contract,
  ].join("\n");

const weekendPattern =
  /(weekend|saturday|sunday|토요일|일요일|getday\s*\(|dayofweek|isweekend)/i;

const holidayPattern =
  /(holiday|공휴일|휴장|krx.*calendar|calendar.*krx|trading.?day|market.?open.?day|session.?date)/i;

const skipPattern =
  /(skip|skipped|return|blocked|wait|not.?trading|closed)/i;

const checks = {
  bindingExists:
    exists(targets.binding),

  producerExists:
    exists(targets.producer),

  collectorExists:
    exists(targets.collector),

  evaluatorExists:
    exists(targets.evaluator),

  summaryExists:
    exists(targets.summary),

  krxProbeExists:
    exists(targets.krxProbe),

  contractExists:
    exists(targets.contract),

  weekendGuardSemanticsFound:
    weekendPattern.test(runtimeGraph),

  holidayOrKrxCalendarSemanticsFound:
    holidayPattern.test(runtimeGraph),

  safeSkipSemanticsFound:
    skipPattern.test(runtimeGraph),

  bindingHasDirectCalendarGuard:
    weekendPattern.test(source.binding) ||
    holidayPattern.test(source.binding),

  producerHasCalendarGuard:
    weekendPattern.test(source.producer) ||
    holidayPattern.test(source.producer),

  collectorHasCalendarGuard:
    weekendPattern.test(source.collector) ||
    holidayPattern.test(source.collector),

  contractMentionsWeekendSkip:
    /(weekendSkipped|weekend.*skip|skip.*weekend)/i.test(
      source.contract
    ),
};

let krxProbe = {
  executed: false,
  exitCode: null,
  spawnError: null,
  stdoutTail: [],
  stderrTail: [],
};

if (checks.krxProbeExists) {
  const result =
    spawnSync(
      process.execPath,
      [
        path.join(
          ROOT,
          targets.krxProbe
        ),
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
        maxBuffer:
          16 * 1024 * 1024,
        env: {
          ...process.env,

          FORWARD_OOS_AUTOMATION_ENABLED:
            "false",

          REAL_TRADING_ENABLED:
            "false",

          ENABLE_REAL_TRADING:
            "false",

          ENABLE_LIVE_TRADING:
            "false",
        },
      }
    );

  krxProbe = {
    executed: true,

    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,

    spawnError:
      result.error
        ? String(
            result.error.message ||
            result.error
          )
        : null,

    stdoutTail:
      String(
        result.stdout || ""
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-20),

    stderrTail:
      String(
        result.stderr || ""
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-20),
  };
}

checks.krxProbePassed =
  krxProbe.executed === true &&
  krxProbe.spawnError === null &&
  krxProbe.exitCode === 0;

const hardFailures = [];

for (const key of [
  "bindingExists",
  "producerExists",
  "collectorExists",
  "krxProbeExists",
]) {
  if (!checks[key]) {
    hardFailures.push(key);
  }
}

if (!checks.weekendGuardSemanticsFound) {
  hardFailures.push(
    "weekendGuardSemanticsFound"
  );
}

if (!checks.holidayOrKrxCalendarSemanticsFound) {
  hardFailures.push(
    "holidayOrKrxCalendarSemanticsFound"
  );
}

if (!checks.safeSkipSemanticsFound) {
  hardFailures.push(
    "safeSkipSemanticsFound"
  );
}

if (!checks.krxProbePassed) {
  hardFailures.push(
    "krxProbePassed"
  );
}

const warnings = [];

if (!checks.bindingHasDirectCalendarGuard) {
  warnings.push(
    "AUTOMATION_BINDING_HAS_NO_DIRECT_KRX_CALENDAR_GUARD"
  );
}

if (!checks.producerHasCalendarGuard) {
  warnings.push(
    "PRODUCER_CALENDAR_GUARD_NOT_OBVIOUS"
  );
}

if (!checks.collectorHasCalendarGuard) {
  warnings.push(
    "COLLECTOR_CALENDAR_GUARD_NOT_OBVIOUS"
  );
}

if (!checks.contractMentionsWeekendSkip) {
  warnings.push(
    "PIPELINE_CONTRACT_WEEKEND_SKIP_ASSERTION_NOT_OBVIOUS"
  );
}

let readiness;

if (hardFailures.length > 0) {
  readiness =
    "KRX_CALENDAR_GUARD_GAP";
} else if (warnings.length > 0) {
  readiness =
    "KRX_CALENDAR_GUARDS_PRESENT_WITH_HARDENING_OPPORTUNITY";
} else {
  readiness =
    "KRX_CALENDAR_GUARDS_VERIFIED";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CALENDAR_HOLIDAY_GUARD_AUDIT_V1",

  readiness,

  checks,

  krxProbe,

  hardFailures,
  warnings,

  safety: {
    readOnlyAudit:
      true,

    forwardOosAutomationEnabled:
      false,

    realTradingForcedOff:
      true,

    productionSchedulerLoopStarted:
      false,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionApplied:
      false,
  },

  nextGate:
    hardFailures.length > 0
      ? "INSPECT_AND_REPAIR_KRX_CALENDAR_GUARD_GAPS"
      : warnings.length > 0
      ? "HARDEN_AUTOMATION_BINDING_WITH_EXPLICIT_KRX_TRADING_DAY_GUARD_V1"
      : "RUN_CONTROLLED_FORWARD_OOS_ONE_SHOT_SMOKE_WITH_AUTOMATION_STILL_DISABLED",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs"
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-krx-calendar-holiday-guard-audit-v1.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

/* compact console only */
console.log(JSON.stringify({
  status:
    report.status,

  readiness:
    report.readiness,

  checks: {
    weekendGuardSemanticsFound:
      checks.weekendGuardSemanticsFound,

    holidayOrKrxCalendarSemanticsFound:
      checks.holidayOrKrxCalendarSemanticsFound,

    safeSkipSemanticsFound:
      checks.safeSkipSemanticsFound,

    krxProbePassed:
      checks.krxProbePassed,

    bindingHasDirectCalendarGuard:
      checks.bindingHasDirectCalendarGuard,

    producerHasCalendarGuard:
      checks.producerHasCalendarGuard,

    collectorHasCalendarGuard:
      checks.collectorHasCalendarGuard,

    contractMentionsWeekendSkip:
      checks.contractMentionsWeekendSkip,
  },

  hardFailures:
    report.hardFailures,

  warnings:
    report.warnings,

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode =
  hardFailures.length === 0
    ? 0
    : 1;
