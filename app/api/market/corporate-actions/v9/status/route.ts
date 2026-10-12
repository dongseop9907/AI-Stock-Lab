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
            "corporate_action_adjustment_runs",
          )
          .select(`
            id,
            stock_code,
            version,
            status,
            event_count,
            supported_event_count,
            unsupported_event_count,
            factor_count,
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
            "corporate_action_validation_runs",
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
          "CORPORATE_ACTION_STATUS_V9_4",

        adjustmentRuns:
          runs.data ??
          [],

        validations:
          validations.data ??
          [],

        rawMarketDailyBarsModified:
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
            : "v9.4 corporate-action status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
