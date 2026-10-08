import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const EXPECTED_TARGET_COUNT = 12;
const EXPECTED_ROW_COUNT = 4572;
const EXPECTED_ROWS_PER_TARGET = 381;

function normalizedKey(
  stockCode: string,
  observedAt: string,
) {
  const ms =
    new Date(
      observedAt,
    ).getTime();

  if (
    !Number.isFinite(ms)
  ) {
    throw new Error(
      `INVALID_TIMESTAMP:${observedAt}`,
    );
  }

  return (
    `${stockCode}|${ms}`
  );
}

async function main() {
  const root =
    process.cwd();

  const planPath =
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-plan.json",
    );

  const desiredPath =
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-desired-rows.json",
    );

  if (
    !fs.existsSync(planPath) ||
    !fs.existsSync(desiredPath)
  ) {
    throw new Error(
      "BACKFILL_PLAN_OR_DESIRED_ROWS_FILE_MISSING",
    );
  }

  const plan =
    JSON.parse(
      fs.readFileSync(
        planPath,
        "utf8",
      ),
    );

  const desiredFile =
    JSON.parse(
      fs.readFileSync(
        desiredPath,
        "utf8",
      ),
    );

  const targets =
    (
      plan.targets ??
      []
    ) as Array<{
      stockCode: string;
      targetSessionDate: string;
    }>;

  const desiredRows =
    (
      desiredFile.rows ??
      []
    ) as Array<{
      stock_code: string;
      observed_at: string;
      raw_payload?: Record<string, unknown>;
    }>;

  if (
    targets.length !==
    EXPECTED_TARGET_COUNT
  ) {
    throw new Error(
      `TARGET_COUNT_MISMATCH:${targets.length}:${EXPECTED_TARGET_COUNT}`,
    );
  }

  if (
    desiredRows.length !==
    EXPECTED_ROW_COUNT
  ) {
    throw new Error(
      `DESIRED_ROW_COUNT_MISMATCH:${desiredRows.length}:${EXPECTED_ROW_COUNT}`,
    );
  }

  const supabase =
    createSupabaseServerClient();

  const actualRows:
    Array<{
      stock_code: string;
      observed_at: string;
      raw_payload: Record<string, unknown> | null;
    }> =
    [];

  const perTarget:
    Array<{
      stockCode: string;
      targetSessionDate: string;
      actualRowCount: number;
      canonicalRowCount: number;
    }> =
    [];

  for (
    const target
    of targets
  ) {
    const start =
      `${target.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${target.targetSessionDate}T23:59:59+09:00`;

    const result =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at,raw_payload",
        )
        .eq(
          "stock_code",
          target.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        )
        .order(
          "observed_at",
          {
            ascending:
              true,
          },
        )
        .limit(
          1000,
        );

    if (
      result.error
    ) {
      throw result.error;
    }

    const rows =
      (
        result.data ??
        []
      ) as Array<{
        stock_code: string;
        observed_at: string;
        raw_payload: Record<string, unknown> | null;
      }>;

    actualRows.push(
      ...rows,
    );

    const canonicalRowCount =
      rows.filter(
        (row) =>
          row.raw_payload
            ?.source ===
            "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED" &&
          row.raw_payload
            ?.source_version ===
            "FHKST03010230_ALPHA_V2_BACKFILL_V1",
      ).length;

    perTarget.push({
      stockCode:
        target.stockCode,

      targetSessionDate:
        target.targetSessionDate,

      actualRowCount:
        rows.length,

      canonicalRowCount,
    });
  }

  const desiredKeys =
    new Set(
      desiredRows.map(
        (row) =>
          normalizedKey(
            row.stock_code,
            row.observed_at,
          ),
      ),
    );

  const actualKeys =
    new Set(
      actualRows.map(
        (row) =>
          normalizedKey(
            row.stock_code,
            row.observed_at,
          ),
      ),
    );

  const missingDesiredKeys =
    [
      ...desiredKeys,
    ].filter(
      (key) =>
        !actualKeys.has(
          key,
        ),
    );

  const unexpectedActualKeys =
    [
      ...actualKeys,
    ].filter(
      (key) =>
        !desiredKeys.has(
          key,
        ),
    );

  const allPerTargetExact =
    perTarget.every(
      (row) =>
        row.actualRowCount ===
          EXPECTED_ROWS_PER_TARGET &&
        row.canonicalRowCount ===
          EXPECTED_ROWS_PER_TARGET,
    );

  const allDesiredPresent =
    missingDesiredKeys.length ===
    0;

  const noUnexpectedRows =
    unexpectedActualKeys.length ===
    0;

  const exactTotal =
    actualRows.length ===
    EXPECTED_ROW_COUNT;

  const verified =
    exactTotal &&
    allPerTargetExact &&
    allDesiredPresent &&
    noUnexpectedRows;

  const report = {
    status:
      verified
        ? "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFIED"
        : "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFY_FAILED",

    applied:
      verified,

    verificationMethod: {
      timestampComparison:
        "NORMALIZED_TO_EPOCH_MILLISECONDS",

      rawStringTimestampComparison:
        false,

      databaseWrites:
        0,
    },

    counts: {
      expectedRows:
        EXPECTED_ROW_COUNT,

      actualRows:
        actualRows.length,

      desiredUniqueKeys:
        desiredKeys.size,

      actualUniqueKeys:
        actualKeys.size,

      missingDesiredKeys:
        missingDesiredKeys.length,

      unexpectedActualKeys:
        unexpectedActualKeys.length,

      exactTargetCount:
        perTarget.filter(
          (row) =>
            row.actualRowCount ===
            EXPECTED_ROWS_PER_TARGET,
        ).length,

      canonicalTargetCount:
        perTarget.filter(
          (row) =>
            row.canonicalRowCount ===
            EXPECTED_ROWS_PER_TARGET,
        ).length,
    },

    perTarget,

    diagnostics: {
      sampleMissingDesiredKeys:
        missingDesiredKeys.slice(
          0,
          10,
        ),

      sampleUnexpectedActualKeys:
        unexpectedActualKeys.slice(
          0,
          10,
        ),
    },

    conclusion:
      verified
        ? "THE_PRIOR_INSERT SUCCEEDED; THE FAILURE WAS ONLY THE RAW TIMESTAMP STRING KEY COMPARISON."
        : "DO_NOT_INSERT AGAIN. REVIEW THE KEY DIFFERENCES BEFORE ANY WRITE.",

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      verified
        ? "RERUN_ALPHA_V2_TARGET_SESSION_COVERAGE_AND_ENTRY_REPLAY"
        : "REVIEW_POST_APPLY_TIMESTAMP_OR_ROW_DIFFERENCES",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-post-apply-verify.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFY_CRASHED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
