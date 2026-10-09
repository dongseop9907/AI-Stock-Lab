import {
  evaluatePaperExecutionRealismV2,
  type PaperExecutionRealismDecision,
} from "@/lib/trading/paper-execution-realism-v2";

import {
  resolvePaperExecutionRealismV2MarketInput,
} from "@/lib/trading/resolve-paper-execution-realism-v2-market-input";

export interface ProtectiveSellExecutionRealismV2Input {
  supabase: any;
  stockCode: string;
  requestedQuantity: number;
  referencePrice: number;
  observedAt: string;
}

export interface ProtectiveSellExecutionRealismV2Result
  extends PaperExecutionRealismDecision {
  protectiveFallbackUsed: boolean;
  protectiveFallbackReason: string | null;
  marketInputSource: string;
}

/*
 * Protective exits are risk-reducing actions.
 *
 * Normal path:
 *   - SELL-side spread / impact / participation model
 *   - partial fill is allowed
 *
 * Fail-open-for-protection path:
 *   - if the realism model would block solely because the observed
 *     interval has no executable liquidity, retry without the
 *     interval-volume cap.
 *
 * Invalid quantity or invalid reference price remain programming/data
 * errors and are not silently converted into an execution.
 */
export async function resolveProtectiveSellExecutionRealismV2(
  input: ProtectiveSellExecutionRealismV2Input,
): Promise<ProtectiveSellExecutionRealismV2Result> {
  const marketInput =
    await resolvePaperExecutionRealismV2MarketInput({
      supabase:
        input.supabase,
      stockCode:
        input.stockCode,
      observedAt:
        input.observedAt,
    });

  let decision =
    evaluatePaperExecutionRealismV2({
      side:
        "SELL",
      requestedQuantity:
        input.requestedQuantity,
      referencePrice:
        input.referencePrice,
      now:
        input.observedAt,
      intervalVolume:
        marketInput.intervalVolume,
    });

  let protectiveFallbackUsed =
    false;

  let protectiveFallbackReason:
    string | null =
      null;

  if (
    !decision.approved ||
    decision.executionPrice ===
      null ||
    decision.filledQuantity <=
      0
  ) {
    if (
      decision.blocker ===
        "INVALID_REQUESTED_QUANTITY" ||
      decision.blocker ===
        "INVALID_REFERENCE_PRICE" ||
      decision.blocker ===
        "INVALID_POLICY"
    ) {
      throw new Error(
        `PROTECTIVE_SELL_REALISM_INVALID_INPUT:${decision.blocker}`,
      );
    }

    protectiveFallbackUsed =
      true;

    protectiveFallbackReason =
      decision.blocker ??
      "NO_EXECUTABLE_FILL";

    decision =
      evaluatePaperExecutionRealismV2({
        side:
          "SELL",
        requestedQuantity:
          input.requestedQuantity,
        referencePrice:
          input.referencePrice,
        now:
          input.observedAt,
        intervalVolume:
          null,
      });
  }

  if (
    !decision.approved ||
    decision.executionPrice ===
      null ||
    decision.filledQuantity <=
      0
  ) {
    throw new Error(
      `PROTECTIVE_SELL_REALISM_FALLBACK_FAILED:${decision.blocker ?? "UNKNOWN"}`,
    );
  }

  return {
    ...decision,
    protectiveFallbackUsed,
    protectiveFallbackReason,
    marketInputSource:
      marketInput.source,
  };
}
