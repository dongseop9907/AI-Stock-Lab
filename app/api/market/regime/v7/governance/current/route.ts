import {
  NextResponse,
} from "next/server";

import {
  getRegimeGovernanceV76,
} from "@/lib/market/get-regime-governance-v7-6";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const result =
      await getRegimeGovernanceV76();

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
            : "Regime v7.6 governance evaluation failed.",
      },
      {
        status: 500,
      },
    );
  }
}