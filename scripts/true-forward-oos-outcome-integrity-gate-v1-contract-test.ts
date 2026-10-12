import assert from "node:assert/strict";

import {
  auditOutcomeRows,
} from "./true-forward-oos-outcome-integrity-gate-v1";

function main() {
  const waiting =
    auditOutcomeRows({
      outcomes:
        [],
    });

  const valid =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.012,
        },
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "3D",

          evaluatedAt:
            "2026-10-15T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.021,
        },
      ],
    });

  const duplicate =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.01,
        },
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:41:00.000Z",

          qualified:
            true,

          returnRate:
            0.02,
        },
      ],
    });

  const ordering =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "3D",

          evaluatedAt:
            "2026-10-15T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.02,
        },
      ],
    });

  const invalid =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "bad",

          targetSessionDate:
            "2026-10-08",

          horizon:
            "9D",

          evaluatedAt:
            null,

          qualified:
            null,

          returnRate:
            Number.NaN,
        },
      ],
    });

  const checks = {
    waitingSafe:
      waiting.integrityStatus ===
      "WAITING_FOR_OUTCOME_ROWS",

    validPasses:
      valid.integrityStatus ===
      "OUTCOME_INTEGRITY_VERIFIED",

    duplicateBlocked:
      duplicate.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      duplicate.failed.includes(
        "DUPLICATE_OUTCOME_KEYS",
      ),

    orderingBlocked:
      ordering.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      ordering.failed.includes(
        "HORIZON_ORDERING_VIOLATION",
      ),

    invalidBlocked:
      invalid.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      invalid.failed.includes(
        "INVALID_OUTCOME_ROWS",
      ),

    readOnly:
      valid.safety.readOnly ===
      true,

    noTradingSideEffects:
      valid.safety.ordersCreated ===
        0 &&
      valid.safety.positionsChanged ===
        0 &&
      valid.safety.realTradingEnabled ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.integrityStatus,

          valid:
            valid.counts,

          duplicate:
            duplicate.counts,

          ordering:
            ordering.counts,

          invalid:
            invalid.counts,
        },

        safety: {
          syntheticOnly:
            true,

          databaseReads:
            0,

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
          "STATIC_VERIFY_THEN_BUILD_OUTCOME_SOURCE_BINDING",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_CONTRACT_FAILED",

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
