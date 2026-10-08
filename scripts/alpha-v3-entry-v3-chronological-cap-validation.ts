import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_ENTRY_V3_CHRONOLOGICAL_CAP_VALIDATION_V2_SCHEMA_FIXED";

const CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
);

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-entry-v3-chronological-cap-validation.json",
);

const CAPS = [0.0025, 0.005, 0.0075, 0.01] as const;
const FOLD_COUNT = 4;

type ReturnSet = {
  r1: number | null;
  r3: number | null;
  r5: number | null;
};

type PolicyRow = {
  maxPremium: number;
  filled: boolean;
  returns: ReturnSet;
};

type SessionRow = {
  sourceTradingDate: string;
  targetSessionDate: string;
  stockCode: string;
  minuteCoverage: {
    sourceRows: number;
    fullCoverage: boolean;
  };
  correctedEntry: {
    qualified: boolean;
    directReturns: ReturnSet;
  };
  limitPolicies: PolicyRow[];
};

function n(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stats(values: Array<number | null>) {
  const xs = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );

  const sorted = [...xs].sort((a, b) => a - b);

  const mean =
    xs.length > 0
      ? xs.reduce((sum, v) => sum + v, 0) / xs.length
      : null;

  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (
            sorted[sorted.length / 2 - 1] +
            sorted[sorted.length / 2]
          ) / 2;

  return {
    count: xs.length,
    mean,
    median,
    positiveRate:
      xs.length > 0
        ? xs.filter((v) => v > 0).length / xs.length
        : null,
    min:
      xs.length > 0
        ? Math.min(...xs)
        : null,
    max:
      xs.length > 0
        ? Math.max(...xs)
        : null,
  };
}

function splitIntoFolds<T>(rows: T[], count: number): T[][] {
  const folds: T[][] = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * rows.length) / count);
    const end = Math.floor(((i + 1) * rows.length) / count);

    folds.push(rows.slice(start, end));
  }

  return folds;
}

function getPolicy(
  row: SessionRow,
  cap: number,
): PolicyRow | null {
  return (
    row.limitPolicies.find(
      (policy) =>
        Math.abs(Number(policy.maxPremium) - cap) < 1e-12,
    ) ?? null
  );
}

function main() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    throw new Error("CHECKPOINT_NOT_FOUND");
  }

  const checkpoint =
    JSON.parse(
      fs.readFileSync(CHECKPOINT_FILE, "utf8"),
    );

  if (!Array.isArray(checkpoint.results)) {
    throw new Error("CHECKPOINT_RESULTS_NOT_ARRAY");
  }

  const rows =
    (checkpoint.results as SessionRow[])
      .filter(
        (row) =>
          row &&
          typeof row.targetSessionDate === "string" &&
          typeof row.stockCode === "string" &&
          row.minuteCoverage &&
          row.correctedEntry &&
          Array.isArray(row.limitPolicies),
      )
      .sort((a, b) => {
        const dateCompare =
          a.targetSessionDate.localeCompare(b.targetSessionDate);

        if (dateCompare !== 0) return dateCompare;

        return a.stockCode.localeCompare(b.stockCode);
      });

  if (rows.length !== 251) {
    throw new Error(
      `EXPECTED_251_SESSIONS_FOUND_${rows.length}`,
    );
  }

  const full381Rows =
    rows.filter(
      (row) =>
        row.minuteCoverage.fullCoverage === true &&
        Number(row.minuteCoverage.sourceRows) === 381,
    );

  const validationRows =
    full381Rows.length === 226
      ? full381Rows
      : rows;

  const folds =
    splitIntoFolds(validationRows, FOLD_COUNT);

  const foldResults =
    folds.map((foldRows, index) => {
      const candidates =
        foldRows.filter(
          (row) =>
            row.correctedEntry.qualified === true,
        );

      const limitPolicies =
        CAPS.map((cap) => {
          const policyRows =
            candidates
              .map((row) => ({
                row,
                policy: getPolicy(row, cap),
              }))
              .filter(
                (
                  item,
                ): item is {
                  row: SessionRow;
                  policy: PolicyRow;
                } =>
                  item.policy !== null,
              );

          const filled =
            policyRows.filter(
              (item) =>
                item.policy.filled === true,
            );

          const paired = (
            horizon: keyof ReturnSet,
          ) =>
            stats(
              filled.map((item) => {
                const direct =
                  n(
                    item.row.correctedEntry
                      .directReturns[horizon],
                  );

                const limited =
                  n(
                    item.policy
                      .returns[horizon],
                  );

                if (
                  direct === null ||
                  limited === null
                ) {
                  return null;
                }

                return limited - direct;
              }),
            );

          return {
            maxPremium: cap,
            candidateSessions: candidates.length,
            policyRowsFound: policyRows.length,
            filledSessions: filled.length,
            fillRate:
              candidates.length > 0
                ? filled.length / candidates.length
                : null,

            returns: {
              r1:
                stats(
                  filled.map(
                    (item) =>
                      n(item.policy.returns.r1),
                  ),
                ),
              r3:
                stats(
                  filled.map(
                    (item) =>
                      n(item.policy.returns.r3),
                  ),
                ),
              r5:
                stats(
                  filled.map(
                    (item) =>
                      n(item.policy.returns.r5),
                  ),
                ),
            },

            pairedVsDirect: {
              r1: paired("r1"),
              r3: paired("r3"),
              r5: paired("r5"),
            },
          };
        });

      return {
        fold: index + 1,
        sessionCount: foldRows.length,
        firstDate:
          foldRows[0]?.targetSessionDate ?? null,
        lastDate:
          foldRows[foldRows.length - 1]?.targetSessionDate ?? null,
        correctedQualifiedSessions: candidates.length,

        directCorrectedEntry: {
          r1:
            stats(
              candidates.map(
                (row) =>
                  n(row.correctedEntry.directReturns.r1),
              ),
            ),
          r3:
            stats(
              candidates.map(
                (row) =>
                  n(row.correctedEntry.directReturns.r3),
              ),
            ),
          r5:
            stats(
              candidates.map(
                (row) =>
                  n(row.correctedEntry.directReturns.r5),
              ),
            ),
        },

        limitPolicies,
      };
    });

  const capStability =
    CAPS.map((cap) => {
      const policies =
        foldResults.map(
          (fold) =>
            fold.limitPolicies.find(
              (policy) =>
                Math.abs(policy.maxPremium - cap) < 1e-12,
            )!,
        );

      const positiveFoldCount =
        policies.filter((policy) => {
          const means = [
            policy.pairedVsDirect.r1.mean,
            policy.pairedVsDirect.r3.mean,
            policy.pairedVsDirect.r5.mean,
          ];

          return (
            means.every((value) => value !== null) &&
            means.every((value) => (value as number) > 0)
          );
        }).length;

      const fillRates =
        policies
          .map((policy) => policy.fillRate)
          .filter(
            (value): value is number =>
              value !== null,
          );

      const allPairedMeans =
        policies.flatMap((policy) => [
          policy.pairedVsDirect.r1.mean,
          policy.pairedVsDirect.r3.mean,
          policy.pairedVsDirect.r5.mean,
        ])
        .filter(
          (value): value is number =>
            value !== null,
        );

      return {
        maxPremium: cap,
        folds: policies.length,
        allHorizonPositiveFoldCount: positiveFoldCount,
        allFourFoldsPositive:
          positiveFoldCount === FOLD_COUNT,

        minimumFoldFillRate:
          fillRates.length > 0
            ? Math.min(...fillRates)
            : null,

        averageFoldFillRate:
          fillRates.length > 0
            ? fillRates.reduce((a, b) => a + b, 0) /
              fillRates.length
            : null,

        worstPairedMeanAcrossFoldHorizons:
          allPairedMeans.length > 0
            ? Math.min(...allPairedMeans)
            : null,

        averagePairedMeanAcrossFoldHorizons:
          allPairedMeans.length > 0
            ? allPairedMeans.reduce((a, b) => a + b, 0) /
              allPairedMeans.length
            : null,

        schemaCoverageComplete:
          policies.every(
            (policy) =>
              policy.policyRowsFound ===
              policy.candidateSessions,
          ),
      };
    });

  const ranking =
    [...capStability].sort((a, b) => {
      if (
        b.allHorizonPositiveFoldCount !==
        a.allHorizonPositiveFoldCount
      ) {
        return (
          b.allHorizonPositiveFoldCount -
          a.allHorizonPositiveFoldCount
        );
      }

      const fillDiff =
        (b.minimumFoldFillRate ?? -1) -
        (a.minimumFoldFillRate ?? -1);

      if (Math.abs(fillDiff) > 1e-12) {
        return fillDiff;
      }

      const worstDiff =
        (b.worstPairedMeanAcrossFoldHorizons ?? -Infinity) -
        (a.worstPairedMeanAcrossFoldHorizons ?? -Infinity);

      if (Math.abs(worstDiff) > 1e-12) {
        return worstDiff;
      }

      return a.maxPremium - b.maxPremium;
    });

  const leader =
    ranking[0] ?? null;

  const passed =
    leader !== null &&
    leader.schemaCoverageComplete === true &&
    leader.allHorizonPositiveFoldCount >= 3 &&
    (leader.minimumFoldFillRate ?? 0) >= 0.75 &&
    (leader.worstPairedMeanAcrossFoldHorizons ?? 0) > 0;

  const correctedQualifiedSessions =
    validationRows.filter(
      (row) =>
        row.correctedEntry.qualified === true,
    ).length;

  const result = {
    status:
      "ALPHA_V3_ENTRY_V3_CHRONOLOGICAL_CAP_VALIDATION_COMPLETE",

    version: VERSION,

    validationClass:
      "HISTORICAL_CHRONOLOGICAL_STRESS_TEST_NOT_TRUE_OOS",

    counts: {
      checkpointSessions: rows.length,
      validationSessions: validationRows.length,
      full381Sessions: full381Rows.length,
      full381OnlyUsed: validationRows === full381Rows,
      foldCount: FOLD_COUNT,
      correctedQualifiedSessionsInValidation:
        correctedQualifiedSessions,
    },

    schema: {
      source:
        "checkpoint.results",
      minuteCoverage:
        "minuteCoverage.sourceRows + minuteCoverage.fullCoverage",
      correctedEntry:
        "correctedEntry.qualified + correctedEntry.directReturns",
      limitPolicies:
        "limitPolicies[]",
    },

    folds: foldResults,
    capStability,

    decision: {
      provisionalLeader:
        leader?.maxPremium ?? null,

      historicalStressTestPassed:
        passed,

      exactProductionCapLocked:
        false,

      structureLocked:
        true,

      structure:
        "CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT",

      nextUse:
        passed
          ? "USE_PROVISIONAL_LEADER_ONLY_IN_FORWARD_SHADOW_OOS"
          : "REVIEW_ENTRY_V3_CHRONOLOGICAL_STABILITY",
    },

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      productionChanged: false,
      thresholdChanged: false,
    },

    nextGate:
      passed
        ? "BUILD_ENTRY_V3_FORWARD_SHADOW_OOS"
        : "REVIEW_ENTRY_V3_CHRONOLOGICAL_STABILITY",

    outputFile:
      "logs/alpha-v3-entry-v3-chronological-cap-validation.json",
  };

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    { recursive: true },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(result, null, 2),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_ENTRY_V3_CHRONOLOGICAL_CAP_VALIDATION_FAILED",
        version: VERSION,
        message:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          kisRequests: 0,
          ordersCreated: 0,
          productionChanged: false,
        },
      },
      null,
      2,
    ),
  );

  process.exit(1);
}
