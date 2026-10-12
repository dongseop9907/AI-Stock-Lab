const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-decision-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_FAILED",

    failed:
      ["decisionExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    decisionExists:
      true,

    packetIntegrityRequired:
      source.includes(
        "auditManualReviewPacketIntegrityV1"
      ) &&
      source.includes(
        "REVIEW_PACKET_INTEGRITY_VERIFIED"
      ),

    explicitApproveDecision:
      source.includes(
        "APPROVE_FOR_PAPER_PROMOTION_REVIEW"
      ),

    explicitRejectDecision:
      source.includes(
        "REJECT_AND_CONTINUE_FORWARD_OOS"
      ),

    exactWriteConfirmation:
      source.includes(
        "RECORD_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION"
      ),

    approvalNotPromotion:
      source.includes(
        "promotionApproved:"
      ) &&
      source.includes(
        "false"
      ) &&
      source.includes(
        "paperPromotionExecuted:"
      ),

    separatePromotionGate:
      source.includes(
        "SEPARATE_PAPER_PROMOTION_GATE_STILL_REQUIRES_ITS_OWN_APPROVAL"
      ),

    decisionHash:
      source.includes(
        "decisionRecordSha256"
      ),

    noAutoPromotion:
      source.includes(
        "automaticPromotion:"
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_FAILED",

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
        ? "RUN_MANUAL_REVIEW_DECISION_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_DECISION_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
