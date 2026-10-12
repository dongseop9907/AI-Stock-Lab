import { NextResponse } from "next/server";

import {
  syncIndexDailyBars,
  type MarketIndexCode,
} from "@/lib/market/sync-index-daily-bars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  markets?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  chunkDays?: unknown;
}

function getMarkets(
  value: unknown,
): MarketIndexCode[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(
    (
      item,
    ): item is MarketIndexCode =>
      item === "KOSPI" ||
      item === "KOSDAQ",
  );
}

function getRequiredDate(
  value: unknown,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    !/^\d{8}$/.test(value)
  ) {
    throw new Error(
      `${fieldName} must use YYYYMMDD.`,
    );
  }

  return value;
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

  const parsed = Number(value);

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
        .catch(() => ({}))) as RequestBody;

    const startDate =
      getRequiredDate(
        body.startDate,
        "startDate",
      );

    const endDate =
      getRequiredDate(
        body.endDate,
        "endDate",
      );

    if (startDate > endDate) {
      throw new Error(
        "startDate cannot be after endDate.",
      );
    }

    const result =
      await syncIndexDailyBars({
        markets:
          getMarkets(
            body.markets,
          ),

        startDate,
        endDate,

        chunkDays:
          getOptionalNumber(
            body.chunkDays,
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
            : "Index daily sync failed.",
      },
      {
        status: 500,
      },
    );
  }
}