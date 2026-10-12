import {
  NextResponse,
} from "next/server";

import {
  processMarketDataBackfillV83,
} from "@/lib/market/process-market-data-backfill-v8-3";

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
      ) as Record<
        string,
        unknown
      >;

    if (
      typeof body.runId !==
        "string" ||
      !body.runId.trim()
    ) {
      return NextResponse.json(
        {
          ok:
            false,

          message:
            "runId is required.",
        },
        {
          status:
            400,
        },
      );
    }

    const result =
      await processMarketDataBackfillV83({
        runId:
          body.runId,

        maxTasks:
          typeof body.maxTasks ===
          "number"
            ? body.maxTasks
            : undefined,

        workerId:
          typeof body.workerId ===
          "string"
            ? body.workerId
            : undefined,

        leaseSeconds:
          typeof body.leaseSeconds ===
          "number"
            ? body.leaseSeconds
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
            : "v8.3 backfill process failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
