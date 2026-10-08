import {
  NextResponse,
} from "next/server";

import {
  reconcileHistoricalSecurityMasterV961,
} from "@/lib/research/historical-market-backfill-v9-6-1-2";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(() => ({}))
      ) as Record<string, unknown>;

    if (
      typeof body.compilationRunId !==
      "string"
    ) {
      throw new Error(
        "compilationRunId is required.",
      );
    }

    const result =
      await reconcileHistoricalSecurityMasterV961(
        body.compilationRunId,
      );

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
            : "v9.6.1 reconciliation failed.",
      },
      {
        status: 500,
      },
    );
  }
}
