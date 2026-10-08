import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGET_FILES = [
  "lib/trading/trailing-stop-policy.ts",
  "lib/trading/update-trailing-stops.ts",
  "lib/trading/risk-manager.ts",
  "lib/trading/types.ts",
  "app/api/trading/trailing-stop/update/route.ts",
  "app/api/trading/stop-loss/check/route.ts",
  "app/api/trading/trades/evaluate/route.ts",
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
];

const SEARCH_TERMS = [
  "trailing",
  "stop",
  "activation",
  "drawdown",
  "risk",
  "entryPrice",
  "stopPrice",
  "highest",
  "peak",
  "atr",
  "volatility",
];

function excerpt(
  text: string,
  line: number,
  radius = 4,
) {
  const lines =
    text.split(/\r?\n/);

  const start =
    Math.max(
      0,
      line - 1 - radius,
    );

  const end =
    Math.min(
      lines.length,
      line + radius,
    );

  return {
    startLine:
      start + 1,

    endLine:
      end,

    text:
      lines
        .slice(
          start,
          end,
        )
        .join("\n"),
  };
}

function scanTextFile(
  relativePath: string,
) {
  const absolute =
    path.resolve(
      ROOT,
      relativePath,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return {
      file:
        relativePath,

      exists:
        false,

      matches: [],
    };
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const lines =
    text.split(/\r?\n/);

  const matches:
    Array<{
      term: string;
      line: number;
      excerpt: ReturnType<typeof excerpt>;
    }> = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    const lower =
      lines[i].toLowerCase();

    for (
      const term of SEARCH_TERMS
    ) {
      if (
        lower.includes(
          term.toLowerCase(),
        )
      ) {
        matches.push({
          term,
          line:
            i + 1,

          excerpt:
            excerpt(
              text,
              i + 1,
            ),
        });

        break;
      }
    }

    if (
      matches.length >= 12
    ) {
      break;
    }
  }

  return {
    file:
      relativePath,

    exists:
      true,

    lineCount:
      lines.length,

    matches,
  };
}

function checkpointProbe() {
  const relative =
    "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json";

  const absolute =
    path.resolve(
      ROOT,
      relative,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return {
      exists:
        false,
    };
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8",
      ),
    );

  const results =
    Array.isArray(
      parsed?.results,
    )
      ? parsed.results
      : [];

  const qualified =
    results.find(
      (row: any) =>
        row?.correctedEntry
          ?.qualified ===
        true,
    );

  return {
    exists:
      true,

    topLevelKeys:
      Object.keys(
        parsed ?? {},
      ),

    resultCount:
      results.length,

    sampleQualified: qualified
      ? {
          sourceTradingDate:
            qualified
              .sourceTradingDate,

          targetSessionDate:
            qualified
              .targetSessionDate,

          stockCode:
            qualified
              .stockCode,

          minuteCoverage:
            qualified
              .minuteCoverage,

          correctedEntry:
            qualified
              .correctedEntry,

          limitPolicies:
            qualified
              .limitPolicies,
        }
      : null,
  };
}

const files =
  TARGET_FILES
    .filter(
      (file) =>
        !file.endsWith(
          ".json",
        ),
    )
    .map(
      scanTextFile,
    );

const output = {
  status:
    "ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE_COMPLETE",

  version:
    "ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE_V1",

  files,

  checkpoint:
    checkpointProbe(),

  safety: {
    databaseReads:
      0,

    databaseWrites:
      0,

    kisRequests:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    productionChanged:
      false,
  },

  nextGate:
    "BUILD_ALPHA_V3_EXIT_V3_BASELINE_REPLAY",
};

console.log(
  JSON.stringify(
    output,
    null,
    2,
  ),
);
