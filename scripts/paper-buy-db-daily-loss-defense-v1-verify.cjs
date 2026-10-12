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
              "_paper_buy_db_daily_loss_defense_v1.sql",
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
        path.join(MIG_DIR, target),
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  helperFunctionPresent:
    /create or replace function public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i
      .test(source),

  dailyRealizedPnlRead:
    /daily_realized_pnl/i
      .test(source),

  accountRowLocked:
    /from public\.paper_accounts[\s\S]{0,180}for update;/i
      .test(source),

  defaultRateTwoPercent:
    /p_max_daily_loss_rate numeric default 0\.02/i
      .test(source),

  thresholdUsesEquity:
    /v_max_daily_loss_amount\s*:=\s*p_equity\s*\*\s*p_max_daily_loss_rate/i
      .test(source),

  failClosedError:
    /DAILY_LOSS_LIMIT_REACHED/i
      .test(source),

  createRpcSignaturePreserved:
    /create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(\s*p_account_id uuid,\s*p_stock_code text,\s*p_requested_quantity integer,\s*p_entry_price numeric,\s*p_stop_price numeric,\s*p_risk_decision_id uuid,\s*p_preflight_approved boolean,\s*p_equity numeric,\s*p_max_aggregate_open_risk_rate numeric default 0\.02\s*\)/mi
      .test(source),

  dailyLossGuardBound:
    /perform public\.assert_paper_buy_daily_loss_allowed_v1\s*\(\s*p_account_id,\s*p_equity\s*\);/mi
      .test(source),

  exposureGuardPreserved:
    /perform public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  freshnessGuardPreserved:
    /assert_paper_buy_data_freshness_allowed_v1/i
      .test(source),

  killSwitchGuardPreserved:
    /assert_paper_buy_new_risk_allowed_v1/i
      .test(source),

  historicalDataRewriteAbsent:
    !/\bupdate\s+public\.paper_accounts\b[\s\S]{0,120}\bdaily_realized_pnl\b/i
      .test(
        source.replace(
          /create or replace function[\s\S]*?\$\$;/gi,
          "",
        ),
      ),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      policy: {
        maxDailyLossRate:
          0.02,

        blockCondition:
          "daily_realized_pnl <= -(equity * 0.02)",

        concurrency:
          "paper_accounts row FOR UPDATE",
      },

      safety: {
        sourceOnly: true,
        databaseReads: 0,
        databaseWrites: 0,
        migrationApplied: false,
        historicalRowsRewritten: false,
        realTradingEnabled: false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_DAILY_LOSS_DEFENSE"
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
