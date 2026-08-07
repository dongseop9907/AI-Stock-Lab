import { NextResponse } from "next/server";

import { syncDailyBars } from "@/lib/market/sync-daily-bars";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  stockCodes?: unknown;

  startDate?: unknown;
  endDate?: unknown;

  adjustedPrice?: unknown;
  chunkDays?: unknown;
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

    const startDate =
      String(
        body.startDate ??
          "",
      ).trim();

    const endDate =
      String(
        body.endDate ??
          "",
      ).trim();

    if (
      !/^\d{8}$/.test(
        startDate,
      ) ||
      !/^\d{8}$/.test(
        endDate,
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "startDate와 endDate는 YYYYMMDD 형식이어야 합니다.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await syncDailyBars({
        startDate,
        endDate,

        stockCodes:
          getStringArray(
            body.stockCodes,
          ),

        adjustedPrice:
          typeof body.adjustedPrice ===
          "boolean"
            ? body.adjustedPrice
            : true,

        chunkDays:
          Number(
            body.chunkDays ??
              80,
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
            : "과거 일봉 수집 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}