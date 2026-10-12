const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_GATE_CONTRACT_V2_REPAIR_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(CONTRACT)) {
  fail("CONTRACT_FILE_NOT_FOUND");
} else {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive:
        true,
    }
  );

  const backup = path.join(
    BACKUP_DIR,
    "true-forward-oos-manual-review-evidence-gate-v1-contract-test.before-v2.ts"
  );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      CONTRACT,
      backup
    );
  }

  let source =
    fs.readFileSync(
      CONTRACT,
      "utf8"
    );

  const oldBlock = `    unsafeSummaryBlocked:
      unsafeSummary.gateStatus ===
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
      unsafeSummary.failed.includes(
        "noSummaryProductionWrites",
      ),`;

  const newBlock = `    unsafeSummaryBlocked:
      unsafeSummary.reviewReady ===
        false &&
      (
        (
          unsafeSummary.gateStatus ===
            "BLOCKED_EVIDENCE_INCONSISTENT" &&
          unsafeSummary.failed.includes(
            "EVALUATOR_EVIDENCE_NOT_CONSISTENT",
          )
        ) ||
        (
          unsafeSummary.gateStatus ===
            "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
          unsafeSummary.failed.includes(
            "noSummaryProductionWrites",
          )
        )
      ),`;

  if (source.includes(oldBlock)) {
    source =
      source.replace(
        oldBlock,
        newBlock
      );
  } else if (
    !source.includes(
      '"BLOCKED_EVIDENCE_INCONSISTENT"'
    )
  ) {
    fail(
      "TARGET_ASSERTION_BLOCK_NOT_FOUND"
    );
  }

  const markerOld = `          unsafeSummary:
            unsafeSummary.failed,`;

  const markerNew = `          unsafeSummary: {
            gateStatus:
              unsafeSummary.gateStatus,

            reviewReady:
              unsafeSummary.reviewReady,

            failed:
              unsafeSummary.failed,
          },`;

  if (source.includes(markerOld)) {
    source =
      source.replace(
        markerOld,
        markerNew
      );
  }

  fs.writeFileSync(
    CONTRACT,
    source,
    "utf8"
  );

  const checks = {
    contractExists:
      fs.existsSync(
        CONTRACT
      ),

    backupExists:
      fs.existsSync(
        backup
      ),

    acceptsUpstreamConsistencyBlock:
      source.includes(
        '"BLOCKED_EVIDENCE_INCONSISTENT"'
      ),

    stillAcceptsLocalManualBlock:
      source.includes(
        '"BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE"'
      ),

    requiresReviewReadyFalse:
      source.includes(
        "unsafeSummary.reviewReady ==="
      ),

    upstreamFailureReasonChecked:
      source.includes(
        '"EVALUATOR_EVIDENCE_NOT_CONSISTENT"'
      ),

    localFailureReasonChecked:
      source.includes(
        '"noSummaryProductionWrites"'
      ),

    productGateNotModified:
      true,
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

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_GATE_CONTRACT_V2_REPAIRED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_GATE_CONTRACT_V2_REPAIR_FAILED",

    changedFile:
      "scripts/true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts",

    backupFile:
      "scripts/backups/true-forward-oos-manual-review-evidence-gate-v1-contract-test.before-v2.ts",

    repair: {
      problem:
        "UNSAFE_SUMMARY_IS_BLOCKED_BY_UPSTREAM_EVIDENCE_CONSISTENCY_GATE_BEFORE_LOCAL_MANUAL_REVIEW_CHECK",

      correctBehavior:
        "FAIL_CLOSED_AT_EARLIEST_VALID_GATE",

      acceptedBlockedStatuses: [
        "BLOCKED_EVIDENCE_INCONSISTENT",
        "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE"
      ]
    },

    checks,

    safety: {
      productGateChanged:
        false,

      tradingLogicChanged:
        false,

      evaluatorExecuted:
        false,

      summaryExecuted:
        false,

      promotionExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false
    },

    failed,

    nextAction:
      failed.length === 0
        ? "RERUN_MANUAL_REVIEW_STATIC_CONTRACT_AND_CURRENT_GATE"
        : "STOP_AND_INSPECT_CONTRACT_REPAIR"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
