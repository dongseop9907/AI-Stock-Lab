import { createSupabaseServerClient } from "../lib/supabase";

async function main() {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    "KRX_ALL_LISTED";

  const startDate =
    "2023-01-02";

  const endDate =
    "2026-07-31";

  const [
    compilationResult,
    sourceResult,
    assertionResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .select(`
          id,
          provider,
          status,
          start_date,
          end_date,
          expected_trading_dates,
          imported_complete_dates,
          missing_trading_dates,
          duplicate_complete_dates,
          compiled_interval_count,
          is_validation
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          startDate,
        )
        .gte(
          "end_date",
          endDate,
        )
        .limit(20),

      supabase
        .from(
          "corporate_action_source_coverage_windows",
        )
        .select(`
          id,
          universe_code,
          provider,
          provider_version,
          start_date,
          end_date,
          coverage_status,
          markets,
          action_types,
          source_fingerprint,
          evidence,
          is_validation
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          endDate,
        )
        .gte(
          "end_date",
          startDate,
        )
        .order(
          "start_date",
          {
            ascending: true,
          },
        )
        .limit(200),

      supabase
        .from(
          "corporate_action_coverage_assertions",
        )
        .select(`
          id,
          universe_code,
          provider,
          start_date,
          end_date,
          coverage_status,
          supported_action_types,
          unsupported_action_types,
          evidence,
          is_validation,
          production_applied
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          endDate,
        )
        .gte(
          "end_date",
          startDate,
        )
        .order(
          "start_date",
          {
            ascending: true,
          },
        )
        .limit(200),
    ]);

  if (
    compilationResult.error
  ) {
    throw new Error(
      `COMPILATION_QUERY_FAILED:${compilationResult.error.message}`,
    );
  }

  if (
    sourceResult.error
  ) {
    throw new Error(
      `SOURCE_COVERAGE_QUERY_FAILED:${sourceResult.error.message}`,
    );
  }

  if (
    assertionResult.error
  ) {
    throw new Error(
      `ASSERTION_QUERY_FAILED:${assertionResult.error.message}`,
    );
  }

  const windows =
    sourceResult.data ?? [];

  const fullRangeWindows =
    windows.filter(
      row =>
        String(
          row.start_date,
        ) <= startDate &&
        String(
          row.end_date,
        ) >= endDate,
    );

  const completeFullRangeWindows =
    fullRangeWindows.filter(
      row =>
        row.coverage_status ===
        "COMPLETE",
    );

  console.log(
    JSON.stringify(
      {
        version:
          "CORPORATE_ACTION_SOURCE_COVERAGE_DIAGNOSTIC_V1",

        requestedRange: {
          universeCode,
          startDate,
          endDate,
        },

        compilation:
          compilationResult.data ??
          [],

        sourceCoverage: {
          overlappingWindowCount:
            windows.length,

          fullRangeWindowCount:
            fullRangeWindows.length,

          completeFullRangeWindowCount:
            completeFullRangeWindows.length,

          windows,
        },

        existingAssertions:
          assertionResult.data ??
          [],

        interpretation:
          completeFullRangeWindows.length >
          0
            ? "FULL_RANGE_COMPLETE_SOURCE_WINDOW_EXISTS"
            : "NO_FULL_RANGE_COMPLETE_SOURCE_WINDOW",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      error instanceof Error
        ? error.stack
        : error,
    );

    process.exitCode = 1;
  },
);
