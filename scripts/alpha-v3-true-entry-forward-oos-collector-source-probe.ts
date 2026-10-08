import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_SOURCE_PROBE_V1";

const ROOT =
  process.cwd();

const CANDIDATE_FILES = [
  "scripts/alpha-v3-entry-v3-forward-shadow-oos.ts",
  "scripts/alpha-v3-entry-v3-chronological-cap-validation.ts",
  "scripts/alpha-v3-entry-v3-replay.ts",
  "scripts/alpha-v3-extended-entry-v3-replay.ts",
  "scripts/alpha-v3-extended-entry-v3-replay-checkpoint.ts",
  "scripts/alpha-v3-extended-entry-v3-replay-runner.ts",
  "scripts/alpha-v3-entry-v3-forward-shadow-collector.ts",
];

const LOG_FILES = [
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
  "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
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
    !fs.existsSync(
      file,
    )
  ) {
    return null;
  }

  return fs.readFileSync(
    file,
    "utf8",
  ).replace(
    /\r\n/g,
    "\n",
  );
}

function compactLines(
  lines: string[],
  from: number,
  to: number,
): string {
  return lines
    .slice(
      from,
      to,
    )
    .map(
      (
        line,
        index,
      ) =>
        String(
          from +
          index +
          1,
        ) +
        ": " +
        line,
    )
    .join(
      "\n",
    );
}

function sourceSummary(
  rel: string,
) {
  const source =
    readText(
      rel,
    );

  if (
    source === null
  ) {
    return {
      file:
        rel,
      exists:
        false,
    };
  }

  const lines =
    source.split(
      "\n",
    );

  const searchTerms = [
    "ENTRY_PREMIUM_CAP",
    "entryPremiumCap",
    "0.01",
    "threshold",
    "0.66",
    "cutoff",
    "targetSessionDate",
    "sourceTradingDate",
    "correctedEntry",
    "limitPolicies",
    "replay-checkpoint",
    "checkpoint",
    "market_minute",
    "market_intraday",
    "market_snapshots",
    "market_daily_bars",
    "supabase",
    "KIS",
    "fetch",
    "results.push",
    ".push(",
    "writeFileSync",
    "appendFileSync",
    "JSON.stringify",
    "state",
    "unseenSessions",
    "qualified",
    "filled",
    "r1",
    "r3",
    "r5",
  ];

  const snippets:
    Array<{
      term:
        string;
      line:
        number;
      text:
        string;
    }> =
    [];

  const usedRanges =
    new Set<
      string
    >();

  for (
    const term
    of searchTerms
  ) {
    const matcher =
      term === ".push("
        ? (
            line: string,
          ) =>
            line.includes(
              ".push(",
            )
        : (
            line: string,
          ) =>
            line
              .toLowerCase()
              .includes(
                term
                  .toLowerCase(),
              );

    const indexes =
      lines
        .map(
          (
            line,
            index,
          ) => ({
            line,
            index,
          }),
        )
        .filter(
          (
            row,
          ) =>
            matcher(
              row.line,
            ),
        )
        .slice(
          0,
          5,
        );

    for (
      const item
      of indexes
    ) {
      const from =
        Math.max(
          0,
          item.index -
            6,
        );

      const to =
        Math.min(
          lines.length,
          item.index +
            15,
        );

      const rangeKey =
        from +
        ":" +
        to;

      if (
        usedRanges.has(
          rangeKey,
        )
      ) {
        continue;
      }

      usedRanges.add(
        rangeKey,
      );

      snippets.push({
        term,
        line:
          item.index +
          1,
        text:
          compactLines(
            lines,
            from,
            to,
          ),
      });
    }
  }

  const imports =
    lines
      .filter(
        (
          line,
        ) =>
          line.startsWith(
            "import ",
          ) ||
          line.startsWith(
            "const ",
          ) &&
          line.includes(
            "require(",
          ),
      )
      .slice(
        0,
        50,
      );

  const functions =
    lines
      .map(
        (
          line,
          index,
        ) => ({
          line,
          index,
        }),
      )
      .filter(
        (
          row,
        ) =>
          /^\s*(async\s+)?function\s+\w+/.test(
            row.line,
          ) ||
          /^\s*const\s+\w+\s*=\s*async\s*\(/.test(
            row.line,
          ),
      )
      .slice(
        0,
        80,
      )
      .map(
        (
          row,
        ) => ({
          line:
            row.index +
            1,
          declaration:
            row.line.trim(),
        }),
      );

  return {
    file:
      rel,

    exists:
      true,

    lineCount:
      lines.length,

    imports,

    functions,

    snippets:
      snippets.slice(
        0,
        80,
      ),
  };
}

function jsonSummary(
  rel: string,
) {
  const source =
    readText(
      rel,
    );

  if (
    source === null
  ) {
    return {
      file:
        rel,
      exists:
        false,
    };
  }

  try {
    const value =
      JSON.parse(
        source,
      );

    if (
      Array.isArray(
        value,
      )
    ) {
      return {
        file:
          rel,
        exists:
          true,
        type:
          "array",
        length:
          value.length,
        first:
          value[0] ??
          null,
        last:
          value[
            value.length -
            1
          ] ??
          null,
      };
    }

    if (
      value &&
      typeof value ===
        "object"
    ) {
      const obj =
        value as
          Record<
            string,
            unknown
          >;

      const summary =
        Object.fromEntries(
          Object.entries(
            obj,
          ).map(
            (
              [
                key,
                val,
              ],
            ) => [
              key,
              Array.isArray(
                val,
              )
                ? {
                    type:
                      "array",
                    length:
                      val.length,
                    first:
                      val[0] ??
                      null,
                    last:
                      val[
                        val.length -
                        1
                      ] ??
                      null,
                  }
                : val &&
                    typeof val ===
                      "object"
                  ? {
                      type:
                        "object",
                      keys:
                        Object.keys(
                          val as
                            Record<
                              string,
                              unknown
                            >,
                        ).slice(
                          0,
                          40,
                        ),
                    }
                  : val,
            ],
          ),
        );

      return {
        file:
          rel,
        exists:
          true,
        type:
          "object",
        summary,
      };
    }

    return {
      file:
        rel,
      exists:
        true,
      type:
        typeof value,
      value,
    };
  } catch (
    error
  ) {
    return {
      file:
        rel,
      exists:
        true,
      parseError:
        error instanceof Error
          ? error.message
          : String(
              error,
            ),
    };
  }
}

function discoverRelatedScripts() {
  const scriptsDir =
    path.resolve(
      ROOT,
      "scripts",
    );

  if (
    !fs.existsSync(
      scriptsDir,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      scriptsDir,
    )
    .filter(
      (
        name,
      ) =>
        /entry.*v3|v3.*entry|forward.*shadow|shadow.*forward/i.test(
          name,
        ),
    )
    .sort();
}

const report = {
  status:
    "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_SOURCE_PROBE_COMPLETE",

  version:
    VERSION,

  discoveredRelatedScripts:
    discoverRelatedScripts(),

  sources:
    CANDIDATE_FILES.map(
      sourceSummary,
    ),

  logs:
    LOG_FILES.map(
      jsonSummary,
    ),

  requiredCollectorContract: {
    frozenAfterCutoff:
      "2026-10-07",

    frozenEntryPremiumCap:
      0.01,

    frozenQualificationThreshold:
      0.66,

    mustGenerateNewSessions:
      true,

    mustPersistIndependentForwardDataset:
      true,

    mustNotRewriteHistoricalCheckpoint:
      true,

    mustNeverRetuneFromForwardOutcomes:
      true,

    mustRecordAtObservationTime: [
      "sourceTradingDate",
      "targetSessionDate",
      "stockCode",
      "correctedEntryScore",
      "qualified",
      "entryPremiumCap",
      "fillObservedAt",
      "fillPrice",
      "filled",
      "sourceDataCutoffAtCollection",
    ],

    maturedLabelsRequired: [
      "r1",
      "r3",
      "r5",
    ],

    maturityRule:
      "labels are appended only after their future trading horizons exist",

    minimumFinalGateGuidance: {
      qualifiedObservations:
        80,

      minimumCalendarDays:
        60,

      desiredWeeks:
        "8-12+",

      minimumFillRate:
        0.90,
    },
  },

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
    "BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR_FROM_CONFIRMED_SOURCE_SURFACE",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
