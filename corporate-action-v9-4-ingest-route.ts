import {
  NextResponse,
} from "next/server";

import {
  ingestCorporateActionV94,
} from "@/lib/market/ingest-corporate-action-v9-4";

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
      await request.json();

    const result =
      await ingestCorporateActionV94(
        body,
      );

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
            : "v9.4 corporate-action ingest failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
