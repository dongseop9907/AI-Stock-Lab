const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SRC = path.join(
  MIG_DIR,
  "20261011002500_paper_accounting_numeric_reconciliation_v1_stop_distance_fixture_fix.sql"
);

const OUT_NAME =
  "20261011002600_paper_accounting_numeric_reconciliation_v1_protective_exit_fixture_fix.sql";

const OUT = path.join(MIG_DIR, OUT_NAME);

const VERIFY = path.join(
  ROOT,
  "scripts",
  "paper-accounting-numeric-reconciliation-v1-protective-exit-fix-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(SRC)) {
  fail("SOURCE_02500_MIGRATION_NOT_FOUND", {
    expected:
      "supabase/migrations/20261011002500_paper_accounting_numeric_reconciliation_v1_stop_distance_fixture_fix.sql",
  });
} else {
  const source = fs.readFileSync(SRC, "utf8");

  const fnStartNeedle =
    "create or replace function\n  public.run_paper_accounting_numeric_reconciliation_v1()";

  const start = source.indexOf(fnStartNeedle);

  if (start < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_DEFINITION_NOT_FOUND_IN_02500");
    return;
  }

  const endMarker = "\n$$;";
  const endPos = source.indexOf(endMarker, start);

  if (endPos < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_END_NOT_FOUND_IN_02500");
    return;
  }

  const fnDef =
    source.slice(start, endPos + endMarker.length);

  const exitPattern =
    /v_exit_price numeric\(18,\s*2\)\s*:=\s*10100\.00;/;

  if (!exitPattern.test(fnDef)) {
    fail("EXPECTED_EXIT_PRICE_10100_PATTERN_NOT_FOUND");
    return;
  }

  const fixedFnDef =
    fnDef.replace(
      exitPattern,
      "v_exit_price numeric(18, 2) := 9700.00;"
    );

  const migration = `-- AI Stock Lab
-- #5 PAPER Accounting Numeric Reconciliation V1
-- Protective-exit fixture repair.
--
-- Previous fixture:
--   entry = 10000
--   stop  = 9700
--   exit  = 10100
--
-- Protective SELL correctly rejected it because:
--   exit_price > current_stop_price
--   -> STOP_NOT_TRIGGERED
--
-- Correct canonical stop-loss fixture:
--   entry = 10000
--   stop  = 9700
--   exit  = 9700
--   qty   = 10
--   BUY fee = 4.14
--   SELL fee = 5
--   SELL tax = 10
--
-- Expected economics:
--   entry notional = 100000
--   BUY cash after = 1899995.86
--   exit notional = 97000
--   SELL-side cost = 15
--   gross PnL = -3000
--   account realized PnL = -3015
--   full round-trip cost = 19.14
--   trade net PnL = -3019.14
--   final cash = 1996980.86
--   trade cost - protective fill cost = 4.14 BUY entry fee
--
-- TEST RPC ONLY.
-- Production BUY/SELL RPCs, status constraint, SHADOW and live trading are
-- not modified.

begin;

${fixedFnDef}

revoke all on function
  public.run_paper_accounting_numeric_reconciliation_v1()
from public, anon, authenticated;

grant execute on function
  public.run_paper_accounting_numeric_reconciliation_v1()
to service_role;

comment on function
  public.run_paper_accounting_numeric_reconciliation_v1()
is
  '#5 transaction-local synthetic PAPER accounting reconciliation using canonical stop-loss exit at 9700.';

commit;
`;

  if (fs.existsSync(OUT)) {
    const existing = fs.readFileSync(OUT, "utf8");

    if (existing !== migration) {
      fail("TARGET_02600_EXISTS_WITH_DIFFERENT_CONTENT", {
        target:
          "supabase/migrations/" + OUT_NAME,
      });
      return;
    }
  } else {
    fs.writeFileSync(OUT, migration, "utf8");
  }

  const verifySource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const target = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011002600_paper_accounting_numeric_reconciliation_v1_protective_exit_fixture_fix.sql"
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

  entryPrice10000:
    /v_entry_price numeric\(18,\s*2\)\s*:=\s*10000\.00;/i
      .test(source),

  stopPrice9700:
    /v_stop_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/i
      .test(source),

  exitPrice9700:
    /v_exit_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/i
      .test(source),

  reservedRisk3000:
    /reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*3000\.00\s*\);/i
      .test(source),

  callsCanonicalBuyV2:
    /execute_paper_buy_order_with_execution_price_v2/i
      .test(source),

  callsCanonicalSellV2:
    /execute_paper_protective_sell_v2/i
      .test(source),

  protectiveStopPath:
    /p_exit_reason\s*=>\s*'STOP_LOSS'/i
      .test(source),

  expectedNegativeEconomicsDocumented:
    /gross PnL = -3000/i.test(source) &&
    /account realized PnL = -3015/i.test(source) &&
    /trade net PnL = -3019\.14/i.test(source) &&
    /final cash = 1996980\.86/i.test(source),

  roundTripDifferenceStill414:
    /trade cost - protective fill cost = 4\.14/i
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

  rollbackHarnessStillPresent:
    /ACCOUNTING_NUMERIC_RECON_V1_ROLLBACK_SENTINEL/i
      .test(source),

  cleanupAssertionsStillPresent:
    /persistentAccountRows/i.test(source) &&
    /persistentOrderRows/i.test(source) &&
    /persistentTradeRows/i.test(source) &&
    /persistentFillRows/i.test(source),

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
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_VERIFY_FAILED",

  migration:
    "supabase/migrations/20261011002600_paper_accounting_numeric_reconciliation_v1_protective_exit_fixture_fix.sql",

  correction: {
    entryPrice: 10000,
    stopPrice: 9700,
    previousExitPrice: 10100,
    correctedExitPrice: 9700,
    reason:
      "Protective SELL only executes when exit price is at or below current stop.",
  },

  expectedEconomics: {
    initialCash: 2000000,
    entryNotional: 100000,
    buyFee: 4.14,
    cashAfterBuy: 1899995.86,
    exitNotional: 97000,
    sellFee: 5,
    sellTax: 10,
    protectiveFillCost: 15,
    grossPnl: -3000,
    accountRealizedPnl: -3015,
    tradeHistoryRoundTripCost: 19.14,
    tradeHistoryNetPnl: -3019.14,
    finalCash: 1996980.86,
    tradeMinusFillCost: 4.14,
  },

  checks,
  failed,

  latentStatusIssueStillOpen: {
    buyBlockPathWritesFailed: true,
    deployedConstraintAllowsFailed: false,
    modifiedByThisFix: false,
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
      ? "DB_PUSH_02600_AND_RERUN_NUMERIC_RECON"
      : "REVIEW_PROTECTIVE_EXIT_FIX",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

  fs.writeFileSync(VERIFY, verifySource, "utf8");

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_INSTALLED",

    generatedMigration:
      "supabase/migrations/" + OUT_NAME,

    generatedVerifier:
      "scripts/paper-accounting-numeric-reconciliation-v1-protective-exit-fix-verify.cjs",

    correction: {
      previousExitPrice: 10100,
      correctedExitPrice: 9700,
      stopPrice: 9700,
      reason:
        "Use the canonical STOP_LOSS trigger instead of attempting a protective sell above the stop.",
    },

    expectedEconomics: {
      buyCash: 1899995.86,
      protectiveCost: 15,
      grossPnl: -3000,
      accountPnl: -3015,
      tradeTotalCost: 19.14,
      tradeNetPnl: -3019.14,
      finalCash: 1996980.86,
      costDifference: 4.14,
    },

    safety: {
      productionBuySellRpcsModified: false,
      statusConstraintModified: false,
      shadowFilesModified: false,
      realTradingEnabled: false,
      databaseWritesDuringInstall: 0,
    },

    nextAction:
      "VERIFY_02600_THEN_DB_PUSH_AND_RERUN_NUMERIC_RECON",
  }, null, 2));
}
