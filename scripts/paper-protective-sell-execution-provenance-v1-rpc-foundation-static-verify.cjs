const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const MIGRATION =
  "supabase/migrations/20261010000300_paper_protective_sell_execution_provenance_v1.sql";

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
          "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_FAIL",
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
      "execute_paper_protective_sell_v3"
    );

  const v2CallIndex =
    sql.indexOf(
      "execute_paper_protective_sell_v2"
    );

  const fillLookupIndex =
    sql.indexOf(
      "select f.id"
    );

  const provenanceUpdateIndex =
    sql.indexOf(
      "execution_provenance ="
    );

  const checks = {
    addsJsonbProvenanceColumn:
      /add column if not exists execution_provenance jsonb/i.test(
        sql
      ),

    addsVersionColumn:
      /add column if not exists execution_provenance_version text/i.test(
        sql
      ),

    createsV3:
      /create or replace function public\.execute_paper_protective_sell_v3\(/i.test(
        sql
      ),

    acceptsExecutionSource:
      /p_execution_source text/i.test(
        sql
      ),

    acceptsProvenance:
      /p_execution_provenance jsonb/i.test(
        sql
      ),

    delegatesToVerifiedV2:
      v2CallIndex >= 0,

    v2BeforeFillLookup:
      v2CallIndex >= 0 &&
      fillLookupIndex > v2CallIndex,

    fillLookupBeforeProvenanceUpdate:
      fillLookupIndex >= 0 &&
      provenanceUpdateIndex > fillLookupIndex,

    exactSellSourceAllowList:
      sql.includes(
        "'BEST_BID'"
      ) &&
      sql.includes(
        "'REFERENCE_MINUS_SYNTHETIC_SPREAD'"
      ),

    preservesDuplicateHistoricalFill:
      sql.includes(
        "alreadyClosed"
      ) &&
      sql.includes(
        "Do not rewrite historical provenance"
      ),

    exactFillTable:
      sql.includes(
        "public.paper_protective_execution_fills_v2"
      ),

    atomicFailureGuard:
      sql.includes(
        "PROTECTIVE_SELL_EXECUTION_PROVENANCE_FILL_NOT_FOUND"
      ) &&
      sql.includes(
        "PROTECTIVE_SELL_EXECUTION_PROVENANCE_PERSISTENCE_LOST_RACE"
      ),

    boundedPayload:
      sql.includes(
        "131072"
      ) &&
      sql.includes(
        "PROTECTIVE_SELL_EXECUTION_PROVENANCE_TOO_LARGE"
      ),

    versioned:
      sql.includes(
        "PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1"
      ),

    serviceRoleOnly:
      /revoke all on function public\.execute_paper_protective_sell_v3[\s\S]*from public;/i.test(
        sql
      ) &&
      /grant execute on function public\.execute_paper_protective_sell_v3[\s\S]*to service_role;/i.test(
        sql
      ),

    noV2MigrationRewrite:
      !sql.includes(
        "20261009000200_paper_execution_realism_v2_protective_sell.sql"
      ),

    noLiveTradingEnable:
      !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
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
            ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_PASS"
            : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_RPC_FOUNDATION_STATIC_FAIL",

        migration:
          MIGRATION,

        design: {
          wrapper:
            "V3 delegates canonical protective SELL execution to V2",

          storage:
            "Detailed provenance is stored on paper_protective_execution_fills_v2",

          atomicity:
            "V2 execution and provenance update share one PostgreSQL transaction",

          duplicate:
            "alreadyClosed=true returns without rewriting historical provenance",
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
            : "REPAIR_SELL_V3_RPC_FOUNDATION",
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
