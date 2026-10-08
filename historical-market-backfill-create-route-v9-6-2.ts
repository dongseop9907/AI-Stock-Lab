import {
  NextResponse,
} from "next/server";

import {
  createHistoricalMarketBackfillV962,
} from "@/lib/research/historical-market-backfill-v9-6-1-2";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(() => ({}))
      ) as Record<string, unknown>;

    if (
      typeof body.compilationRunId !==
        "string" ||
      typeof body.startDate !==
        "string" ||
      typeof body.endDate !==
        "string"
    ) {
      throw new Error(
        "compilationRunId, startDate and endDate are required.",
      );
    }

    const stockCodes =
      Array.isArray(body.stockCodes)
        ? body.stockCodes.filter(
            (
              value,
            ): value is string =>
              typeof value === "string",
          )
        : undefined;

    const result =
      await createHistoricalMarketBackfillV962({
        compilationRunId:
          body.compilationRunId,
        startDate:
          body.startDate,
        endDate:
          body.endDate,
        stockCodes,
        adjustedPrice:
          typeof body.adjustedPrice ===
          "boolean"
            ? body.adjustedPrice
            : undefined,
        maxAttempts:
          typeof body.maxAttempts ===
          "number"
            ? body.maxAttempts
            : undefined,
        requestDelayMs:
          typeof body.requestDelayMs ===
          "number"
            ? body.requestDelayMs
            : undefined,
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
            : "v9.6.2 backfill create failed.",
      },
      {
        status: 500,
      },
    );
  }
}
