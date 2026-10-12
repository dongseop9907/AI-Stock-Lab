import fs from "node:fs";
import path from "node:path";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function objective(summary: any): number {
  return (
    (summary.meanReturn.r1 ?? 0) * 0.30 +
    (summary.meanReturn.r3 ?? 0) * 0.40 +
    (summary.meanReturn.r5 ?? 0) * 0.30
  );
}

function summarizePolicy(
  rows: any[],
  cap: number,
) {
  const policies = rows
    .map((row) =>
      row.limitPolicies?.find(
        (policy: any) =>
          Number(policy.maxPremium) === cap,
      ),
    )
    .filter(Boolean);

  const filled =
    policies.filter(
      (policy: any) =>
        policy.filled === true,
    );

  const mean = (
    horizon: "r1" | "r3" | "r5",
  ) =>
    avg(
      filled
        .map(
          (policy: any) =>
            policy.returns?.[horizon],
        )
        .filter(Number.isFinite),
    );

  const summary = {
    maxPremium: cap,
    candidateSessions: policies.length,
    filledSessions: filled.length,
    fillRate:
      policies.length
        ? filled.length / policies.length
        : null,
    meanReturn: {
      r1: mean("r1"),
      r3: mean("r3"),
      r5: mean("r5"),
    },
  };

  return {
    ...summary,
    objective:
      objective(summary),
  };
}

function summarizeDirect(
  rows: any[],
) {
  const qualified =
    rows.filter(
      (row) =>
        row.correctedSignal?.qualified === true,
    );

  const mean = (
    horizon: "r1" | "r3" | "r5",
  ) =>
    avg(
      qualified
        .map(
          (row) =>
            row.correctedSignal
              ?.directReturns?.[
              horizon
            ],
        )
        .filter(Number.isFinite),
    );

  const summary = {
    candidateSessions: rows.length,
    qualifiedSessions: qualified.length,
    qualificationRate:
      rows.length
        ? qualified.length / rows.length
        : null,
    meanReturn: {
      r1: mean("r1"),
      r3: mean("r3"),
      r5: mean("r5"),
    },
  };

  return {
    ...summary,
    objective:
      objective(summary),
  };
}

function main() {
  const root =
    process.cwd();

  const inputPath =
    path.join(
      root,
      "logs",
      "alpha-v2-all-18-kis-minute-limit-replay.json",
    );

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      "ALL_18_KIS_MINUTE_REPLAY_LOG_NOT_FOUND",
    );
  }

  const input =
    JSON.parse(
      fs.readFileSync(
        inputPath,
        "utf8",
      ),
    );

  const rows =
    (input.results ?? [])
      .filter(
        (row: any) =>
          row.fullCoverage === true,
      )
      .sort(
        (a: any, b: any) =>
          `${a.targetSessionDate}|${a.stockCode}`
            .localeCompare(
              `${b.targetSessionDate}|${b.stockCode}`,
            ),
      );

  if (rows.length !== 18) {
    throw new Error(
      `EXPECTED_18_FULL_SESSIONS_GOT_${rows.length}`,
    );
  }

  const caps = [
    0.0025,
    0.005,
    0.0075,
    0.01,
  ];

  const folds: any[] = [];

  const minimumTrainSessions = 8;
  const testBlockSize = 3;

  for (
    let testStart = minimumTrainSessions;
    testStart < rows.length;
    testStart += testBlockSize
  ) {
    const train =
      rows.slice(
        0,
        testStart,
      );

    const test =
      rows.slice(
        testStart,
        Math.min(
          rows.length,
          testStart +
            testBlockSize,
        ),
      );

    if (!test.length) {
      continue;
    }

    const trainCandidates =
      caps
        .map(
          (cap) =>
            summarizePolicy(
              train,
              cap,
            ),
        )
        .filter(
          (summary) =>
            summary.candidateSessions > 0 &&
            summary.filledSessions >= 4 &&
            summary.fillRate !== null &&
            summary.fillRate >= 0.75,
        )
        .sort(
          (a, b) =>
            b.objective -
            a.objective,
        );

    const selected =
      trainCandidates[0] ??
      summarizePolicy(
        train,
        0.0075,
      );

    const adaptiveTest =
      summarizePolicy(
        test,
        selected.maxPremium,
      );

    const fixed075Test =
      summarizePolicy(
        test,
        0.0075,
      );

    const fixed100Test =
      summarizePolicy(
        test,
        0.01,
      );

    const directTest =
      summarizeDirect(
        test,
      );

    folds.push({
      fold:
        folds.length + 1,

      trainSessionCount:
        train.length,

      testSessionCount:
        test.length,

      testStart:
        test[0]
          .targetSessionDate,

      testEnd:
        test.at(-1)
          .targetSessionDate,

      selectedPremium:
        selected.maxPremium,

      trainSelected:
        selected,

      adaptiveTest,

      fixed075Test,

      fixed100Test,

      directTest,
    });
  }

  const selectedCounts:
    Record<string, number> =
      {};

  for (const fold of folds) {
    const key =
      String(
        fold.selectedPremium,
      );

    selectedCounts[key] =
      (selectedCounts[key] ?? 0) +
      1;
  }

  function aggregate(
    key:
      | "adaptiveTest"
      | "fixed075Test"
      | "fixed100Test"
      | "directTest",
  ) {
    const mean = (
      horizon:
        | "r1"
        | "r3"
        | "r5",
    ) =>
      avg(
        folds
          .map(
            (fold) =>
              fold[key]
                .meanReturn[
                horizon
              ],
          )
          .filter(Number.isFinite),
      );

    return {
      meanReturn: {
        r1: mean("r1"),
        r3: mean("r3"),
        r5: mean("r5"),
      },

      meanObjective:
        avg(
          folds
            .map(
              (fold) =>
                fold[key]
                  .objective,
            )
            .filter(Number.isFinite),
        ),

      meanFillRate:
        key === "directTest"
          ? null
          : avg(
              folds
                .map(
                  (fold) =>
                    fold[key]
                      .fillRate,
                )
                .filter(Number.isFinite),
            ),
    };
  }

  const result = {
    status:
      "ALPHA_V3_LIMIT_POLICY_WALK_FORWARD_COMPLETE",

    sessionCount:
      rows.length,

    foldCount:
      folds.length,

    candidatePremiumCaps:
      caps,

    selectedCounts,

    aggregateAdaptive:
      aggregate(
        "adaptiveTest",
      ),

    aggregateFixed075:
      aggregate(
        "fixed075Test",
      ),

    aggregateFixed100:
      aggregate(
        "fixed100Test",
      ),

    aggregateDirect:
      aggregate(
        "directTest",
      ),

    folds,

    decisionRule: {
      productionCandidate:
        "0.75% only if fixed075 remains positive across horizons and competitive with adaptive selection",

      avoidOverfit:
        true,

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
      "DECIDE_ALPHA_V3_LIMIT_POLICY_AFTER_WALK_FORWARD",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v3-limit-policy-walk-forward.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,

        sessionCount:
          result.sessionCount,

        foldCount:
          result.foldCount,

        selectedCounts:
          result.selectedCounts,

        aggregateAdaptive:
          result.aggregateAdaptive,

        aggregateFixed075:
          result.aggregateFixed075,

        aggregateFixed100:
          result.aggregateFixed100,

        aggregateDirect:
          result.aggregateDirect,

        folds:
          result.folds.map(
            (fold: any) => ({
              fold:
                fold.fold,

              trainSessionCount:
                fold.trainSessionCount,

              testStart:
                fold.testStart,

              testEnd:
                fold.testEnd,

              selectedPremium:
                fold.selectedPremium,

              adaptiveTest:
                fold.adaptiveTest,

              fixed075Test:
                fold.fixed075Test,

              directTest:
                fold.directTest,
            }),
          ),

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v3-limit-policy-walk-forward.json",
      },
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
          "ALPHA_V3_LIMIT_POLICY_WALK_FORWARD_FAILED",

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
