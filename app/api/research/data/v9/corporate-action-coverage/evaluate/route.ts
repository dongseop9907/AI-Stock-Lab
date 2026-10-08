import {
  NextResponse,
} from "next/server";

import {
  evaluateCorporateActionDatasetCoverageV97,
} from "@/lib/research/evaluate-corporate-action-dataset-coverage-v9-7";

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
      await evaluateCorporateActionDatasetCoverageV97({
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

        sourceCoverageWindowId:
          typeof body.sourceCoverageWindowId ===
          "string"
            ? body.sourceCoverageWindowId
            : undefined,

        provider:
          typeof body.provider ===
          "string"
            ? body.provider
            : undefined,

        requiredActionTypes:
          Array.isArray(
            body.requiredActionTypes,
          )
            ? body.requiredActionTypes.map(
                (
                  value,
                ) =>
                  String(
                    value,
                  ),
              )
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
            : "v9.7 corporate-action dataset coverage failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
