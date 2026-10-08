import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY";

const START_DATE =
  "2026-07-30";

const END_DATE =
  "2026-10-02";

async function main() {
  const supabase =
    createSupabaseServerClient();

  const stocksResult =
    await supabase
      .from("stocks")
      .select("stock_code")
      .eq("is_active", true)
      .order("stock_code");

  if (stocksResult.error) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${stocksResult.error.message}`,
    );
  }

  const stockCodes =
    (stocksResult.data ?? [])
      .map((row) => String(row.stock_code));

  const flowResult =
    await supabase
      .from("kis_investor_flow_daily")
      .select("stock_code,trading_date")
      .gte("trading_date", START_DATE)
      .lte("trading_date", END_DATE)
      .order("trading_date");

  if (flowResult.error) {
    throw new Error(
      `FLOW_TABLE_READ_FAILED:${flowResult.error.message}`,
    );
  }

  const rows =
    flowResult.data ?? [];

  const byStock =
    stockCodes.map(
      (stockCode) => {
        const dates =
          rows
            .filter(
              (row) =>
                String(row.stock_code) ===
                stockCode,
            )
            .map(
              (row) =>
                String(row.trading_date),
            )
            .sort();

        return {
          stockCode,
          rowCount:
            dates.length,
          earliest:
            dates[0] ?? null,
          latest:
            dates.at(-1) ?? null,
        };
      },
    );

  const ready =
    stockCodes.length > 0 &&
    rows.length > 0 &&
    byStock.every(
      (row) =>
        row.rowCount > 0 &&
        row.earliest === START_DATE &&
        row.latest === END_DATE,
    );

  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_COMPLETE",
        version:
          VERSION,
        table:
          "kis_investor_flow_daily",
        totalRows:
          rows.length,
        activeStockCount:
          stockCodes.length,
        byStock,
        ready,
        blocker:
          ready
            ? null
            : "HISTORICAL_FLOW_PERSISTENCE_INCOMPLETE",
        nextGate:
          ready
            ? "ALPHA_V1_FULL_HISTORICAL_REPLAY_READY"
            : "ALPHA_V1_REPAIR_HISTORICAL_FLOW_PERSISTENCE",
        safety: {
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
        },
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_FAILED",
          version:
            VERSION,
          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),
          databaseWrites: 0,
          ordersCreated: 0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
