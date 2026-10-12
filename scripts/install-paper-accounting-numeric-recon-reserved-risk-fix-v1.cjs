const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SRC = path.join(
  MIG_DIR,
  "20261011002300_paper_accounting_numeric_reconciliation_v1.sql"
);

const OUT_NAME =
  "20261011002400_paper_accounting_numeric_reconciliation_v1_reserved_risk_fixture_fix.sql";

const OUT = path.join(MIG_DIR, OUT_NAME);

const VERIFY = path.join(
  ROOT,
  "scripts",
  "paper-accounting-numeric-reconciliation-v1-reserved-risk-fix-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_RESERVED_RISK_FIX_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(SRC)) {
  fail("SOURCE_02300_MIGRATION_NOT_FOUND", {
    expected:
      "supabase/migrations/20261011002300_paper_accounting_numeric_reconciliation_v1.sql",
  });
} else {
  const source = fs.readFileSync(SRC, "utf8");

  const fnStartNeedle =
    "create or replace function\n  public.run_paper_accounting_numeric_reconciliation_v1()";

  const start = source.indexOf(fnStartNeedle);

  if (start < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_DEFINITION_NOT_FOUND_IN_02300");
    return;
  }

  const endMarker = "\n$$;";
  const endPos = source.indexOf(endMarker, start);

  if (endPos < 0) {
    fail("ACCOUNTING_RECON_FUNCTION_END_NOT_FOUND_IN_02300");
    return;
  }

  const fnDef =
    source.slice(start, endPos + endMarker.length);

  const pattern =
    /(reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*)0(\s*\);)/m;

  if (!pattern.test(fnDef)) {
    fail("EXPECTED_ZERO_RESERVED_RISK_FIXTURE_PATTERN_NOT_FOUND");
    return;
  }

  const fixedFnDef =
    fnDef.replace(
      pattern,
      "$110000.00$2",
    );

  if (fixedFnDef === fnDef) {
    fail("FUNCTION_PATCH_PRODUCED_NO_CHANGE");
    return;
  }

  const migration = `-- AI Stock Lab
-- #5 PAPER Accounting Numeric Reconciliation V1
-- Reserved-risk fixture repair.
--
-- Scope:
--   TEST RPC ONLY.
--   The original 02300 synthetic fixture inserted reserved_risk_amount=0,
--   which intentionally triggered the production fill risk guard before
--   accounting assertions could run.
--
-- Correct fixture economics:
--   entry 10000, stop 9000, quantity 10
--   reserved risk = (10000 - 9000) * 10 = 10000
--
-- Production BUY/SELL RPCs, status constraint, SHADOW and live trading are
-- not modified by this migration.

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
  '#5 transaction-local synthetic PAPER numeric reconciliation. Reserved-risk fixture repaired to 10000 for 10 x (10000 entry - 9000 stop).';

commit;
`;

  if (fs.existsSync(OUT)) {
    const existing = fs.readFileSync(OUT, "utf8");

    if (existing !== migration) {
      fail("TARGET_02400_EXISTS_WITH_DIFFERENT_CONTENT", {
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
`;

  fs.writeFileSync(VERIFY, verifySource, "utf8");

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_RESERVED_RISK_FIX_V1_INSTALLED",

    generatedMigration:
      "supabase/migrations/" + OUT_NAME,

    generatedVerifier:
      "scripts/paper-accounting-numeric-reconciliation-v1-reserved-risk-fix-verify.cjs",

    correction: {
      fixtureReservedRiskBefore: 0,
      fixtureReservedRiskAfter: 10000,
      reason:
        "BUY V2 computes actual trade risk from execution price, stop price and fill quantity. The 0-risk fixture was invalid.",
    },

    separateLatentIssue: {
      status:
        "OPEN",

      issue:
        "Production BUY rejection path writes status=FAILED while deployed paper_order_requests_status_check does not allow FAILED.",

      modifiedByThisFix:
        false,
    },

    safety: {
      productionBuySellRpcsModified:
        false,
      statusConstraintModified:
        false,
      shadowFilesModified:
        false,
      realTradingEnabled:
        false,
      databaseWritesDuringInstall:
        0,
    },

    nextAction:
      "VERIFY_02400_THEN_DB_PUSH_AND_RERUN_NUMERIC_RECON",
  }, null, 2));
}
