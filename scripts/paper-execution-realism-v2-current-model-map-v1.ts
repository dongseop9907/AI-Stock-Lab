import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/paper-execution-price-resolver.ts",
  "lib/trading/resolve-safe-paper-buy-execution.ts",
  "lib/trading/gap-slippage-risk.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/evaluate-paper-trades.ts",
  "lib/trading/generate-daily-performance-report.ts",
  "lib/trading/get-paper-account-dashboard.ts",
  "lib/trading/get-trade-history-dashboard.ts",
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
] as const;

const GROUPS = {
  executionPrice: [
    "execution_price",
    "executionPrice",
    "average_price",
    "averagePrice",
    "fill_price",
    "fillPrice",
  ],
  slippage: [
    "slippage",
    "slippageBps",
    "slippage_rate",
    "adverse_entry_drift",
  ],
  spread: [
    "spread",
    "bid",
    "ask",
    "mid",
    "best_bid",
    "best_ask",
  ],
  partialFill: [
    "partialFill",
    "partial_fill",
    "filled_quantity",
    "filledQuantity",
    "fillRatio",
    "fill_rate",
  ],
  liquidity: [
    "liquidity",
    "volume",
    "turnover",
    "participation",
    "marketImpact",
    "market_impact",
  ],
  fees: [
    "brokerFee",
    "broker_fee",
    "commission",
    "feeRate",
    "fee_rate",
    "transactionFee",
    "transaction_fee",
  ],
  tax: [
    "sellTax",
    "sell_tax",
    "taxRate",
    "tax_rate",
    "transactionTax",
    "transaction_tax",
  ],
  netPnl: [
    "netPnl",
    "net_pnl",
    "realizedPnl",
    "realized_pnl",
    "profitAfter",
    "afterCost",
    "after_cost",
  ],
  grossPnl: [
    "grossPnl",
    "gross_pnl",
    "pnl",
    "profit",
  ],
  latency: [
    "latency",
    "delay",
    "observed_at",
    "captured_at",
    "execution_price_observed_at",
  ],
  orderbook: [
    "orderbook",
    "order_book",
    "bestBid",
    "bestAsk",
    "bidPrice",
    "askPrice",
    "호가",
  ],
  exitRealism: [
    "exitPrice",
    "exit_price",
    "stop",
    "trailing",
    "sell",
    "close_price",
  ],
} as const;

type GroupName =
  keyof typeof GROUPS;

function read(rel: string) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return {
      rel,
      exists: false,
      text: "",
      lines: [] as string[],
    };
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  return {
    rel,
    exists: true,
    text,
    lines:
      text.split(/\r?\n/),
  };
}

function hitsFor(
  lines: string[],
  needles: readonly string[],
) {
  const hits:
    Array<{
      line: number;
      text: string;
      matched: string[];
    }> = [];

  lines.forEach(
    (line, index) => {
      const lowered =
        line.toLowerCase();

      const matched =
        needles.filter(
          needle =>
            lowered.includes(
              needle.toLowerCase(),
            ),
        );

      if (
        matched.length >
        0
      ) {
        hits.push({
          line:
            index + 1,
          text:
            line.trim(),
          matched:
            [...matched],
        });
      }
    },
  );

  return hits;
}

const files =
  TARGETS.map(
    rel => {
      const loaded =
        read(rel);

      const groups =
        Object.fromEntries(
          Object.entries(
            GROUPS,
          ).map(
            (
              [
                name,
                needles,
              ],
            ) => {
              const hits =
                hitsFor(
                  loaded.lines,
                  needles,
                );

              return [
                name,
                {
                  count:
                    hits.length,
                  sample:
                    hits.slice(
                      0,
                      8,
                    ),
                },
              ];
            },
          ),
        ) as Record<
          GroupName,
          {
            count: number;
            sample: Array<{
              line: number;
              text: string;
              matched: string[];
            }>;
          }
        >;

      return {
        file: rel,
        exists:
          loaded.exists,
        groups,
      };
    },
  );

function file(
  rel: string,
) {
  return files.find(
    row =>
      row.file === rel,
  );
}

function groupCount(
  rel: string,
  group: GroupName,
) {
  return (
    file(rel)
      ?.groups[group]
      ?.count ??
    0
  );
}

const runtimeExecutionFiles = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/paper-execution-price-resolver.ts",
  "lib/trading/resolve-safe-paper-buy-execution.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/execute-approved-paper-orders.ts",
] as const;

const evaluationFiles = [
  "lib/trading/evaluate-paper-trades.ts",
  "lib/trading/generate-daily-performance-report.ts",
  "lib/trading/get-paper-account-dashboard.ts",
  "lib/trading/get-trade-history-dashboard.ts",
] as const;

function anyIn(
  list: readonly string[],
  group: GroupName,
) {
  return list.some(
    rel =>
      groupCount(
        rel,
        group,
      ) >
      0,
  );
}

const executionLayer = {
  executionPrice:
    anyIn(
      runtimeExecutionFiles,
      "executionPrice",
    ),
  slippage:
    anyIn(
      runtimeExecutionFiles,
      "slippage",
    ),
  spread:
    anyIn(
      runtimeExecutionFiles,
      "spread",
    ),
  partialFill:
    anyIn(
      runtimeExecutionFiles,
      "partialFill",
    ),
  liquidity:
    anyIn(
      runtimeExecutionFiles,
      "liquidity",
    ),
  orderbook:
    anyIn(
      runtimeExecutionFiles,
      "orderbook",
    ),
  latency:
    anyIn(
      runtimeExecutionFiles,
      "latency",
    ),
  fees:
    anyIn(
      runtimeExecutionFiles,
      "fees",
    ),
  tax:
    anyIn(
      runtimeExecutionFiles,
      "tax",
    ),
};

const evaluationLayer = {
  fees:
    anyIn(
      evaluationFiles,
      "fees",
    ),
  tax:
    anyIn(
      evaluationFiles,
      "tax",
    ),
  netPnl:
    anyIn(
      evaluationFiles,
      "netPnl",
    ),
  grossPnl:
    anyIn(
      evaluationFiles,
      "grossPnl",
    ),
  slippage:
    anyIn(
      evaluationFiles,
      "slippage",
    ),
  exitRealism:
    anyIn(
      evaluationFiles,
      "exitRealism",
    ),
};

const persistenceLayer = {
  executionPrice:
    groupCount(
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
      "executionPrice",
    ) >
    0,
  fees:
    groupCount(
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
      "fees",
    ) >
    0 ||
    groupCount(
      "supabase/migrations/003_execute_paper_orders.sql",
      "fees",
    ) >
    0,
  tax:
    groupCount(
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
      "tax",
    ) >
    0 ||
    groupCount(
      "supabase/migrations/003_execute_paper_orders.sql",
      "tax",
    ) >
    0,
  partialFill:
    groupCount(
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
      "partialFill",
    ) >
    0 ||
    groupCount(
      "supabase/migrations/003_execute_paper_orders.sql",
      "partialFill",
    ) >
    0,
};

const gaps: string[] = [];

if (
  !executionLayer.fees
) {
  gaps.push(
    "PAPER_RUNTIME_EXECUTION_FEE_MODEL_NOT_VISIBLE",
  );
}

if (
  !executionLayer.tax
) {
  gaps.push(
    "PAPER_RUNTIME_EXECUTION_TAX_MODEL_NOT_VISIBLE",
  );
}

if (
  !persistenceLayer.fees
) {
  gaps.push(
    "PAPER_EXECUTION_FEE_PERSISTENCE_NOT_VISIBLE",
  );
}

if (
  !persistenceLayer.tax
) {
  gaps.push(
    "PAPER_EXECUTION_TAX_PERSISTENCE_NOT_VISIBLE",
  );
}

if (
  !evaluationLayer.netPnl
) {
  gaps.push(
    "PAPER_NET_PNL_AFTER_COST_NOT_VISIBLE",
  );
}

if (
  !evaluationLayer.fees ||
  !evaluationLayer.tax
) {
  gaps.push(
    "PAPER_EVALUATION_COST_ATTRIBUTION_INCOMPLETE",
  );
}

if (
  !evaluationLayer.slippage
) {
  gaps.push(
    "PAPER_EVALUATION_SLIPPAGE_ATTRIBUTION_NOT_VISIBLE",
  );
}

if (
  !executionLayer.orderbook
) {
  gaps.push(
    "PAPER_ORDERBOOK_EXECUTION_INPUT_NOT_VISIBLE",
  );
}

if (
  !executionLayer.latency
) {
  gaps.push(
    "PAPER_EXECUTION_LATENCY_MODEL_NOT_VISIBLE",
  );
}

const priority =
  gaps.some(
    gap =>
      gap.includes(
        "FEE",
      ) ||
      gap.includes(
        "TAX",
      ) ||
      gap.includes(
        "NET_PNL",
      ) ||
      gap.includes(
        "COST_ATTRIBUTION",
      ),
  )
    ? "PAPER_EXECUTION_COST_ATTRIBUTION_V1"
    : gaps.length > 0
      ? "PAPER_EXECUTION_REALISM_GAP_REPAIR_V2"
      : "PAPER_LIVE_FORWARD_EVIDENCE_ACCUMULATION";

const compactFiles =
  files
    .filter(
      row =>
        row.exists,
    )
    .map(
      row => ({
        file:
          row.file,
        counts:
          Object.fromEntries(
            Object.entries(
              row.groups,
            )
              .filter(
                (
                  [
                    ,
                    value,
                  ],
                ) =>
                  value.count >
                  0,
              )
              .map(
                (
                  [
                    key,
                    value,
                  ],
                ) => [
                  key,
                  value.count,
                ],
              ),
          ),
        samples:
          Object.fromEntries(
            Object.entries(
              row.groups,
            )
              .filter(
                (
                  [
                    ,
                    value,
                  ],
                ) =>
                  value.count >
                  0,
              )
              .map(
                (
                  [
                    key,
                    value,
                  ],
                ) => [
                  key,
                  value.sample.slice(
                    0,
                    3,
                  ),
                ],
              ),
          ),
      }),
    );

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_EXECUTION_REALISM_V2_CURRENT_MODEL_MAP_V1_COMPLETE",

      purpose:
        "Map current PAPER execution realism and identify the next production-relevant gap without creating orders.",

      executionLayer,
      evaluationLayer,
      persistenceLayer,

      gaps,

      gapCount:
        gaps.length,

      priorityNextGate:
        priority,

      files:
        compactFiles,

      interpretation: {
        existingExecutionRealism:
          executionLayer.executionPrice &&
          executionLayer.slippage &&
          executionLayer.spread,

        costAccountingReady:
          executionLayer.fees &&
          executionLayer.tax &&
          persistenceLayer.fees &&
          persistenceLayer.tax &&
          evaluationLayer.fees &&
          evaluationLayer.tax &&
          evaluationLayer.netPnl,

        paperEvidenceReadyForNetPerformance:
          executionLayer.executionPrice &&
          executionLayer.slippage &&
          persistenceLayer.executionPrice &&
          evaluationLayer.netPnl &&
          evaluationLayer.fees &&
          evaluationLayer.tax,
      },

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

      nextAction:
        priority,
    },
    null,
    2,
  ),
);

process.exitCode = 0;
