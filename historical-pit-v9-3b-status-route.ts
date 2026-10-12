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
      compilationResult,
      validationResult,
    ] =
      await Promise.all([
        supabase
          .from(
            "historical_universe_compilation_runs",
          )
          .select(`
            id,
            universe_code,
            provider,
            calendar_index_code,
            start_date,
            end_date,
            status,
            expected_trading_dates,
            imported_complete_dates,
            missing_trading_dates,
            duplicate_complete_dates,
            compiled_interval_count,
            metadata,
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
          .limit(10),

        supabase
          .from(
            "historical_universe_validation_runs",
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
          .limit(10),
      ]);

    if (
      compilationResult.error
    ) {
      throw new Error(
        compilationResult
          .error
          .message,
      );
    }

    if (
      validationResult.error
    ) {
      throw new Error(
        validationResult
          .error
          .message,
      );
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "HISTORICAL_PIT_INTERVAL_STATUS_V9_3B",

        compilations:
          compilationResult.data ??
          [],

        validations:
          validationResult.data ??
          [],

        canonicalMembershipsModified:
          false,

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
            : "v9.3B status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
