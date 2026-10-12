const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ADAPTER =
  path.join(
    ROOT,
    "lib",
    "alpha",
    "daily-market-adapters.ts"
  );

const REPLAY =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-5-date-full-historical-replay-read-only.ts"
  );

const FIXED_STATIC =
  path.join(
    ROOT,
    "scripts",
    "market-regime-v7-latest-market-date-null-contract-v3-static-verify.cjs"
  );

const PROBE_LOG =
  path.join(
    ROOT,
    "logs",
    "kis-flow-row-type-contract-probe-v1.json"
  );

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_V7_STATIC_AND_KIS_FLOW_TYPE_PROBE_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (
  !fs.existsSync(ADAPTER) ||
  !fs.existsSync(REPLAY)
) {
  fail(
    "REQUIRED_SOURCE_NOT_FOUND",
    {
      adapterExists:
        fs.existsSync(ADAPTER),

      replayExists:
        fs.existsSync(REPLAY),
    }
  );

  return;
}

const adapterSource =
  fs.readFileSync(
    ADAPTER,
    "utf8"
  );

const staticChecks = {
  adapterContractNullable:
    adapterSource.includes(
      "latestMarketDate: string | null;"
    ),

  helperAcceptsNullableSqlDate:
    adapterSource.includes(
      "sqlDate: string | null,"
    ),

  helperFailClosed:
    adapterSource.includes(
      "if (!sqlDate) {\n    return null;\n  }"
    ) ||
    adapterSource.includes(
      "if (!sqlDate) {\r\n    return null;\r\n  }"
    ),

  evidenceReturnsUndefinedWithoutAvailableAt:
    adapterSource.includes(
      "if (!availableAt) {"
    ) &&
    adapterSource.includes(
      "return undefined;"
    ),

  noFallbackDateInvented:
    !adapterSource.includes(
      "latestMarketDate ??"
    ) &&
    !adapterSource.includes(
      "latestMarketDate ||"
    ),
};

const staticFailed =
  Object.entries(
    staticChecks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

const fixedStaticSource = `const fs = require("fs");
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
        "if (!sqlDate) {\\n    return null;\\n  }"
      ) ||
      source.includes(
        "if (!sqlDate) {\\r\\n    return null;\\r\\n  }"
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
`;

fs.writeFileSync(
  FIXED_STATIC,
  fixedStaticSource,
  "utf8"
);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }

  for (const entry of fs.readdirSync(
    dir,
    { withFileTypes: true }
  )) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name
      );

    if (entry.isDirectory()) {
      walk(
        full,
        out
      );
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx")
    ) {
      out.push(
        full
      );
    }
  }

  return out;
}

function rel(file) {
  return path
    .relative(
      ROOT,
      file
    )
    .replaceAll(
      "\\",
      "/"
    );
}

function snippets(source, needle, before = 18, after = 28) {
  const lines =
    source.split(/\r?\n/);

  const results = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      lines[i].includes(
        needle
      )
    ) {
      const start =
        Math.max(
          0,
          i - before
        );

      const end =
        Math.min(
          lines.length,
          i + after + 1
        );

      results.push({
        line:
          i + 1,

        snippet:
          lines
            .slice(
              start,
              end
            )
            .map(
              (text, offset) => ({
                line:
                  start +
                  offset +
                  1,

                text
              })
            )
      });
    }
  }

  return results;
}

const replaySource =
  fs.readFileSync(
    REPLAY,
    "utf8"
  );

const symbols = [
  "stockFlow",
  "KisDomesticInvestorTrendOutput",
  "buildKisInvestorFlowEvidence",
  "stck_clpr",
  "prsn_ntby_qty",
  "frgn_ntby_qty",
  "orgn_ntby_qty",
];

const replayContext = {};

for (const symbol of symbols) {
  replayContext[symbol] =
    snippets(
      replaySource,
      symbol
    );
}

const symbolFiles = {};

for (const symbol of [
  "KisDomesticInvestorTrendOutput",
  "buildKisInvestorFlowEvidence"
]) {
  symbolFiles[symbol] = [];

  for (const file of walk(ROOT)) {
    let source;

    try {
      source =
        fs.readFileSync(
          file,
          "utf8"
        );
    } catch {
      continue;
    }

    if (
      !source.includes(
        symbol
      )
    ) {
      continue;
    }

    symbolFiles[symbol].push({
      file:
        rel(file),

      matches:
        snippets(
          source,
          symbol
        )
    });
  }
}

const report = {
  status:
    "AI_STOCK_LAB_V7_STATIC_AND_KIS_FLOW_TYPE_PROBE_V1_COMPLETE",

  v7StaticVerifierRepair: {
    verifier:
      "scripts/market-regime-v7-latest-market-date-null-contract-v3-static-verify.cjs",

    checks:
      staticChecks,

    failed:
      staticFailed,

    interpretation:
      staticFailed.length === 0
        ? "V2 PRODUCT FIX IS PRESENT; PREVIOUS STATIC FAILURE WAS VERIFIER FALSE_NEGATIVE"
        : "PRODUCT SOURCE NEEDS RECHECK"
  },

  buildError: {
    file:
      "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts",

    line:
      1193,

    value:
      "stockFlow",

    expectedType:
      "KisDomesticInvestorTrendOutput[]",

    actualProblem:
      "one or more mapped fields are inferred as unknown"
  },

  replayContext,

  symbolFiles,

  decisionRules: {
    preferred:
      "normalize unknown source values at the mapping boundary into string | number | null | undefined",

    alternative:
      "narrow upstream row interface if the database/query contract already guarantees those scalar types",

    forbidden:
      "do not use broad any-cast only to silence TypeScript"
  },

  safety: {
    sourceOnly:
      true,

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

  nextGate:
    "PATCH_KIS_FLOW_ROW_MAPPING_WITH_EXPLICIT_SCALAR_NORMALIZATION"
};

fs.mkdirSync(
  path.dirname(
    PROBE_LOG
  ),
  {
    recursive:
      true
  }
);

fs.writeFileSync(
  PROBE_LOG,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode = 0;
