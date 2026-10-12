import {
  NextResponse,
} from "next/server";

import {
  validateCorporateActionFoundationV94,
} from "@/lib/market/validate-corporate-action-v9-4";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await validateCorporateActionFoundationV94();

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
            : "v9.4 corporate-action validation failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
