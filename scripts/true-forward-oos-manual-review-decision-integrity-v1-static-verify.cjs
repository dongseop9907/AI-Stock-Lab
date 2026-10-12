const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-decision-integrity-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_FAILED",

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

    packetIntegrityUsed:
      source.includes(
        "auditManualReviewPacketIntegrityV1"
      ),

    decisionPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-decision-v1.json"
      ),

    packetPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-packet-v1.json"
      ),

    decisionHashRecomputed:
      source.includes(
        "recomputedDecisionSha256"
      ),

    packetReferenceChecked:
      source.includes(
        "packetReferenceMatchesCurrent"
      ),

    allSourceReferencesChecked:
      source.includes(
        "observationsReferenceMatchesCurrent"
      ) &&
      source.includes(
        "evaluatorReferenceMatchesCurrent"
      ) &&
      source.includes(
        "summaryReferenceMatchesCurrent"
      ),

    approveReviewOnly:
      source.includes(
        "BUILD_SEPARATE_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT"
      ),

    rejectContinuesOos:
      source.includes(
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING"
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
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
          value !==
          true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      decisionWritten:
        false,

      promotionExecuted:
        false,

      promotionApproved:
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
        ? "RUN_MANUAL_REVIEW_DECISION_INTEGRITY_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_DECISION_INTEGRITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
