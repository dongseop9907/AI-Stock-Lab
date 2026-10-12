const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-packet-integrity-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_FAILED",

    failed:
      ["verifierExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    verifierExists:
      true,

    packetPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-packet-v1.json"
      ),

    sourceFiles:
      source.includes(
        "alpha-v3-entry-v3-forward-oos-observations.json"
      ) &&
      source.includes(
        "alpha-v3-entry-v3-forward-shadow-oos.json"
      ) &&
      source.includes(
        "alpha-v3-true-forward-oos-summary.json"
      ),

    packetHashRecomputed:
      source.includes(
        "recomputedPacketSha256"
      ),

    allSourceHashesChecked:
      source.includes(
        "observationsSourceHashMatches"
      ) &&
      source.includes(
        "evaluatorSourceHashMatches"
      ) &&
      source.includes(
        "summarySourceHashMatches"
      ),

    sourceDriftFailClosed:
      source.includes(
        "REVIEW_PACKET_SOURCE_DRIFT_DETECTED"
      ),

    packetIntegrityFailClosed:
      source.includes(
        "REVIEW_PACKET_INTEGRITY_FAILED"
      ),

    manualReviewOnlyNext:
      source.includes(
        "MANUAL_HUMAN_REVIEW_OF_FROZEN_PACKET_ONLY"
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_FAILED",

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
        ? "RUN_MANUAL_REVIEW_PACKET_INTEGRITY_CONTRACT"
        : "REPAIR_PACKET_INTEGRITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
