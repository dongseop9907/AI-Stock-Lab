import assert from "node:assert/strict";

import {
  evaluatePaperExecutionRealismV2,
} from "../lib/trading/paper-execution-realism-v2";

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 100,
      referencePrice: 100_000,
      now:
        "2026-10-09T04:00:00.000Z",
      intervalVolume: 1_000,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.filledQuantity,
    50,
  );

  assert.equal(
    result.unfilledQuantity,
    50,
  );

  assert.ok(
    result.executionPrice !==
      null,
  );

  assert.ok(
    result.brokerFee > 0,
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 7,
      referencePrice: 50_000,
      now:
        "2026-10-09T04:00:00.000Z",
      intervalVolume: null,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.filledQuantity,
    7,
  );

  assert.equal(
    result.priceSource,
    "REFERENCE_PLUS_SYNTHETIC_SPREAD",
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "PAPER_EXECUTION_REALISM_V2_BUY_BINDING_CONTRACT_VERIFIED",
      cases: 2,
      invariants: [
        "PARTIAL_FILL_BY_VOLUME_CAP",
        "SYNTHETIC_SPREAD_FALLBACK",
        "BUY_BROKER_FEE",
      ],
    },
    null,
    2,
  ),
);
