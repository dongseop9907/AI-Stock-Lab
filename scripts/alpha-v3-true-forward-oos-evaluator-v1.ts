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
  // OOS_NULL_MATURITY_GUARD_V2: only actual numeric returns are observable.
  const x = (typeof value === "number" && Number.isFinite(value)) ? value : null;

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
                 if (row.maturity?.labelDefinition !== "KRX_T_PLUS_N_CLOSE_V2" || row.maturity?.[horizon] !== true) return null;

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

const FORWARD_OOS_EVALUATOR_PROVENANCE_AUDIT_V1_2 =
  "FORWARD_OOS_EVALUATOR_PROVENANCE_AUDIT_V1_2" as const;

const FORWARD_TOP1_SESSION_FILE_V1_2 =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-true-forward-top1-sessions-v1.json",
  );

function inspectForwardTop1SessionProvenanceV1_2() {
  let sessions:
    unknown[] = [];

  let parseError:
    string | null = null;

  try {
    if (
      fs.existsSync(
        FORWARD_TOP1_SESSION_FILE_V1_2,
      )
    ) {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            FORWARD_TOP1_SESSION_FILE_V1_2,
            "utf8",
          ),
        ) as {
          sessions?:
            unknown[];
        };

      sessions =
        Array.isArray(
          parsed.sessions,
        )
          ? parsed.sessions
          : [];
    }
  }
  catch (error) {
    parseError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const rows =
    sessions.map(
      (
        value,
        index,
      ) => {
        const row =
          value &&
          typeof value ===
            "object"
            ? value as Record<
                string,
                unknown
              >
            : {};

        const provenance =
          row.provenance &&
          typeof row.provenance ===
            "object"
            ? row.provenance as Record<
                string,
                unknown
              >
            : {};

        const checks = {
          shadowMode:
            provenance.shadowMode ===
              "DEVELOPMENT_SHADOW" ||
            provenance.shadowMode ===
              "PROMOTION_SHADOW",

          commitSha:
            typeof provenance.commitSha ===
              "string" &&
            /^[0-9a-f]{7,40}$/i.test(
              provenance.commitSha,
            ),

          configHash:
            typeof provenance.configHash ===
              "string" &&
            /^[0-9a-f]{64}$/i.test(
              provenance.configHash,
            ),

          strategyVersion:
            typeof provenance.strategyVersion ===
              "string" &&
            provenance.strategyVersion.length >
              0,

          alphaVersion:
            typeof provenance.alphaVersion ===
              "string" &&
            provenance.alphaVersion.length >
              0,

          entryVersion:
            typeof provenance.entryVersion ===
              "string" &&
            provenance.entryVersion.length >
              0,

          riskVersion:
            typeof provenance.riskVersion ===
              "string" &&
            provenance.riskVersion.length >
              0,

          schemaVersion:
            typeof provenance.schemaVersion ===
              "string" &&
            provenance.schemaVersion.length >
              0,

          generatedAt:
            typeof provenance.generatedAt ===
              "string" &&
            !Number.isNaN(
              Date.parse(
                provenance.generatedAt,
              ),
            ),
        };

        const valid =
          Object.values(
            checks,
          ).every(
            (ok) =>
              ok === true,
          );

        return {
          index,

          sourceTradingDate:
            typeof row.sourceTradingDate ===
              "string"
              ? row.sourceTradingDate
              : null,

          targetSessionDate:
            typeof row.targetSessionDate ===
              "string"
              ? row.targetSessionDate
              : null,

          shadowMode:
            typeof provenance.shadowMode ===
              "string"
              ? provenance.shadowMode
              : null,

          commitSha:
            typeof provenance.commitSha ===
              "string"
              ? provenance.commitSha
              : null,

          configHash:
            typeof provenance.configHash ===
              "string"
              ? provenance.configHash
              : null,

          valid,

          checks,
        };
      },
    );

  const validRows =
    rows.filter(
      (row) =>
        row.valid,
    );

  const developmentShadow =
    validRows.filter(
      (row) =>
        row.shadowMode ===
          "DEVELOPMENT_SHADOW",
    ).length;

  const promotionShadow =
    validRows.filter(
      (row) =>
        row.shadowMode ===
          "PROMOTION_SHADOW",
    ).length;

  return {
    schemaVersion:
      FORWARD_OOS_EVALUATOR_PROVENANCE_AUDIT_V1_2,

    generatedAt:
      new Date()
        .toISOString(),

    sessionFile:
      "logs/alpha-v3-true-forward-top1-sessions-v1.json",

    parseError,

    total:
      rows.length,

    valid:
      validRows.length,

    legacyOrInvalid:
      rows.length -
      validRows.length,

    developmentShadow,

    promotionShadow,

    promotionEvidenceEligible:
      promotionShadow >
        0,

    rows,
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

  const promotionGradeSessionProvenance =
    inspectForwardTop1SessionProvenanceV1_2();

  const report = {
    promotionGradeSessionProvenance,

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
