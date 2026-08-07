import { NextResponse } from "next/server";

import { runBacktest } from "@/lib/backtest/run-backtest";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request
        .json()
        .catch(
          () => ({}),
        );

    const result =
      await runBacktest(
        body,
      );

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
            : "백테스트 실행 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}