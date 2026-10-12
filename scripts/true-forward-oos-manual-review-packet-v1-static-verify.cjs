const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-packet-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_FAILED",

    failed:
      ["packetExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    packetExists:
      true,

    manualReviewGateUsed:
      source.includes(
        "auditManualForwardOosReviewEvidenceGateV1"
      ),

    reviewReadyRequired:
      source.includes(
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
      ),

    sourceHashes:
      source.includes(
        "observationsSha256"
      ) &&
      source.includes(
        "evaluatorSha256"
      ) &&
      source.includes(
        "summarySha256"
      ),

    packetHash:
      source.includes(
        "packetSha256"
      ),

    exactWriteConfirmation:
      source.includes(
        "WRITE_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET"
      ),

    previewDefault:
      source.includes(
        "READY_PREVIEW_ONLY"
      ),

    noAutomaticWrite:
      source.includes(
        "if ("
      ) &&
      source.includes(
        "input.write !=="
      ),

    noAutoPromotion:
      source.includes(
        "automaticPromotion:"
      ) &&
      source.includes(
        "false"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      packetWritten:
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
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_MANUAL_REVIEW_PACKET_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_PACKET_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
