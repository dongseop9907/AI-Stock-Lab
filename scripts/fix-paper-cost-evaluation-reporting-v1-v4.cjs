const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  daily:
    "lib/trading/generate-daily-performance-report.ts",
  account:
    "lib/trading/get-paper-account-dashboard.ts",
  history:
    "lib/trading/get-trade-history-dashboard.ts",
};

const BACKUP_DIR =
  path.join(
    ROOT,
    "scripts",
    "backups",
    "paper-cost-evaluation-reporting-v1-v4",
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_V4_PATCH_FAILED",
        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

function read(rel) {
  const abs = path.join(ROOT, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(`FILE_NOT_FOUND:${rel}`);
  }

  return {
    rel,
    abs,
    text: fs.readFileSync(abs, "utf8"),
  };
}

function backup(file) {
  fs.mkdirSync(
    BACKUP_DIR,
    { recursive: true },
  );

  const target =
    path.join(
      BACKUP_DIR,
      file.rel
        .replaceAll("/", "__")
        .replaceAll("\\", "__"),
    );

  if (!fs.existsSync(target)) {
    fs.copyFileSync(
      file.abs,
      target,
    );
  }

  return target;
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceOnceLiteral(
  text,
  search,
  replacement,
  label,
) {
  const first =
    text.indexOf(search);

  if (first < 0) {
    throw new Error(
      `ANCHOR_NOT_FOUND:${label}`,
    );
  }

  const second =
    text.indexOf(
      search,
      first + search.length,
    );

  if (second >= 0) {
    throw new Error(
      `ANCHOR_NOT_UNIQUE:${label}`,
    );
  }

  return (
    text.slice(0, first) +
    replacement +
    text.slice(first + search.length)
  );
}

function ensurePnlImport(text) {
  const single =
    `import { resolveCanonicalPaperTradePnl } from "@/lib/trading/paper-cost-attribution-view";`;

  const combined =
    `import {
  resolveCanonicalPaperTradePnl,
  resolveCanonicalPaperTradeReturn,
} from "@/lib/trading/paper-cost-attribution-view";`;

  if (
    text.includes(single) ||
    text.includes(combined)
  ) {
    return text;
  }

  const anchor =
    `import { createSupabaseServerClient } from "@/lib/supabase";`;

  return replaceOnceLiteral(
    text,
    anchor,
    `${anchor}\n${single}`,
    "pnl_import",
  );
}

function ensurePnlReturnImport(text) {
  const single =
    `import { resolveCanonicalPaperTradePnl } from "@/lib/trading/paper-cost-attribution-view";`;

  const combined =
    `import {
  resolveCanonicalPaperTradePnl,
  resolveCanonicalPaperTradeReturn,
} from "@/lib/trading/paper-cost-attribution-view";`;

  if (text.includes(combined)) {
    return text;
  }

  if (text.includes(single)) {
    return text.replace(
      single,
      combined,
    );
  }

  const anchor =
    `import { createSupabaseServerClient } from "@/lib/supabase";`;

  return replaceOnceLiteral(
    text,
    anchor,
    `${anchor}\n${combined}`,
    "pnl_return_import",
  );
}

try {
  const daily = read(FILES.daily);
  const account = read(FILES.account);
  const history = read(FILES.history);

  const backups = {
    daily: backup(daily),
    account: backup(account),
    history: backup(history),
  };

  let dailyText =
    ensurePnlImport(
      daily.text,
    );

  let accountText =
    ensurePnlImport(
      account.text,
    );

  let historyText =
    ensurePnlReturnImport(
      history.text,
    );

  /*
   * DAILY: schema/type/select fields
   */
  if (
    !dailyText.includes(
      "cost_attribution_complete:",
    )
  ) {
    dailyText =
      replaceOnceLiteral(
        dailyText,
        "  closed_at: string;",
        `  gross_pnl:
    | number
    | string
    | null;

  net_pnl:
    | number
    | string
    | null;

  net_return:
    | number
    | string
    | null;

  total_transaction_cost:
    | number
    | string
    | null;

  cost_attribution_complete:
    | boolean
    | null;

  closed_at: string;`,
        "daily_trade_cost_fields",
      );
  }

  if (
    !dailyText.includes(
      "        gross_pnl,",
    )
  ) {
    dailyText =
      replaceOnceLiteral(
        dailyText,
        `        realized_pnl,
        realized_return,
        closed_at`,
        `        realized_pnl,
        realized_return,
        gross_pnl,
        net_pnl,
        net_return,
        total_transaction_cost,
        cost_attribution_complete,
        closed_at`,
        "daily_select_cost_fields",
      );
  }

  /*
   * DAILY: replace only the raw field token.
   * This works whether it is wrapped in toNumber(...) or not.
   */
  const dailyLegacyBefore =
    count(
      dailyText,
      "trade.realized_pnl",
    );

  const dailyCanonicalBefore =
    count(
      dailyText,
      "resolveCanonicalPaperTradePnl(trade).pnl",
    );

  if (
    dailyLegacyBefore >
    0
  ) {
    dailyText =
      dailyText.replaceAll(
        "trade.realized_pnl",
        "resolveCanonicalPaperTradePnl(trade).pnl",
      );
  }
  else if (
    dailyCanonicalBefore ===
    0
  ) {
    throw new Error(
      "DAILY_PNL_CONSUMER_STATE_INCONCLUSIVE",
    );
  }

  if (
    !dailyText.includes(
      "const grossPnlDay =",
    )
  ) {
    dailyText =
      replaceOnceLiteral(
        dailyText,
        "  const winRate =",
        `  const grossPnlDay =
    trades.reduce(
      (sum, trade) =>
        sum +
        resolveCanonicalPaperTradePnl(
          trade,
        ).grossPnl,
      0,
    );

  const transactionCostDay =
    trades.reduce(
      (sum, trade) =>
        sum +
        resolveCanonicalPaperTradePnl(
          trade,
        ).totalTransactionCost,
      0,
    );

  const costAttributedTrades =
    trades.filter(
      trade =>
        resolveCanonicalPaperTradePnl(
          trade,
        ).costAttributionComplete,
    ).length;

  const legacyFallbackTrades =
    trades.length -
    costAttributedTrades;

  const winRate =`,
        "daily_cost_aggregate_anchor",
      );
  }

  if (
    !dailyText.includes(
      "netPnlDay:",
    )
  ) {
    dailyText =
      dailyText.replace(
        /(\s+realizedPnlDay,\s*\n)(\s+closedTrades:)/,
        `$1      grossPnlDay,
      transactionCostDay,
      netPnlDay:
        realizedPnlDay,
      costAttributedTrades,
      legacyFallbackTrades,

$2`,
      );
  }

  /*
   * HISTORY: type/select/output
   */
  if (
    !historyText.includes(
      "cost_attribution_complete:",
    )
  ) {
    historyText =
      replaceOnceLiteral(
        historyText,
        "  realized_return: number | string;",
        `  realized_return: number | string;

  gross_pnl:
    | number
    | string
    | null;

  net_pnl:
    | number
    | string
    | null;

  net_return:
    | number
    | string
    | null;

  total_transaction_cost:
    | number
    | string
    | null;

  cost_attribution_complete:
    | boolean
    | null;`,
        "history_trade_cost_fields",
      );
  }

  if (
    !historyText.includes(
      "  pnlSource:",
    )
  ) {
    historyText =
      replaceOnceLiteral(
        historyText,
        "  realizedReturn: number;",
        `  realizedReturn: number;

  grossPnl: number;
  netPnl: number;
  transactionCost: number;

  pnlSource:
    | "NET_PNL_COST_ATTRIBUTED"
    | "LEGACY_REALIZED_PNL";

  costAttributionComplete: boolean;`,
        "history_row_cost_fields",
      );
  }

  if (
    !historyText.includes(
      "      gross_pnl,",
    )
  ) {
    historyText =
      replaceOnceLiteral(
        historyText,
        `      realized_pnl,
      realized_return,
      exit_reason,`,
        `      realized_pnl,
      realized_return,
      gross_pnl,
      net_pnl,
      net_return,
      total_transaction_cost,
      cost_attribution_complete,
      exit_reason,`,
        "history_select_cost_fields",
      );
  }

  const historyPnlSourceMapped =
    historyText.includes(
      "pnlSource:\n          resolveCanonicalPaperTradePnl(",
    );

  if (!historyPnlSourceMapped) {
    const oldBlock =
      `        realizedPnl:
          toRequiredNumber(
            trade.realized_pnl,
          ),

        realizedReturn:
          toRequiredNumber(
            trade.realized_return,
          ),`;

    if (
      historyText.includes(
        oldBlock,
      )
    ) {
      historyText =
        historyText.replace(
          oldBlock,
          `        realizedPnl:
          resolveCanonicalPaperTradePnl(
            trade,
          ).pnl,

        realizedReturn:
          resolveCanonicalPaperTradeReturn(
            trade,
          ).value,

        grossPnl:
          resolveCanonicalPaperTradePnl(
            trade,
          ).grossPnl,

        netPnl:
          resolveCanonicalPaperTradePnl(
            trade,
          ).pnl,

        transactionCost:
          resolveCanonicalPaperTradePnl(
            trade,
          ).totalTransactionCost,

        pnlSource:
          resolveCanonicalPaperTradePnl(
            trade,
          ).source,

        costAttributionComplete:
          resolveCanonicalPaperTradePnl(
            trade,
          ).costAttributionComplete,`,
        );
    }
    else {
      throw new Error(
        "HISTORY_ROW_MAPPING_STATE_INCONCLUSIVE",
      );
    }
  }

  /*
   * ACCOUNT: canonical realized PnL from trade history
   */
  if (
    !accountText.includes(
      "grossRealizedPnl: number;",
    )
  ) {
    accountText =
      accountText.replace(
        /(\s+realizedPnl:\s*number;\s*\n\s+unrealizedPnl:\s*number;\s*\n\s+totalPnl:\s*number;\s*\n\s+totalReturn:\s*number;)/,
        `$1

    grossRealizedPnl: number;
    transactionCosts: number;

    costAttributedTrades: number;
    legacyFallbackTrades: number;

    ledgerTotalPnl: number;
    costAccountingGap: number;`,
      );
  }

  if (
    !accountText.includes(
      "const tradeCostRows =",
    )
  ) {
    const oldAccountPnl =
      `const realizedPnl =
  getFirstNumber(
    account,
    [
      "realized_pnl",
      "total_realized_pnl",
    ],
  );`;

    if (
      !accountText.includes(
        oldAccountPnl,
      )
    ) {
      throw new Error(
        "ACCOUNT_REALIZED_PNL_STATE_INCONCLUSIVE",
      );
    }

    accountText =
      accountText.replace(
        oldAccountPnl,
        `const {
  data: tradeCostData,
  error: tradeCostError,
} = await supabase
  .from("paper_trade_history")
  .select(\`
    realized_pnl,
    realized_return,
    gross_pnl,
    net_pnl,
    net_return,
    total_transaction_cost,
    cost_attribution_complete
  \`)
  .eq(
    "account_id",
    account.id,
  )
  .limit(10000);

if (tradeCostError) {
  throw new Error(
    \`PAPER_TRADE_COST_HISTORY_QUERY_FAILED: \${tradeCostError.message}\`,
  );
}

const tradeCostRows =
  (tradeCostData ?? []) as Array<{
    realized_pnl:
      | number
      | string
      | null;

    realized_return:
      | number
      | string
      | null;

    gross_pnl:
      | number
      | string
      | null;

    net_pnl:
      | number
      | string
      | null;

    net_return:
      | number
      | string
      | null;

    total_transaction_cost:
      | number
      | string
      | null;

    cost_attribution_complete:
      | boolean
      | null;
  }>;

const realizedPnl =
  tradeCostRows.reduce(
    (sum, trade) =>
      sum +
      resolveCanonicalPaperTradePnl(
        trade,
      ).pnl,
    0,
  );

const grossRealizedPnl =
  tradeCostRows.reduce(
    (sum, trade) =>
      sum +
      resolveCanonicalPaperTradePnl(
        trade,
      ).grossPnl,
    0,
  );

const transactionCosts =
  tradeCostRows.reduce(
    (sum, trade) =>
      sum +
      resolveCanonicalPaperTradePnl(
        trade,
      ).totalTransactionCost,
    0,
  );

const costAttributedTrades =
  tradeCostRows.filter(
    trade =>
      resolveCanonicalPaperTradePnl(
        trade,
      ).costAttributionComplete,
  ).length;

const legacyFallbackTrades =
  tradeCostRows.length -
  costAttributedTrades;`,
      );
  }

  if (
    !accountText.includes(
      "const ledgerTotalPnl =",
    )
  ) {
    accountText =
      accountText.replace(
        /const\s+totalPnl\s*=\s*accountEquity\s*-\s*initialBalance;/,
        `const ledgerTotalPnl =
    accountEquity -
    initialBalance;

  const totalPnl =
    realizedPnl +
    unrealizedPnl;

  const costAccountingGap =
    ledgerTotalPnl -
    totalPnl;`,
      );
  }

  if (
    !accountText.includes(
      "      grossRealizedPnl,",
    )
  ) {
    accountText =
      accountText.replace(
        /(\s+realizedPnl,\s*\n\s+unrealizedPnl,\s*\n\s+totalPnl,\s*\n\s+totalReturn,)/,
        `$1

      grossRealizedPnl,
      transactionCosts,

      costAttributedTrades,
      legacyFallbackTrades,

      ledgerTotalPnl,
      costAccountingGap,`,
      );
  }

  /*
   * FINAL IDEMPOTENT GUARDS
   */
  const checks = {
    dailyNoRawLegacyPnlToken:
      !dailyText.includes(
        "trade.realized_pnl",
      ),

    dailyCanonicalPnlPresent:
      count(
        dailyText,
        "resolveCanonicalPaperTradePnl",
      ) >= 4,

    dailyCostSummaryPresent:
      dailyText.includes(
        "grossPnlDay",
      ) &&
      dailyText.includes(
        "transactionCostDay",
      ) &&
      dailyText.includes(
        "costAttributedTrades",
      ),

    historyCanonicalPnlMapped:
      historyText.includes(
        "pnlSource:",
      ) &&
      historyText.includes(
        "resolveCanonicalPaperTradeReturn",
      ) &&
      historyText.includes(
        "transactionCost:",
      ),

    accountCanonicalHistoryPnl:
      accountText.includes(
        "const tradeCostRows =",
      ) &&
      accountText.includes(
        "grossRealizedPnl",
      ) &&
      accountText.includes(
        "costAccountingGap",
      ),

    noRealTradingEnable:
      !dailyText.includes(
        "REAL_TRADING_ENABLED=true",
      ) &&
      !historyText.includes(
        "REAL_TRADING_ENABLED=true",
      ) &&
      !accountText.includes(
        "REAL_TRADING_ENABLED=true",
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  if (failed.length > 0) {
    fail(
      "POST_PATCH_GUARD_FAILED",
      {
        checks,
        failed,
        diagnostics: {
          dailyLegacyBefore,
          dailyCanonicalBefore,
          dailyCanonicalAfter:
            count(
              dailyText,
              "resolveCanonicalPaperTradePnl",
            ),
        },
      },
    );
    return;
  }

  fs.writeFileSync(
    daily.abs,
    dailyText,
    "utf8",
  );

  fs.writeFileSync(
    account.abs,
    accountText,
    "utf8",
  );

  fs.writeFileSync(
    history.abs,
    historyText,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_V4_PATCHED",

        mode:
          "IDEMPOTENT_STATE_AWARE_REPAIR",

        diagnostics: {
          dailyLegacyBefore,
          dailyCanonicalBefore,
          dailyCanonicalAfter:
            count(
              dailyText,
              "resolveCanonicalPaperTradePnl",
            ),
        },

        changedFiles:
          Object.values(FILES),

        backups,

        checks,

        safety: {
          sourceFilesWritten: 3,
          databaseReads: 0,
          databaseWrites: 0,
          ordersCreated: 0,
          ordersExecuted: 0,
          positionsChanged: 0,
          realTradingEnabled: false,
        },

        failed: [],

        nextGate:
          "RUN_CONTRACT_STATIC_AND_APP_TSC",
      },
      null,
      2,
    ),
  );

  process.exitCode = 0;
}
catch (error) {
  fail(
    "PATCH_EXCEPTION",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    },
  );
}
