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
    "paper-cost-evaluation-reporting-v1-v3",
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_V3_PATCH_FAILED",
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

function replaceLiteralOnce(
  text,
  search,
  replacement,
  label,
) {
  const index =
    text.indexOf(search);

  if (index < 0) {
    throw new Error(
      `ANCHOR_NOT_FOUND:${label}`,
    );
  }

  if (
    text.indexOf(
      search,
      index + search.length,
    ) >= 0
  ) {
    throw new Error(
      `ANCHOR_NOT_UNIQUE:${label}`,
    );
  }

  return (
    text.slice(0, index) +
    replacement +
    text.slice(index + search.length)
  );
}

function replaceRegexOnce(
  text,
  regex,
  replacement,
  label,
) {
  const flags =
    regex.flags.includes("g")
      ? regex.flags
      : regex.flags + "g";

  const globalRegex =
    new RegExp(
      regex.source,
      flags,
    );

  const matches =
    [...text.matchAll(globalRegex)];

  if (matches.length !== 1) {
    throw new Error(
      `REGEX_MATCH_COUNT:${label}:${matches.length}`,
    );
  }

  return text.replace(
    regex,
    replacement,
  );
}

function replaceRegexAtLeast(
  text,
  regex,
  replacement,
  minimum,
  label,
) {
  const flags =
    regex.flags.includes("g")
      ? regex.flags
      : regex.flags + "g";

  const globalRegex =
    new RegExp(
      regex.source,
      flags,
    );

  const matches =
    [...text.matchAll(globalRegex)];

  if (matches.length < minimum) {
    throw new Error(
      `REGEX_MATCH_TOO_FEW:${label}:${matches.length}`,
    );
  }

  return text.replace(
    globalRegex,
    replacement,
  );
}

function addPnlImport(
  text,
  label,
) {
  const importLine =
    `import { resolveCanonicalPaperTradePnl } from "@/lib/trading/paper-cost-attribution-view";`;

  if (text.includes(importLine)) {
    return text;
  }

  if (
    text.includes(
      "resolveCanonicalPaperTradeReturn",
    )
  ) {
    return text;
  }

  return replaceRegexOnce(
    text,
    /import\s*\{\s*createSupabaseServerClient\s*\}\s*from\s*"@\/lib\/supabase";/,
    match =>
      `${match}\n${importLine}`,
    `${label}_pnl_import`,
  );
}

function addPnlReturnImport(
  text,
  label,
) {
  const importBlock =
    `import {
  resolveCanonicalPaperTradePnl,
  resolveCanonicalPaperTradeReturn,
} from "@/lib/trading/paper-cost-attribution-view";`;

  if (
    text.includes(
      "resolveCanonicalPaperTradeReturn",
    ) &&
    text.includes(
      "@/lib/trading/paper-cost-attribution-view",
    )
  ) {
    return text;
  }

  return replaceRegexOnce(
    text,
    /import\s*\{\s*createSupabaseServerClient\s*\}\s*from\s*"@\/lib\/supabase";/,
    match =>
      `${match}\n${importBlock}`,
    `${label}_pnl_return_import`,
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
    daily: backup(daily),
    account: backup(account),
    history: backup(history),
  };

  /*
   * DAILY REPORT
   */
  let dailyText =
    addPnlImport(
      daily.text,
      "daily",
    );

  if (
    !dailyText.includes(
      "cost_attribution_complete:",
    )
  ) {
    dailyText =
      replaceLiteralOnce(
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
        "daily_trade_record_closed_at",
      );
  }

  if (
    !/realized_pnl,\s*realized_return,\s*gross_pnl,/m.test(
      dailyText,
    )
  ) {
    dailyText =
      replaceRegexOnce(
        dailyText,
        /realized_pnl,\s*realized_return,\s*closed_at/,
        `realized_pnl,
        realized_return,
        gross_pnl,
        net_pnl,
        net_return,
        total_transaction_cost,
        cost_attribution_complete,
        closed_at`,
        "daily_trade_select",
      );
  }

  dailyText =
    replaceRegexAtLeast(
      dailyText,
      /toNumber\(\s*trade\.realized_pnl\s*,?\s*\)/,
      "resolveCanonicalPaperTradePnl(trade).pnl",
      3,
      "daily_realized_pnl_consumers",
    );

  if (
    !dailyText.includes(
      "const grossPnlDay =",
    )
  ) {
    dailyText =
      replaceLiteralOnce(
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
        "daily_win_rate_anchor",
      );
  }

  if (
    !dailyText.includes(
      "grossPnlDay,",
    )
  ) {
    dailyText =
      replaceRegexOnce(
        dailyText,
        /(\s{6}realizedPnlDay,\s*\n)(\s{6}closedTrades:)/,
        `$1      grossPnlDay,
      transactionCostDay,
      netPnlDay:
        realizedPnlDay,
      costAttributedTrades,
      legacyFallbackTrades,

$2`,
        "daily_summary_cost_fields",
      );
  }

  /*
   * TRADE HISTORY DASHBOARD
   */
  let historyText =
    addPnlReturnImport(
      history.text,
      "history",
    );

  if (
    !historyText.includes(
      "cost_attribution_complete:",
    )
  ) {
    historyText =
      replaceLiteralOnce(
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
        "history_trade_record_cost_fields",
      );
  }

  if (
    !historyText.includes(
      "pnlSource:",
    )
  ) {
    historyText =
      replaceLiteralOnce(
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
        "history_dashboard_row_cost_fields",
      );
  }

  if (
    !/realized_pnl,\s*realized_return,\s*gross_pnl,/m.test(
      historyText,
    )
  ) {
    historyText =
      replaceRegexOnce(
        historyText,
        /realized_pnl,\s*realized_return,\s*exit_reason,/,
        `realized_pnl,
      realized_return,
      gross_pnl,
      net_pnl,
      net_return,
      total_transaction_cost,
      cost_attribution_complete,
      exit_reason,`,
        "history_trade_select",
      );
  }

  if (
    !/pnlSource:\s*resolveCanonicalPaperTradePnl\(/m.test(
      historyText,
    )
  ) {
    historyText =
      replaceRegexOnce(
        historyText,
        /realizedPnl:\s*toRequiredNumber\(\s*trade\.realized_pnl\s*,?\s*\),\s*realizedReturn:\s*toRequiredNumber\(\s*trade\.realized_return\s*,?\s*\),/,
        `realizedPnl:
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
  }

  /*
   * ACCOUNT DASHBOARD
   */
  let accountText =
    addPnlImport(
      account.text,
      "account",
    );

  if (
    !accountText.includes(
      "grossRealizedPnl: number;",
    )
  ) {
    accountText =
      replaceRegexOnce(
        accountText,
        /(\s{4}realizedPnl:\s*number;\s*\n\s{4}unrealizedPnl:\s*number;\s*\n\s{4}totalPnl:\s*number;\s*\n\s{4}totalReturn:\s*number;)/,
        `$1

    grossRealizedPnl: number;
    transactionCosts: number;

    costAttributedTrades: number;
    legacyFallbackTrades: number;

    ledgerTotalPnl: number;
    costAccountingGap: number;`,
        "account_dashboard_interface",
      );
  }

  if (
    !accountText.includes(
      "const tradeCostRows =",
    )
  ) {
    accountText =
      replaceRegexOnce(
        accountText,
        /const\s+realizedPnl\s*=\s*getFirstNumber\(\s*account,\s*\[\s*"realized_pnl",\s*"total_realized_pnl",\s*\],\s*\);/,
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
  }

  if (
    !accountText.includes(
      "const ledgerTotalPnl =",
    )
  ) {
    accountText =
      replaceRegexOnce(
        accountText,
        /const\s+totalPnl\s*=\s*accountEquity\s*-\s*initialBalance;\s*const\s+totalReturn\s*=/,
        `const ledgerTotalPnl =
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
  }

  if (
    !/grossRealizedPnl,\s*transactionCosts,/m.test(
      accountText,
    )
  ) {
    accountText =
      replaceRegexOnce(
        accountText,
        /(\s{6}realizedPnl,\s*\n\s{6}unrealizedPnl,\s*\n\s{6}totalPnl,\s*\n\s{6}totalReturn,)/,
        `$1

      grossRealizedPnl,
      transactionCosts,

      costAttributedTrades,
      legacyFallbackTrades,

      ledgerTotalPnl,
      costAccountingGap,`,
        "account_return_cost_fields",
      );
  }

  /*
   * MEMORY-ONLY GUARDS BEFORE WRITING
   */
  const checks = {
    dailyUsesPnlResolverOnly:
      dailyText.includes(
        'import { resolveCanonicalPaperTradePnl }',
      ) &&
      !dailyText.includes(
        "resolveCanonicalPaperTradeReturn",
      ),

    dailyNetFieldsSelected:
      dailyText.includes(
        "net_pnl",
      ) &&
      dailyText.includes(
        "total_transaction_cost",
      ) &&
      dailyText.includes(
        "cost_attribution_complete",
      ),

    dailyCanonicalConsumers:
      !/toNumber\(\s*trade\.realized_pnl\s*,?\s*\)/.test(
        dailyText,
      ) &&
      dailyText.includes(
        "transactionCostDay",
      ),

    historyUsesPnlAndReturnResolvers:
      historyText.includes(
        "resolveCanonicalPaperTradePnl",
      ) &&
      historyText.includes(
        "resolveCanonicalPaperTradeReturn",
      ) &&
      historyText.includes(
        "pnlSource",
      ),

    historyNoLegacyDirectMapping:
      !/realizedPnl:\s*toRequiredNumber\(\s*trade\.realized_pnl/m.test(
        historyText,
      ) &&
      !/realizedReturn:\s*toRequiredNumber\(\s*trade\.realized_return/m.test(
        historyText,
      ),

    accountUsesPnlResolverOnly:
      accountText.includes(
        'import { resolveCanonicalPaperTradePnl }',
      ) &&
      !accountText.includes(
        "resolveCanonicalPaperTradeReturn",
      ),

    accountUsesTradeHistory:
      accountText.includes(
        '.from("paper_trade_history")',
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

  if (failed.length > 0) {
    fail(
      "POST_PATCH_MEMORY_GUARD_FAILED",
      {
        checks,
        failed,
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
    history.abs,
    historyText,
    "utf8",
  );

  fs.writeFileSync(
    account.abs,
    accountText,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_V3_PATCHED",

        repair: {
          v2Failure:
            "REGEX_MATCH_TOO_FEW:daily_realized_return_consumers:0",

          verifiedReality:
            "Daily report does not consume trade.realized_return in calculations.",

          v3Policy:
            "Daily and Account use only canonical PnL resolver; Trade History uses canonical PnL + Return resolvers.",
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
          promotionExecuted: false,
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
