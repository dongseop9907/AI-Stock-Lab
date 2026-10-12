// AI_STOCK_LAB_PATCH_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_V1
// Contract fixture typing only: widen forward return fixtures to number | null without changing runtime values.
import assert from "node:assert/strict";

import {
  bindActualForwardObservations,
} from "./true-forward-oos-observation-source-binding-v1";

function validBase() {
  return {
    sourceTradingDate:
      "2026-10-08",

    targetSessionDate:
      "2026-10-12",

    stockCode:
      "005930",

    candidateCapturedAt:
      "2026-10-08T23:50:00.000Z",

    correctedEntry: {
      qualified:
        true,

      observedAt:
        "2026-10-12T00:02:00.000Z",

      directReturns: {
        r1: 0.01 as number | null,

        r3: null as number | null,

        r5: null as number | null,
      },
    },

    selectedPolicy: {
      filled:
        true,

      returns: {
        r1: 0.008 as number | null,

        r3: null as number | null,

        r5: null as number | null,
      },
    },
  };
}

function main() {
  const oneDay =
    bindActualForwardObservations({
      observations: [
        validBase(),
      ],
    });

  const allMatureObservation =
    validBase();

  allMatureObservation
    .correctedEntry
    .directReturns = {
      r1:
        0.01,

      r3:
        0.02,

      r5:
        0.03,
    };

  allMatureObservation
    .selectedPolicy
    .returns = {
      r1:
        0.008,

      r3:
        0.018,

      r5:
        0.025,
    };

  const allMature =
    bindActualForwardObservations({
      observations: [
        allMatureObservation,
      ],
    });

  const orderingObservation =
    validBase();

  orderingObservation
    .correctedEntry
    .directReturns = {
      r1:
        null,

      r3:
        0.02,

      r5:
        null,
    };

  const ordering =
    bindActualForwardObservations({
      observations: [
        orderingObservation,
      ],
    });

  const duplicate =
    bindActualForwardObservations({
      observations: [
        validBase(),
        validBase(),
      ],
    });

  const invalid =
    bindActualForwardObservations({
      observations: [
        {
          ...validBase(),

          stockCode:
            "",

          correctedEntry: {
            qualified:
              null,

            directReturns: {
              r1:
                0.01,
            },
          },
        },
      ],
    });

  const checks = {
    oneDayBound:
      oneDay.bindingStatus ===
        "ACTUAL_OUTCOME_SOURCE_BOUND" &&
      oneDay.counts
        .canonicalOutcomeRows ===
        1 &&
      oneDay.rows[0]
        ?.horizon ===
        "1D",

    actualR1MappedTo1D:
      oneDay.rows[0]
        ?.directReturn ===
        0.01,

    qualifiedMapped:
      oneDay.rows[0]
        ?.qualified ===
        true,

    policyReturnMapped:
      oneDay.rows[0]
        ?.policyReturn ===
        0.008,

    allMatureHasThreeRows:
      allMature.counts
        .canonicalOutcomeRows ===
        3 &&
      allMature.rows
        .map(
          row =>
            row.horizon,
        )
        .join(",") ===
        "1D,3D,5D",

    orderingViolationBlocked:
      ordering.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      ordering.failed.includes(
        "CANONICAL_HORIZON_ORDERING_VIOLATION",
      ),

    duplicateBlocked:
      duplicate.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      duplicate.failed.includes(
        "DUPLICATE_CANONICAL_OUTCOME_KEYS",
      ),

    invalidBlocked:
      invalid.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      invalid.failed.includes(
        "INVALID_OBSERVATION_SOURCE_ROWS",
      ),

    actualSchemaNoInventedFields:
      oneDay.schema
        .unsupportedLegacyAssumptions
        .includes(
          "evaluatedAt",
        ) &&
      oneDay.schema
        .unsupportedLegacyAssumptions
        .includes(
          "returnRate",
        ),

    readOnly:
      oneDay.safety
        .readOnly ===
        true,

    noTradingSideEffects:
      oneDay.safety
        .ordersCreated ===
        0 &&
      oneDay.safety
        .positionsChanged ===
        0 &&
      oneDay.safety
        .realTradingEnabled ===
        false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          oneDay:
            oneDay.counts,

          allMature:
            allMature.counts,

          ordering:
            ordering.failed,

          duplicate:
            duplicate.failed,

          invalid:
            invalid.failed,
        },

        safety: {
          syntheticOnly:
            true,

          collectorExecuted:
            false,

          evaluatorExecuted:
            false,

          databaseWrites:
            0,

          fileWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_ACTUAL_SOURCE_BINDING",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_CONTRACT_FAILED",

        error:
          String(
            error instanceof Error
              ? error.stack ??
                error.message
              : error
          ),
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
