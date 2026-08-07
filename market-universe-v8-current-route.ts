import {
  NextResponse,
} from "next/server";

import {
  getPointInTimeUniverseV80,
} from "@/lib/market/get-point-in-time-universe-v8";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

function parseBoolean(
  value:
    string | null,

  fallback:
    boolean,
) {
  if (
    value ===
      null
  ) {
    return fallback;
  }

  if (
    value ===
      "true"
  ) {
    return true;
  }

  if (
    value ===
      "false"
  ) {
    return false;
  }

  return fallback;
}

export async function GET(
  request:
    Request,
) {
  try {
    const url =
      new URL(
        request.url,
      );

    const result =
      await getPointInTimeUniverseV80({
        universeCode:
          url
            .searchParams
            .get(
              "universeCode",
            ) ??
          undefined,

        asOfDate:
          url
            .searchParams
            .get(
              "asOfDate",
            ) ??
          undefined,

        requirePitEligible:
          parseBoolean(
            url
              .searchParams
              .get(
                "requirePitEligible",
              ),
            true,
          ),

        requireTradable:
          parseBoolean(
            url
              .searchParams
              .get(
                "requireTradable",
              ),
            true,
          ),
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
            : "v8.0 universe resolve failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
