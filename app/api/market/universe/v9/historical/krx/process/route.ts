import { NextResponse } from "next/server";
import {
  processKrxHistoricalPitImportRunV93C,
} from "@/lib/market/process-krx-historical-pit-import-run-v9-3c";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof body.runId !== "string") {
      throw new Error("runId is required.");
    }

    const result = await processKrxHistoricalPitImportRunV93C({
      runId: body.runId,
      maxTasks:
        typeof body.maxTasks === "number" ? body.maxTasks : undefined,
      requestDelayMs:
        typeof body.requestDelayMs === "number"
          ? body.requestDelayMs
          : undefined,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "v9.3C process failed.",
      },
      { status: 500 },
    );
  }
}
