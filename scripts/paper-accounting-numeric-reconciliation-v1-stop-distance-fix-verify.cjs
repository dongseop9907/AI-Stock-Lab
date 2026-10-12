const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011002500_paper_accounting_numeric_reconciliation_v1_stop_distance_fixture_fix.sql"
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

  stopPriceIs9700:
    /v_stop_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/i
      .test(source),

  stopDistanceIs3Percent:
    /entry 10000[\s\S]*stop\s+9700[\s\S]*stop distance = 3%/i
      .test(source),

  reservedRiskIs3000:
    /reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*3000\.00\s*\);/i
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
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_STOP_DISTANCE_FIX_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_STOP_DISTANCE_FIX_V1_VERIFY_FAILED",

  migration:
    "supabase/migrations/20261011002500_paper_accounting_numeric_reconciliation_v1_stop_distance_fixture_fix.sql",

  correction: {
    entryPrice: 10000,
    previousStopPrice: 9000,
    correctedStopPrice: 9700,
    previousStopDistanceRate: 0.10,
    correctedStopDistanceRate: 0.03,
    previousReservedRisk: 10000,
    correctedReservedRisk: 3000,
    derivation:
      "(10000 - 9700) * 10 = 3000",
  },

  checks,
  failed,

  latentStatusIssueStillOpen: {
    buyBlockPathWritesFailed:
      true,
    deployedConstraintAllowsFailed:
      false,
    modifiedByThisFix:
      false,
  },

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    syntheticFixtureOnly: true,
    runtimeFixtureRollbackPreserved: true,
    productionTradingFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_02500_AND_RERUN_NUMERIC_RECON"
      : "REVIEW_STOP_DISTANCE_FIX",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
