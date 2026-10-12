const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ORCH =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-first-session-orchestrator-v1.ts"
  );

const source =
  fs.existsSync(ORCH)
    ? fs.readFileSync(
        ORCH,
        "utf8"
      )
    : "";

const checks = {
  orchestratorExists:
    Boolean(source),

  exactTargetDate:
    source.includes(
      '"2026-10-12"'
    ),

  exactWindow:
    source.includes(
      '"08:45"'
    ) &&
    source.includes(
      '"08:59"'
    ),

  exactConfirmation:
    source.includes(
      '"RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"'
    ),

  dryRunPreflight:
    source.includes(
      '"CONTROLLED_EVIDENCE_PREFLIGHT"'
    ) &&
    source.includes(
      '"--dry-run"'
    ),

  normalEvidenceRunAtMostOnce:
    (
      source.match(
        /"CONTROLLED_NORMAL_EVIDENCE_RUN"/g
      ) ?? []
    ).length === 1,

  postCaptureIntegrity:
    source.includes(
      '"POST_CAPTURE_DATA_QUALITY"'
    ) &&
    source.includes(
      '"POST_CAPTURE_DASHBOARD"'
    ),

  automationForcedOff:
    source.includes(
      'FORWARD_OOS_AUTOMATION_ENABLED:\n          "false"'
    ),

  realTradingForcedOff:
    source.includes(
      'REAL_TRADING_ENABLED:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_REAL_TRADING:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_LIVE_TRADING:\n          "false"'
    ),

  noDirectOrderApi:
    !source.includes(
      "/api/orders/"
    ) &&
    !source.includes(
      "createPaperBuyOrder("
    ),

  noPromotion:
    !source.includes(
      "applyPromotion("
    ) &&
    !source.includes(
      "/api/models/promotion/apply"
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_STATIC_FAILED",

      checks,

      contract: {
        targetDate:
          "2026-10-12",
        executeWindowKst:
          "08:45-08:59",
        dryRunNow:
          true,
        maxNormalRun:
          1,
        realTrading:
          "FORCED_OFF",
        globalAutomation:
          "FORCED_OFF",
        postCapture:
          "LEDGER/INTEGRITY/DASHBOARD VALIDATION",
      },

      safety: {
        sourceOnly:
          true,
        producerExecuted:
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
          ? "RUN_DRY_RUN_ORCHESTRATOR_AND_TYPECHECK"
          : "REPAIR_FIRST_SESSION_ORCHESTRATOR_V1",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
