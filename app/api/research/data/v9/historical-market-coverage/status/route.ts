import {
  NextResponse,
} from "next/server";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const supabase =
      createSupabaseServerClient();

    const [
      runs,
      validations,
    ] =
      await Promise.all([
        supabase
          .from(
            "historical_market_data_coverage_runs",
          )
          .select(`
            id,
            version,
            universe_code,
            compilation_run_id,
            start_date,
            end_date,
            status,
            observed_member_count,
            data_ready_member_count,
            expected_bar_count,
            available_bar_count,
            missing_bar_count,
            overall_bar_coverage_rate,
            ready_member_rate,
            minimum_overall_bar_coverage_rate,
            minimum_per_member_coverage_rate,
            minimum_ready_member_rate,
            summary,
            is_validation,
            started_at,
            finished_at,
            error_message,
            production_applied
          `)
          .eq(
            "is_validation",
            false,
          )
          .order(
            "started_at",
            {
              ascending:
                false,
            },
          )
          .limit(20),

        supabase
          .from(
            "historical_market_data_coverage_validation_runs",
          )
          .select(`
            id,
            validation_version,
            status,
            assertions,
            cleanup_succeeded,
            error_message,
            production_applied,
            created_at
          `)
          .order(
            "created_at",
            {
              ascending:
                false,
            },
          )
          .limit(20),
      ]);

    if (
      runs.error
    ) {
      throw new Error(
        runs.error.message,
      );
    }

    if (
      validations.error
    ) {
      throw new Error(
        validations.error.message,
      );
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "HISTORICAL_MARKET_DATA_COVERAGE_STATUS_V9_6",

        runs:
          runs.data ??
          [],

        validations:
          validations.data ??
          [],

        productionApplied:
          false,
      },
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "v9.6 market-data coverage status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
