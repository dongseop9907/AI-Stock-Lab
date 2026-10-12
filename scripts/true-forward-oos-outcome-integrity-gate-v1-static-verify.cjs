const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-outcome-integrity-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_FAILED",

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

    duplicateCheck:
      source.includes(
        "DUPLICATE_OUTCOME_KEYS"
      ),

    invalidRowCheck:
      source.includes(
        "INVALID_OUTCOME_ROWS"
      ),

    orderingCheck:
      source.includes(
        "HORIZON_ORDERING_VIOLATION"
      ),

    waitingGate:
      source.includes(
        "WAITING_FOR_OUTCOME_ROWS"
      ),

    summaryGate:
      source.includes(
        "BUILD_TRUE_FORWARD_OOS_SUMMARY_AND_PROMOTION_EVIDENCE"
      ),

    readOnlySurface:
      !source.includes(
        "writeFileSync"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

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
        ? "RUN_OUTCOME_INTEGRITY_CONTRACT"
        : "REPAIR_OUTCOME_INTEGRITY_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
