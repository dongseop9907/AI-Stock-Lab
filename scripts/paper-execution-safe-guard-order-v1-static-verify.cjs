const fs = require("fs");
const path = require("path");

const file = path.join(
  process.cwd(),
  "lib",
  "trading",
  "execute-paper-order.ts"
);

if (!fs.existsSync(file)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_FAILED",
    failed: [
      "sourceExists"
    ]
  }, null, 2));
  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const guard =
    source.indexOf(
      "  if (\n    !safeExecution.allowed ||"
    );

  const market =
    source.indexOf(
      "  const realismMarketInput ="
    );

  const observed =
    source.indexOf(
      "observedAt: safeExecution.executionPriceObservedAt"
    );

  const nowUse =
    source.indexOf(
      "now:\n        safeExecution.executionPriceObservedAt"
    );

  const checks = {
    sourceExists:
      true,

    guardBeforeMarketInput:
      guard >= 0 &&
      market >= 0 &&
      guard < market,

    guardBeforeObservedAt:
      guard >= 0 &&
      observed >= 0 &&
      guard < observed,

    guardBeforeRealismNow:
      guard >= 0 &&
      nowUse >= 0 &&
      guard < nowUse,

    failClosedStillPresent:
      source.includes(
        "failUnsafePaperBuyExecution"
      ) &&
      source.includes(
        "\"PAPER_BUY_EXECUTION_BLOCKED\""
      ),

    noFallbackTimestamp:
      !source.includes(
        "executionPriceObservedAt ?? new Date"
      ) &&
      !source.includes(
        "executionPriceObservedAt || new Date"
      )
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
        ? "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      fallbackTimestampInvented:
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
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_NEXT_BUILD"
        : "REPAIR_SAFE_EXECUTION_GUARD_ORDER"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
