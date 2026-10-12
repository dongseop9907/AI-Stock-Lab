import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const migration =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261010000200_paper_orderbook_execution_provenance_v1.sql",
  );

const sql =
  fs.readFileSync(
    migration,
    "utf8",
  );

const checks = {
  requiredArgsPresent:
    [
      "p_order_id uuid",
      "p_execution_price numeric",
      "p_execution_observed_at timestamptz",
      "p_execution_price_source text",
      "p_execution_provenance jsonb",
      "p_fill_quantity integer default null",
      "p_broker_fee numeric default 0",
    ].every(
      fragment =>
        sql.includes(
          fragment,
        ),
    ),

  exactBuySources:
    sql.includes(
      "'BEST_ASK'",
    ) &&
    sql.includes(
      "'REFERENCE_PLUS_SYNTHETIC_SPREAD'",
    ),

  invalidSourceFailsClosed:
    sql.includes(
      "UNSUPPORTED_PAPER_BUY_EXECUTION_PRICE_SOURCE",
    ),

  malformedProvenanceFailsClosed:
    sql.includes(
      "EXECUTION_PROVENANCE_OBJECT_REQUIRED",
    ),

  callsV2:
    sql.includes(
      "public.execute_paper_buy_order_with_execution_price_v2(",
    ),

  duplicateDoesNotRewrite:
    sql.indexOf(
      "alreadyFilled",
    ) <
    sql.indexOf(
      "update public.paper_order_requests",
    ),

  successfulPartialOrFullFillCanPersist:
    sql.includes(
      "'FILLED'",
    ) &&
    sql.includes(
      "'RISK_APPROVED'",
    ),

  riskSnapshotMergedNotReplaced:
    sql.includes(
      "coalesce(",
    ) &&
    sql.includes(
      "execution_risk_snapshot",
    ) &&
    sql.includes(
      "||",
    ),

  persistenceRaceRollsBack:
    sql.includes(
      "get diagnostics",
    ) &&
    sql.includes(
      "EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE",
    ),

  versionRecorded:
    sql.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1",
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
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_CONTRACT_FAIL",

      checks,

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

      failed,
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
    0
    ? 0
    : 1;
