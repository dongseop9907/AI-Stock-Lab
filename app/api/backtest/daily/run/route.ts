import { NextResponse } from "next/server";

import { runDailyBacktest } from "@/lib/backtest/run-daily-backtest";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  startDate?: unknown;
  endDate?: unknown;

  stockCodes?: unknown;

  initialCash?: unknown;

  entryThreshold?: unknown;
  stopDistanceRate?: unknown;

  feeRate?: unknown;
  taxRate?: unknown;
  slippageRate?: unknown;

  maxPositions?: unknown;
  maxPositionRate?: unknown;

  maxHoldingDays?: unknown;
}

function getStringArray(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(
    (
      item,
    ): item is string =>
      typeof item ===
      "string",
  );
}

function getOptionalString(
  value: unknown,
): string | undefined {
  return typeof value ===
    "string"
    ? value
    : undefined;
}

function getOptionalNumber(
  value: unknown,
): number | undefined {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return undefined;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : undefined;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as RequestBody;

    const result =
      await runDailyBacktest({
        startDate:
          getOptionalString(
            body.startDate,
          ),

        endDate:
          getOptionalString(
            body.endDate,
          ),

        stockCodes:
          getStringArray(
            body.stockCodes,
          ),

        initialCash:
          getOptionalNumber(
            body.initialCash,
          ),

        entryThreshold:
          getOptionalNumber(
            body.entryThreshold,
          ),

        stopDistanceRate:
          getOptionalNumber(
            body.stopDistanceRate,
          ),

        feeRate:
          getOptionalNumber(
            body.feeRate,
          ),

        taxRate:
          getOptionalNumber(
            body.taxRate,
          ),

        slippageRate:
          getOptionalNumber(
            body.slippageRate,
          ),

        maxPositions:
          getOptionalNumber(
            body.maxPositions,
          ),

        maxPositionRate:
          getOptionalNumber(
            body.maxPositionRate,
          ),

        maxHoldingDays:
          getOptionalNumber(
            body.maxHoldingDays,
          ),
      });

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
            : "일봉 백테스트 실행 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}