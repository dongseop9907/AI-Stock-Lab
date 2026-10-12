const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const files =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter(
          (name) =>
            name.endsWith(
              "_paper_sell_v2_remaining_cash_net_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const target =
  files.length
    ? files[
        files.length - 1
      ]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(
          MIG_DIR,
          target,
        ),
        "utf8",
      )
    : "";

const fnStart =
  source.lastIndexOf(
    "create or replace function public.execute_paper_protective_sell_v2(",
  );

const bodyStart =
  fnStart >= 0
    ? source.indexOf(
        "as $$",
        fnStart,
      )
    : -1;

const fnEnd =
  bodyStart >= 0
    ? source.indexOf(
        "$$;",
        bodyStart + 5,
      )
    : -1;

const fnBlock =
  (
    fnStart >= 0 &&
    bodyStart >= 0 &&
    fnEnd >= 0
  )
    ? source.slice(
        fnStart,
        fnEnd + 3,
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  sellV2FunctionPresent:
    fnBlock.includes(
      "create or replace function public.execute_paper_protective_sell_v2(",
    ),

  totalTransactionCostDefined:
    /v_total_transaction_cost\s*:=\s*p_broker_fee\s*\+\s*p_sell_tax\s*;/m
      .test(fnBlock),

  accountCreditsGrossExit:
    /cash_balance\s*=\s*cash_balance\s*\+\s*v_exit_amount/m
      .test(fnBlock),

  accountDeductsTransactionCost:
    /cash_balance\s*=\s*cash_balance\s*-\s*v_total_transaction_cost/m
      .test(fnBlock),

  responseReturnsNetCash:
    /'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*-\s*v_total_transaction_cost\s*,/m
      .test(fnBlock),

  responseNoLongerReturnsGrossCash:
    !/'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*,/m
      .test(fnBlock),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\.paper_accounts\b[\s\S]{0,120}\bwhere\b[\s\S]{0,120}\bnot\b/i
      .test(
        source
          .replace(
            fnBlock,
            "",
          ),
      ),

  transactionWrapped:
    /\bbegin\s*;/i.test(
      source,
    ) &&
    /\bcommit\s*;/i.test(
      source,
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
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      expectedAccounting: {
        initialCash:
          1000000000,

        exitProceeds:
          8900,

        brokerFee:
          10,

        sellTax:
          5,

        expectedFinalCash:
          1000008885,
      },

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        migrationApplied:
          false,

        historicalRowsRewritten:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_SELL_REMAINING_CASH_FIX"
          : "REPAIR_SOURCE_BEFORE_DB_APPLY",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
