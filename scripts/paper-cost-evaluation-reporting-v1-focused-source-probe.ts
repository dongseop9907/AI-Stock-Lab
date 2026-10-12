import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  {
    file:
      "lib/trading/evaluate-paper-trades.ts",
    anchors: [
      "paper_trade_history",
      "realized_pnl",
      "exit_price",
      "select(",
      "insert(",
      "return {",
    ],
  },
  {
    file:
      "lib/trading/generate-daily-performance-report.ts",
    anchors: [
      "paper_trade_history",
      "realized_pnl",
      "select(",
      "reduce(",
      "total",
      "return {",
    ],
  },
  {
    file:
      "lib/trading/get-paper-account-dashboard.ts",
    anchors: [
      "paper_trade_history",
      "realized_pnl",
      "daily_pnl",
      "select(",
      "realizedPnl",
      "return {",
    ],
  },
  {
    file:
      "lib/trading/get-trade-history-dashboard.ts",
    anchors: [
      "paper_trade_history",
      "realized_pnl",
      "select(",
      "realizedPnl",
      "totalRealizedPnl",
      "return {",
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

  if (
    !fs.existsSync(
      abs,
    )
  ) {
    return {
      exists: false,
      lines: [] as string[],
    };
  }

  return {
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

function mergeWindows(
  lines: string[],
  anchors: readonly string[],
) {
  const indices:
    number[] = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      const lower =
        line.toLowerCase();

      if (
        anchors.some(
          anchor =>
            lower.includes(
              anchor.toLowerCase(),
            ),
        )
      ) {
        indices.push(
          index,
        );
      }
    },
  );

  const raw =
    indices.map(
      index => ({
        start:
          Math.max(
            0,
            index - 14,
          ),
        end:
          Math.min(
            lines.length - 1,
            index + 18,
          ),
      }),
    );

  const merged:
    Array<{
      start: number;
      end: number;
    }> = [];

  for (
    const item of raw
  ) {
    const last =
      merged.at(
        -1,
      );

    if (
      last &&
      item.start <=
        last.end + 3
    ) {
      last.end =
        Math.max(
          last.end,
          item.end,
        );
    }
    else {
      merged.push({
        ...item,
      });
    }
  }

  return merged
    .slice(
      0,
      12,
    )
    .map(
      window => ({
        startLine:
          window.start + 1,
        endLine:
          window.end + 1,
        lines:
          lines
            .slice(
              window.start,
              window.end + 1,
            )
            .map(
              (
                text,
                offset,
              ) => ({
                line:
                  window.start +
                  offset +
                  1,
                text,
              }),
            ),
      }),
    );
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
          mergeWindows(
            loaded.lines,
            target.anchors,
          ),
      };
    },
  );

const checks = {
  allFilesExist:
    files.every(
      row =>
        row.exists,
    ),

  dailyReportHasHistorySurface:
    files
      .find(
        row =>
          row.file ===
          "lib/trading/generate-daily-performance-report.ts",
      )
      ?.windows.length
      ? true
      : false,

  accountDashboardHasHistorySurface:
    files
      .find(
        row =>
          row.file ===
          "lib/trading/get-paper-account-dashboard.ts",
      )
      ?.windows.length
      ? true
      : false,

  tradeHistoryDashboardHasHistorySurface:
    files
      .find(
        row =>
          row.file ===
          "lib/trading/get-trade-history-dashboard.ts",
      )
      ?.windows.length
      ? true
      : false,
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
          ? "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_FOCUSED_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_FOCUSED_SOURCE_PROBE_FAILED",

      purpose:
        "Capture exact type/select/calculation/return insertion points before binding net_pnl and explicit PAPER execution costs into evaluation/reporting.",

      intendedPolicy: {
        canonicalClosedTradePnl:
          "net_pnl when cost_attribution_complete=true and net_pnl is non-null",
        legacyFallback:
          "realized_pnl",
        preserveLegacyFields:
          true,
        syntheticTradeCreation:
          false,
      },

      files,

      checks,

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
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
          ? "PATCH_PAPER_COST_EVALUATION_REPORTING_V1"
          : "REPAIR_FOCUSED_SOURCE_PROBE",
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
