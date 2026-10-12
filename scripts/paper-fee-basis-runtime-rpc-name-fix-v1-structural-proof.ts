import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000900_paper_fee_basis_runtime_rpc_name_fix_v1.sql",
);

const runner = path.join(
  ROOT,
  "scripts",
  "paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
);

const migrationText =
  fs.existsSync(migration)
    ? fs.readFileSync(migration, "utf8")
    : "";

const runnerText =
  fs.existsSync(runner)
    ? fs.readFileSync(runner, "utf8")
    : "";

const shortName =
  "run_paper_fee_basis_rt_v1";

const oldTruncatedName =
  "run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v";

const checks = {
  migrationExists:
    migrationText.length > 0,

  shortRpcNameWithinPostgresLimit:
    Buffer.byteLength(shortName, "utf8") <= 63,

  oldTruncatedNameExactly63Bytes:
    Buffer.byteLength(oldTruncatedName, "utf8") === 63,

  migrationRenamesTruncatedFunction:
    migrationText.includes(oldTruncatedName) &&
    migrationText.includes(shortName),

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,900}?from\s+public/i.test(migrationText) &&
    /revoke\s+all[\s\S]{0,1400}?from\s+anon/i.test(migrationText) &&
    /revoke\s+all[\s\S]{0,1800}?from\s+authenticated/i.test(migrationText) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(migrationText),

  runnerUsesShortRpc:
    runnerText.includes(
      "/rpc/run_paper_fee_basis_rt_v1"
    ),

  runnerNoLongerUsesTooLongRpc:
    !runnerText.includes(
      "/rpc/run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1"
    ),

  noProductionTradingLogicModified:
    !/execute_paper_buy_order_with_execution_price_v[2345]\s*\(/i.test(migrationText) &&
    !/execute_paper_protective_sell_v[234]\s*\(/i.test(migrationText),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(migrationText) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(migrationText) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(migrationText),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "POSTGRES_IDENTIFIER_TRUNCATION_RPC_NAME_REPAIRED_STRUCTURALLY"
      : "RPC_NAME_FIX_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    requestedName:
      "run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1",

    requestedNameBytes:
      Buffer.byteLength(
        "run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1",
        "utf8",
      ),

    postgresStoredTruncatedName:
      oldTruncatedName,

    postgresStoredNameBytes:
      Buffer.byteLength(oldTruncatedName, "utf8"),

    repairedName:
      shortName,

    repairedNameBytes:
      Buffer.byteLength(shortName, "utf8"),
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    productionTradingLogicModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_RPC_RENAME_AND_RERUN_EXISTING_RUNTIME_REGRESSION"
      : "REVIEW_FAILED_NAME_FIX_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
