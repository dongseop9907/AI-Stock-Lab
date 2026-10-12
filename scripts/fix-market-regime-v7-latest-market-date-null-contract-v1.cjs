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
    "market-regime-v7-latest-market-date-null-contract-v1-static-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V1_FAILED",

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
    "daily-market-adapters.before-v7-latest-market-date-null-contract-v1.ts"
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

const before =
  source;

/*
 * 1. Align adapter-like contract with the canonical V7 feature vector.
 *
 * Canonical:
 *   latestMarketDate: string | null
 *
 * Adapter-like was incorrectly narrower:
 *   latestMarketDate: string
 */
const narrowInterface =
  /export interface V7MarketRegimeFeatureVectorLike\s*\{([\s\S]*?)latestMarketDate:\s*string\s*;/;

if (
  narrowInterface.test(
    source
  )
) {
  source =
    source.replace(
      /latestMarketDate:\s*string\s*;/,
      "latestMarketDate: string | null;"
    );
}

/*
 * 2. completedTradingDateAvailableAt already represents an
 * availability calculation. If its parameter is still string-only,
 * widen that input contract and fail closed on null.
 *
 * No fallback date is invented.
 */
const helperIndex =
  source.indexOf(
    "function completedTradingDateAvailableAt"
  ) >= 0
    ? source.indexOf(
        "function completedTradingDateAvailableAt"
      )
    : source.indexOf(
        "const completedTradingDateAvailableAt"
      );

if (
  helperIndex <
  0
) {
  fail(
    "COMPLETED_TRADING_DATE_AVAILABLE_AT_HELPER_NOT_FOUND"
  );

  return;
}

const helperWindowEnd =
  Math.min(
    source.length,
    helperIndex +
      1800
  );

let helperWindow =
  source.slice(
    helperIndex,
    helperWindowEnd
  );

const alreadyNullableHelper =
  /(?:tradingDate|marketDate|date)\s*:\s*string\s*\|\s*null/.test(
    helperWindow
  ) ||
  /(?:tradingDate|marketDate|date)\s*:\s*string\s*\|\s*null\s*\|\s*undefined/.test(
    helperWindow
  );

if (
  !alreadyNullableHelper
) {
  const parameterPatterns = [
    /(tradingDate\s*:\s*)string/,
    /(marketDate\s*:\s*)string/,
    /(date\s*:\s*)string/
  ];

  let widened =
    false;

  for (
    const pattern of parameterPatterns
  ) {
    if (
      pattern.test(
        helperWindow
      )
    ) {
      helperWindow =
        helperWindow.replace(
          pattern,
          "$1string | null"
        );

      widened =
        true;

      break;
    }
  }

  if (
    !widened
  ) {
    fail(
      "HELPER_DATE_PARAMETER_PATTERN_NOT_FOUND",
      {
        helperPreview:
          helperWindow.slice(
            0,
            900
          )
      }
    );

    return;
  }

  source =
    source.slice(
      0,
      helperIndex
    ) +
    helperWindow +
    source.slice(
      helperWindowEnd
    );
}

/*
 * 3. Add an explicit fail-closed null guard to the helper if one
 * is not already obvious.
 */
const refreshedHelperIndex =
  source.indexOf(
    "function completedTradingDateAvailableAt"
  ) >= 0
    ? source.indexOf(
        "function completedTradingDateAvailableAt"
      )
    : source.indexOf(
        "const completedTradingDateAvailableAt"
      );

const refreshedEnd =
  Math.min(
    source.length,
    refreshedHelperIndex +
      2200
  );

let refreshedHelper =
  source.slice(
    refreshedHelperIndex,
    refreshedEnd
  );

const hasNullGuard =
  /if\s*\(\s*!(?:tradingDate|marketDate|date)\s*\)/.test(
    refreshedHelper
  ) ||
  /(?:tradingDate|marketDate|date)\s*===\s*null/.test(
    refreshedHelper
  );

if (
  !hasNullGuard
) {
  const brace =
    refreshedHelper.indexOf(
      "{"
    );

  if (
    brace <
    0
  ) {
    fail(
      "HELPER_BODY_OPEN_BRACE_NOT_FOUND"
    );

    return;
  }

  const paramMatch =
    refreshedHelper.match(
      /(tradingDate|marketDate|date)\s*:\s*string\s*\|\s*null/
    );

  if (
    !paramMatch
  ) {
    fail(
      "NULLABLE_HELPER_PARAMETER_NOT_RESOLVED"
    );

    return;
  }

  const parameterName =
    paramMatch[1];

  const guard =
    `\n  if (!${parameterName}) {\n    return null;\n  }\n`;

  refreshedHelper =
    refreshedHelper.slice(
      0,
      brace + 1
    ) +
    guard +
    refreshedHelper.slice(
      brace + 1
    );

  source =
    source.slice(
      0,
      refreshedHelperIndex
    ) +
    refreshedHelper +
    source.slice(
      refreshedEnd
    );
}

const checks = {
  adapterContractNullable:
    /export interface V7MarketRegimeFeatureVectorLike\s*\{[\s\S]*?latestMarketDate:\s*string\s*\|\s*null\s*;/.test(
      source
    ),

  helperAcceptsNullableDate:
    /completedTradingDateAvailableAt[\s\S]{0,500}(?:tradingDate|marketDate|date)\s*:\s*string\s*\|\s*null/.test(
      source
    ),

  helperFailClosedOnNull:
    /completedTradingDateAvailableAt[\s\S]{0,900}if\s*\(\s*!(?:tradingDate|marketDate|date)\s*\)\s*\{\s*return null\s*;/.test(
      source
    ),

  evidenceAlreadyFailsClosed:
    /const availableAt\s*=[\s\S]*?completedTradingDateAvailableAt\([\s\S]*?latestMarketDate[\s\S]*?if\s*\(\s*!availableAt\s*\)\s*\{\s*return undefined\s*;/.test(
      source
    ),

  inventedFallbackDate:
    false,

  marketRegimeDecisionLogicChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "inventedFallbackDate",
          "marketRegimeDecisionLogicChanged"
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
    "POST_REPAIR_CONTRACT_CHECK_FAILED",
    {
      checks,
      failed
    }
  );

  return;
}

if (
  source !==
  before
) {
  fs.writeFileSync(
    TARGET,
    source,
    "utf8"
  );
}

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
      "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V1_STATIC_FAILED",

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

    helperAcceptsNullableDate:
      /completedTradingDateAvailableAt[\\\\s\\\\S]{0,500}(?:tradingDate|marketDate|date)\\\\s*:\\\\s*string\\\\s*\\\\|\\\\s*null/.test(
        source
      ),

    helperFailClosed:
      /completedTradingDateAvailableAt[\\\\s\\\\S]{0,900}if\\\\s*\\\\(\\\\s*!(?:tradingDate|marketDate|date)\\\\s*\\\\)\\\\s*\\\\{\\\\s*return null\\\\s*;/.test(
        source
      ),

    evidenceReturnsUndefinedWithoutAvailableAt:
      /if\\\\s*\\\\(\\\\s*!availableAt\\\\s*\\\\)\\\\s*\\\\{\\\\s*return undefined\\\\s*;/.test(
        source
      ),

    noInventedFallback:
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
        ? "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V1_STATIC_FAILED",

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
        ? "RUN_NEXT_BUILD"
        : "REPAIR_V7_NULL_CONTRACT"
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
        "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_NULL_CONTRACT_V1_REPAIRED",

      changedFile:
        "lib/alpha/daily-market-adapters.ts",

      generatedFile:
        "scripts/market-regime-v7-latest-market-date-null-contract-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/daily-market-adapters.before-v7-latest-market-date-null-contract-v1.ts",

      repair: {
        canonicalSourceType:
          "MarketRegimeFeatureVectorV7.latestMarketDate = string | null",

        adapterLikeType:
          "V7MarketRegimeFeatureVectorLike.latestMarketDate = string | null",

        nullBehavior:
          "completedTradingDateAvailableAt returns null",

        evidenceBehavior:
          "buildV7MarketRegimeEvidence returns undefined when no availableAt",

        fallbackMarketDate:
          "NOT_INVENTED",

        runtimeMarketRegimePolicy:
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
