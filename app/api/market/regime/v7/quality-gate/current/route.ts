import {
  NextResponse,
} from "next/server";

import {
  getMarketDataQualityGateV710,
} from "@/lib/market/get-market-data-quality-gate-v7-10";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getMarketDataQualityGateV710();

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
            : "Market data quality gate failed.",
      },
      {
        status: 500,
      },
    );
  }
}