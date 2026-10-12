import { NextResponse } from "next/server";

import { generateEntrySignals } from "@/lib/trading/generate-entry-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateEntrySignalRequest {
  modelId?: unknown;
  autoOrder?: unknown;
  maxOrders?: unknown;
  stockCodes?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as GenerateEntrySignalRequest;

    const modelId =
      body.modelId === undefined ||
      body.modelId === null ||
      String(body.modelId).trim() === ""
        ? undefined
        : String(body.modelId).trim();

    const autoOrder =
      body.autoOrder === true;

    const maxOrders =
      body.maxOrders === undefined
        ? undefined
        : Number(body.maxOrders);

    const stockCodes =
      Array.isArray(body.stockCodes)
        ? body.stockCodes.map(
            (value) =>
              String(value),
          )
        : undefined;

    const result =
      await generateEntrySignals({
        modelId,
        autoOrder,
        maxOrders,
        stockCodes,
      });

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
            : "진입 신호 생성 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}