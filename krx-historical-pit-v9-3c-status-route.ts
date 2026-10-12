import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId")?.trim();

    if (!runId) throw new Error("runId is required.");

    const { data: run, error: runError } = await supabase
      .from("krx_historical_pit_import_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (runError || !run) {
      throw new Error(
        `v9.3C status run lookup failed: ${runError?.message ?? "NO_RUN"}`,
      );
    }

    const { data: failures, error: failureError } = await supabase
      .from("krx_historical_pit_import_tasks")
      .select("id,as_of_date,status,attempt_count,error_message,updated_at")
      .eq("run_id", runId)
      .eq("status", "FAILED")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (failureError) {
      throw new Error(
        `v9.3C status failure lookup failed: ${failureError.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      result: {
        version: "KRX_HISTORICAL_PIT_STATUS_V9_3C",
        run,
        recentFailures: failures ?? [],
        productionApplied: false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "v9.3C status failed.",
      },
      { status: 500 },
    );
  }
}
