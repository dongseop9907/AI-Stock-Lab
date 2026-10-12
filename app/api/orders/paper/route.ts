import { NextResponse } from "next/server";

import { createPaperBuyOrder } from "@/lib/trading/paper-order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PaperBuyRequest {
  stockCode?: unknown;
  proposedStopPrice?: unknown;
  requestedQuantity?: unknown;
  modelId?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PaperBuyRequest;

    const result = await createPaperBuyOrder({
      stockCode: String(body.stockCode ?? ""),
      proposedStopPrice: Number(body.proposedStopPrice),
      requestedQuantity: Number(body.requestedQuantity),
      modelId: String(body.modelId ?? ""),
    });

    return NextResponse.json({
      ok: true,
      approved: result.risk.approved,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        approved: false,
        message:
          error instanceof Error
            ? error.message
            : "모의주문 처리 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}