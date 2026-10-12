import {
  NextResponse,
} from "next/server";

import {
  getCurrentMarketRegimeFeaturesV7,
} from "@/lib/market/get-current-market-regime-features-v7";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getCurrentMarketRegimeFeaturesV7();

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
            : "Market Regime v7 feature calculation failed.",
      },
      {
        status: 500,
      },
    );
  }
}