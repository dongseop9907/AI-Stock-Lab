import {
  NextResponse,
} from "next/server";

import {
  linkLatestRegimeShadowOutcomesV74,
} from "@/lib/market/link-regime-shadow-outcomes-v7-4";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  automationRunId?:
    unknown;
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
        )) as RequestBody;

    const automationRunId =
      typeof body
        .automationRunId ===
        "string"
        ? body
            .automationRunId
            .trim()
        : "";

    const result =
      await linkLatestRegimeShadowOutcomesV74({
        automationRunId,
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
            : "v7.11 causal forward outcome link failed.",
      },
      {
        status: 500,
      },
    );
  }
}