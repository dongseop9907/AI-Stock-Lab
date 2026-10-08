import {
  strict as assert,
} from "node:assert";

import {
  classifyCaptureWindow,
  nextExpectedKrxOpenDate,
} from "./alpha-v3-true-forward-top1-producer-v1";

import {
  targetSessionReadyForEntryCollection,
} from "./alpha-v3-true-entry-forward-oos-collector-v1";

import {
  evaluateForwardObservations,
} from "./alpha-v3-true-forward-oos-evaluator-v1";

async function main() {
  const checks:
    Record<string, boolean> = {};

  checks.nextWeekday =
    nextExpectedKrxOpenDate(
      "2026-10-08",
      [],
    ) ===
      "2026-10-09";

  checks.weekendSkipped =
    nextExpectedKrxOpenDate(
      "2026-10-09",
      [],
    ) ===
      "2026-10-12";

  checks.verifiedClosureSkipped =
    nextExpectedKrxOpenDate(
      "2026-10-08",
      [
        {
          calendar_date:
            "2026-10-09",
          is_open:
            false,
          verified:
            true,
        },
      ],
    ) ===
      "2026-10-12";

  checks.beforeDecisionBlocked =
    classifyCaptureWindow({
      now:
        new Date(
          "2026-10-08T14:59:00.000Z",
        ),
      decisionAt:
        "2026-10-08T15:05:00.000Z",
      targetSessionDate:
        "2026-10-09",
    }) ===
      "BEFORE_DECISION_TIME";

  checks.preOpenCaptureAllowed =
    classifyCaptureWindow({
      now:
        new Date(
          "2026-10-08T15:10:00.000Z",
        ),
      decisionAt:
        "2026-10-08T15:05:00.000Z",
      targetSessionDate:
        "2026-10-09",
    }) ===
      "CAPTURE_WINDOW_OPEN";

  checks.afterOpenRetrospectiveBlocked =
    classifyCaptureWindow({
      now:
        new Date(
          "2026-10-09T00:00:00.000Z",
        ),
      decisionAt:
        "2026-10-08T15:05:00.000Z",
      targetSessionDate:
        "2026-10-09",
    }) ===
      "MISSED_CAPTURE_WINDOW";

  checks.collectorWaitsUntil1540 =
    targetSessionReadyForEntryCollection(
      "2026-10-09",
      new Date(
        "2026-10-09T06:39:00.000Z",
      ),
    ) ===
      false &&
    targetSessionReadyForEntryCollection(
      "2026-10-09",
      new Date(
        "2026-10-09T06:40:00.000Z",
      ),
    ) ===
      true;

  const observations =
    Array.from(
      {
        length:
          80,
      },
      (
        _,
        index,
      ) => ({
        targetSessionDate:
          index <
          40
            ? "2026-10-09"
            : "2026-12-10",

        correctedEntry: {
          qualified:
            true,

          directReturns: {
            r1:
              0,
            r3:
              0,
            r5:
              0,
          },
        },

        selectedPolicy: {
          filled:
            true,

          returns: {
            r1:
              0.01,
            r3:
              0.01,
            r5:
              0.01,
          },
        },
      }),
    );

  const evaluation =
    evaluateForwardObservations(
      observations,
    );

  checks.frozenFinalGateMath =
    evaluation.counts
      .qualifiedObservations ===
      80 &&
    evaluation.fillRate ===
      1 &&
    evaluation.counts
      .calendarSpanDays >=
      60 &&
    evaluation.decision
      .forwardOosGatePassed ===
      true;

  assert.equal(
    evaluation.decision
      .selectedCap,
    0.01,
  );

  assert.equal(
    evaluation.decision
      .entryScoreThreshold,
    0.66,
  );

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
      )
      .map(
        ([name]) =>
          name,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
          0
            ? "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_VERIFIED"
            : "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_REVIEW",

        checks,

        failed,

        contract: {
          historicalCutoff:
            "2026-10-07",

          entryScoreThreshold:
            0.66,

          selectedCap:
            0.01,

          retrospectiveCandidateCreation:
            false,

          targetEntryCollectionAfter:
            "15:40 KST",

          minQualifiedObservations:
            80,

          minCalendarDays:
            60,

          minFillRate:
            0.90,

          minPairedPositiveRate:
            0.80,
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
          failed.length ===
          0
            ? "STATIC_TYPESCRIPT_THEN_LIVE_PRODUCER_COLLECTOR_SMOKE"
            : "REVIEW_TRUE_FORWARD_OOS_PIPELINE_V1",
      },
      null,
      2,
    ),
  );

  if (
    failed.length >
    0
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_FATAL",

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
