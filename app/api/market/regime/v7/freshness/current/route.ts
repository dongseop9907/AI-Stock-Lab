import {
  NextResponse,
} from "next/server";

import {
  getMarketDataFreshnessV77,
} from "@/lib/market/get-market-data-freshness-v7-7";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getMarketDataFreshnessV77();

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
            : "Market data freshness evaluation failed.",
      },
      {
        status: 500,
      },
    );
  }
}