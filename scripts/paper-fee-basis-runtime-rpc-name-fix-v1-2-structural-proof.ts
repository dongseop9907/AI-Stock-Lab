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

const compact =
  migration
    .replace(/\\s+/g, " ")
    .trim();

const checks = {
  migrationExists:
    migration.length > 0,

  beginCommitPresent:
    compact.startsWith("begin;") &&
    compact.endsWith("commit;"),

  validAlterFunctionRenamePresent:
    compact.includes(
      "alter function public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v() rename to run_paper_fee_basis_rt_v1;"
    ),

  noIfExistsInAlterFunction:
    !/alter\\s+function\\s+if\\s+exists/i.test(migration),

  revokePublicPresent:
    compact.includes(
      "revoke all on function public.run_paper_fee_basis_rt_v1() from public;"
    ),

  revokeAnonPresent:
    compact.includes(
      "revoke all on function public.run_paper_fee_basis_rt_v1() from anon;"
    ),

  revokeAuthenticatedPresent:
    compact.includes(
      "revoke all on function public.run_paper_fee_basis_rt_v1() from authenticated;"
    ),

  grantServiceRolePresent:
    compact.includes(
      "grant execute on function public.run_paper_fee_basis_rt_v1() to service_role;"
    ),

  pgrstReloadPresent:
    compact.includes(
      "notify pgrst, 'reload schema';"
    ),

  runnerUsesShortRpc:
    runner.includes(
      "/rpc/run_paper_fee_basis_rt_v1"
    ),

  runnerNoLongRpc:
    !runner.includes(
      "/rpc/run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1"
    ),

  oldNameExactly63Bytes:
    Buffer.byteLength(
      "run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v",
      "utf8",
    ) === 63,

  shortNameWithinLimit:
    Buffer.byteLength(
      "run_paper_fee_basis_rt_v1",
      "utf8",
    ) <= 63,

  noProductionTradingLogicModified:
    !/execute_paper_buy_order_with_execution_price_v[2345]\\s*\\(/i.test(
      migration,
    ) &&
    !/execute_paper_protective_sell_v[234]\\s*\\(/i.test(
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
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_2_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_2_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "MINIMAL_RPC_RENAME_MIGRATION_READY"
      : "MINIMAL_RPC_RENAME_MIGRATION_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    previousFailure:
      "STRUCTURAL_PROOF_FALSE_NEGATIVE_OR_PARTIAL_PATCH_MISMATCH",

    migration009PreviouslyApplied:
      false,

    exactRemoteFunctionExpected:
      "public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v()",

    renameTarget:
      "public.run_paper_fee_basis_rt_v1()",

    productionTradingLogicModified:
      false
  },

  nextGate:
    failed.length === 0
      ? "RETRY_DB_PUSH_THEN_RERUN_EXISTING_RUNTIME_REGRESSION"
      : "STOP_AND_REVIEW"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
