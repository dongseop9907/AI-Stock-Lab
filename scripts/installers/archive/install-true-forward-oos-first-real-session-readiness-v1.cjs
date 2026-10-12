const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "lib/trading/krx-trading-calendar.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const auditSource = String.raw`import fs from "node:fs";
import path from "node:path";

import {
  isKrxTradingDate,
  nextKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

const ROOT =
  process.cwd();

const TARGET_DATE =
  process.env
    .TRUE_FORWARD_OOS_FIRST_REAL_SESSION_TARGET_DATE ??
  "2026-10-12";

const FILES = {
  controlledProducer:
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",

  evidenceWrapper:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",

  automationBinding:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",

  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

  maturityAudit:
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",

  collectorGate:
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
};

function read(
  rel: string,
) {
  return fs.readFileSync(
    path.join(
      ROOT,
      rel,
    ),
    "utf8",
  );
}

function envTrue(
  key: string,
) {
  return String(
    process.env[key] ??
    "",
  )
    .trim()
    .toLowerCase() ===
    "true";
}

function collectSessionEvidence() {
  const candidates = [
    "logs/alpha-v3-true-forward-oos-sessions.json",
    "logs/alpha-v3-entry-v3-forward-oos-sessions.json",
    "logs/alpha-v3-true-forward-top1-sessions.json",
    "logs/true-forward-oos-sessions.json",
  ];

  const found =
    candidates
      .filter(
        rel =>
          fs.existsSync(
            path.join(
              ROOT,
              rel,
            ),
          ),
      );

  let sessions =
    0;

  const details:
    Array<{
      file: string;
      sessions: number | null;
    }> = [];

  for (
    const rel of found
  ) {
    let count:
      number | null =
      null;

    try {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            path.join(
              ROOT,
              rel,
            ),
            "utf8",
          ),
        );

      if (
        Array.isArray(
          parsed,
        )
      ) {
        count =
          parsed.length;
      } else if (
        Array.isArray(
          parsed?.sessions,
        )
      ) {
        count =
          parsed.sessions.length;
      } else if (
        Number.isFinite(
          Number(
            parsed?.counts?.sessions,
          ),
        )
      ) {
        count =
          Number(
            parsed.counts.sessions,
          );
      }
    } catch {
      count =
        null;
    }

    if (
      typeof count ===
        "number"
    ) {
      sessions +=
        count;
    }

    details.push({
      file:
        rel,

      sessions:
        count,
    });
  }

  return {
    candidateFiles:
      candidates,

    foundFiles:
      found,

    countedSessions:
      sessions,

    details,
  };
}

export function buildFirstRealSessionReadinessV1() {
  const controlledProducer =
    read(
      FILES.controlledProducer,
    );

  const evidenceWrapper =
    read(
      FILES.evidenceWrapper,
    );

  const automationBinding =
    read(
      FILES.automationBinding,
    );

  const producer =
    read(
      FILES.producer,
    );

  const maturityAudit =
    read(
      FILES.maturityAudit,
    );

  const collectorGate =
    read(
      FILES.collectorGate,
    );

  const sessionEvidence =
    collectSessionEvidence();

  const realTradingFlags = {
    REAL_TRADING_ENABLED:
      envTrue(
        "REAL_TRADING_ENABLED",
      ),

    ENABLE_REAL_TRADING:
      envTrue(
        "ENABLE_REAL_TRADING",
      ),

    ENABLE_LIVE_TRADING:
      envTrue(
        "ENABLE_LIVE_TRADING",
      ),
  };

  const targetDateIsKrxTradingDate =
    isKrxTradingDate(
      TARGET_DATE,
    );

  const previousProbeDate =
    "2026-10-09";

  const nextAfterHoliday =
    nextKrxTradingDate(
      previousProbeDate,
    );

  const checks = {
    targetDateIsKrxTradingDate,

    hangeulDayNextOpenRegression:
      nextAfterHoliday ===
      "2026-10-12",

    controlledProducerFeatureFlagPresent:
      controlledProducer.includes(
        "FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED",
      ),

    controlledProducerExactPhrasePresent:
      controlledProducer.includes(
        "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",
      ),

    controlledProducerDryRunSurfacePresent:
      controlledProducer.includes(
        "--dry-run",
      ) ||
      controlledProducer.includes(
        "dryRun",
      ),

    evidenceWrapperPresent:
      evidenceWrapper.includes(
        "controlled",
      ) &&
      evidenceWrapper.includes(
        "evidence",
      ),

    evidenceWrapperBeforeAfterEvidence:
      evidenceWrapper.includes(
        "before",
      ) &&
      evidenceWrapper.includes(
        "after",
      ),

    automationDefaultOffContractPresent:
      automationBinding.includes(
        "FORWARD_OOS_AUTOMATION_ENABLED",
      ),

    automationCurrentlyNotEnabled:
      !envTrue(
        "FORWARD_OOS_AUTOMATION_ENABLED",
      ),

    producerProbeOnlyContractPresent:
      producer.includes(
        "--probe-only",
      ) ||
      producer.includes(
        "probe-only",
      ),

    maturityUsesKrxTradingSessions:
      maturityAudit.includes(
        "addKrxTradingSessions(",
      ) &&
      maturityAudit.includes(
        "nextKrxTradingDate(",
      ) &&
      !maturityAudit.includes(
        "addCalendarDays(",
      ),

    collectorSingleRunBinding:
      collectorGate.includes(
        "collectorSingleRunBinding",
      ) &&
      collectorGate.includes(
        "await runCollector()",
      ),

    collectorNoUnsupportedHorizonCli:
      !collectorGate.includes(
        '"--horizon"',
      ),

    noRealTradingFlagEnabled:
      Object.values(
        realTradingFlags,
      )
        .every(
          value =>
            value ===
            false,
        ),

    noExistingCountedForwardSessions:
      sessionEvidence
        .countedSessions ===
        0,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  const ready =
    failed.length ===
    0;

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1",

    readinessStatus:
      ready
        ? "READY_FOR_CONTROLLED_FIRST_FORWARD_SESSION"
        : "BLOCKED_FIRST_FORWARD_SESSION_READINESS",

    target: {
      tradingDate:
        TARGET_DATE,

      controlledWindow:
        "08:45-08:59 KST",

      expectedProducerMode:
        "CONTROLLED_ONE_SHOT_NORMAL_PRODUCER",

      persistentAutomation:
        "OFF",
    },

    checks,

    runtime: {
      realTradingFlags,

      automationEnabled:
        envTrue(
          "FORWARD_OOS_AUTOMATION_ENABLED",
        ),

      controlledProducerPersistentlyEnabled:
        envTrue(
          "FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED",
        ),

      sessionEvidence,
    },

    safety: {
      sourceReadOnly:
        true,

      producerExecuted:
        false,

      maturityAuditExecuted:
        false,

      collectorExecuted:
        false,

      evaluatorExecuted:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      fileWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      ready
        ? "ON_TARGET_TRADING_DATE_RUN_CONTROLLED_EVIDENCE_WRAPPER_PREFLIGHT_THEN_ONE_SHOT_PRODUCER"
        : "REPAIR_FAILED_READINESS_CHECKS_BEFORE_FIRST_REAL_SESSION",
  };
}

function main() {
  const result =
    buildFirstRealSessionReadinessV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.failed.length ===
      0
      ? 0
      : 1;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-first-real-session-readiness-v1.ts",
  )
) {
  main();
}
`;

  const contractSource = String.raw`import assert from "node:assert/strict";

import {
  buildFirstRealSessionReadinessV1,
} from "./true-forward-oos-first-real-session-readiness-v1";

function main() {
  const result =
    buildFirstRealSessionReadinessV1();

  const structuralChecks = {
    hasTargetDate:
      result.target.tradingDate ===
      "2026-10-12",

    controlledWindowFrozen:
      result.target.controlledWindow ===
      "08:45-08:59 KST",

    persistentAutomationOff:
      result.target.persistentAutomation ===
      "OFF",

    hangeulRegression:
      result.checks
        .hangeulDayNextOpenRegression ===
        true,

    targetKrxTradingDate:
      result.checks
        .targetDateIsKrxTradingDate ===
        true,

    krxMaturityBound:
      result.checks
        .maturityUsesKrxTradingSessions ===
        true,

    collectorSingleRun:
      result.checks
        .collectorSingleRunBinding ===
        true,

    unsupportedHorizonRemoved:
      result.checks
        .collectorNoUnsupportedHorizonCli ===
        true,

    noRealTrading:
      result.checks
        .noRealTradingFlagEnabled ===
        true,

    noProducerExecution:
      result.safety
        .producerExecuted ===
        false,

    noTradingSideEffects:
      result.safety
        .ordersCreated ===
        0 &&
      result.safety
        .positionsChanged ===
        0 &&
      result.safety
        .promotionExecuted ===
        false,
  };

  const failed =
    Object.entries(
      structuralChecks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  for (
    const [
      key,
      value,
    ] of Object.entries(
      structuralChecks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_CONTRACT_VERIFIED",

        checks:
          structuralChecks,

        currentReadinessStatus:
          result.readinessStatus,

        currentFailed:
          result.failed,

        safety:
          result.safety,

        failed,

        nextGate:
          "RUN_CURRENT_FIRST_REAL_SESSION_READINESS",
      },
      null,
      2,
    ),
  );
}

main();
`;

  const staticSource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const audit = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1.ts"
);

if (!fs.existsSync(audit)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_FAILED",

    failed: [
      "auditExists"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const checks = {
    auditExists:
      true,

    targetDatePinned:
      source.includes(
        '"2026-10-12"',
      ),

    krxCalendarBound:
      source.includes(
        "isKrxTradingDate",
      ) &&
      source.includes(
        "nextKrxTradingDate",
      ),

    controlledProducerChecked:
      source.includes(
        "FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED",
      ),

    exactPhraseChecked:
      source.includes(
        "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",
      ),

    automationOffChecked:
      source.includes(
        "FORWARD_OOS_AUTOMATION_ENABLED",
      ),

    realTradingFlagsChecked:
      source.includes(
        "REAL_TRADING_ENABLED",
      ) &&
      source.includes(
        "ENABLE_REAL_TRADING",
      ) &&
      source.includes(
        "ENABLE_LIVE_TRADING",
      ),

    maturityBindingChecked:
      source.includes(
        "addKrxTradingSessions(",
      ),

    collectorBindingChecked:
      source.includes(
        "collectorSingleRunBinding",
      ),

    noSpawn:
      !source.includes(
        "spawn(",
      ),

    noDatabaseSurface:
      !/supabase|\\.insert\\s*\\(|\\.update\\s*\\(|\\.delete\\s*\\(/i.test(
        source,
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source,
      ),
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      producerExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_READINESS_CONTRACT_AND_CURRENT_AUDIT"
        : "REPAIR_FIRST_REAL_SESSION_READINESS_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    AUDIT,
    auditSource,
    "utf8"
  );

  fs.writeFileSync(
    CONTRACT,
    contractSource,
    "utf8"
  );

  fs.writeFileSync(
    STATIC,
    staticSource,
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
  } catch (error) {
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

    return;
  }

  pkg.scripts ||= {};

  pkg.scripts[
    "test:true-forward-oos-first-real-session-readiness-static"
  ] =
    "node ./scripts/true-forward-oos-first-real-session-readiness-v1-static-verify.cjs";

  pkg.scripts[
    "test:true-forward-oos-first-real-session-readiness"
  ] =
    "tsx --env-file=.env.local ./scripts/true-forward-oos-first-real-session-readiness-v1-contract-test.ts";

  pkg.scripts[
    "forward-oos:first-real-session-readiness"
  ] =
    "tsx --env-file=.env.local ./scripts/true-forward-oos-first-real-session-readiness-v1.ts";

  fs.writeFileSync(
    PACKAGE,
    JSON.stringify(
      pkg,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_INSTALLED",

    generatedFiles: [
      "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
      "scripts/true-forward-oos-first-real-session-readiness-v1-contract-test.ts",
      "scripts/true-forward-oos-first-real-session-readiness-v1-static-verify.cjs"
    ],

    target: {
      tradingDate:
        "2026-10-12",

      window:
        "08:45-08:59 KST"
    },

    purpose:
      "FINAL_READ_ONLY_READINESS_AUDIT_BEFORE_FIRST_CONTROLLED_REAL_FORWARD_OOS_SESSION",

    safety: {
      installerExecutedProducer:
        false,

      installerExecutedCollector:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false
    },

    nextAction:
      "RUN_STATIC_CONTRACT_AND_CURRENT_FIRST_REAL_SESSION_READINESS"
  }, null, 2));

  process.exitCode = 0;
}
