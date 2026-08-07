import {
  NextResponse,
} from "next/server";

import {
  analyzeRegimeV7Trades,
} from "@/lib/backtest/analyze-regime-v7-trades";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  runIds?: unknown;
  stockCodes?: unknown;
}

function getStringArray(
  value: unknown,
): string[] {
  if (
    !Array.isArray(
      value,
    )
  ) {
    return [];
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

    const result =
      await analyzeRegimeV7Trades({
        runIds:
          getStringArray(
            body.runIds,
          ),

        stockCodes:
          getStringArray(
            body.stockCodes,
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
            : "Market Regime v7 trade-feature analysis failed.",
      },
      {
        status: 500,
      },
    );
  }
}