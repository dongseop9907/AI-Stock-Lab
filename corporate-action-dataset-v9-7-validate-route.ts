import {
  NextResponse,
} from "next/server";

import {
  validateCorporateActionDatasetCoverageV97,
} from "@/lib/research/validate-corporate-action-dataset-coverage-v9-7";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await validateCorporateActionDatasetCoverageV97();

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
            : "v9.7 corporate-action dataset validation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
