const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const FILES = {
  helper:
    "lib/trading/paper-cost-attribution-view.ts",

  daily:
    "lib/trading/generate-daily-performance-report.ts",

  account:
    "lib/trading/get-paper-account-dashboard.ts",

  history:
    "lib/trading/get-trade-history-dashboard.ts",

  contract:
    "scripts/paper-cost-evaluation-reporting-v1-contract-test.ts",
};

function read(rel) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  return fs.existsSync(abs)
    ? fs.readFileSync(
        abs,
        "utf8",
      )
    : "";
}

const helper =
  read(FILES.helper);

const daily =
  read(FILES.daily);

const account =
  read(FILES.account);

const history =
  read(FILES.history);

const contract =
  read(FILES.contract);

const checks = {
  allFilesExist:
    Object.values(
      FILES,
    ).every(
      rel =>
        fs.existsSync(
          path.join(
            ROOT,
            rel,
          ),
        ),
    ),

  helperFailClosedPolicy:
    helper.includes(
      "NET_PNL_COST_ATTRIBUTED",
    ) &&
    helper.includes(
      "LEGACY_REALIZED_PNL",
    ) &&
    helper.includes(
      "cost_attribution_complete",
    ),

  dailySelectsCostFields:
    [
      "gross_pnl",
      "net_pnl",
      "net_return",
      "total_transaction_cost",
      "cost_attribution_complete",
    ].every(
      name =>
        daily.includes(
          name,
        ),
    ),

  dailyUsesCanonicalPnl:
    daily.includes(
      "resolveCanonicalPaperTradePnl",
    ) &&
    daily.includes(
      "grossPnlDay",
    ) &&
    daily.includes(
      "transactionCostDay",
    ),

  accountUsesTradeHistoryCanonicalPnl:
    account.includes(
      '.from("paper_trade_history")',
    ) &&
    account.includes(
      "resolveCanonicalPaperTradePnl",
    ) &&
    account.includes(
      "costAccountingGap",
    ),

  historySelectsCostFields:
    [
      "gross_pnl",
      "net_pnl",
      "net_return",
      "total_transaction_cost",
      "cost_attribution_complete",
    ].every(
      name =>
        history.includes(
          name,
        ),
    ),

  historyExposesCostDiagnostics:
    history.includes(
      "grossPnl",
    ) &&
    history.includes(
      "netPnl",
    ) &&
    history.includes(
      "transactionCost",
    ) &&
    history.includes(
      "pnlSource",
    ),

  legacyFieldNamesPreserved:
    daily.includes(
      "realizedPnlDay",
    ) &&
    account.includes(
      "realizedPnl",
    ) &&
    history.includes(
      "totalRealizedPnl",
    ),

  contractPresent:
    contract.includes(
      "attributedUsesNetPnl",
    ) &&
    contract.includes(
      "incompleteFailsClosedToLegacy",
    ),

  noDbWritesInContract:
    !contract.includes(
      ".insert(",
    ) &&
    !contract.includes(
      ".update(",
    ) &&
    !contract.includes(
      ".upsert(",
    ) &&
    !contract.includes(
      ".delete(",
    ),

  noRealTradingEnable:
    !helper.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !daily.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !account.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !history.includes(
      "REAL_TRADING_ENABLED=true",
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
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
          ? "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_STATIC_FAILED",

      checks,

      interpretation: {
        evaluation:
          "EXIT_QUALITY_LOGIC_UNCHANGED_BECAUSE_IT_EVALUATES_POST_EXIT_PRICE_PATH, NOT REALIZED_PNL",

        dailyReport:
          "COST_AWARE",

        accountDashboard:
          "COST_AWARE_REALIZED_PNL",

        tradeHistoryDashboard:
          "COST_AWARE_WITH_EXPLICIT_DIAGNOSTICS",

        legacyCompatibility:
          true,
      },

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length ===
          0
          ? "APP_TSC_AND_READ_ONLY_RUNTIME_VERIFY"
          : "REPAIR_COST_EVALUATION_REPORTING_V1",
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
