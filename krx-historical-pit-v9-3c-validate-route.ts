import { NextResponse } from "next/server";
import {
  validateKrxHistoricalPitProviderV93C,
} from "@/lib/market/validate-krx-historical-pit-provider-v9-3c";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const result = await validateKrxHistoricalPitProviderV93C({
      historicalDate:
        typeof body.historicalDate === "string"
          ? body.historicalDate
          : undefined,
      comparisonDate:
        typeof body.comparisonDate === "string"
          ? body.comparisonDate
          : undefined,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "v9.3C validation failed.",
      },
      { status: 500 },
    );
  }
}
