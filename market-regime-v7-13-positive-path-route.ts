import {
  NextResponse,
} from "next/server";

import {
  runMarketRegimePositivePathValidationV713,
} from "@/lib/market/run-market-regime-positive-path-validation-v7-13";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  retainArtifacts?:
    unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(
            () => ({}),
          )
      ) as RequestBody;

    const result =
      await runMarketRegimePositivePathValidationV713({
        retainArtifacts:
          body
            .retainArtifacts ===
          true,
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "v7.13 positive-path validation failed.",
      },
      {
        status: 500,
      },
    );
  }
}
