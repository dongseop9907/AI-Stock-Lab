import {
  NextResponse,
} from "next/server";

import {
  getCurrentMarketRegimeShadowComparisonV73,
} from "@/lib/market/market-regime-shadow-comparator-v7-3";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getCurrentMarketRegimeShadowComparisonV73();

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
            : "Market Regime v7.3 shadow comparison failed.",
      },
      {
        status: 500,
      },
    );
  }
}