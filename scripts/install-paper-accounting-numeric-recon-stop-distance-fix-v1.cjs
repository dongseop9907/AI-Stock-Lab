const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SRC = path.join(
  MIG_DIR,
  "20261011002400_paper_accounting_numeric_reconciliation_v1_reserved_risk_fixture_fix.sql"
);

const OUT_NAME =
  "20261011002500_paper_accounting_numeric_reconciliation_v1_stop_distance_fixture_fix.sql";

const OUT = path.join(MIG_DIR, OUT_NAME);

const VERIFY = path.join(
  ROOT,
  "scripts",
  "paper-accounting-numeric-reconciliation-v1-stop-distance-fix-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_STOP_DISTANCE_FIX_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(SRC)) {
  fail("SOURCE_02400_MIGRATION_NOT_FOUND", {
    expected:
      "supabase/migrations/20261011002400_paper_accounting_numeric_reconciliation_v1_reserved_risk_fixture_fix.sql",
  });
} else {
  const source = fs.readFileSync(SRC, "utf8");

  const fnStartNeedle =
    "create or replace function\n  public.run_paper_accounting_numeric_reconciliation_v1()";

  const start = source.indexOf(fnStartNeedle);

  if (start < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_DEFINITION_NOT_FOUND_IN_02400");
    return;
  }

  const endMarker = "\n$$;";
  const endPos = source.indexOf(endMarker, start);

  if (endPos < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_END_NOT_FOUND_IN_02400");
    return;
  }

  const fnDef =
    source.slice(start, endPos + endMarker.length);

  let fixedFnDef = fnDef;

  fixedFnDef = fixedFnDef.replace(
    /v_stop_price numeric\(18,\s*2\)\s*:=\s*9000\.00;/,
    "v_stop_price numeric(18, 2) := 9700.00;"
  );

  fixedFnDef = fixedFnDef.replace(
    /(reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*)10000\.00(\s*\);)/m,
    "$13000.00$2"
  );

  if (fixedFnDef === fnDef) {
    fail("STOP_DISTANCE_FIX_PRODUCED_NO_CHANGE");
    return;
  }

  if (!/v_stop_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/.test(fixedFnDef)) {
    fail("STOP_PRICE_9700_PATCH_NOT_APPLIED");
    return;
  }

  if (!/(reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*)3000\.00(\s*\);)/m.test(fixedFnDef)) {
    fail("RESERVED_RISK_3000_PATCH_NOT_APPLIED");
    return;
  }

  const migration = `-- AI Stock Lab
-- #5 PAPER Accounting Numeric Reconciliation V1
-- Stop-distance fixture repair.
--
-- The previous fixture used entry=10000 and stop=9000 (10% stop distance),
-- which correctly tripped the production BUY V2 execution guard:
--   STOP_DISTANCE_TOO_FAR_AT_EXECUTION
--
-- Correct synthetic fixture:
--   entry 10000
--   stop  9700
--   qty   10
--   stop distance = 3%
--   reserved risk = (10000 - 9700) * 10 = 3000
--
-- This migration replaces TEST RPC only.
-- Production trading RPCs and status constraints are not modified.

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
  '#5 transaction-local synthetic PAPER numeric reconciliation. Fixture uses entry 10000, stop 9700 (3% distance), qty 10 and reserved risk 3000.';

commit;
`;

  if (fs.existsSync(OUT)) {
    const existing = fs.readFileSync(OUT, "utf8");
    if (existing !== migration) {
      fail("TARGET_02500_EXISTS_WITH_DIFFERENT_CONTENT", {
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
`;

  fs.writeFileSync(VERIFY, verifySource, "utf8");

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_STOP_DISTANCE_FIX_V1_INSTALLED",

    generatedMigration:
      "supabase/migrations/" + OUT_NAME,

    generatedVerifier:
      "scripts/paper-accounting-numeric-reconciliation-v1-stop-distance-fix-verify.cjs",

    correction: {
      entryPrice: 10000,
      stopPriceBefore: 9000,
      stopPriceAfter: 9700,
      stopDistanceBefore: "10%",
      stopDistanceAfter: "3%",
      reservedRiskBefore: 10000,
      reservedRiskAfter: 3000,
      reason:
        "BUY V2 blocks execution when execution stop distance exceeds 5%.",
    },

    separateLatentIssue: {
      status: "OPEN",
      issue:
        "BUY rejection path writes FAILED, while deployed status constraint does not allow FAILED.",
      modifiedByThisFix:
        false,
    },

    safety: {
      productionBuySellRpcsModified: false,
      statusConstraintModified: false,
      shadowFilesModified: false,
      realTradingEnabled: false,
      databaseWritesDuringInstall: 0,
    },

    nextAction:
      "VERIFY_02500_THEN_DB_PUSH_AND_RERUN_NUMERIC_RECON",
  }, null, 2));
}
