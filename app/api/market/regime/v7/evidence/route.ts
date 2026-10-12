import {
  NextResponse,
} from "next/server";

import {
  getRegimeForwardEvidenceV75,
} from "@/lib/market/get-regime-forward-evidence-v7-5";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getRegimeForwardEvidenceV75();

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
            : "Regime v7.5 evidence load failed.",
      },
      {
        status: 500,
      },
    );
  }
}