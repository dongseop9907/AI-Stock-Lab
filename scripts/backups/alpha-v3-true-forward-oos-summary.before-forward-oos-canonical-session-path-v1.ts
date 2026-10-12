import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const TOP1 =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-top1-sessions.json",
  );

const CHECKPOINT =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-true-forward-entry-v3-checkpoint.json",
  );

function finite(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(
      value,
    )
  );
}

function stats(
  values: number[],
) {
  if (
    !values.length
  ) {
    return {
      count: 0,
      mean: null,
      positiveRate:
        null,
    };
  }

  return {
    count:
      values.length,

    mean:
      values.reduce(
        (
          sum,
          value,
        ) =>
          sum +
          value,
        0,
      ) /
      values.length,

    positiveRate:
      values.filter(
        (value) =>
          value >
          0,
      ).length /
      values.length,
  };
}

function daysBetween(
  a: string,
  b: string,
) {
  return Math.floor(
    (
      new Date(
        `${b}T00:00:00Z`,
      ).getTime() -
      new Date(
        `${a}T00:00:00Z`,
      ).getTime()
    ) /
    86_400_000,
  );
}

function main() {
  const top1 =
    fs.existsSync(
      TOP1,
    )
      ? JSON.parse(
          fs.readFileSync(
            TOP1,
            "utf8",
          ),
        )
      : {
          sessions:
            [],
        };

  const checkpoint =
    fs.existsSync(
      CHECKPOINT,
    )
      ? JSON.parse(
          fs.readFileSync(
            CHECKPOINT,
            "utf8",
          ),
        )
      : {
          results:
            [],
        };

  const sessions =
    top1.sessions ??
    [];

  const strict =
    sessions.filter(
      (row: any) =>
        row.integrity ===
        "STRICT_TRUE_OOS",
    );

  const results =
    checkpoint.results ??
    [];

  const full =
    results.filter(
      (row: any) =>
        row.minuteCoverage
          ?.fullCoverage ===
          true &&
        row.minuteCoverage
          ?.sourceRows ===
          381,
    );

  const qualified =
    full.filter(
      (row: any) =>
        row.correctedEntry
          ?.qualified ===
        true,
    );

  const filled =
    qualified
      .map(
        (row: any) => ({
          row,
          policy:
            (
              row.limitPolicies ??
              []
            ).find(
              (policy: any) =>
                Number(
                  policy.maxPremium,
                ) ===
                0.01,
            ),
        }),
      )
      .filter(
        (item: any) =>
          item.policy
            ?.filled ===
          true,
      );

  const paired:
    Record<
      "r1" |
      "r3" |
      "r5",
      number[]
    > = {
      r1: [],
      r3: [],
      r5: [],
    };

  const direct:
    Record<
      "r1" |
      "r3" |
      "r5",
      number[]
    > = {
      r1: [],
      r3: [],
      r5: [],
    };

  const limit:
    Record<
      "r1" |
      "r3" |
      "r5",
      number[]
    > = {
      r1: [],
      r3: [],
      r5: [],
    };

  for (
    const item
    of filled
  ) {
    for (
      const horizon
      of [
        "r1",
        "r3",
        "r5",
      ] as const
    ) {
      const d =
        item.row
          .correctedEntry
          ?.directReturns
          ?.[
            horizon
          ];

      const l =
        item.policy
          ?.returns
          ?.[
            horizon
          ];

      if (
        finite(
          d,
        )
      ) {
        direct[
          horizon
        ].push(
          d,
        );
      }

      if (
        finite(
          l,
        )
      ) {
        limit[
          horizon
        ].push(
          l,
        );
      }

      if (
        finite(
          d,
        ) &&
        finite(
          l,
        )
      ) {
        paired[
          horizon
        ].push(
          l -
          d,
        );
      }
    }
  }

  const targetDates =
    strict
      .map(
        (row: any) =>
          row.targetSessionDate,
      )
      .filter(
        Boolean,
      )
      .sort();

  const calendarDays =
    targetDates.length >=
      2
      ? daysBetween(
          targetDates[0],
          targetDates.at(
            -1,
          ),
        )
      : 0;

  const fillRate =
    qualified.length
      ? filled.length /
        qualified.length
      : null;

  const pairedStats = {
    r1:
      stats(
        paired.r1,
      ),
    r3:
      stats(
        paired.r3,
      ),
    r5:
      stats(
        paired.r5,
      ),
  };

  const finalGate = {
    qualifiedAtLeast80:
      qualified.length >=
      80,

    calendarDaysAtLeast60:
      calendarDays >=
      60,

    fillRateAtLeast90Pct:
      fillRate !==
        null &&
      fillRate >=
        0.90,

    pairedPositiveR1:
      pairedStats.r1
        .mean !==
        null &&
      pairedStats.r1
        .mean >
        0,

    pairedPositiveR3:
      pairedStats.r3
        .mean !==
        null &&
      pairedStats.r3
        .mean >
        0,

    pairedPositiveR5:
      pairedStats.r5
        .mean !==
        null &&
      pairedStats.r5
        .mean >
        0,
  };

  const result = {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_SUMMARY_COMPLETE",

    contract: {
      historicalTargetCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,

      retuningAllowed:
        false,
    },

    counts: {
      frozenCandidates:
        sessions.length,

      strictTrueOosCandidates:
        strict.length,

      pendingTargetBind:
        sessions.filter(
          (row: any) =>
            row.integrity ===
            "PENDING_TARGET_BIND",
        ).length,

      lateCaptureExcluded:
        sessions.filter(
          (row: any) =>
            row.integrity ===
            "LATE_CAPTURE_EXCLUDED",
        ).length,

      entryResults:
        results.length,

      full381Sessions:
        full.length,

      qualifiedSessions:
        qualified.length,

      filledSessions:
        filled.length,
    },

    span: {
      firstTargetDate:
        targetDates[0] ??
        null,

      lastTargetDate:
        targetDates.at(
          -1,
        ) ??
        null,

      calendarDays,
    },

    performance: {
      fillRate,

      direct: {
        r1:
          stats(
            direct.r1,
          ),
        r3:
          stats(
            direct.r3,
          ),
        r5:
          stats(
            direct.r5,
          ),
      },

      limit: {
        r1:
          stats(
            limit.r1,
          ),
        r3:
          stats(
            limit.r3,
          ),
        r5:
          stats(
            limit.r5,
          ),
      },

      pairedVsDirect:
        pairedStats,
    },

    finalGate,

    decision: {
      trueForwardReady:
        true,

      productionPolicyLocked:
        false,

      enoughEvidenceForFinalEntryGate:
        Object.values(
          finalGate,
        ).every(
          Boolean,
        ),

      nextUse:
        Object.values(
          finalGate,
        ).every(
          Boolean,
        )
          ? "REVIEW_TRUE_FORWARD_OOS_AND_THEN_EXIT_CHALLENGERS"
          : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    },

    safety: {
      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },
  };

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "alpha-v3-true-forward-oos-summary.json",
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
          "ALPHA_V3_TRUE_FORWARD_OOS_SUMMARY_FAILED",

        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
