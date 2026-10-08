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
      windows,
    ] =
      await Promise.all([
        supabase
          .from(
            "corporate_action_dataset_coverage_runs",
          )
          .select(`
            id,
            version,
            universe_code,
            compilation_run_id,
            source_coverage_window_id,
            start_date,
            end_date,
            status,
            pit_member_count,
            pit_markets,
            required_action_types,
            missing_markets,
            missing_action_types,
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
            "corporate_action_dataset_coverage_validation_runs",
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
            evidence,
            is_validation,
            production_applied,
            created_at
          `)
          .eq(
            "is_validation",
            false,
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            },
          )
          .limit(20),
      ]);

    for (
      const result
      of [
        runs,
        validations,
        windows,
      ]
    ) {
      if (
        result.error
      ) {
        throw new Error(
          result.error.message,
        );
      }
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "CORPORATE_ACTION_DATASET_COVERAGE_STATUS_V9_7",

        runs:
          runs.data ??
          [],

        validations:
          validations.data ??
          [],

        sourceCoverageWindows:
          windows.data ??
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
            : "v9.7 corporate-action dataset status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
