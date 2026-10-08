import {
  NextResponse,
} from "next/server";

import {
  evaluateAlphaBacktestResearchGateV95,
} from "@/lib/research/evaluate-alpha-backtest-research-gate-v9-5";

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

    const result =
      await evaluateAlphaBacktestResearchGateV95({
        universeCode:
          typeof body.universeCode ===
          "string"
            ? body.universeCode
            : undefined,

        startDate:
          typeof body.startDate ===
          "string"
            ? body.startDate
            : undefined,

        endDate:
          typeof body.endDate ===
          "string"
            ? body.endDate
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
            : "v9.5 research gate failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
