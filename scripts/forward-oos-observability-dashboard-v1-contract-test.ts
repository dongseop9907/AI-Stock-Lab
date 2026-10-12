import assert from "node:assert/strict";

import {
  getForwardOosObservabilityDashboardV1,
} from "../lib/research/get-forward-oos-observability-dashboard-v1";

function main() {
  const result =
    getForwardOosObservabilityDashboardV1();

  const noObservations =
    result.evidence
      .observations === 0;

  const checks = {
    status:
      result.status ===
      "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_V1",

    nonNegativeSessions:
      result.sessions.total >= 0 &&
      result.sessions.valid >= 0 &&
      result.sessions.invalid >= 0,

    maturityShape:
      result.maturity["1D"] >= 0 &&
      result.maturity["3D"] >= 0 &&
      result.maturity["5D"] >= 0,

    evidenceShape:
      result.evidence.observations >= 0 &&
      result.evidence.qualified >= 0 &&
      result.evidence.filled >= 0,

    noObservationSuppressesStaleReady:
      !noObservations ||
      (
        result.finalGate
          .trueForwardReady === false &&
        result.evidence
          .fillRate === null &&
        result.evidence
          .pairedPositiveRate["1D"] === null &&
        result.evidence
          .pairedPositiveRate["3D"] === null &&
        result.evidence
          .pairedPositiveRate["5D"] === null
      ),

    readOnlySafety:
      result.safety.readOnly === true &&
      result.safety.databaseWrites === 0 &&
      result.safety.ordersCreated === 0 &&
      result.safety.positionsChanged === 0 &&
      result.safety.promotionExecuted === false &&
      result.safety.realTradingEnabled === false,

    currentGatePresent:
      result.currentGate.length > 0,
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
          "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_V1_STALE_EVIDENCE_GUARD_CONTRACT_VERIFIED",

        checks,

        snapshot: {
          currentGate:
            result.currentGate,

          nextAction:
            result.nextAction,

          sessions:
            result.sessions,

          maturity:
            result.maturity,

          evidence:
            result.evidence,

          finalGate:
            result.finalGate,

          warnings:
            result.warnings,
        },

        safety:
          result.safety,

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_AND_NEXT_BUILD",
      },
      null,
      2,
    ),
  );
}

main();
