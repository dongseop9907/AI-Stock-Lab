import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE_V1";

const ROOT =
  process.cwd();

const TARGETS = [
  "scripts/alpha-v3-extended-entry-v3-replay-batcher.ts",
  "scripts/alpha-v3-lock-entry-v3-structure.ts",
  "scripts/alpha-v3-analyze-extended-entry-replay.ts",
];

function readText(
  rel: string,
): string | null {
  const file =
    path.resolve(
      ROOT,
      rel,
    );

  if (
    !fs.existsSync(file)
  ) {
    return null;
  }

  return fs
    .readFileSync(
      file,
      "utf8",
    )
    .replace(
      /\r\n/g,
      "\n",
    );
}

function numbered(
  lines: string[],
  from: number,
  to: number,
): string {
  return lines
    .slice(from, to)
    .map(
      (line, index) =>
        String(
          from + index + 1,
        ) +
        ": " +
        line,
    )
    .join("\n");
}

function inspect(
  rel: string,
) {
  const source =
    readText(rel);

  if (
    source === null
  ) {
    return {
      file: rel,
      exists: false,
    };
  }

  const lines =
    source.split("\n");

  const terms = [
    "createSupabaseServerClient",
    ".from(",
    "market_minute",
    "market_daily_bars",
    "market_snapshots",
    "stocks",
    "sourceTradingDate",
    "targetSessionDate",
    "entryScoreThreshold",
    "0.66",
    "premiumCaps",
    "0.01",
    "correctedEntry",
    "entryPrice",
    "observedAt",
    "limitPolicies",
    "fillPrice",
    "fillType",
    "INTRAMINUTE_LIMIT_TOUCH",
    "OPEN_AT_OR_BELOW_LIMIT",
    "directReturns",
    "returns:",
    "r1",
    "r3",
    "r5",
    "checkpoint",
    "CHECKPOINT",
    "results.push",
    ".push(",
    "writeFileSync",
    "appendFileSync",
    "usableRange",
    "startDate",
    "endDate",
    "batch",
    "cursor",
    "next",
    "resume",
    "existing",
    "fullCoverage",
    "381",
    "alphaV2EffectiveScore",
    "alphaV2RawPriceVolumeScore",
  ];

  const snippets = [];
  const seen =
    new Set<string>();

  for (
    const term
    of terms
  ) {
    const matching =
      lines
        .map(
          (line, index) => ({
            line,
            index,
          }),
        )
        .filter(
          (row) =>
            row.line
              .toLowerCase()
              .includes(
                term.toLowerCase(),
              ),
        )
        .slice(
          0,
          12,
        );

    for (
      const row
      of matching
    ) {
      const from =
        Math.max(
          0,
          row.index - 8,
        );

      const to =
        Math.min(
          lines.length,
          row.index + 22,
        );

      const key =
        from + ":" + to;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      snippets.push({
        term,
        line:
          row.index + 1,
        text:
          numbered(
            lines,
            from,
            to,
          ),
      });
    }
  }

  const functions =
    lines
      .map(
        (line, index) => ({
          line:
            line.trim(),
          index,
        }),
      )
      .filter(
        (row) =>
          /^(export\s+)?(async\s+)?function\s+\w+/.test(
            row.line,
          ) ||
          /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(
            row.line,
          ),
      )
      .map(
        (row) => ({
          line:
            row.index + 1,
          declaration:
            row.line,
        }),
      );

  const constants =
    lines
      .map(
        (line, index) => ({
          line:
            line.trim(),
          index,
        }),
      )
      .filter(
        (row) =>
          /^const\s+[A-Z0-9_]+\s*=/.test(
            row.line,
          ),
      )
      .slice(
        0,
        120,
      )
      .map(
        (row) => ({
          line:
            row.index + 1,
          declaration:
            row.line,
        }),
      );

  return {
    file: rel,
    exists: true,
    lineCount:
      lines.length,
    functions,
    constants,
    snippets:
      snippets.slice(
        0,
        140,
      ),
  };
}

const batcher =
  readText(
    TARGETS[0],
  );

const references =
  batcher
    ? [...batcher.matchAll(
        /["']([^"']+\.(?:ts|json))["']/g,
      )]
        .map(
          (match) =>
            match[1],
        )
        .filter(
          (value, index, array) =>
            array.indexOf(value) ===
            index,
        )
        .slice(
          0,
          100,
        )
    : [];

const report = {
  status:
    "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE_COMPLETE",

  version:
    VERSION,

  targets:
    TARGETS.map(
      inspect,
    ),

  batcherReferencedFiles:
    references,

  collectorDesignGate: {
    needExactSourceBeforePatch:
      true,

    requiredReusablePieces: [
      "trading-day/source-target session construction",
      "candidate stock selection",
      "minute row loading",
      "correctedEntry score and qualification",
      "1pct cap fill simulation",
      "r1/r3/r5 maturity calculation",
      "checkpoint dedupe/resume logic",
    ],

    forwardDatasetRule:
      "write to an independent forward dataset; never append to the historical checkpoint",

    frozenContract: {
      historicalCutoff:
        "2026-10-07",
      entryScoreThreshold:
        0.66,
      selectedCap:
        0.01,
      retuningAllowed:
        false,
    },
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  nextGate:
    "BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR_USING_BATCHER_LOGIC",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
