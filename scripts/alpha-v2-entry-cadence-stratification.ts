import fs from "node:fs";
import path from "node:path";

function avg(
  values: number[],
): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function summarize(
  rows: any[],
  entryKey:
    | "currentEntry"
    | "correctedEntry",
) {
  const qualified =
    rows.filter(
      (row) =>
        row[entryKey]
          ?.qualified === true,
    );

  const mean = (
    source:
      | "entry"
      | "baseline",
    horizon:
      | "r1"
      | "r3"
      | "r5",
  ) => {
    const values =
      qualified
        .map(
          (row) =>
            source === "entry"
              ? row[entryKey]
                  ?.returns?.[
                    horizon
                  ]
              : row
                  .sessionOpenBaseline?.[
                    horizon
                  ],
        )
        .filter(
          Number.isFinite,
        ) as number[];

    return avg(values);
  };

  const entry = {
    r1:
      mean("entry", "r1"),
    r3:
      mean("entry", "r3"),
    r5:
      mean("entry", "r5"),
  };

  const baseline = {
    r1:
      mean(
        "baseline",
        "r1",
      ),
    r3:
      mean(
        "baseline",
        "r3",
      ),
    r5:
      mean(
        "baseline",
        "r5",
      ),
  };

  return {
    sessionCount:
      rows.length,

    qualifiedSessions:
      qualified.length,

    qualificationRate:
      rows.length
        ? qualified.length /
          rows.length
        : null,

    actualEntryReturn:
      entry,

    sameSessionsOpenBaseline:
      baseline,

    entryMinusOpenBaseline: {
      r1:
        entry.r1 !== null &&
        baseline.r1 !== null
          ? entry.r1 -
            baseline.r1
          : null,

      r3:
        entry.r3 !== null &&
        baseline.r3 !== null
          ? entry.r3 -
            baseline.r3
          : null,

      r5:
        entry.r5 !== null &&
        baseline.r5 !== null
          ? entry.r5 -
            baseline.r5
          : null,
    },
  };
}

function summarizeAllOpen(
  rows: any[],
) {
  const get = (
    horizon:
      | "r1"
      | "r3"
      | "r5",
  ) =>
    avg(
      rows
        .map(
          (row) =>
            row
              .sessionOpenBaseline?.[
              horizon
            ],
        )
        .filter(
          Number.isFinite,
        ) as number[],
    );

  return {
    r1:
      get("r1"),
    r3:
      get("r3"),
    r5:
      get("r5"),
  };
}

function averageDelayMinutes(
  rows: any[],
  entryKey:
    | "currentEntry"
    | "correctedEntry",
) {
  const values =
    rows
      .filter(
        (row) =>
          row[entryKey]
            ?.qualified === true &&
          row[entryKey]
            ?.observedAt,
      )
      .map(
        (row) => {
          const entryMs =
            new Date(
              row[entryKey]
                .observedAt,
            ).getTime();

          const openMs =
            new Date(
              `${row.targetSessionDate}T09:00:00+09:00`,
            ).getTime();

          return (
            entryMs -
            openMs
          ) /
          60000;
        },
      )
      .filter(
        Number.isFinite,
      );

  return avg(values);
}

function main() {
  const root =
    process.cwd();

  const inputPath =
    path.join(
      root,
      "logs",
      "alpha-v2-expanded-entry-comparison.json",
    );

  if (
    !fs.existsSync(
      inputPath,
    )
  ) {
    throw new Error(
      "EXPANDED_ENTRY_COMPARISON_LOG_NOT_FOUND",
    );
  }

  const report =
    JSON.parse(
      fs.readFileSync(
        inputPath,
        "utf8",
      ),
    );

  const rows =
    report.results ??
    [];

  const full381 =
    rows.filter(
      (row: any) =>
        row.snapshotCount ===
        381,
    );

  const sparse =
    rows.filter(
      (row: any) =>
        row.snapshotCount !==
        381,
    );

  const groups = {
    full381: {
      sessionCount:
        full381.length,

      currentEntry:
        summarize(
          full381,
          "currentEntry",
        ),

      correctedEntry:
        summarize(
          full381,
          "correctedEntry",
        ),

      allSessionsOpenBaseline:
        summarizeAllOpen(
          full381,
        ),

      averageEntryDelayMinutes: {
        current:
          averageDelayMinutes(
            full381,
            "currentEntry",
          ),

        corrected:
          averageDelayMinutes(
            full381,
            "correctedEntry",
          ),
      },
    },

    sparse: {
      sessionCount:
        sparse.length,

      currentEntry:
        summarize(
          sparse,
          "currentEntry",
        ),

      correctedEntry:
        summarize(
          sparse,
          "correctedEntry",
        ),

      allSessionsOpenBaseline:
        summarizeAllOpen(
          sparse,
        ),

      averageEntryDelayMinutes: {
        current:
          averageDelayMinutes(
            sparse,
            "currentEntry",
          ),

        corrected:
          averageDelayMinutes(
            sparse,
            "correctedEntry",
          ),
      },
    },
  };

  const result = {
    status:
      "ALPHA_V2_ENTRY_CADENCE_STRATIFICATION_COMPLETE",

    counts: {
      totalSessions:
        rows.length,

      full381Sessions:
        full381.length,

      sparseSessions:
        sparse.length,
    },

    groups,

    interpretationRule: {
      primary:
        "Use full381 one-minute reconstructed sessions as the cleaner Entry comparison set.",

      sparse:
        "Treat sparse live-snapshot sessions separately because momentum and volume features depend on observation interval.",

      productionChanged:
        false,
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      "DECIDE_ENTRY_V2_FROM_FULL_381_SESSION_STRATUM",
  };

  const outputPath =
    path.join(
      root,
      "logs",
      "alpha-v2-entry-cadence-stratification.json",
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V2_ENTRY_CADENCE_STRATIFICATION_FAILED",

        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
