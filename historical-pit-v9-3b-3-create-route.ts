import {
  NextResponse,
} from "next/server";

import {
  createHistoricalPitChunkedCompilationV93B3,
} from "@/lib/market/create-historical-pit-chunked-compilation-v9-3b-3";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST(
  request:
    Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(
            () => ({}),
          )
      ) as Record<
        string,
        unknown
      >;

    if (
      typeof body.universeCode !==
        "string" ||
      typeof body.provider !==
        "string" ||
      typeof body.startDate !==
        "string" ||
      typeof body.endDate !==
        "string"
    ) {
      throw new Error(
        "universeCode, provider, startDate, endDate are required.",
      );
    }

    const result =
      await createHistoricalPitChunkedCompilationV93B3({
        universeCode:
          body.universeCode,

        provider:
          body.provider,

        startDate:
          body.startDate,

        endDate:
          body.endDate,

        calendarIndexCode:
          typeof body.calendarIndexCode ===
          "string"
            ? body.calendarIndexCode
            : undefined,

        chunkTradingDays:
          typeof body.chunkTradingDays ===
          "number"
            ? body.chunkTradingDays
            : undefined,

        maxAttempts:
          typeof body.maxAttempts ===
          "number"
            ? body.maxAttempts
            : undefined,

        isValidation:
          body.isValidation ===
          true,
      });

    return NextResponse.json({
      ok:
        true,

      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "v9.3B.3 create failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
