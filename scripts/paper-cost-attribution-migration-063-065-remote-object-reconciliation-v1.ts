import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const ROOT =
  process.cwd();

const MIGRATIONS_DIR =
  path.join(
    ROOT,
    "supabase",
    "migrations",
  );

const VERSION_FILES = [
  "063_alpha_v1_kis_investor_flow_daily.sql",
  "064_committed_risk_reservation_v3.sql",
  "065_committed_risk_concurrency_test_harness.sql",
  "20261008000100_committed_risk_reservation_v3.sql",
  "20261008000200_committed_risk_concurrency_test_harness.sql",
  "20261010000100_paper_execution_cost_attribution_v1.sql",
] as const;

function localFileState(
  name: string,
) {
  const abs =
    path.join(
      MIGRATIONS_DIR,
      name,
    );

  return {
    name,
    exists:
      fs.existsSync(
        abs,
      ),
    bytes:
      fs.existsSync(
        abs,
      )
        ? fs.statSync(
            abs,
          ).size
        : null,
  };
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const localFiles =
    VERSION_FILES.map(
      localFileState,
    );

  const investorFlow =
    await supabase
      .from(
        "kis_investor_flow_daily",
      )
      .select(
        "stock_code,trading_date,source,source_version",
      )
      .limit(
        1,
      );

  const committedRisk =
    await supabase
      .from(
        "paper_order_requests",
      )
      .select(`
        id,
        reserved_risk_amount,
        reserved_risk_at,
        reserved_risk_released_at,
        reserved_risk_release_reason,
        committed_risk_reason,
        committed_risk_snapshot
      `)
      .limit(
        1,
      );

  const randomRunId =
    crypto.randomUUID();

  const randomAccountKey =
    crypto.randomUUID();

  const concurrencySummary =
    await supabase.rpc(
      "committed_risk_concurrency_test_summary_v1",
      {
        p_run_id:
          randomRunId,
        p_account_key:
          randomAccountKey,
      },
    );

  const investorTableExists =
    investorFlow.error ===
    null;

  const committedRiskSchemaExists =
    committedRisk.error ===
    null;

  const concurrencyHarnessSummaryExists =
    concurrencySummary.error ===
    null;

  const localLegacy064 =
    localFiles.find(
      row =>
        row.name.startsWith(
          "064_",
        ),
    )?.exists ??
    false;

  const localLegacy065 =
    localFiles.find(
      row =>
        row.name.startsWith(
          "065_",
        ),
    )?.exists ??
    false;

  const localTimestamp064Replacement =
    localFiles.find(
      row =>
        row.name ===
        "20261008000100_committed_risk_reservation_v3.sql",
    )?.exists ??
    false;

  const localTimestamp065Replacement =
    localFiles.find(
      row =>
        row.name ===
        "20261008000200_committed_risk_concurrency_test_harness.sql",
    )?.exists ??
    false;

  const classification = {
    "063":
      investorTableExists
        ? "STALE_LOCAL_ALIAS_OR_HISTORY_DRIFT_REMOTE_OBJECT_ALREADY_EXISTS"
        : "GENUINE_LOCAL_ONLY_PENDING_MIGRATION",

    "064":
      committedRiskSchemaExists &&
      localLegacy064
        ? "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE"
        : "INCONCLUSIVE",

    "065":
      concurrencyHarnessSummaryExists &&
      localLegacy065
        ? "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE"
        : "INCONCLUSIVE",
  } as const;

  const safeToQuarantine064065 =
    classification["064"] ===
      "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE" &&
    classification["065"] ===
      "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE";

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_MIGRATION_063_064_065_REMOTE_OBJECT_RECONCILIATION_V1_COMPLETE",

        localFiles,

        remoteReadOnlyChecks: {
          investorFlow: {
            exists:
              investorTableExists,
            sampleRows:
              investorFlow.data
                ?.length ??
              0,
            error:
              investorFlow.error
                ? {
                    code:
                      investorFlow.error.code ??
                      null,
                    message:
                      investorFlow.error.message,
                  }
                : null,
          },

          committedRiskReservationV3: {
            schemaExists:
              committedRiskSchemaExists,
            sampleRows:
              committedRisk.data
                ?.length ??
              0,
            error:
              committedRisk.error
                ? {
                    code:
                      committedRisk.error.code ??
                      null,
                    message:
                      committedRisk.error.message,
                  }
                : null,
          },

          concurrencyHarness: {
            summaryRpcExists:
              concurrencyHarnessSummaryExists,
            randomRunId,
            randomAccountKey,
            result:
              concurrencySummary.data ??
              null,
            error:
              concurrencySummary.error
                ? {
                    code:
                      concurrencySummary.error.code ??
                      null,
                    message:
                      concurrencySummary.error.message,
                  }
                : null,
          },
        },

        classification,

        decision: {
          safeToQuarantine064065,

          migration063Action:
            classification["063"] ===
            "GENUINE_LOCAL_ONLY_PENDING_MIGRATION"
              ? "KEEP_AS_REAL_PENDING_AND_HANDLE_BEFORE_COST_ATTRIBUTION"
              : "DO_NOT_APPLY_UNTIL_HISTORY_DRIFT_IS_RECONCILED",

          migration064Action:
            classification["064"] ===
            "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE"
              ? "QUARANTINE_LOCAL_064_FROM_SUPABASE_MIGRATIONS"
              : "DO_NOT_TOUCH",

          migration065Action:
            classification["065"] ===
            "STALE_LOCAL_ALIAS_REMOTE_TIMESTAMP_MIGRATION_ALREADY_EFFECTIVE"
              ? "QUARANTINE_LOCAL_065_FROM_SUPABASE_MIGRATIONS"
              : "DO_NOT_TOUCH",
        },

        safety: {
          readOnly:
            true,
          databaseReads:
            3,
          databaseWrites:
            0,
          migrationsApplied:
            0,
          migrationsRepaired:
            0,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          syntheticTradesCreated:
            0,
          realTradingEnabled:
            false,
        },

        nextGate:
          safeToQuarantine064065
            ? (
                classification["063"] ===
                "GENUINE_LOCAL_ONLY_PENDING_MIGRATION"
                  ? "QUARANTINE_064_065_THEN_APPLY_063_SEPARATELY_BEFORE_COST_MIGRATION"
                  : "RECONCILE_063_HISTORY_THEN_QUARANTINE_064_065"
              )
            : "STOP_AND_REVIEW_REMOTE_OBJECT_MISMATCH",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    safeToQuarantine064065
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_MIGRATION_063_064_065_REMOTE_OBJECT_RECONCILIATION_V1_FAILED",

          error:
            String(
              error instanceof
                Error
                ? error.message
                : error,
            ),

          safety: {
            databaseReadsOnly:
              true,
            databaseWrites:
              0,
            migrationsApplied:
              0,
            ordersCreated:
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
      1;
  },
);
