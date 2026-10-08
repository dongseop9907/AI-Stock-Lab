import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATOR_V1";

const OBSERVATION_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

const HISTORICAL_CUTOFF =
  "2026-10-07";

const FROZEN_ENTRY_THRESHOLD =
  0.66;

const FROZEN_PREMIUM_CAP =
  0.01;

const MIN_QUALIFIED_OBSERVATIONS =
  80;

const MIN_CALENDAR_DAYS =
  60;

const MIN_FILL_RATE =
  0.90;

const MIN_PAIRED_POSITIVE_RATE =
  0.80;

function n(
  value:
    unknown,
): number | null {
  const x =
    Number(value);

  return Number.isFinite(x)
    ? x
    : null;
}

function stats(
  values:
    Array<
      number |
      null
    >,
) {
  const xs =
    values.filter(
      (
        value,
      ): value is number =>
        value !==
          null &&
        Number.isFinite(
          value,
        ),
    );

  const mean =
    xs.length
      ? xs.reduce(
          (
            sum,
            value,
          ) =>
            sum +
            value,
          0,
        ) /
        xs.length
      : null;

  const positiveRate =
    xs.length
      ? xs.filter(
          (value) =>
            value >
            0,
        ).length /
        xs.length
      : null;

  return {
    count:
      xs.length,
    mean,
    positiveRate,
  };
}

function calendarSpanDays(
  dates:
    string[],
) {
  if (
    dates.length ===
    0
  ) {
    return 0;
  }

  const sorted =
    [
      ...dates,
    ].sort();

  const first =
    Date.parse(
      `${sorted[0]}T00:00:00.000Z`,
    );

  const last =
    Date.parse(
      `${sorted.at(-1)}T00:00:00.000Z`,
    );

  return (
    Math.floor(
      (
        last -
        first
      ) /
      86_400_000,
    ) +
    1
  );
}

export function evaluateForwardObservations(
  observations:
    any[],
) {
  const qualified =
    observations.filter(
      (row) =>
        row.correctedEntry
          ?.qualified ===
        true,
    );

  const filled =
    qualified.filter(
      (row) =>
        row.selectedPolicy
          ?.filled ===
        true,
    );

  const fillRate =
    qualified.length >
    0
      ? filled.length /
        qualified.length
      : null;

  const horizons =
    (
      [
        "r1",
        "r3",
        "r5",
      ] as const
    ).map(
      (horizon) => {
        const paired =
          filled
            .map(
              (row) => {
                const direct =
                  n(
                    row.correctedEntry
                      ?.directReturns
                      ?.[horizon],
                  );

                const policy =
                  n(
                    row.selectedPolicy
                      ?.returns
                      ?.[horizon],
                  );

                if (
                  direct ===
                    null ||
                  policy ===
                    null
                ) {
                  return null;
                }

                return {
                  direct,
                  policy,
                  improvement:
                    policy -
                    direct,
                };
              },
            )
            .filter(
              Boolean,
            ) as Array<{
              direct: number;
              policy: number;
              improvement: number;
            }>;

        return {
          horizon,

          direct:
            stats(
              paired.map(
                (row) =>
                  row.direct,
              ),
            ),

          policy:
            stats(
              paired.map(
                (row) =>
                  row.policy,
              ),
            ),

          pairedImprovement:
            stats(
              paired.map(
                (row) =>
                  row.improvement,
              ),
            ),

          pairedPositiveRate:
            paired.length
              ? paired.filter(
                  (row) =>
                    row.improvement >
                    0,
                ).length /
                paired.length
              : null,
        };
      },
    );

  const dates =
    observations.map(
      (row) =>
        String(
          row.targetSessionDate,
        ),
    );

  const spanDays =
    calendarSpanDays(
      dates,
    );

  const r5 =
    horizons.find(
      (row) =>
        row.horizon ===
        "r5",
    )!;

  const enoughSample =
    qualified.length >=
      MIN_QUALIFIED_OBSERVATIONS &&
    spanDays >=
      MIN_CALENDAR_DAYS;

  const fillPassed =
    fillRate !==
      null &&
    fillRate >=
      MIN_FILL_RATE;

  const pairedPassed =
    r5.pairedPositiveRate !==
      null &&
    r5.pairedPositiveRate >=
      MIN_PAIRED_POSITIVE_RATE;

  const forwardOosGatePassed =
    enoughSample &&
    fillPassed &&
    pairedPassed;

  return {
    counts: {
      observations:
        observations.length,

      qualifiedObservations:
        qualified.length,

      filledObservations:
        filled.length,

      calendarSpanDays:
        spanDays,
    },

    fillRate,

    horizons,

    decision: {
      enoughSample,
      fillPassed,
      pairedPassed,
      forwardOosGatePassed,

      selectedCap:
        FROZEN_PREMIUM_CAP,

      entryScoreThreshold:
        FROZEN_ENTRY_THRESHOLD,

      nextUse:
        forwardOosGatePassed
          ? "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
          : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",
    },
  };
}

async function main() {
  const observations =
    fs.existsSync(
      OBSERVATION_FILE,
    )
      ? (
          JSON.parse(
            fs.readFileSync(
              OBSERVATION_FILE,
              "utf8",
            ),
          ).observations ??
          []
        )
      : [];

  const evaluation =
    evaluateForwardObservations(
      observations,
    );

  const report = {
    status:
      observations.length >
      0
        ? "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED"
        : "ALPHA_V3_TRUE_FORWARD_OOS_WAITING_FOR_OBSERVATIONS",

    version:
      VERSION,

    contract: {
      historicalCutoff:
        HISTORICAL_CUTOFF,

      selectedCap:
        FROZEN_PREMIUM_CAP,

      entryScoreThreshold:
        FROZEN_ENTRY_THRESHOLD,

      retuningAllowed:
        false,

      minQualifiedObservations:
        MIN_QUALIFIED_OBSERVATIONS,

      minCalendarDays:
        MIN_CALENDAR_DAYS,

      minFillRate:
        MIN_FILL_RATE,

      minPairedPositiveRate:
        MIN_PAIRED_POSITIVE_RATE,
    },

    ...evaluation,

    interpretation: {
      performanceClaimAllowed:
        false,

      reason:
        "True forward evidence accumulation only; passing the gate requires later manual review and does not enable live trading automatically.",
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

      thresholdChanged:
        false,
    },

    nextGate:
      evaluation.decision
        .forwardOosGatePassed
        ? "MANUAL_FORWARD_OOS_REVIEW_BEFORE_ANY_PROMOTION"
        : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };

  fs.writeFileSync(
    OUTPUT_FILE,
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
}

if (
  require.main ===
  module
) {
  main().catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATOR_FAILED",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),
          },
          null,
          2,
        ),
      );

      process.exitCode =
        2;
    },
  );
}
