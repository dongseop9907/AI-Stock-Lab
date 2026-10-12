import { NextResponse } from "next/server";

import {
  validateBuyRisk,
  validateStopUpdate,
} from "@/lib/trading/risk-manager";

import type {
  BuyRiskInput,
  StopUpdateInput,
} from "@/lib/trading/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RiskRequest =
  | {
      action: "BUY";
      input: BuyRiskInput;
    }
  | {
      action: "UPDATE_STOP";
      input: StopUpdateInput;
    };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RiskRequest;

    if (body.action === "BUY") {
      const result = validateBuyRisk(body.input);

      return NextResponse.json({
        ok: true,
        action: body.action,
        result,
      });
    }

    if (body.action === "UPDATE_STOP") {
      const result = validateStopUpdate(body.input);

      return NextResponse.json({
        ok: true,
        action: body.action,
        result,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message: "지원하지 않는 위험검증 작업입니다.",
      },
      {
        status: 400,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "위험검증 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}