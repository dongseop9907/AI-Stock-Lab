import {
  NextResponse,
} from "next/server";

import {
  getCurrentForwardCausalCohortV711,
} from "@/lib/market/get-current-forward-causal-cohort-v7-11";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getCurrentForwardCausalCohortV711();

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
            : "v7.11 current causal cohort load failed.",
      },
      {
        status: 500,
      },
    );
  }
}