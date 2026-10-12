import { NextResponse } from "next/server";

import { executeApprovedPaperOrders } from "@/lib/trading/execute-approved-paper-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecuteApprovedRequest {
  maxOrders?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as ExecuteApprovedRequest;

    const maxOrders =
      body.maxOrders === undefined
        ? 5
        : Number(body.maxOrders);

    const result =
      await executeApprovedPaperOrders(
        maxOrders,
      );

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
            : "승인 주문 체결 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}