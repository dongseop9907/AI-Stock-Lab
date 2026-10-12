const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "lib",
  "alpha",
  "daily-market-adapters.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V2_STATIC_FAILED",
    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    adapterContractNullable:
      /export interface V7MarketRegimeFeatureVectorLike\\s*\\{[\\s\\S]*?latestMarketDate:\\s*string\\s*\\|\\s*null\\s*;/.test(
        source
      ),

    helperAcceptsNullableSqlDate:
      /function completedTradingDateAvailableAt\\(\\s*sqlDate:\\s*string\\s*\\|\\s*null\\s*,\\s*\\):\\s*string\\s*\\|\\s*null/.test(
        source
      ),

    helperFailClosed:
      /function completedTradingDateAvailableAt[\\s\\S]{0,300}if\\s*\\(\\s*!sqlDate\\s*\\)\\s*\\{\\s*return null\\s*;/.test(
        source
      ),

    evidenceReturnsUndefinedWithoutAvailableAt:
      /if\\s*\\(\\s*!availableAt\\s*\\)\\s*\\{\\s*return undefined\\s*;/.test(
        source
      ),

    noFallbackDateInvented:
      !source.includes(
        "latestMarketDate ??"
      ) &&
      !source.includes(
        "latestMarketDate ||"
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
        ? "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V2_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      fallbackDateInvented:
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
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_V7_NULL_CONTRACT_V2"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
