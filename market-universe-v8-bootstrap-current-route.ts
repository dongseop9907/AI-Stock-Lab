import {
  NextResponse,
} from "next/server";

import {
  bootstrapLegacyUniverseV80,
} from "@/lib/market/bootstrap-legacy-universe-v8";

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
      ) as {
        asOfDate?:
          unknown;
      };

    const result =
      await bootstrapLegacyUniverseV80({
        asOfDate:
          typeof body
            .asOfDate ===
          "string"
            ? body
                .asOfDate
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
            : "v8.0 universe bootstrap failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
