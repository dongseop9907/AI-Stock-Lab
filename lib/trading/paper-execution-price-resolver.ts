import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluatePaperExecutionPriceSnapshot,
  type PaperExecutionPriceDecision,
  type PaperExecutionPricePolicy,
} from "@/lib/trading/paper-execution-price-model";

export async function resolvePaperExecutionPrice(
  input: {
    stockCode: string;
    now?: Date;
    policy?: PaperExecutionPricePolicy;
  },
): Promise<PaperExecutionPriceDecision> {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code,close_price,observed_at",
      )
      .eq(
        "stock_code",
        input.stockCode,
      )
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(
        1,
      );

  if (
    error
  ) {
    throw new Error(
      `PAPER_EXECUTION_PRICE_SNAPSHOT_READ_FAILED:${error.message}`,
    );
  }

  const snapshot =
    data?.[0] ??
    null;

  return evaluatePaperExecutionPriceSnapshot(
    {
      stockCode:
        input.stockCode,

      snapshot,

      now:
        input.now,
    },

    input.policy,
  );
}
