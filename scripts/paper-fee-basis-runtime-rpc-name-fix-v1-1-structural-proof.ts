import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000900_paper_fee_basis_runtime_rpc_name_fix_v1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
);

const migration =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const runner =
  fs.existsSync(runnerPath)
    ? fs.readFileSync(runnerPath, "utf8")
    : "";

const checks = {
  migrationExists:
    migration.length > 0,

  invalidAlterFunctionIfExistsRemoved:
    !/alter\\s+function\\s+if\\s+exists/i.test(migration),

  validAlterFunctionRenamePresent:
    /alter\\s+function\\s+public\\.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v\\s*\\(\\s*\\)\\s*rename\\s+to\\s+run_paper_fee_basis_rt_v1\\s*;/i.test(
      migration,
    ),

  runnerUsesShortRpc:
    runner.includes("/rpc/run_paper_fee_basis_rt_v1"),

  serviceRoleOnlyRetained:
    /revoke\\s+all[\\s\\S]{0,900}?from\\s+public/i.test(migration) &&
    /revoke\\s+all[\\s\\S]{0,1400}?from\\s+anon/i.test(migration) &&
    /revoke\\s+all[\\s\\S]{0,1800}?from\\s+authenticated/i.test(migration) &&
    /grant\\s+execute[\\s\\S]{0,500}?to\\s+service_role/i.test(migration),

  pgrstReloadRetained:
    /notify\\s+pgrst\\s*,\\s*'reload schema'/i.test(migration),

  noProductionTradingLogicModified:
    !/create\\s+or\\s+replace\\s+function\\s+public\\.execute_paper_buy_order/i.test(
      migration,
    ) &&
    !/create\\s+or\\s+replace\\s+function\\s+public\\.execute_paper_protective_sell/i.test(
      migration,
    ),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\\s*=\\s*true/i.test(migration) &&
    !/ENABLE_REAL_TRADING\\s*=\\s*true/i.test(migration) &&
    !/ENABLE_LIVE_TRADING\\s*=\\s*true/i.test(migration),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "ALTER_FUNCTION_SQL_SYNTAX_REPAIRED_AND_RPC_RENAME_READY"
      : "RPC_RENAME_SQL_SYNTAX_REPAIR_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    previousSqlState: "42601",
    cause: "ALTER FUNCTION does not accept IF EXISTS in this syntax position",
    migrationPreviouslyApplied: false,
    productionTradingLogicModified: false
  },

  nextGate:
    failed.length === 0
      ? "RETRY_DB_PUSH_THEN_RERUN_FEE_BASIS_RUNTIME_REGRESSION"
      : "REVIEW_FAILED_SYNTAX_REPAIR_CHECKS"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
