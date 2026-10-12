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
              "_paper_buy_v2_execution_risk_variable_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const target =
  files.length
    ? files[files.length - 1]
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

const checks = {
  migrationFound:
    Boolean(target),

  v2FunctionPresent:
    source.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
    ),

  declaredExecutionRisk:
    /\bv_execution_risk_amount\s+numeric\b/i.test(
      source,
    ),

  noBadActualTradeRiskReference:
    (() => {
      const fnStart =
        source.lastIndexOf(
          "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
        );

      if (fnStart < 0) {
        return false;
      }

      const bodyStart =
        source.indexOf(
          "as $$",
          fnStart,
        );

      if (bodyStart < 0) {
        return false;
      }

      const fnEnd =
        source.indexOf(
          "$$;",
          bodyStart + 5,
        );

      if (fnEnd < 0) {
        return false;
      }

      const fnBlock =
        source.slice(
          fnStart,
          fnEnd + 3,
        );

      return !/\bv_actual_trade_risk\b/.test(
        fnBlock,
      );
    })(),

  reservedRiskUsesExecutionRisk:
    /reserved_risk_amount[\s\S]{0,500}v_execution_risk_amount/i.test(
      source,
    ),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noTableDataRewrite:
    !/\bdelete\s+from\b|\btruncate\b/i.test(
      source,
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true,
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
          ? "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        historicalRowsRewritten:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN"
          : "REPAIR_GENERATED_MIGRATION_BEFORE_APPLY",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
