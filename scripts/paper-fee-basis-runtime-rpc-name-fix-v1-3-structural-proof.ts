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
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const sourceName =
  "run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v";

const shortName =
  "run_paper_fee_basis_rt_v1";

const exactRename =
  `alter function public.${sourceName}() rename to ${shortName};`;

const checks = {
  migrationExists:
    migration.length > 0,

  runnerExists:
    runner.length > 0,

  beginCommitPresent:
    compact.startsWith("begin;") &&
    compact.endsWith("commit;"),

  validAlterFunctionRenamePresent:
    compact.includes(exactRename),

  invalidIfExistsAbsent:
    !compact.includes("alter function if exists"),

  revokePublicPresent:
    compact.includes(
      `revoke all on function public.${shortName}() from public;`
    ),

  revokeAnonPresent:
    compact.includes(
      `revoke all on function public.${shortName}() from anon;`
    ),

  revokeAuthenticatedPresent:
    compact.includes(
      `revoke all on function public.${shortName}() from authenticated;`
    ),

  grantServiceRolePresent:
    compact.includes(
      `grant execute on function public.${shortName}() to service_role;`
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
      sourceName,
      "utf8",
    ) === 63,

  shortNameWithinPostgresLimit:
    Buffer.byteLength(
      shortName,
      "utf8",
    ) <= 63,

  productionBuyRpcDefinitionAbsent:
    !migration.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_"
    ),

  productionSellRpcDefinitionAbsent:
    !migration.includes(
      "create or replace function public.execute_paper_protective_sell_"
    ),

  productionBuyRpcInvocationAbsent:
    !migration.includes(
      "execute_paper_buy_order_with_execution_price_v2("
    ) &&
    !migration.includes(
      "execute_paper_buy_order_with_execution_price_v3("
    ) &&
    !migration.includes(
      "execute_paper_buy_order_with_execution_price_v4("
    ) &&
    !migration.includes(
      "execute_paper_buy_order_with_execution_price_v5("
    ),

  productionSellRpcInvocationAbsent:
    !migration.includes(
      "execute_paper_protective_sell_v2("
    ) &&
    !migration.includes(
      "execute_paper_protective_sell_v3("
    ) &&
    !migration.includes(
      "execute_paper_protective_sell_v4("
    ),

  noRealTradingEnablement:
    !migration.includes(
      "REAL_TRADING_ENABLED=true"
    ) &&
    !migration.includes(
      "ENABLE_REAL_TRADING=true"
    ) &&
    !migration.includes(
      "ENABLE_LIVE_TRADING=true"
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_3_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_NAME_FIX_V1_3_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "MINIMAL_RPC_RENAME_MIGRATION_READY"
      : "MINIMAL_RPC_RENAME_MIGRATION_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    priorV1_2Failure:
      "STRUCTURAL_PROOF_TYPESCRIPT_REGEX_LITERAL_GENERATION_BUG",

    migration009PreviouslyApplied:
      false,

    migration009ModifiedByThisFix:
      false,

    sourceRpcName:
      `public.${sourceName}()`,

    targetRpcName:
      `public.${shortName}()`,

    productionTradingLogicModified:
      false
  },

  safety: {
    sourceOnly:
      true,

    databaseReads:
      0,

    databaseWrites:
      0,

    rpcInvoked:
      false,

    realTradingEnabled:
      false
  },

  nextGate:
    failed.length === 0
      ? "RETRY_DB_PUSH_THEN_RERUN_EXISTING_RUNTIME_REGRESSION"
      : "STOP_AND_REVIEW",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
