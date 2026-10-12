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
    const supabase =
      createSupabaseServerClient();

    const url =
      new URL(
        request.url,
      );

    const compilationRunId =
      url.searchParams
        .get(
          "compilationRunId",
        )
        ?.trim();

    if (
      !compilationRunId
    ) {
      throw new Error(
        "compilationRunId is required.",
      );
    }

    const {
      data: run,
      error: runError,
    } =
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .select("*")
        .eq(
          "id",
          compilationRunId,
        )
        .single();

    if (
      runError ||
      !run
    ) {
      throw new Error(
        `v9.3B.3 status run lookup failed: ${
          runError?.message ??
          "NO_RUN"
        }`,
      );
    }

    const {
      data: chunks,
      error: chunkError,
    } =
      await supabase
        .from(
          "historical_universe_compilation_chunks",
        )
        .select(`
          chunk_no,
          start_date,
          end_date,
          status,
          attempt_count,
          max_attempts,
          chunk_interval_count,
          merged_interval_count,
          inserted_interval_count,
          error_message,
          updated_at
        `)
        .eq(
          "compilation_run_id",
          compilationRunId,
        )
        .order(
          "chunk_no",
          {
            ascending:
              true,
          },
        );

    if (
      chunkError
    ) {
      throw new Error(
        `v9.3B.3 status chunk lookup failed: ${chunkError.message}`,
      );
    }

    const rows =
      chunks ??
      [];

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "HISTORICAL_PIT_CHUNK_STATUS_V9_3B_3",

        run,

        counts: {
          chunks:
            rows.length,

          pending:
            rows.filter(
              (
                row,
              ) =>
                row.status ===
                "PENDING",
            ).length,

          running:
            rows.filter(
              (
                row,
              ) =>
                row.status ===
                "RUNNING",
            ).length,

          success:
            rows.filter(
              (
                row,
              ) =>
                row.status ===
                "SUCCESS",
            ).length,

          failed:
            rows.filter(
              (
                row,
              ) =>
                row.status ===
                "FAILED",
            ).length,
        },

        recentFailures:
          rows
            .filter(
              (
                row,
              ) =>
                row.status ===
                "FAILED",
            )
            .slice(
              -20,
            ),

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
            : "v9.3B.3 status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
