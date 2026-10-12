import { NextResponse } from "next/server";

import { syncDartDisclosures } from "@/lib/market/sync-dart-disclosures";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface SyncRequest {
  lookbackDays?: unknown;
  maxPages?: unknown;
  secret?: unknown;
}

function isLocalRequest(
  request: Request,
): boolean {
  try {
    const hostname =
      new URL(
        request.url,
      ).hostname.toLowerCase();

    return (
      hostname ===
        "localhost" ||
      hostname ===
        "127.0.0.1" ||
      hostname ===
        "::1"
    );
  } catch {
    return false;
  }
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
        )) as SyncRequest;

    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET
        ?.trim() ?? "";

    const providedSecret =
      request.headers
        .get(
          "x-automation-secret",
        )
        ?.trim() ??
      String(
        body.secret ?? "",
      ).trim();

    if (
      process.env.NODE_ENV ===
        "production" &&
      !isLocalRequest(request) &&
      (
        !expectedSecret ||
        expectedSecret !==
          providedSecret
      )
    ) {
      return NextResponse.json(
        {
          ok: false,

          message:
            "DART 공시 수집 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const result =
      await syncDartDisclosures({
        lookbackDays:
          Number(
            body.lookbackDays ??
              3,
          ),

        maxPages:
          Number(
            body.maxPages ??
              10,
          ),
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "DART 공시 수집 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}