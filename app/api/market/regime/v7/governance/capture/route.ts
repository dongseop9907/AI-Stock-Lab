import {
  NextResponse,
} from "next/server";

import {
  captureRegimeGovernanceReviewV76,
} from "@/lib/market/capture-regime-governance-review-v7-6";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await captureRegimeGovernanceReviewV76();

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
            : "Regime v7.6 governance capture failed.",
      },
      {
        status: 500,
      },
    );
  }
}