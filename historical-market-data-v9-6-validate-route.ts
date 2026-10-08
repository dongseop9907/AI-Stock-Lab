import {
  NextResponse,
} from "next/server";

import {
  validateHistoricalMarketDataCoverageV96,
} from "@/lib/research/validate-historical-market-data-coverage-v9-6";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await validateHistoricalMarketDataCoverageV96();

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
            : "v9.6 market-data coverage validation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
