import {
  NextResponse,
} from "next/server";

import {
  evaluateHistoricalMarketDataCoverageV96,
} from "@/lib/research/evaluate-historical-market-data-coverage-v9-6";

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
      await evaluateHistoricalMarketDataCoverageV96({
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

        compilationRunId:
          typeof body.compilationRunId ===
          "string"
            ? body.compilationRunId
            : undefined,

        minimumOverallBarCoverageRate:
          typeof body.minimumOverallBarCoverageRate ===
          "number"
            ? body.minimumOverallBarCoverageRate
            : undefined,

        minimumPerMemberCoverageRate:
          typeof body.minimumPerMemberCoverageRate ===
          "number"
            ? body.minimumPerMemberCoverageRate
            : undefined,

        minimumReadyMemberRate:
          typeof body.minimumReadyMemberRate ===
          "number"
            ? body.minimumReadyMemberRate
            : undefined,

        isValidation:
          body.isValidation ===
          true,
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
            : "v9.6 market-data coverage evaluation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
