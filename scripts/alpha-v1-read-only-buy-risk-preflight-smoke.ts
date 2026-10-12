import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  evaluateReadOnlyBuyRiskPreflight,
} from "../lib/trading/read-only-buy-risk-preflight";

const VERSION =
  "ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE";

function toNumber(
  value: unknown,
): number {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

async function resolveLatestEntryModelId() {
  const supabase =
    createSupabaseServerClient();

  const candidate =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id, status, purpose, created_at",
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "status",
        "CANDIDATE",
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    candidate.error
  ) {
    throw new Error(
      `ENTRY_MODEL_CANDIDATE_READ_FAILED:${candidate.error.message}`,
    );
  }

  if (
    candidate.data
      ?.id
  ) {
    return String(
      candidate.data.id,
    );
  }

  const approved =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id, status, purpose, approved_at",
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "status",
        "APPROVED",
      )
      .order(
        "approved_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    approved.error
  ) {
    throw new Error(
      `ENTRY_MODEL_APPROVED_READ_FAILED:${approved.error.message}`,
    );
  }

  if (
    !approved.data
      ?.id
  ) {
    throw new Error(
      "ACTIVE_ENTRY_TIMING_MODEL_NOT_FOUND",
    );
  }

  return String(
    approved.data.id,
  );
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const stockCode =
    "005930";

  const modelId =
    await resolveLatestEntryModelId();

  const snapshot =
    await supabase
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code, close_price, observed_at",
      )
      .eq(
        "stock_code",
        stockCode,
      )
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    snapshot.error ||
    !snapshot.data
  ) {
    throw new Error(
      `TARGET_SNAPSHOT_READ_FAILED:${
        snapshot.error
          ?.message ??
        "NO_SNAPSHOT"
      }`,
    );
  }

  const entryPrice =
    toNumber(
      snapshot
        .data
        .close_price,
    );

  if (
    entryPrice <=
    0
  ) {
    throw new Error(
      "TARGET_ENTRY_PRICE_INVALID",
    );
  }

  const proposedStopPrice =
    Math.floor(
      entryPrice *
      0.975,
    );

  const preflight =
    await evaluateReadOnlyBuyRiskPreflight({
      stockCode,
      modelId,
      entryPrice,
      proposedStopPrice,
      requestedQuantity:
        1,

      entryObservedAt:
        String(
          snapshot
            .data
            .observed_at,
        ),
    });

  const report = {
    status:
      "ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE_COMPLETE",

    version:
      VERSION,

    diagnosticFixture: {
      stockCode,
      modelId,
      entryPrice,
      proposedStopPrice,
      requestedQuantity:
        1,

      stopDistanceRate:
        (
          entryPrice -
          proposedStopPrice
        ) /
        entryPrice,
    },

    preflight,

    contract: {
      riskFormula:
        "EXISTING_VALIDATE_BUY_RISK",

      accountContext:
        "SAME_PAPER_ACCOUNT_POSITION_MARK_TO_MARKET_CONTRACT_AS_PAPER_ORDER_SERVICE",

      ordersCreated:
        0,

      riskDecisionWrites:
        0,

      entrySignalWrites:
        0,
    },

    nextGate:
      "ALPHA_V1_BIND_READ_ONLY_RISK_PREFLIGHT_AFTER_ENTRY_TIMING_CANDIDATE",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            riskDecisionWrites:
              0,

            entrySignalWrites:
              0,

            orderWrites:
              0,

            ordersCreated:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
