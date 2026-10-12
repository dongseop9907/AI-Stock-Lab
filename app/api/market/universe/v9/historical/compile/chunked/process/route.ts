import {
  NextResponse,
} from "next/server";

import {
  processHistoricalPitChunkedCompilationV93B3,
} from "@/lib/market/process-historical-pit-chunked-compilation-v9-3b-3";

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

    if (
      typeof body.compilationRunId !==
        "string"
    ) {
      throw new Error(
        "compilationRunId is required.",
      );
    }

    const result =
      await processHistoricalPitChunkedCompilationV93B3({
        compilationRunId:
          body.compilationRunId,

        maxChunks:
          typeof body.maxChunks ===
          "number"
            ? body.maxChunks
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
            : "v9.3B.3 process failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
