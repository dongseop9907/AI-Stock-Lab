import fs from "node:fs";
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
