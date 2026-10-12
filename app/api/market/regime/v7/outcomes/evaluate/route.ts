import {
  NextResponse,
} from "next/server";

import {
  evaluateRegimeShadowOutcomesV74,
} from "@/lib/market/evaluate-regime-shadow-outcomes-v7-4";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  limit?: unknown;
}

function getLimit(
  value: unknown,
) {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 200;
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

    const result =
      await evaluateRegimeShadowOutcomesV74(
        getLimit(
          body.limit,
        ),
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
            : "Regime v7.4 outcome evaluation failed.",
      },
      {
        status: 500,
      },
    );
  }
}