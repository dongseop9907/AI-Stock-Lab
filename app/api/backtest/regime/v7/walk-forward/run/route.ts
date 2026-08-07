import {
  NextResponse,
} from "next/server";

import {
  runRegimeV7PolicyWalkForward,
} from "@/lib/backtest/run-regime-v7-policy-walk-forward";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  stockCodes?: unknown;

  initialCash?: unknown;

  stopDistanceRate?: unknown;

  feeRate?: unknown;
  taxRate?: unknown;
  slippageRate?: unknown;

  maxPositions?: unknown;
  maxPositionRate?: unknown;

  maxHoldingDays?: unknown;

  minValidationTradesPerYear?: unknown;
}

function stringArray(
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

function optionalNumber(
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

  return Number.isFinite(parsed)
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
      await runRegimeV7PolicyWalkForward({
        stockCodes:
          stringArray(
            body.stockCodes,
          ),

        initialCash:
          optionalNumber(
            body.initialCash,
          ),

        stopDistanceRate:
          optionalNumber(
            body.stopDistanceRate,
          ),

        feeRate:
          optionalNumber(
            body.feeRate,
          ),

        taxRate:
          optionalNumber(
            body.taxRate,
          ),

        slippageRate:
          optionalNumber(
            body.slippageRate,
          ),

        maxPositions:
          optionalNumber(
            body.maxPositions,
          ),

        maxPositionRate:
          optionalNumber(
            body.maxPositionRate,
          ),

        maxHoldingDays:
          optionalNumber(
            body.maxHoldingDays,
          ),

        minValidationTradesPerYear:
          optionalNumber(
            body
              .minValidationTradesPerYear,
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
            : "Regime v7.2 policy walk-forward failed.",
      },
      {
        status: 500,
      },
    );
  }
}