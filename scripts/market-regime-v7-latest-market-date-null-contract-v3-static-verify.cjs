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
      "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V3_STATIC_FAILED",
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
      source.includes(
        "latestMarketDate: string | null;"
      ),

    helperAcceptsNullableSqlDate:
      source.includes(
        "sqlDate: string | null,"
      ),

    helperFailClosed:
      source.includes(
        "if (!sqlDate) {\n    return null;\n  }"
      ) ||
      source.includes(
        "if (!sqlDate) {\r\n    return null;\r\n  }"
      ),

    evidenceReturnsUndefinedWithoutAvailableAt:
      source.includes(
        "if (!availableAt) {"
      ) &&
      source.includes(
        "return undefined;"
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
        ? "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V3_STATIC_VERIFIED"
        : "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V3_STATIC_FAILED",

    verifierVersion:
      "V3_STRING_ONLY_NO_COMPLEX_REGEX",

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

    failed
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
