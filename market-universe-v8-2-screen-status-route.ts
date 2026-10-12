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

export async function GET(
  request:
    Request,
) {
  try {
    const url =
      new URL(
        request.url,
      );

    const universeCode =
      url
        .searchParams
        .get(
          "universeCode",
        ) ??
      "KRX_ALL_LISTED";

    const supabase =
      createSupabaseServerClient();

    const {
      data: run,
      error: runError,
    } =
      await supabase
        .from(
          "stock_universe_screening_runs",
        )
        .select(`
          id,
          universe_code,
          as_of_date,
          market_date,
          started_at,
          finished_at,
          status,
          criteria,
          total_members,
          master_eligible_count,
          data_ready_count,
          liquidity_eligible_count,
          final_eligible_count,
          data_coverage_rate,
          result,
          error_message,
          production_applied
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .order(
          "started_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle();

    if (
      runError
    ) {
      throw new Error(
        runError.message,
      );
    }

    let topEligible:
      unknown[] = [];

    if (
      run?.id
    ) {
      const {
        data,
        error,
      } =
        await supabase
          .from(
            "stock_universe_screening_results",
          )
          .select(`
            stock_code,
            stock_name,
            market,
            security_type,
            latest_bar_date,
            latest_close,
            recent_bar_count,
            average_volume,
            average_trading_value,
            liquidity_rank
          `)
          .eq(
            "run_id",
            run.id,
          )
          .eq(
            "eligible",
            true,
          )
          .order(
            "liquidity_rank",
            {
              ascending:
                true,
            },
          )
          .limit(50);

      if (
        error
      ) {
        throw new Error(
          error.message,
        );
      }

      topEligible =
        data ??
        [];
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "UNIVERSE_ELIGIBILITY_LIQUIDITY_STATUS_V8_2",

        latestRun:
          run ??
          null,

        topEligible,

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
            : "v8.2 universe screen status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
