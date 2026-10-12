import {
  NextResponse,
} from "next/server";

import {
  compileHistoricalUniverseIntervalsV93B,
} from "@/lib/market/compile-historical-universe-intervals-v9-3b";

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
      return NextResponse.json(
        {
          ok:
            false,

          message:
            "universeCode, provider, startDate, endDate are required.",
        },
        {
          status:
            400,
        },
      );
    }

    const result =
      await compileHistoricalUniverseIntervalsV93B({
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
            : "v9.3B interval compilation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
