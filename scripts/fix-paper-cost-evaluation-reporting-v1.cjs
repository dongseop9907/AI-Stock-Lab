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
    "paper-cost-evaluation-reporting-v1",
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_PATCH_FAILED",
        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

function load(rel) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    throw new Error(
      `FILE_NOT_FOUND:${rel}`,
    );
  }

  return {
    rel,
    abs,
    text:
      fs.readFileSync(
        abs,
        "utf8",
      ),
  };
}

function backup(file) {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive: true,
    },
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

function replaceOnce(
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
    text.slice(
      0,
      first,
    ) +
    replacement +
    text.slice(
      first + search.length,
    )
  );
}

function replaceRegexAll(
  text,
  regex,
  replacement,
  minimum,
  label,
) {
  const matches =
    text.match(regex) ?? [];

  if (
    matches.length <
    minimum
  ) {
    throw new Error(
      `REGEX_MATCH_TOO_FEW:${label}:${matches.length}`,
    );
  }

  return text.replace(
    regex,
    replacement,
  );
}

function addImport(
  text,
) {
  const importLine =
    'import { createSupabaseServerClient } from "@/lib/supabase";';

  const costImport =
    `import {
  resolveCanonicalPaperTradePnl,
  resolveCanonicalPaperTradeReturn,
} from "@/lib/trading/paper-cost-attribution-view";`;

  if (
    text.includes(
      costImport,
    )
  ) {
    return text;
  }

  return replaceOnce(
    text,
    importLine,
    `${importLine}\n${costImport}`,
    "supabase_import",
  );
}

try {
  const daily =
    load(FILES.daily);

  const account =
    load(FILES.account);

  const history =
    load(FILES.history);

  const backups = {
    daily:
      backup(daily),
    account:
      backup(account),
    history:
      backup(history),
  };

  let dailyText =
    addImport(
      daily.text,
    );

  dailyText =
    replaceOnce(
      dailyText,
      `interface TradeRecord {
  realized_pnl:
    | number
    | string
    | null;

  realized_return:
    | number
    | string
    | null;

  closed_at: string;
}`,
      `interface TradeRecord {
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

  closed_at: string;
}`,
      "daily_trade_record",
    );

  dailyText =
    replaceOnce(
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
      "daily_trade_select",
    );

  dailyText =
    replaceRegexAll(
      dailyText,
      /toNumber\(\s*trade\.realized_pnl,\s*\)/g,
      "resolveCanonicalPaperTradePnl(trade).pnl",
      3,
      "daily_realized_pnl_consumers",
    );

  dailyText =
    replaceRegexAll(
      dailyText,
      /toNumber\(\s*trade\.realized_return,\s*\)/g,
      "resolveCanonicalPaperTradeReturn(trade).value",
      1,
      "daily_realized_return_consumers",
    );

  dailyText =
    replaceOnce(
      dailyText,
      `  const winRate =
    trades.length > 0`,
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

  const winRate =
    trades.length > 0`,
      "daily_cost_aggregates",
    );

  dailyText =
    replaceOnce(
      dailyText,
      `      realizedPnlDay,
      closedTrades:`,
      `      realizedPnlDay,
      grossPnlDay,
      transactionCostDay,
      netPnlDay:
        realizedPnlDay,
      costAttributedTrades,
      legacyFallbackTrades,

      closedTrades:`,
      "daily_summary_cost_fields",
    );

  let historyText =
    addImport(
      history.text,
    );

  historyText =
    replaceOnce(
      historyText,
      `  realized_pnl: number | string;
  realized_return: number | string;`,
      `  realized_pnl: number | string;
  realized_return: number | string;

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
      "history_trade_record",
    );

  historyText =
    replaceOnce(
      historyText,
      `  realizedPnl: number;
  realizedReturn: number;`,
      `  realizedPnl: number;
  realizedReturn: number;

  grossPnl: number;
  netPnl: number;
  transactionCost: number;

  pnlSource:
    | "NET_PNL_COST_ATTRIBUTED"
    | "LEGACY_REALIZED_PNL";

  costAttributionComplete: boolean;`,
      "history_dashboard_row",
    );

  historyText =
    replaceOnce(
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
      "history_trade_select",
    );

  historyText =
    replaceOnce(
      historyText,
      `        realizedPnl:
          toRequiredNumber(
            trade.realized_pnl,
          ),

        realizedReturn:
          toRequiredNumber(
            trade.realized_return,
          ),`,
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
      "history_row_mapping",
    );

  let accountText =
    addImport(
      account.text,
    );

  accountText =
    replaceOnce(
      accountText,
      `    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    totalReturn: number;`,
      `    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    totalReturn: number;

    grossRealizedPnl: number;
    transactionCosts: number;

    costAttributedTrades: number;
    legacyFallbackTrades: number;

    ledgerTotalPnl: number;
    costAccountingGap: number;`,
      "account_dashboard_interface",
    );

  accountText =
    replaceOnce(
      accountText,
      `const realizedPnl =
  getFirstNumber(
    account,
    [
      "realized_pnl",
      "total_realized_pnl",
    ],
  );`,
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
  (tradeCostData ??
    []) as Array<{
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
      "account_realized_pnl_source",
    );

  accountText =
    replaceOnce(
      accountText,
      `  const totalPnl =
    accountEquity -
    initialBalance;

  const totalReturn =`,
      `  const ledgerTotalPnl =
    accountEquity -
    initialBalance;

  const totalPnl =
    realizedPnl +
    unrealizedPnl;

  const costAccountingGap =
    ledgerTotalPnl -
    totalPnl;

  const totalReturn =`,
      "account_total_pnl_policy",
    );

  accountText =
    replaceOnce(
      accountText,
      `      realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalReturn,

      exposureRate,`,
      `      realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalReturn,

      grossRealizedPnl,
      transactionCosts,

      costAttributedTrades,
      legacyFallbackTrades,

      ledgerTotalPnl,
      costAccountingGap,

      exposureRate,`,
      "account_return_cost_fields",
    );

  fs.writeFileSync(
    daily.abs,
    dailyText,
    "utf8",
  );

  fs.writeFileSync(
    history.abs,
    historyText,
    "utf8",
  );

  fs.writeFileSync(
    account.abs,
    accountText,
    "utf8",
  );

  const checks = {
    dailyNetResolver:
      dailyText.includes(
        "resolveCanonicalPaperTradePnl",
      ) &&
      dailyText.includes(
        "net_pnl",
      ) &&
      dailyText.includes(
        "transactionCostDay",
      ),

    historyNetResolver:
      historyText.includes(
        "resolveCanonicalPaperTradePnl",
      ) &&
      historyText.includes(
        "pnlSource",
      ) &&
      historyText.includes(
        "transactionCost",
      ),

    accountNetResolver:
      accountText.includes(
        'from("paper_trade_history")',
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
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  if (
    failed.length >
    0
  ) {
    fail(
      "POST_PATCH_CHECK_FAILED",
      {
        checks,
        failed,
      },
    );

    return;
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_PATCHED",

        changedFiles:
          Object.values(
            FILES,
          ),

        backups,

        policy: {
          canonicalClosedTradePnl:
            "NET_PNL_IF_COMPLETE_ELSE_REALIZED_PNL",

          canonicalClosedTradeReturn:
            "NET_RETURN_IF_COMPLETE_ELSE_REALIZED_RETURN",

          dailyReport:
            "WIN_LOSS_AND_REALIZED_PNL_DAY_USE_CANONICAL_PNL",

          accountDashboard:
            "REALIZED_PNL_FROM_TRADE_HISTORY_CANONICAL_PNL",

          tradeHistoryDashboard:
            "LEGACY_REALIZED_FIELDS_NOW_SURFACE_CANONICAL_NET_VALUES",

          compatibility:
            "EXISTING FIELD NAMES PRESERVED",
        },

        checks,

        safety: {
          sourceFilesWritten:
            3,
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
          promotionExecuted:
            false,
          realTradingEnabled:
            false,
        },

        failed: [],

        nextGate:
          "RUN_CONTRACT_STATIC_AND_APP_TSC",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    0;
}
catch (error) {
  fail(
    "PATCH_EXCEPTION",
    {
      error:
        String(
          error instanceof
            Error
            ? error.message
            : error,
        ),
    },
  );
}
