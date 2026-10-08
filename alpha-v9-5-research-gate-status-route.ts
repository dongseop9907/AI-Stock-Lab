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

    const {
      data,
      error,
    } =
      await supabase
        .from(
          "alpha_backtest_research_gate_runs",
        )
        .select(`
          id,
          gate_version,
          universe_code,
          requested_start_date,
          requested_end_date,
          status,
          checks,
          blockers,
          automatic_backtest_started,
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
        .limit(20);

    if (
      error
    ) {
      throw new Error(
        error.message,
      );
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "ALPHA_BACKTEST_RESEARCH_GATE_STATUS_V9_5",

        runs:
          data ??
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
            : "v9.5 gate status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
