import {
  NextResponse,
} from "next/server";

import {
  createMarketDataBackfillV83,
} from "@/lib/market/create-market-data-backfill-v8-3";

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

    const result =
      await createMarketDataBackfillV83({
        universeCode:
          typeof body.universeCode ===
          "string"
            ? body.universeCode
            : undefined,

        universeAsOfDate:
          typeof body.universeAsOfDate ===
          "string"
            ? body.universeAsOfDate
            : undefined,

        startDate:
          typeof body.startDate ===
          "string"
            ? body.startDate
            : undefined,

        endDate:
          typeof body.endDate ===
          "string"
            ? body.endDate
            : undefined,

        lookbackCalendarDays:
          typeof body.lookbackCalendarDays ===
          "number"
            ? body.lookbackCalendarDays
            : undefined,

        adjustedPrice:
          typeof body.adjustedPrice ===
          "boolean"
            ? body.adjustedPrice
            : undefined,

        allowedSecurityTypes:
          Array.isArray(
            body.allowedSecurityTypes,
          )
            ? (
                body.allowedSecurityTypes as unknown[]
              )
                .filter(
                  (
                    value,
                  ): value is string =>
                    typeof value ===
                    "string",
                )
            : undefined,

        excludeManagement:
          typeof body.excludeManagement ===
          "boolean"
            ? body.excludeManagement
            : undefined,

        excludeLowLiquidityFlag:
          typeof body.excludeLowLiquidityFlag ===
          "boolean"
            ? body.excludeLowLiquidityFlag
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
            : "v8.3 backfill create failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
