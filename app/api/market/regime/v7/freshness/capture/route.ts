import {
  NextResponse,
} from "next/server";

import {
  captureMarketDataFreshnessV77,
} from "@/lib/market/capture-market-data-freshness-v7-7";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await captureMarketDataFreshnessV77();

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Market data freshness capture failed.",
      },
      {
        status: 500,
      },
    );
  }
}