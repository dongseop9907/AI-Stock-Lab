import assert from "node:assert/strict";

import {
  evaluatePaperExecutionRealismV2,
} from "../lib/trading/paper-execution-realism-v2";

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "SELL",
      requestedQuantity: 100,
      referencePrice: 100_000,
      now:
        "2026-10-09T06:00:00.000Z",
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
    result.executionPrice! <
      100_000,
  );

  assert.ok(
    result.brokerFee > 0,
  );

  assert.ok(
    result.sellTax > 0,
  );

  assert.equal(
    result.totalTransactionCost,
    result.brokerFee +
      result.sellTax,
  );
}

{
  const blocked =
    evaluatePaperExecutionRealismV2({
      side: "SELL",
      requestedQuantity: 5,
      referencePrice: 50_000,
      now:
        "2026-10-09T06:00:00.000Z",
      intervalVolume: 0,
    });

  assert.equal(
    blocked.approved,
    false,
  );

  assert.equal(
    blocked.blocker,
    "NO_EXECUTABLE_LIQUIDITY",
  );

  const protectiveFallback =
    evaluatePaperExecutionRealismV2({
      side: "SELL",
      requestedQuantity: 5,
      referencePrice: 50_000,
      now:
        "2026-10-09T06:00:00.000Z",
      intervalVolume: null,
    });

  assert.equal(
    protectiveFallback.approved,
    true,
  );

  assert.equal(
    protectiveFallback.filledQuantity,
    5,
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_CONTRACT_VERIFIED",
      cases: 2,
      invariants: [
        "SELL_PARTIAL_FILL_BY_VOLUME_CAP",
        "SELL_ADVERSE_EXECUTION_PRICE",
        "SELL_BROKER_FEE_AND_TAX",
        "PROTECTIVE_ZERO_LIQUIDITY_FALLBACK_CAN_EXECUTE",
      ],
    },
    null,
    2,
  ),
);
