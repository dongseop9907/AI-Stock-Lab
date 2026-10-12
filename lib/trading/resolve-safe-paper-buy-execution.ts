import {
  evaluateBuyExecutionGapSlippageRisk,
  type BuyExecutionRiskEvaluation,
} from "@/lib/trading/gap-slippage-risk";

import {
  resolvePaperExecutionPrice,
} from "@/lib/trading/paper-execution-price-resolver";

export interface ResolveSafePaperBuyExecutionInput {
  stockCode: string;
  plannedEntryPrice: number;
  stopPrice: number;
  quantity: number;
  accountEquity: number;
  reservedRiskAmount: number;
  now?: Date;
}

export interface SafePaperBuyExecutionDecision {
  allowed: boolean;

  executionPrice:
    number |
    null;

  executionPriceObservedAt:
    string |
    null;

  executionPriceSource:
    "MARKET_SNAPSHOT_CLOSE";

  priceDecision:
    Awaited<
      ReturnType<
        typeof resolvePaperExecutionPrice
      >
    >;

  riskDecision:
    BuyExecutionRiskEvaluation |
    null;

  reason:
    string;

  semantics: {
    plannedEntryPriceFallback: false;
    unsafeBuyFailsClosed: true;
  };
}

export async function resolveSafePaperBuyExecution(
  input:
    ResolveSafePaperBuyExecutionInput,
): Promise<SafePaperBuyExecutionDecision> {
  const priceDecision =
    await resolvePaperExecutionPrice({
      stockCode:
        input.stockCode,

      now:
        input.now,
    });

  if (
    !priceDecision.usable ||
    priceDecision.executionPrice ===
      null
  ) {
    return {
      allowed:
        false,

      executionPrice:
        null,

      executionPriceObservedAt:
        priceDecision.observedAt,

      executionPriceSource:
        "MARKET_SNAPSHOT_CLOSE",

      priceDecision,

      riskDecision:
        null,

      reason:
        `EXECUTION_PRICE_BLOCKED:${priceDecision.blocker}`,

      semantics: {
        plannedEntryPriceFallback:
          false,

        unsafeBuyFailsClosed:
          true,
      },
    };
  }

  const riskDecision =
    evaluateBuyExecutionGapSlippageRisk({
      stockCode:
        input.stockCode,

      plannedEntryPrice:
        input.plannedEntryPrice,

      executionPrice:
        priceDecision.executionPrice,

      stopPrice:
        input.stopPrice,

      quantity:
        input.quantity,

      accountEquity:
        input.accountEquity,

      reservedRiskAmount:
        input.reservedRiskAmount,
    });

  return {
    allowed:
      riskDecision.allowed,

    executionPrice:
      priceDecision.executionPrice,

    executionPriceObservedAt:
      priceDecision.observedAt,

    executionPriceSource:
      "MARKET_SNAPSHOT_CLOSE",

    priceDecision,

    riskDecision,

    reason:
      riskDecision.allowed
        ? "SAFE_PAPER_BUY_EXECUTION_ALLOWED"
        : `GAP_SLIPPAGE_BLOCKED:${riskDecision.blockers.join(",")}`,

    semantics: {
      plannedEntryPriceFallback:
        false,

      unsafeBuyFailsClosed:
        true,
    },
  };
}
