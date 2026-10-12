const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "lib",
    "alpha",
    "daily-market-adapters.ts"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "market-regime-v7-latest-market-date-null-contract-v2-static-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V2_FAILED",
        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    TARGET
  )
) {
  fail(
    "DAILY_MARKET_ADAPTERS_NOT_FOUND"
  );
  return;
}

let source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const backupDir =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

fs.mkdirSync(
  backupDir,
  {
    recursive:
      true
  }
);

const backup =
  path.join(
    backupDir,
    "daily-market-adapters.before-v7-latest-market-date-null-contract-v2.ts"
  );

if (
  !fs.existsSync(
    backup
  )
) {
  fs.copyFileSync(
    TARGET,
    backup
  );
}

/*
 * 1. Widen adapter-like type to match the canonical
 * MarketRegimeFeatureVectorV7 contract.
 */
source =
  source.replace(
    /latestMarketDate:\s*string\s*;/,
    "latestMarketDate: string | null;"
  );

/*
 * 2. Widen completedTradingDateAvailableAt(sqlDate: string)
 * to accept null.
 */
source =
  source.replace(
    /function completedTradingDateAvailableAt\(\s*sqlDate:\s*string\s*,\s*\):\s*string\s*\|\s*null\s*\{/m,
    "function completedTradingDateAvailableAt(\n  sqlDate: string | null,\n): string | null {"
  );

/*
 * 3. Add explicit fail-closed null guard before the
 * existing YYYY-MM-DD format validation.
 */
const helperHeader =
  "function completedTradingDateAvailableAt(\n  sqlDate: string | null,\n): string | null {";

const helperStart =
  source.indexOf(
    helperHeader
  );

if (
  helperStart <
  0
) {
  fail(
    "NULLABLE_HELPER_SIGNATURE_NOT_FOUND"
  );
  return;
}

const afterHeader =
  helperStart +
  helperHeader.length;

const helperPreview =
  source.slice(
    helperStart,
    Math.min(
      source.length,
      helperStart + 700
    )
  );

if (
  !helperPreview.includes(
    "if (!sqlDate) {"
  )
) {
  source =
    source.slice(
      0,
      afterHeader
    ) +
    "\n  if (!sqlDate) {\n    return null;\n  }\n" +
    source.slice(
      afterHeader
    );
}

const checks = {
  adapterContractNullable:
    /export interface V7MarketRegimeFeatureVectorLike\s*\{[\s\S]*?latestMarketDate:\s*string\s*\|\s*null\s*;/.test(
      source
    ),

  helperAcceptsNullableSqlDate:
    /function completedTradingDateAvailableAt\(\s*sqlDate:\s*string\s*\|\s*null\s*,\s*\):\s*string\s*\|\s*null/.test(
      source
    ),

  helperFailClosedOnNull:
    /function completedTradingDateAvailableAt[\s\S]{0,300}if\s*\(\s*!sqlDate\s*\)\s*\{\s*return null\s*;/.test(
      source
    ),

  originalFormatGuardPreserved:
    /!\s*\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(\s*sqlDate\s*,?\s*\)/.test(
      source
    ) ||
    source.includes(
      '!/^\\d{4}-\\d{2}-\\d{2}$/.test(\n      sqlDate,'
    ),

  evidenceStillFailsClosed:
    /const availableAt\s*=[\s\S]*?completedTradingDateAvailableAt\([\s\S]*?latestMarketDate[\s\S]*?if\s*\(\s*!availableAt\s*\)\s*\{\s*return undefined\s*;/.test(
      source
    ),

  fallbackDateInvented:
    false,

  regimePolicyChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "fallbackDateInvented",
          "regimePolicyChanged"
        ].includes(
          key
        ) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (
  failed.length >
  0
) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed
    }
  );
  return;
}

fs.writeFileSync(
  TARGET,
  source,
  "utf8"
);

const staticSource = `const fs = require("fs");
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
      /export interface V7MarketRegimeFeatureVectorLike\\\\s*\\\\{[\\\\s\\\\S]*?latestMarketDate:\\\\s*string\\\\s*\\\\|\\\\s*null\\\\s*;/.test(
        source
      ),

    helperAcceptsNullableSqlDate:
      /function completedTradingDateAvailableAt\\\\(\\\\s*sqlDate:\\\\s*string\\\\s*\\\\|\\\\s*null\\\\s*,\\\\s*\\\\):\\\\s*string\\\\s*\\\\|\\\\s*null/.test(
        source
      ),

    helperFailClosed:
      /function completedTradingDateAvailableAt[\\\\s\\\\S]{0,300}if\\\\s*\\\\(\\\\s*!sqlDate\\\\s*\\\\)\\\\s*\\\\{\\\\s*return null\\\\s*;/.test(
        source
      ),

    evidenceReturnsUndefinedWithoutAvailableAt:
      /if\\\\s*\\\\(\\\\s*!availableAt\\\\s*\\\\)\\\\s*\\\\{\\\\s*return undefined\\\\s*;/.test(
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
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V2_REPAIRED",

      changedFile:
        "lib/alpha/daily-market-adapters.ts",

      generatedFile:
        "scripts/market-regime-v7-latest-market-date-null-contract-v2-static-verify.cjs",

      backupFile:
        "scripts/backups/daily-market-adapters.before-v7-latest-market-date-null-contract-v2.ts",

      repair: {
        canonicalSourceType:
          "MarketRegimeFeatureVectorV7.latestMarketDate = string | null",

        adapterLikeType:
          "V7MarketRegimeFeatureVectorLike.latestMarketDate = string | null",

        helperParameter:
          "sqlDate: string | null",

        nullBehavior:
          "return null before existing format validation",

        evidenceBehavior:
          "buildV7MarketRegimeEvidence returns undefined when availableAt is unavailable",

        fallbackMarketDate:
          "NOT_INVENTED",

        runtimePolicyLogic:
          "UNCHANGED"
      },

      checks,

      safety: {
        replayExecuted:
          false,

        databaseReads:
          0,

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

      failed:
        [],

      nextAction:
        "RUN_STATIC_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
