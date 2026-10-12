import {
  NextResponse,
} from "next/server";

import {
  validateHistoricalPitIntervalsV93B,
} from "@/lib/market/validate-historical-pit-intervals-v9-3b";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await validateHistoricalPitIntervalsV93B();

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
            : "v9.3B validation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
