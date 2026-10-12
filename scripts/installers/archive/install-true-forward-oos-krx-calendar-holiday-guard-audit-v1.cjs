const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCRIPTS =
  path.join(
    ROOT,
    "scripts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const BACKUPS =
  path.join(
    SCRIPTS,
    "backups"
  );

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-krx-calendar-holiday-guard-audit-v1.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CALENDAR_HOLIDAY_GUARD_AUDIT_V1_INSTALL_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

const required = [
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs",
  "package.json",
];

const missing =
  required.filter(
    (rel) =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.mkdirSync(
    BACKUPS,
    {
      recursive: true,
    }
  );

  const packageBackup =
    path.join(
      BACKUPS,
      "package.before-true-forward-oos-krx-calendar-holiday-guard-audit-v1.json"
    );

  if (
    !fs.existsSync(
      packageBackup
    )
  ) {
    fs.copyFileSync(
      PACKAGE,
      packageBackup
    );
  }

  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst ROOT = process.cwd();\n\nconst targets = {\n  binding:\n    \"lib/research/run-true-forward-oos-automation-binding-v1.ts\",\n\n  producer:\n    \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n\n  collector:\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n\n  evaluator:\n    \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n\n  summary:\n    \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n\n  krxProbe:\n    \"scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs\",\n\n  contract:\n    \"scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts\",\n};\n\nfunction exists(rel) {\n  return fs.existsSync(\n    path.join(ROOT, rel)\n  );\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(\n      path.join(ROOT, rel),\n      \"utf8\"\n    );\n  } catch {\n    return \"\";\n  }\n}\n\nconst source = {};\n\nfor (const [key, rel] of Object.entries(targets)) {\n  source[key] = read(rel);\n}\n\nconst runtimeGraph =\n  [\n    source.binding,\n    source.producer,\n    source.collector,\n    source.evaluator,\n    source.summary,\n    source.contract,\n  ].join(\"\\n\");\n\nconst weekendPattern =\n  /(weekend|saturday|sunday|\ud1a0\uc694\uc77c|\uc77c\uc694\uc77c|getday\\s*\\(|dayofweek|isweekend)/i;\n\nconst holidayPattern =\n  /(holiday|\uacf5\ud734\uc77c|\ud734\uc7a5|krx.*calendar|calendar.*krx|trading.?day|market.?open.?day|session.?date)/i;\n\nconst skipPattern =\n  /(skip|skipped|return|blocked|wait|not.?trading|closed)/i;\n\nconst checks = {\n  bindingExists:\n    exists(targets.binding),\n\n  producerExists:\n    exists(targets.producer),\n\n  collectorExists:\n    exists(targets.collector),\n\n  evaluatorExists:\n    exists(targets.evaluator),\n\n  summaryExists:\n    exists(targets.summary),\n\n  krxProbeExists:\n    exists(targets.krxProbe),\n\n  contractExists:\n    exists(targets.contract),\n\n  weekendGuardSemanticsFound:\n    weekendPattern.test(runtimeGraph),\n\n  holidayOrKrxCalendarSemanticsFound:\n    holidayPattern.test(runtimeGraph),\n\n  safeSkipSemanticsFound:\n    skipPattern.test(runtimeGraph),\n\n  bindingHasDirectCalendarGuard:\n    weekendPattern.test(source.binding) ||\n    holidayPattern.test(source.binding),\n\n  producerHasCalendarGuard:\n    weekendPattern.test(source.producer) ||\n    holidayPattern.test(source.producer),\n\n  collectorHasCalendarGuard:\n    weekendPattern.test(source.collector) ||\n    holidayPattern.test(source.collector),\n\n  contractMentionsWeekendSkip:\n    /(weekendSkipped|weekend.*skip|skip.*weekend)/i.test(\n      source.contract\n    ),\n};\n\nlet krxProbe = {\n  executed: false,\n  exitCode: null,\n  spawnError: null,\n  stdoutTail: [],\n  stderrTail: [],\n};\n\nif (checks.krxProbeExists) {\n  const result =\n    spawnSync(\n      process.execPath,\n      [\n        path.join(\n          ROOT,\n          targets.krxProbe\n        ),\n      ],\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        shell: false,\n        maxBuffer:\n          16 * 1024 * 1024,\n        env: {\n          ...process.env,\n\n          FORWARD_OOS_AUTOMATION_ENABLED:\n            \"false\",\n\n          REAL_TRADING_ENABLED:\n            \"false\",\n\n          ENABLE_REAL_TRADING:\n            \"false\",\n\n          ENABLE_LIVE_TRADING:\n            \"false\",\n        },\n      }\n    );\n\n  krxProbe = {\n    executed: true,\n\n    exitCode:\n      typeof result.status === \"number\"\n        ? result.status\n        : 1,\n\n    spawnError:\n      result.error\n        ? String(\n            result.error.message ||\n            result.error\n          )\n        : null,\n\n    stdoutTail:\n      String(\n        result.stdout || \"\"\n      )\n        .trim()\n        .split(/\\r?\\n/)\n        .filter(Boolean)\n        .slice(-20),\n\n    stderrTail:\n      String(\n        result.stderr || \"\"\n      )\n        .trim()\n        .split(/\\r?\\n/)\n        .filter(Boolean)\n        .slice(-20),\n  };\n}\n\nchecks.krxProbePassed =\n  krxProbe.executed === true &&\n  krxProbe.spawnError === null &&\n  krxProbe.exitCode === 0;\n\nconst hardFailures = [];\n\nfor (const key of [\n  \"bindingExists\",\n  \"producerExists\",\n  \"collectorExists\",\n  \"krxProbeExists\",\n]) {\n  if (!checks[key]) {\n    hardFailures.push(key);\n  }\n}\n\nif (!checks.weekendGuardSemanticsFound) {\n  hardFailures.push(\n    \"weekendGuardSemanticsFound\"\n  );\n}\n\nif (!checks.holidayOrKrxCalendarSemanticsFound) {\n  hardFailures.push(\n    \"holidayOrKrxCalendarSemanticsFound\"\n  );\n}\n\nif (!checks.safeSkipSemanticsFound) {\n  hardFailures.push(\n    \"safeSkipSemanticsFound\"\n  );\n}\n\nif (!checks.krxProbePassed) {\n  hardFailures.push(\n    \"krxProbePassed\"\n  );\n}\n\nconst warnings = [];\n\nif (!checks.bindingHasDirectCalendarGuard) {\n  warnings.push(\n    \"AUTOMATION_BINDING_HAS_NO_DIRECT_KRX_CALENDAR_GUARD\"\n  );\n}\n\nif (!checks.producerHasCalendarGuard) {\n  warnings.push(\n    \"PRODUCER_CALENDAR_GUARD_NOT_OBVIOUS\"\n  );\n}\n\nif (!checks.collectorHasCalendarGuard) {\n  warnings.push(\n    \"COLLECTOR_CALENDAR_GUARD_NOT_OBVIOUS\"\n  );\n}\n\nif (!checks.contractMentionsWeekendSkip) {\n  warnings.push(\n    \"PIPELINE_CONTRACT_WEEKEND_SKIP_ASSERTION_NOT_OBVIOUS\"\n  );\n}\n\nlet readiness;\n\nif (hardFailures.length > 0) {\n  readiness =\n    \"KRX_CALENDAR_GUARD_GAP\";\n} else if (warnings.length > 0) {\n  readiness =\n    \"KRX_CALENDAR_GUARDS_PRESENT_WITH_HARDENING_OPPORTUNITY\";\n} else {\n  readiness =\n    \"KRX_CALENDAR_GUARDS_VERIFIED\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CALENDAR_HOLIDAY_GUARD_AUDIT_V1\",\n\n  readiness,\n\n  checks,\n\n  krxProbe,\n\n  hardFailures,\n  warnings,\n\n  safety: {\n    readOnlyAudit:\n      true,\n\n    forwardOosAutomationEnabled:\n      false,\n\n    realTradingForcedOff:\n      true,\n\n    productionSchedulerLoopStarted:\n      false,\n\n    databaseWrites:\n      0,\n\n    ordersCreated:\n      0,\n\n    positionsChanged:\n      0,\n\n    promotionApplied:\n      false,\n  },\n\n  nextGate:\n    hardFailures.length > 0\n      ? \"INSPECT_AND_REPAIR_KRX_CALENDAR_GUARD_GAPS\"\n      : warnings.length > 0\n      ? \"HARDEN_AUTOMATION_BINDING_WITH_EXPLICIT_KRX_TRADING_DAY_GUARD_V1\"\n      : \"RUN_CONTROLLED_FORWARD_OOS_ONE_SHOT_SMOKE_WITH_AUTOMATION_STILL_DISABLED\",\n};\n\nfs.mkdirSync(\n  path.join(\n    ROOT,\n    \"logs\"\n  ),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"true-forward-oos-krx-calendar-holiday-guard-audit-v1.json\"\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ),\n  \"utf8\"\n);\n\n/* compact console only */\nconsole.log(JSON.stringify({\n  status:\n    report.status,\n\n  readiness:\n    report.readiness,\n\n  checks: {\n    weekendGuardSemanticsFound:\n      checks.weekendGuardSemanticsFound,\n\n    holidayOrKrxCalendarSemanticsFound:\n      checks.holidayOrKrxCalendarSemanticsFound,\n\n    safeSkipSemanticsFound:\n      checks.safeSkipSemanticsFound,\n\n    krxProbePassed:\n      checks.krxProbePassed,\n\n    bindingHasDirectCalendarGuard:\n      checks.bindingHasDirectCalendarGuard,\n\n    producerHasCalendarGuard:\n      checks.producerHasCalendarGuard,\n\n    collectorHasCalendarGuard:\n      checks.collectorHasCalendarGuard,\n\n    contractMentionsWeekendSkip:\n      checks.contractMentionsWeekendSkip,\n  },\n\n  hardFailures:\n    report.hardFailures,\n\n  warnings:\n    report.warnings,\n\n  nextGate:\n    report.nextGate,\n}, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0\n    ? 0\n    : 1;\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (
    error
  ) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (
    pkg
  ) {
    if (
      !pkg.scripts ||
      typeof pkg.scripts !==
        "object"
    ) {
      pkg.scripts = {};
    }

    pkg.scripts[
      "test:true-forward-oos-krx-calendar-guard"
    ] =
      "node ./scripts/true-forward-oos-krx-calendar-holiday-guard-audit-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CALENDAR_HOLIDAY_GUARD_AUDIT_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-krx-calendar-holiday-guard-audit-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-krx-calendar-guard",

          mode:
            "READ_ONLY_AUDIT_PLUS_EXISTING_KRX_PROBE",

          safety: {
            productSourceChanges:
              0,

            forwardOosAutomationEnabled:
              false,

            realTradingForcedOff:
              true,

            databaseWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,
          },

          nextAction:
            "RUN_COMPACT_KRX_CALENDAR_GUARD_AUDIT",
        },
        null,
        2
      )
    );
  }
}
