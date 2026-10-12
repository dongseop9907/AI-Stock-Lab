const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011002400_paper_accounting_numeric_reconciliation_v1_reserved_risk_fixture_fix.sql"
);

const source =
  fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : "";

const checks = {
  migrationFound:
    Boolean(source),

  accountingTestRpcReplaced:
    /create or replace function\s+public\.run_paper_accounting_numeric_reconciliation_v1\s*\(\s*\)/i
      .test(source),

  reservedRiskFixtureIs10000:
    /reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*10000\.00\s*\);/i
      .test(source),

  productionBuyV2NotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order_with_execution_price_v2/i
      .test(source),

  productionBuyV5NotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order_with_execution_price_v5/i
      .test(source),

  productionSellV2NotReplaced:
    !/create or replace function\s+public\.execute_paper_protective_sell_v2/i
      .test(source),

  statusConstraintNotModified:
    !/alter table\s+public\.paper_order_requests[\s\S]{0,300}paper_order_requests_status_check/i
      .test(source),

  serviceRoleOnly:
    /revoke all on function[\s\S]*?from public, anon, authenticated;/i
      .test(source) &&
    /grant execute on function[\s\S]*?to service_role;/i
      .test(source),

  rollbackHarnessStillPresent:
    /ACCOUNTING_NUMERIC_RECON_V1_ROLLBACK_SENTINEL/i
      .test(source),

  cleanupAssertionsStillPresent:
    /persistentAccountRows/i.test(source) &&
    /persistentOrderRows/i.test(source) &&
    /persistentTradeRows/i.test(source),

  noShadowMutation:
    !/true_forward|forward_oos|shadow_session/i
      .test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_RESERVED_RISK_FIX_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_RESERVED_RISK_FIX_V1_VERIFY_FAILED",

  migration:
    "supabase/migrations/20261011002400_paper_accounting_numeric_reconciliation_v1_reserved_risk_fixture_fix.sql",

  correction: {
    previousReservedRisk:
      0,

    correctedReservedRisk:
      10000,

    derivation:
      "(10000 entry - 9000 stop) * 10 shares = 10000",

    expectedEffect:
      "Accounting fixture reaches canonical BUY execution instead of intentionally tripping ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK.",
  },

  checks,
  failed,

  deliberatelyNotChanged: {
    paperOrderStatusConstraint:
      true,

    failedStatusContract:
      true,

    productionBuyRpc:
      true,

    productionSellRpc:
      true,

    shadowForwardOos:
      true,

    realTrading:
      true,
  },

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    syntheticFixtureOnly: true,
    runtimeFixtureRollbackPreserved: true,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_02400_AND_RERUN_NUMERIC_RECON"
      : "REVIEW_RESERVED_RISK_FIX",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
