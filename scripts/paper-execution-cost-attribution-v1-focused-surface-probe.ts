import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  {
    file:
      "lib/trading/execute-paper-order.ts",
    needles: [
      "p_broker_fee",
      "brokerFee",
      "execution_price",
      "filled_quantity",
      "rpc(",
      "execute_paper_buy_order",
    ],
  },
  {
    file:
      "lib/trading/evaluate-paper-trades.ts",
    needles: [
      "exit_price",
      "realized_pnl",
      "metrics",
      "insert(",
      "paper_trade_evaluations",
      "paper_trade_history",
    ],
  },
  {
    file:
      "lib/trading/generate-daily-performance-report.ts",
    needles: [
      "realized_pnl",
      "unrealizedPnl",
      "return",
      "profit",
      "paper_trade_history",
      "paper_positions",
    ],
  },
  {
    file:
      "lib/trading/get-paper-account-dashboard.ts",
    needles: [
      "realized_pnl",
      "unrealizedPnl",
      "daily_pnl",
      "paper_positions",
      "paper_trade_history",
    ],
  },
  {
    file:
      "lib/trading/get-trade-history-dashboard.ts",
    needles: [
      "realized_pnl",
      "exit_price",
      "paper_trade_history",
      "totalRealizedPnl",
    ],
  },
  {
    file:
      "lib/trading/paper-order-service.ts",
    needles: [
      "realized_pnl",
      "daily_realized_pnl",
      "paper_positions",
      "paper_trade_history",
      "average_price",
    ],
  },
  {
    file:
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
    needles: [
      "p_broker_fee",
      "broker_fee",
      "execution_price",
      "filled_quantity",
      "paper_trade_history",
      "paper_positions",
    ],
  },
  {
    file:
      "supabase/migrations/003_execute_paper_orders.sql",
    needles: [
      "realized_pnl",
      "paper_trade_history",
      "paper_positions",
      "filled_quantity",
      "average_price",
    ],
  },
] as const;

function read(
  rel: string,
) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return {
      file: rel,
      exists: false,
      lines: [] as string[],
    };
  }

  return {
    file: rel,
    exists: true,
    lines:
      fs
        .readFileSync(
          abs,
          "utf8",
        )
        .split(/\r?\n/),
  };
}

function windowsAround(
  lines: string[],
  needles: readonly string[],
) {
  const hits =
    lines
      .map(
        (text, index) => ({
          index,
          text,
        }),
      )
      .filter(
        row =>
          needles.some(
            needle =>
              row.text
                .toLowerCase()
                .includes(
                  needle.toLowerCase(),
                ),
          ),
      );

  const windows:
    Array<{
      start: number;
      end: number;
      lines: Array<{
        line: number;
        text: string;
      }>;
    }> = [];

  for (
    const hit of
    hits.slice(
      0,
      12,
    )
  ) {
    const start =
      Math.max(
        0,
        hit.index - 10,
      );

    const end =
      Math.min(
        lines.length,
        hit.index + 11,
      );

    const overlaps =
      windows.some(
        item =>
          start <=
            item.end &&
          end >=
            item.start,
      );

    if (overlaps) {
      continue;
    }

    windows.push({
      start:
        start + 1,
      end,
      lines:
        lines
          .slice(
            start,
            end,
          )
          .map(
            (text, offset) => ({
              line:
                start +
                offset +
                1,
              text,
            }),
          ),
    });
  }

  return windows;
}

const files =
  TARGETS.map(
    target => {
      const loaded =
        read(
          target.file,
        );

      return {
        file:
          target.file,
        exists:
          loaded.exists,
        totalLines:
          loaded.lines.length,
        windows:
          windowsAround(
            loaded.lines,
            target.needles,
          ),
      };
    },
  );

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_FOCUSED_SURFACE_PROBE_COMPLETE",

      purpose:
        "Capture exact source insertion points for broker fee, sell tax, slippage attribution, and gross/net PnL separation in PAPER execution and evaluation.",

      targetContract: {
        entryCost:
          "persist broker fee and execution slippage attribution on PAPER buy execution",
        exitCost:
          "persist broker fee plus sell tax and exit slippage when PAPER trade closes",
        pnl:
          "preserve gross PnL and derive net PnL after explicit costs",
        evaluation:
          "paper evaluation/reporting consumes explicit cost fields rather than inferring from realized_pnl",
        safety:
          "NO ORDERS / NO POSITIONS / NO DB WRITES IN THIS PROBE",
      },

      files,

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        networkRequests:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        "PATCH_PAPER_EXECUTION_COST_ATTRIBUTION_V1_WITH_EXACT_SOURCE_CONTEXT",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
