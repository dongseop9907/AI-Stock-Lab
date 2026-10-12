const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const MIGRATION =
  "supabase/migrations/20261010000200_paper_orderbook_execution_provenance_v1.sql";

const abs =
  path.join(
    ROOT,
    MIGRATION
  );

if (!fs.existsSync(abs)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_FAIL",
        reason:
          "MIGRATION_NOT_FOUND",
        migration:
          MIGRATION,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}
else {
  const sql =
    fs.readFileSync(
      abs,
      "utf8"
    );

  const v3Index =
    sql.indexOf(
      "execute_paper_buy_order_with_execution_price_v3"
    );

  const v2CallIndex =
    sql.indexOf(
      "execute_paper_buy_order_with_execution_price_v2"
    );

  const provenanceUpdateIndex =
    sql.indexOf(
      "executionProvenanceVersion"
    );

  const diagnosticsIndex =
    sql.indexOf(
      "get diagnostics"
    );

  const checks = {
    createsV3:
      /create or replace function public\.execute_paper_buy_order_with_execution_price_v3\(/i.test(
        sql
      ),

    acceptsActualPriceSource:
      /p_execution_price_source text/i.test(
        sql
      ),

    acceptsProvenanceJson:
      /p_execution_provenance jsonb/i.test(
        sql
      ),

    delegatesToVerifiedV2:
      v2CallIndex >= 0,

    v2CallBeforeProvenanceUpdate:
      v2CallIndex >= 0 &&
      provenanceUpdateIndex >= 0 &&
      v2CallIndex <
        provenanceUpdateIndex,

    buySourceAllowList:
      sql.includes(
        "'BEST_ASK'"
      ) &&
      sql.includes(
        "'REFERENCE_PLUS_SYNTHETIC_SPREAD'"
      ),

    preservesDuplicateHistoricalRow:
      sql.includes(
        "alreadyFilled"
      ) &&
      sql.includes(
        "Never replace historical provenance"
      ),

    successOnlyBinding:
      sql.includes(
        "'FILLED'"
      ) &&
      sql.includes(
        "'RISK_APPROVED'"
      ),

    mergesExistingRiskSnapshot:
      /coalesce\(\s*execution_risk_snapshot,\s*'\{\}'::jsonb\s*\)\s*\|\|/m.test(
        sql
      ),

    atomicLostRaceGuard:
      diagnosticsIndex >= 0 &&
      sql.includes(
        "EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE"
      ),

    provenanceVersioned:
      sql.includes(
        "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
      ),

    boundedPayload:
      sql.includes(
        "EXECUTION_PROVENANCE_TOO_LARGE"
      ) &&
      sql.includes(
        "131072"
      ),

    serviceRoleOnly:
      /revoke all on function public\.execute_paper_buy_order_with_execution_price_v3[\s\S]*from public;/i.test(
        sql
      ) &&
      /grant execute on function public\.execute_paper_buy_order_with_execution_price_v3[\s\S]*to service_role;/i.test(
        sql
      ),

    noLegacyMigrationRewrite:
      !sql.includes(
        "20261009000100_paper_execution_realism_v2_buy_partial_fill.sql"
      ),

    noRealTrading:
      !/LIVE_ACCOUNT_ALLOWED|REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
        sql
      ),

    noSyntheticTradeCreation:
      !/insert\s+into\s+public\.paper_trade_history/i.test(
        sql
      ),
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, ok]) =>
          ok !== true
      )
      .map(
        ([name]) =>
          name
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_PASS"
            : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_FAIL",

        migration:
          MIGRATION,

        design: {
          wrapper:
            "V3 delegates canonical fill behavior to V2",

          atomicity:
            "V2 fill and provenance persistence share one PostgreSQL transaction",

          successfulNewFill:
            "Persist actual price source + versioned provenance JSON",

          duplicateAlreadyFilled:
            "Return V2 result without rewriting historical provenance",

          v2NormalFailedResult:
            "Return unchanged; V1 provenance binding targets successful fills only",
        },

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
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          realTradingEnabled:
            false,
        },

        nextGate:
          failed.length === 0
            ? "CHECK_SUPABASE_MIGRATION_STATUS_BEFORE_APPLY"
            : "REPAIR_V3_RPC_FOUNDATION",
      },
      null,
      2
    )
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
