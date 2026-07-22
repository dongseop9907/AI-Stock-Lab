import { NextResponse } from "next/server";

import { syncMarketSnapshots } from "@/lib/market/sync-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await syncMarketSnapshots();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "시세 수집 중 알 수 없는 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}