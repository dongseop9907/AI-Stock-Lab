import {
  NextResponse,
} from "next/server";

import {
  screenPointInTimeUniverseV82,
} from "@/lib/market/screen-point-in-time-universe-v8-2";

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
      await screenPointInTimeUniverseV82({
        universeCode:
          typeof body
            .universeCode ===
          "string"
            ? body
                .universeCode
            : undefined,

        asOfDate:
          typeof body
            .asOfDate ===
          "string"
            ? body
                .asOfDate
            : undefined,

        lookbackCalendarDays:
          typeof body
            .lookbackCalendarDays ===
          "number"
            ? body
                .lookbackCalendarDays
            : undefined,

        minimumBars:
          typeof body
            .minimumBars ===
          "number"
            ? body
                .minimumBars
            : undefined,

        minimumPrice:
          typeof body
            .minimumPrice ===
          "number"
            ? body
                .minimumPrice
            : undefined,

        minimumAverageTradingValue:
          typeof body
            .minimumAverageTradingValue ===
          "number"
            ? body
                .minimumAverageTradingValue
            : undefined,

        minimumCoverageRate:
          typeof body
            .minimumCoverageRate ===
          "number"
            ? body
                .minimumCoverageRate
            : undefined,

        allowedSecurityTypes:
          Array.isArray(
            body
              .allowedSecurityTypes,
          )
            ? (
                body
                  .allowedSecurityTypes as unknown[]
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
          typeof body
            .excludeManagement ===
          "boolean"
            ? body
                .excludeManagement
            : undefined,

        excludeLowLiquidityFlag:
          typeof body
            .excludeLowLiquidityFlag ===
          "boolean"
            ? body
                .excludeLowLiquidityFlag
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
            : "v8.2 universe screening failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
