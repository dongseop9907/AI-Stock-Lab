import { NextResponse } from "next/server";
import {
  createKrxHistoricalPitImportRunV93C,
} from "@/lib/market/create-krx-historical-pit-import-run-v9-3c";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (
      typeof body.startDate !== "string" ||
      typeof body.endDate !== "string"
    ) {
      throw new Error("startDate and endDate are required.");
    }

    const result = await createKrxHistoricalPitImportRunV93C({
      startDate: body.startDate,
      endDate: body.endDate,
      calendarIndexCode:
        typeof body.calendarIndexCode === "string"
          ? body.calendarIndexCode
          : undefined,
      requestDelayMs:
        typeof body.requestDelayMs === "number"
          ? body.requestDelayMs
          : undefined,
      maxAttempts:
        typeof body.maxAttempts === "number"
          ? body.maxAttempts
          : undefined,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "v9.3C create failed.",
      },
      { status: 500 },
    );
  }
}
