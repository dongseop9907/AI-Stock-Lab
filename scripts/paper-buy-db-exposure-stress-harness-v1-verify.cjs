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
              "_paper_buy_db_exposure_stress_harness_v1.sql",
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

  stressRpcPresent:
    /create or replace function public\.run_paper_buy_exposure_stress_commit_v1\s*\(/i
      .test(source),

  callsProductionExposureGuard:
    /perform public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  syntheticAccountPrefixRequired:
    /AI_STOCK_LAB_STRESS_%/
      .test(source) &&
    /STRESS_ACCOUNT_PREFIX_REQUIRED/
      .test(source),

  insertsSyntheticRiskDecision:
    /insert into public\.risk_decisions/i
      .test(source),

  insertsPendingBuy:
    /insert into public\.paper_order_requests/i
      .test(source) &&
    /'RISK_APPROVED'/i
      .test(source),

  pendingExposureVisibleBeforeCommit:
    /insert into public\.paper_order_requests[\s\S]*?if p_hold_ms > 0 then[\s\S]*?pg_sleep/i
      .test(source),

  boundedHold:
    /p_hold_ms > 500/i
      .test(source),

  serviceRoleGranted:
    /grant execute on function[\s\S]*?to service_role;/i
      .test(source),

  publicRevoked:
    /revoke all on function[\s\S]*?from public, anon, authenticated;/i
      .test(source),

  productionFunctionsNotReplaced:
    !/create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(/i
      .test(source) &&
    !/create or replace function public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\./i.test(source) &&
    !/\bdelete\s+from\s+public\./i.test(source),

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
          ? "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_STRESS_HARNESS_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_STRESS_HARNESS_V1_VERIFY_FAILED",

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
        migrationApplied:
          false,
        syntheticAccountOnly:
          true,
        serviceRoleOnly:
          true,
        realBrokerApiInvoked:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_EXPOSURE_STRESS_HARNESS"
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
