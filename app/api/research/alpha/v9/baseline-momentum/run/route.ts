import { NextResponse } from "next/server";
import { runBaselineMomentumAlphaV90 } from "@/lib/research/run-baseline-momentum-alpha-v9-0";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await runBaselineMomentumAlphaV90({
      universeCode: typeof body.universeCode === "string" ? body.universeCode : undefined,
      minimumCoverageRate: typeof body.minimumCoverageRate === "number" ? body.minimumCoverageRate : undefined,
      topN: typeof body.topN === "number" ? body.topN : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "v9.0 alpha research run failed." },
      { status: 500 },
    );
  }
}
