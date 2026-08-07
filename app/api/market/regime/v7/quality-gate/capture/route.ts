import {
  NextResponse,
} from "next/server";

import {
  captureMarketDataQualityGateV710,
} from "@/lib/market/capture-market-data-quality-gate-v7-10";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await captureMarketDataQualityGateV710();

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Market data quality gate capture failed.",
      },
      {
        status: 500,
      },
    );
  }
}