import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_DB_VERIFY";

async function main() {
  const supabase =
    createSupabaseServerClient();

  const history =
    await supabase
      .from(
        "paper_trade_history",
      )
      .select(`
        id,
        gross_pnl,
        entry_broker_fee,
        exit_broker_fee,
        sell_tax,
        total_transaction_cost,
        net_pnl,
        gross_return,
        net_return,
        entry_slippage_amount,
        entry_slippage_rate,
        cost_attribution_complete,
        cost_model_version,
        cost_attribution_snapshot
      `)
      .limit(
        1,
      );

  const order =
    await supabase
      .from(
        "paper_order_requests",
      )
      .select(`
        id,
        execution_price,
        execution_broker_fee,
        execution_transaction_cost,
        execution_fill_count
      `)
      .limit(
        1,
      );

  const checks = {
    paperTradeHistoryCostColumnsReadable:
      history.error ===
      null,

    existingBuyExecutionCostColumnsReadable:
      order.error ===
      null,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          ok !==
          true,
      )
      .map(
        ([name]) =>
          name,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
            0
            ? `${VERSION}_PASS`
            : `${VERSION}_FAILED`,

        checks,

        liveSchema: {
          paperTradeHistorySampleCount:
            history.data
              ?.length ??
            0,

          paperOrderRequestSampleCount:
            order.data
              ?.length ??
            0,

          historyError:
            history.error
              ? {
                  code:
                    history.error
                      .code ??
                    null,
                  message:
                    history.error
                      .message,
                }
              : null,

          orderError:
            order.error
              ? {
                  code:
                    order.error
                      .code ??
                    null,
                  message:
                    order.error
                      .message,
                }
              : null,

          sampleTrade:
            history.data
              ?.[0] ??
            null,
        },

        interpretation: {
          migrationColumnsVisible:
            history.error ===
            null,

          triggerDefinition:
            "VERIFIED_STATICALLY_IN_MIGRATION_SOURCE; NO_SYNTHETIC_TRADE_CREATED",

          runtimeAttributionProof:
            (
              history.data
                ?.some(
                  (
                    row:
                      Record<
                        string,
                        unknown
                      >,
                  ) =>
                    row
                      .cost_model_version ===
                    "PAPER_EXECUTION_COST_ATTRIBUTION_V1",
                ) ??
              false
            )
              ? "NATURAL_TRADE_EVIDENCE_PRESENT"
              : "WAIT_FOR_FIRST_NATURAL_PAPER_TRADE",

          waitWithoutTrade:
            "NORMAL",
        },

        safety: {
          databaseReadsOnly:
            true,
          databaseWrites:
            0,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          syntheticTradesCreated:
            0,
          promotionExecuted:
            false,
          realTradingEnabled:
            false,
        },

        failed,

        nextGate:
          failed.length ===
            0
            ? "BIND_COST_FIELDS_TO_EVALUATION_AND_REPORTING_V1"
            : "REVIEW_DB_MIGRATION_OR_SCHEMA_CACHE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
      0
      ? 0
      : 1;
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            `${VERSION}_FAILED`,

          error:
            String(
              error instanceof
                Error
                ? error
                    .message
                : error,
            ),

          safety: {
            databaseReadsOnly:
              true,
            databaseWrites:
              0,
            ordersCreated:
              0,
            ordersExecuted:
              0,
            positionsChanged:
              0,
            realTradingEnabled:
              false,
          },

          nextGate:
            "REVIEW_DB_VERIFY_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
