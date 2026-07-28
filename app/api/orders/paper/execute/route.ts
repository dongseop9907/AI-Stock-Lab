import { NextResponse } from "next/server";

import { executePaperOrder } from "@/lib/trading/execute-paper-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecuteOrderRequest {
  orderId?: unknown;
}

function getErrorStatus(message: string): number {
  if (
    message.includes("INVALID_ORDER_ID") ||
    message.includes("APPROVED_QUANTITY_IS_ZERO") ||
    message.includes("STOP_PRICE_IS_REQUIRED")
  ) {
    return 400;
  }

  if (
    message.includes("ORDER_NOT_FOUND") ||
    message.includes("ACCOUNT_NOT_FOUND")
  ) {
    return 404;
  }

  if (
    message.includes("ORDER_NOT_RISK_APPROVED") ||
    message.includes("INSUFFICIENT_CASH_AT_EXECUTION") ||
    message.includes("LIVE_ACCOUNT_NOT_ALLOWED")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as ExecuteOrderRequest;

    const orderId = String(body.orderId ?? "");

    const result = await executePaperOrder(orderId);

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "모의체결 중 오류가 발생했습니다.";

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      {
        status: getErrorStatus(message),
      },
    );
  }
}