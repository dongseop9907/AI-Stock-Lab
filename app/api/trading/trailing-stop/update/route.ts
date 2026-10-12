import { NextResponse } from "next/server";

import { updateTrailingStops } from "@/lib/trading/update-trailing-stops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await updateTrailingStops();

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
            : "추적손절 갱신 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}