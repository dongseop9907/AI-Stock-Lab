const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_SYMBOLS = [
  "V7MarketRegimeFeatureVectorLike",
  "MarketRegimeFeatureVectorV7",
  "buildV7MarketRegimeEvidence",
];

const TARGET_CALL_FILE =
  "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts";

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }

  for (const entry of fs.readdirSync(
    dir,
    { withFileTypes: true },
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
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(
        full,
        out,
      );
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx")
    ) {
      out.push(
        full,
      );
    }
  }

  return out;
}

function rel(file) {
  return path
    .relative(
      ROOT,
      file,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function linesAround(
  source,
  needle,
  before = 18,
  after = 30,
) {
  const lines =
    source.split(/\r?\n/);

  const matches = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      lines[i].includes(
        needle,
      )
    ) {
      const start =
        Math.max(
          0,
          i - before,
        );

      const end =
        Math.min(
          lines.length,
          i + after + 1,
        );

      matches.push({
        line:
          i + 1,

        snippet:
          lines
            .slice(
              start,
              end,
            )
            .map(
              (text, offset) => ({
                line:
                  start +
                  offset +
                  1,

                text,
              }),
            ),
      });
    }
  }

  return matches;
}

const files =
  walk(
    ROOT,
  );

const symbolResults = {};

for (
  const symbol of TARGET_SYMBOLS
) {
  symbolResults[symbol] =
    [];

  for (
    const file of files
  ) {
    let source;

    try {
      source =
        fs.readFileSync(
          file,
          "utf8",
        );
    } catch {
      continue;
    }

    if (
      !source.includes(
        symbol,
      )
    ) {
      continue;
    }

    symbolResults[symbol].push({
      file:
        rel(
          file,
        ),

      matches:
        linesAround(
          source,
          symbol,
        ),
    });
  }
}

const callFile =
  path.join(
    ROOT,
    TARGET_CALL_FILE,
  );

let callSite = null;

if (
  fs.existsSync(
    callFile,
  )
) {
  const source =
    fs.readFileSync(
      callFile,
      "utf8",
    );

  callSite = {
    file:
      TARGET_CALL_FILE,

    buildCalls:
      linesAround(
        source,
        "buildV7MarketRegimeEvidence",
        28,
        38,
      ),

    latestMarketDateUses:
      linesAround(
        source,
        "latestMarketDate",
        20,
        28,
      ),

    v7FeaturesUses:
      linesAround(
        source,
        "v7Features",
        18,
        28,
      ),
  };
}

const report = {
  status:
    "AI_STOCK_LAB_MARKET_REGIME_V7_LATEST_MARKET_DATE_TYPE_CONTRACT_PROBE_V1_COMPLETE",

  buildError: {
    file:
      TARGET_CALL_FILE,

    line:
      938,

    sourceType:
      "MarketRegimeFeatureVectorV7",

    targetType:
      "V7MarketRegimeFeatureVectorLike",

    incompatibleField:
      "latestMarketDate",

    sourceFieldType:
      "string | null",

    targetFieldType:
      "string",
  },

  symbolResults,

  callSite,

  decisionRules: {
    ifConsumerAlreadyHandlesNull:
      "WIDEN_V7MarketRegimeFeatureVectorLike.latestMarketDate_TO_string_or_null",

    ifConsumerRequiresConcreteDate:
      "ADD_EXPLICIT_FAIL_CLOSED_GUARD_BEFORE_buildV7MarketRegimeEvidence",

    forbiddenShortcut:
      "DO_NOT_INVENT_OR_SUBSTITUTE_A_MARKET_DATE_ONLY_TO_SATISFY_TYPESCRIPT",
  },

  safety: {
    sourceOnly:
      true,

    filesModified:
      0,

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
      false,
  },

  nextGate:
    "PATCH_EXACT_TYPE_CONTRACT_WITHOUT_CHANGING_REGIME_SEMANTICS",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "market-regime-v7-latest-market-date-type-contract-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
