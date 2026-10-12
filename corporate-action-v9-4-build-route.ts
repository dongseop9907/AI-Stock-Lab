import {
  NextResponse,
} from "next/server";

import {
  buildCorporateActionAdjustmentV94,
} from "@/lib/market/build-corporate-action-adjustment-v9-4";

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
        await request.json()
      ) as Record<
        string,
        unknown
      >;

    if (
      typeof body.stockCode !==
      "string"
    ) {
      return NextResponse.json(
        {
          ok:
            false,

          message:
            "stockCode is required.",
        },
        {
          status:
            400,
        },
      );
    }

    const result =
      await buildCorporateActionAdjustmentV94({
        stockCode:
          body.stockCode,

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
            : "v9.4 corporate-action adjustment failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
