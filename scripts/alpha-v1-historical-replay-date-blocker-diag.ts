import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const START =
  "2026-07-30";

const END =
  "2026-10-02";

const FLOW_LOOKBACK =
  7;

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: stocks,
    error: stockError,
  } =
    await supabase
      .from("stocks")
      .select("stock_code")
      .eq("is_active", true)
      .order("stock_code");

  if (stockError) {
    throw stockError;
  }

  const stockCodes =
    (stocks ?? [])
      .map((row) =>
        String(row.stock_code)
      );

  const {
    data: predictions,
    error: predictionError,
  } =
    await supabase
      .from("ai_stock_predictions")
      .select("prediction_date,generated_at")
      .gte("prediction_date", START)
      .lte("prediction_date", END)
      .order("prediction_date")
      .order("generated_at");

  if (predictionError) {
    throw predictionError;
  }

  const byDate =
    new Map<
      string,
      string[]
    >();

  for (const row of predictions ?? []) {
    const date =
      String(row.prediction_date);

    const arr =
      byDate.get(date) ?? [];

    arr.push(
      String(row.generated_at)
    );

    byDate.set(
      date,
      arr,
    );
  }

  const rows = [];

  for (const [date, times] of byDate) {
    const decisionAt =
      [...times]
        .sort()
        .at(-1)!;

    const snapshotResult =
      await supabase
        .from("market_snapshots")
        .select(
          "stock_code",
          {
            count: "exact",
            head: true,
          },
        )
        .gte(
          "observed_at",
          `${date}T00:00:00.000Z`,
        )
        .lte(
          "observed_at",
          decisionAt,
        );

    if (snapshotResult.error) {
      throw snapshotResult.error;
    }

    const flowResult =
      await supabase
        .from("kis_investor_flow_daily")
        .select("stock_code,trading_date")
        .lt("trading_date", date)
        .order(
          "trading_date",
          {
            ascending: false,
          },
        )
        .limit(
          stockCodes.length *
            FLOW_LOOKBACK,
        );

    if (flowResult.error) {
      throw flowResult.error;
    }

    const counts =
      new Map<
        string,
        number
      >();

    for (const row of flowResult.data ?? []) {
      const code =
        String(row.stock_code);

      counts.set(
        code,
        (counts.get(code) ?? 0) + 1,
      );
    }

    const flowMin =
      stockCodes.length
        ? Math.min(
            ...stockCodes.map(
              (code) =>
                counts.get(code) ?? 0,
            ),
          )
        : 0;

    const snapshotRows =
      snapshotResult.count ?? 0;

    const blockers: string[] = [];

    if (
      flowMin <
      FLOW_LOOKBACK
    ) {
      blockers.push(
        "FLOW_LOOKBACK_LT_7",
      );
    }

    if (
      snapshotRows ===
      0
    ) {
      blockers.push(
        "NO_SNAPSHOT_BEFORE_DECISION",
      );
    }

    rows.push({
      date,
      decisionAt,
      snapshotRows,
      priorFlowRowsMinimum:
        flowMin,
      replayReady:
        blockers.length === 0,
      blockers,
    });
  }

  const summary = {
    totalPredictionDates:
      rows.length,

    replayReadyDates:
      rows.filter(
        (row) =>
          row.replayReady,
      ).length,

    noSnapshotDates:
      rows.filter(
        (row) =>
          row.blockers.includes(
            "NO_SNAPSHOT_BEFORE_DECISION",
          ),
      ).length,

    flowLookbackDates:
      rows.filter(
        (row) =>
          row.blockers.includes(
            "FLOW_LOOKBACK_LT_7",
          ),
      ).length,
  };

  const report = {
    status:
      "ALPHA_V1_HISTORICAL_REPLAY_DATE_BLOCKER_DIAG_COMPLETE",
    summary,
    rows,
    safety: {
      databaseWrites: 0,
      ordersCreated: 0,
    },
  };

  const out =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-historical-replay-date-blocker-diag.json",
    );

  fs.mkdirSync(
    path.dirname(out),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    out,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        ...summary,
        blockedDates:
          rows
            .filter(
              (row) =>
                !row.replayReady,
            )
            .map(
              (row) => ({
                date:
                  row.date,
                snapshotRows:
                  row.snapshotRows,
                flowMin:
                  row.priorFlowRowsMinimum,
                blockers:
                  row.blockers,
              }),
            ),
        outputFile:
          "logs/alpha-v1-historical-replay-date-blocker-diag.json",
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
            "ALPHA_V1_HISTORICAL_REPLAY_DATE_BLOCKER_DIAG_FAILED",
          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
