const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-evidence-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    consistencyGateUsed:
      source.includes(
        "auditEvaluatorEvidenceConsistencyV1"
      ),

    evaluatorGateRequired:
      source.includes(
        "forwardOosGatePassed"
      ),

    manualReviewOnlyStatus:
      source.includes(
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
      ),

    noAutoPromotion:
      source.includes(
        "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY"
      ),

    summaryEvidenceRequired:
      source.includes(
        "enoughEvidenceForFinalEntryGate"
      ),

    productionPolicyUnlockedCheck:
      source.includes(
        "productionPolicyLocked"
      ),

    summarySafetyChecks:
      source.includes(
        "noSummaryProductionWrites"
      ) &&
      source.includes(
        "noSummaryOrders"
      ) &&
      source.includes(
        "noSummaryPositionMutation"
      ),

    frozenCutoff:
      source.includes(
        '"2026-10-07"'
      ),

    frozenCap:
      source.includes(
        "0.01"
      ),

    frozenThreshold:
      source.includes(
        "0.66"
      ),

    readOnly:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    noSubprocess:
      !/spawn\s*\(|spawnSync\s*\(|execSync\s*\(/.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*[:=]\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(
      checks
    )
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      evaluatorExecuted:
        false,

      summaryExecuted:
        false,

      promotionExecuted:
        false,

      databaseWrites:
        0,

      fileWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_MANUAL_REVIEW_EVIDENCE_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_EVIDENCE_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
