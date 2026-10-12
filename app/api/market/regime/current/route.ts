import { NextResponse } from "next/server";

import {
  getCurrentMarketRegimeShadowSafe,
} from "@/lib/trading/market-regime-shadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result =
    await getCurrentMarketRegimeShadowSafe();

  return NextResponse.json({
    ok:
      result.regime !==
      "UNKNOWN",

    result,
  });
}