import assert from "node:assert/strict";

import {
  DEFAULT_PAPER_EXECUTION_REALISM_POLICY,
  evaluatePaperExecutionRealismV2,
} from "../lib/trading/paper-execution-realism-v2";

function near(
  actual: number,
  expected: number,
  epsilon = 1e-8,
) {
  assert.ok(
    Math.abs(
      actual - expected,
    ) <= epsilon,
    `${actual} != ${expected}`,
  );
}

const now =
  "2026-10-09T03:30:00.000Z";

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 100,
      referencePrice: 100_000,
      now,
      quote: {
        observedAt:
          "2026-10-09T03:29:59.000Z",
        bestAskPrice: 100_100,
        bestAskQuantity: 40,
        bestBidPrice: 100_000,
        bestBidQuantity: 80,
      },
      intervalVolume: 10_000,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.priceSource,
    "BEST_ASK",
  );

  assert.equal(
    result.filledQuantity,
    40,
  );

  assert.equal(
    result.unfilledQuantity,
    60,
  );

  assert.ok(
    result.marketImpactBps > 0,
  );

  assert.ok(
    result.brokerFee > 0,
  );

  assert.equal(
    result.sellTax,
    0,
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "SELL",
      requestedQuantity: 50,
      referencePrice: 100_000,
      now,
      quote: {
        observedAt:
          "2026-10-09T03:29:59.000Z",
        bestBidPrice: 99_900,
        bestBidQuantity: 100,
      },
      intervalVolume: 20_000,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.priceSource,
    "BEST_BID",
  );

  assert.equal(
    result.filledQuantity,
    50,
  );

  assert.ok(
    result.sellTax > 0,
  );

  assert.ok(
    result.netCashFlow > 0,
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 10,
      referencePrice: 50_000,
      now,
      intervalVolume: 1_000,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.priceSource,
    "REFERENCE_PLUS_SYNTHETIC_SPREAD",
  );

  assert.equal(
    result.syntheticSpreadBps,
    DEFAULT_PAPER_EXECUTION_REALISM_POLICY.syntheticHalfSpreadBps,
  );

  assert.equal(
    result.filledQuantity,
    10,
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 100,
      referencePrice: 10_000,
      now,
      intervalVolume: 1_000,
    });

  assert.equal(
    result.filledQuantity,
    50,
  );

  assert.equal(
    result.unfilledQuantity,
    50,
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 1,
      referencePrice: 100_000,
      now,
      quote: {
        observedAt:
          "2026-10-09T03:29:50.000Z",
        bestAskPrice: 100_100,
      },
    });

  assert.equal(
    result.approved,
    false,
  );

  assert.equal(
    result.blocker,
    "STALE_QUOTE",
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 0,
      referencePrice: 100_000,
      now,
    });

  assert.equal(
    result.blocker,
    "INVALID_REQUESTED_QUANTITY",
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 1,
      referencePrice: 0,
      now,
    });

  assert.equal(
    result.blocker,
    "INVALID_REFERENCE_PRICE",
  );
}

{
  const policy = {
    ...DEFAULT_PAPER_EXECUTION_REALISM_POLICY,
    allowReferencePriceFallback: false,
  };

  const result =
    evaluatePaperExecutionRealismV2(
      {
        side: "BUY",
        requestedQuantity: 1,
        referencePrice: 100_000,
        now,
      },
      policy,
    );

  assert.equal(
    result.blocker,
    "NO_EXECUTABLE_PRICE",
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 100,
      referencePrice: 100_000,
      now,
      intervalVolume: 0,
    });

  assert.equal(
    result.blocker,
    "NO_EXECUTABLE_LIQUIDITY",
  );
}

{
  const result =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity: 10,
      referencePrice: 100_000,
      now,
      quote: {
        observedAt:
          "2026-10-09T03:29:59.000Z",
        bestAskPrice: 100_000,
        bestAskQuantity: 10,
      },
      intervalVolume: 10_000,
    });

  assert.equal(
    result.approved,
    true,
  );

  assert.equal(
    result.filledQuantity,
    10,
  );

  assert.ok(
    result.executionPrice !== null,
  );

  assert.ok(
    (result.executionPrice ?? 0) >=
      100_000,
  );

  near(
    result.totalTransactionCost,
    result.brokerFee,
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "PAPER_EXECUTION_REALISM_V2_CONTRACT_VERIFIED",
      cases: 10,
      covers: [
        "BEST_ASK_BUY",
        "BEST_BID_SELL",
        "SYNTHETIC_SPREAD_FALLBACK",
        "VOLUME_PARTICIPATION_PARTIAL_FILL",
        "STALE_QUOTE_BLOCK",
        "INVALID_QUANTITY_BLOCK",
        "INVALID_PRICE_BLOCK",
        "NO_FALLBACK_PRICE_BLOCK",
        "ZERO_LIQUIDITY_BLOCK",
        "TRANSACTION_COST_AND_MARKET_IMPACT",
      ],
    },
    null,
    2,
  ),
);
