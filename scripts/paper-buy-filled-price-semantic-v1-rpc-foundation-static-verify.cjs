const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const MIGRATION =
  "supabase/migrations/20261011000100_paper_buy_filled_price_semantic_v1.sql";

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
          "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_RPC_FOUNDATION_STATIC_FAIL",
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

  const lockIndex =
    sql.indexOf(
      "for update;"
    );

  const v3Index =
    sql.indexOf(
      "execute_paper_buy_order_with_execution_price_v3"
    );

  /*
   * IMPORTANT:
   * Do not use sql.indexOf("filled_price =").
   * The migration header intentionally documents the legacy bug using that
   * exact text, which caused the V1 verifier to mistake a comment for the
   * real persistence UPDATE.
   */
  const correctionMatch =
    /update\s+public\.paper_order_requests[\s\S]*?set[\s\S]*?filled_price\s*=/i.exec(
      sql
    );

  const correctionIndex =
    correctionMatch?.index ??
    -1;

  const duplicateGuardMatch =
    /if\s+coalesce\s*\(\s*v_result\s*->>\s*'alreadyFilled'\s*,\s*'false'\s*\)\s*=\s*'true'\s+then[\s\S]*?return\s+v_result\s*;[\s\S]*?end\s+if\s*;/i.exec(
      sql
    );

  const duplicateGuardIndex =
    duplicateGuardMatch?.index ??
    -1;

  const checks = {
    createsV4:
      /create or replace function public\.execute_paper_buy_order_with_execution_price_v4\(/i.test(
        sql
      ),

    sameCallerContractAsV3:
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
            fragment
          )
      ),

    capturesPriorQuantity:
      sql.includes(
        "v_prior_filled_quantity"
      ),

    capturesPriorFilledPrice:
      sql.includes(
        "v_prior_filled_price"
      ),

    locksBeforeDelegating:
      lockIndex >= 0 &&
      v3Index > lockIndex,

    delegatesV3NotV2:
      v3Index >= 0 &&
      !sql.includes(
        "execute_paper_buy_order_with_execution_price_v2("
      ),

    preservesDuplicate:
      duplicateGuardIndex >= 0 &&
      correctionIndex > duplicateGuardIndex,

    weightedFormulaUsesPriorPrice:
      sql.includes(
        "v_prior_filled_price *"
      ) &&
      sql.includes(
        "v_prior_filled_quantity"
      ),

    weightedFormulaUsesNewExecutionPrice:
      sql.includes(
        "p_execution_price *"
      ) &&
      sql.includes(
        "v_new_fill_quantity"
      ),

    weightedFormulaUsesTotalQuantity:
      sql.includes(
        "/\n      v_total_filled_quantity"
      ),

    firstFillUsesExecutionPrice:
      /if v_prior_filled_quantity = 0 then[\s\S]*v_cumulative_filled_price :=[\s\S]*p_execution_price;/i.test(
        sql
      ),

    legacyInvalidPriorFailsClosed:
      sql.includes(
        "BUY_FILLED_PRICE_PRIOR_CUMULATIVE_PRICE_INVALID"
      ),

    correctionMatchesPostFillQuantity:
      sql.includes(
        "and filled_quantity ="
      ) &&
      sql.includes(
        "v_total_filled_quantity"
      ),

    raceGuard:
      sql.includes(
        "BUY_FILLED_PRICE_PERSISTENCE_LOST_RACE"
      ),

    returnFilledPriceIsCumulative:
      /'filledPrice',[\s\S]*v_cumulative_filled_price/i.test(
        sql
      ),

    returnsLatestExecutionSeparately:
      /'latestExecutionPrice',[\s\S]*p_execution_price/i.test(
        sql
      ),

    semanticVersion:
      sql.includes(
        "PAPER_BUY_FILLED_PRICE_WEIGHTED_AVERAGE_V1"
      ),

    serviceRoleOnly:
      /revoke all on function public\.execute_paper_buy_order_with_execution_price_v4[\s\S]*from public;/i.test(
        sql
      ) &&
      /grant execute on function public\.execute_paper_buy_order_with_execution_price_v4[\s\S]*to service_role;/i.test(
        sql
      ),

    noLegacyMigrationRewrite:
      !sql.includes(
        "20261009000100_paper_execution_realism_v2_buy_partial_fill.sql"
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
            ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_RPC_FOUNDATION_STATIC_PASS"
            : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_RPC_FOUNDATION_STATIC_FAIL",

        migration:
          MIGRATION,

        verifierRevision:
          "STATIC_V2_COMMENT_SAFE_DUPLICATE_ORDERING",

        falseNegativeRepair: {
          previousCheck:
            "sql.indexOf('filled_price =')",

          previousFailure:
            "Migration header comment contains the legacy phrase 'filled_price = entry_price', so the verifier anchored to a comment before the duplicate guard.",

          correctedCheck:
            "Anchor to the actual UPDATE public.paper_order_requests ... SET ... filled_price statement and prove the alreadyFilled return block occurs before it.",

          migrationModified:
            false,

          productionSourceModified:
            false,
        },

        design: {
          wrapper:
            "V4 captures pre-fill state and delegates canonical V3 -> V2 execution",

          semantic:
            "paper_order_requests.filled_price becomes cumulative quantity-weighted execution price",

          firstFill:
            "filled_price = current execution price",

          laterPartialFill:
            "weighted average of prior cumulative filled_price and current execution price",

          atomicity:
            "correction failure rolls back delegated V3/V2 execution in the same transaction",

          backfill:
            "none; current natural PAPER BUY fill evidence count was zero before this repair",
        },

        orderingEvidence: {
          duplicateGuardIndex,
          correctionUpdateIndex:
            correctionIndex,
          duplicateBeforeCorrection:
            duplicateGuardIndex >= 0 &&
            correctionIndex > duplicateGuardIndex,
        },

        checks,
        failed,

        safety: {
          sourceOnly:
            true,
          migrationApplied:
            false,
          migrationModified:
            false,
          productionSourceModified:
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
            ? "CHECK_MIGRATION_STATUS_BEFORE_APPLY"
            : "REVIEW_BUY_FILLED_PRICE_V4_FOUNDATION",
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
