import {
  NextResponse,
} from "next/server";

import {
  runMarketDataIntegrityV79,
} from "@/lib/market/run-market-data-integrity-v7-9";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  windowCalendarDays?:
    unknown;

  repair?:
    unknown;
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

    const windowCalendarDays =
      typeof body
        .windowCalendarDays ===
        "number"
        ? body
            .windowCalendarDays
        : undefined;

    const repair =
      body.repair ===
      true;

    const result =
      await runMarketDataIntegrityV79({
        windowCalendarDays,
        repair,
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Market data integrity scan failed.",
      },
      {
        status: 500,
      },
    );
  }
}