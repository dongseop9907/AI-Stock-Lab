import { NextResponse } from "next/server";

import { runWalkForwardValidation } from "@/lib/backtest/run-walk-forward";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  stockCodes?: unknown;

  thresholdCandidates?: unknown;

  initialCash?: unknown;

  stopDistanceRate?: unknown;

  feeRate?: unknown;
  taxRate?: unknown;
  slippageRate?: unknown;

  maxPositions?: unknown;
  maxPositionRate?: unknown;

  maxHoldingDays?: unknown;

  startYear?: unknown;
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

function getNumberArray(
  value: unknown,
): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) =>
      Number(item),
    )
    .filter(
      (item) =>
        Number.isFinite(item),
    );
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
      await runWalkForwardValidation({
        stockCodes:
          getStringArray(
            body.stockCodes,
          ),

        thresholdCandidates:
          getNumberArray(
            body.thresholdCandidates,
          ),

        initialCash:
          getOptionalNumber(
            body.initialCash,
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

        startYear:
          getOptionalNumber(
            body.startYear,
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
            : "Walk-Forward 검증 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}