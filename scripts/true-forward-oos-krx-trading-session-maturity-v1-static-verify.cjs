const fs = require("fs");
const path = require("path");

const audit = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (!fs.existsSync(audit)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_FAILED",

    failed: [
      "auditFileExists"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const checks = {
    auditFileExists:
      true,

    nextKrxImported:
      source.includes(
        'nextKrxTradingDate'
      ) &&
      source.includes(
        '../lib/trading/krx-trading-calendar'
      ),

    krxSessionHelperExists:
      source.includes(
        "function addKrxTradingSessions("
      ),

    helperUsesNextKrxTradingDate:
      source.includes(
        "nextKrxTradingDate("
      ),

    calendarDayHelperRemoved:
      !source.includes(
        "function addCalendarDays("
      ),

    maturityNoLongerCallsCalendarDays:
      !source.includes(
        "addCalendarDays("
      ),

    maturityUsesKrxSessions:
      (
        source.match(
          /addKrxTradingSessions\s*\(/g
        ) ||
        []
      ).length ===
        4,

    oneThreeFiveHorizonsStillPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      maturityAuditExecuted:
        false,

      collectorExecuted:
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
        ? "RUN_KRX_MATURITY_CONTRACT_AND_CURRENT_AUDIT"
        : "REPAIR_KRX_TRADING_SESSION_MATURITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
