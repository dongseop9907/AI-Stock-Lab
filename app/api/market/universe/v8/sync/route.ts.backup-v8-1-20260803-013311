import {
  NextResponse,
} from "next/server";

import {
  syncKrxPointInTimeUniverseV81,
} from "@/lib/market/sync-krx-point-in-time-universe-v8-1";

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
      await syncKrxPointInTimeUniverseV81({
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
            : "v8.1 KRX universe sync failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
