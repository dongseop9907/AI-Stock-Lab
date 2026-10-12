import {
  NextResponse,
} from "next/server";

import {
  runDailyRegimeV7Backtest,
} from "@/lib/backtest/run-daily-regime-v7-backtest";

import {
  normalizeMarketRegimeV7Policy,
} from "@/lib/market/market-regime-v7-policy";

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

  v7Policy?: unknown;
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
      await runDailyRegimeV7Backtest({
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

        v7Policy:
          normalizeMarketRegimeV7Policy(
            body.v7Policy,
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
            : "Market Regime v7.1 backtest failed.",
      },
      {
        status: 500,
      },
    );
  }
}