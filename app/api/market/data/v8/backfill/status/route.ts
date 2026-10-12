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

    const runId =
      url
        .searchParams
        .get(
          "runId",
        );

    const supabase =
      createSupabaseServerClient();

    let runQuery =
      supabase
        .from(
          "market_data_backfill_runs",
        )
        .select(`
          id,
          universe_code,
          universe_as_of_date,
          start_date,
          end_date,
          adjusted_price,
          allowed_security_types,
          exclude_management,
          exclude_low_liquidity_flag,
          max_attempts,
          request_delay_ms,
          status,
          task_count,
          pending_count,
          running_count,
          success_count,
          failed_count,
          received_rows,
          saved_rows,
          started_at,
          finished_at,
          updated_at,
          metadata,
          error_message,
          production_applied
        `);

    if (
      runId
    ) {
      runQuery =
        runQuery.eq(
          "id",
          runId,
        );
    }

    const {
      data: run,
      error: runError,
    } =
      await runQuery
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

    if (
      !run
    ) {
      return NextResponse.json({
        ok:
          true,

        result: {
          version:
            "SCALABLE_MARKET_DATA_BACKFILL_STATUS_V8_3",

          run:
            null,

          recentFailures:
            [],

          productionApplied:
            false,
        },
      });
    }

    const {
      data: failures,
      error: failureError,
    } =
      await supabase
        .from(
          "market_data_backfill_tasks",
        )
        .select(`
          id,
          stock_code,
          stock_name,
          market,
          attempt_count,
          start_date,
          end_date,
          last_error,
          updated_at
        `)
        .eq(
          "run_id",
          run.id,
        )
        .eq(
          "status",
          "FAILED",
        )
        .order(
          "updated_at",
          {
            ascending:
              false,
          },
        )
        .limit(20);

    if (
      failureError
    ) {
      throw new Error(
        failureError.message,
      );
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "SCALABLE_MARKET_DATA_BACKFILL_STATUS_V8_3",

        run,

        recentFailures:
          failures ??
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
            : "v8.3 backfill status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
