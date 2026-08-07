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
      runResponse,
      definitionsResponse,
    ] =
      await Promise.all([
        supabase
          .from(
            "stock_universe_sync_runs",
          )
          .select(`
            id,
            started_at,
            finished_at,
            as_of_date,
            status,
            source,
            source_version,
            kospi_raw_count,
            kospi_member_count,
            kosdaq_raw_count,
            kosdaq_member_count,
            combined_member_count,
            snapshots,
            error_message,
            production_applied
          `)
          .order(
            "started_at",
            {
              ascending:
                false,
            },
          )
          .limit(1)
          .maybeSingle(),

        supabase
          .from(
            "stock_universe_definitions",
          )
          .select(`
            universe_code,
            display_name,
            is_ready,
            requires_complete_coverage,
            metadata,
            updated_at
          `)
          .in(
            "universe_code",
            [
              "KRX_KOSPI_LISTED",
              "KRX_KOSDAQ_LISTED",
              "KRX_ALL_LISTED",
            ],
          )
          .order(
            "universe_code",
            {
              ascending:
                true,
            },
          ),
      ]);

    if (
      runResponse.error
    ) {
      throw new Error(
        runResponse
          .error
          .message,
      );
    }

    if (
      definitionsResponse.error
    ) {
      throw new Error(
        definitionsResponse
          .error
          .message,
      );
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "POINT_IN_TIME_UNIVERSE_STATUS_V8_1",

        latestRun:
          runResponse.data ??
          null,

        definitions:
          definitionsResponse.data ??
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
            : "v8.1 universe status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
