import assert from "node:assert/strict";

import {
  auditForwardSessions,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

function main() {
  const waiting =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-12T00:00:00.000Z",
        ),

      sessions:
        [],
    });

  const valid =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-16T00:00:00.000Z",
        ),

      sessions: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          capturedAt:
            "2026-10-08T23:50:00.000Z",

          candidateCount:
            1,
        },
      ],
    });

  const invalid =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-16T00:00:00.000Z",
        ),

      sessions: [
        {
          sourceTradingDate:
            "2026-10-12",

          targetSessionDate:
            "2026-10-12",

          capturedAt:
            "",

          candidateCount:
            -1,
        },
      ],
    });

  const checks = {
    waitingStatus:
      waiting.auditStatus ===
      "WAITING_FOR_FORWARD_SESSION",

    waitingExitSafe:
      waiting.nextGate ===
      "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION",

    validIntegrity:
      valid.auditStatus ===
      "FORWARD_SESSION_INTEGRITY_VERIFIED",

    validCount:
      valid.counts.valid ===
      1,

    oneDayMature:
      valid.counts.maturityReady["1D"] ===
      1,

    threeDayMature:
      valid.counts.maturityReady["3D"] ===
      1,

    fiveDayNotYetMature:
      valid.counts.maturityReady["5D"] ===
      0,

    invalidRejected:
      invalid.auditStatus ===
      "FORWARD_SESSION_INTEGRITY_FAILED",

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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.auditStatus,

          valid:
            valid.counts,

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
          "STATIC_VERIFY_THEN_RUN_READ_ONLY_CURRENT_FORWARD_SESSION_AUDIT",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_CONTRACT_FAILED",

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
