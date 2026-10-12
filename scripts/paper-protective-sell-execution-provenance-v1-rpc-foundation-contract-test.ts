import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const migration =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261010000300_paper_protective_sell_execution_provenance_v1.sql",
  );

const sql =
  fs.readFileSync(
    migration,
    "utf8",
  );

const checks = {
  requiredArgsPresent:
    [
      "p_position_id uuid",
      "p_exit_price numeric",
      "p_observed_at timestamptz",
      "p_execution_source text",
      "p_execution_provenance jsonb",
      "p_fill_quantity integer default null",
      "p_broker_fee numeric default 0",
      "p_sell_tax numeric default 0",
      "p_exit_reason text default 'PROTECTIVE_STOP'",
    ].every(
      fragment =>
        sql.includes(
          fragment,
        ),
    ),

  exactSellSources:
    sql.includes(
      "'BEST_BID'",
    ) &&
    sql.includes(
      "'REFERENCE_MINUS_SYNTHETIC_SPREAD'",
    ),

  invalidSourceFailsClosed:
    sql.includes(
      "UNSUPPORTED_PROTECTIVE_SELL_EXECUTION_SOURCE",
    ),

  malformedProvenanceFailsClosed:
    sql.includes(
      "PROTECTIVE_SELL_EXECUTION_PROVENANCE_OBJECT_REQUIRED",
    ),

  callsV2:
    sql.includes(
      "public.execute_paper_protective_sell_v2(",
    ),

  duplicateDoesNotRewrite:
    sql.indexOf(
      "alreadyClosed",
    ) <
    sql.indexOf(
      "update public.paper_protective_execution_fills_v2",
    ),

  provenanceStoredOnFill:
    sql.includes(
      "execution_provenance =",
    ) &&
    sql.includes(
      "execution_provenance_version =",
    ),

  persistenceFailureRollsBack:
    sql.includes(
      "PROTECTIVE_SELL_EXECUTION_PROVENANCE_FILL_NOT_FOUND",
    ) &&
    sql.includes(
      "PROTECTIVE_SELL_EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE",
    ),

  versionRecorded:
    sql.includes(
      "PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1",
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_CONTRACT_FAIL",

      checks,
      failed,

      safety: {
        sourceOnly:
          true,
        migrationApplied:
          false,
        databaseReads:
          0,
        databaseWrites:
          0,
        externalApiCalls:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
