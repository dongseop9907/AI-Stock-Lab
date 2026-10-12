const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_FAILED",

    failed:
      ["auditExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    auditExists:
      true,

    readOnlyDiskSurface:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    forwardSessionIntegrity:
      source.includes(
        "buildSessionIntegrity"
      ),

    maturitySchedule:
      source.includes(
        "buildMaturitySchedule"
      ),

    horizonsPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    waitingGate:
      source.includes(
        "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION"
      ),

    oneDayGate:
      source.includes(
        "RUN_1D_OUTCOME_COLLECTION_FOR_MATURE_SESSIONS"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_FAILED",

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

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_POST_CAPTURE_MATURITY_CONTRACT"
        : "REPAIR_POST_CAPTURE_MATURITY_AUDIT_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
