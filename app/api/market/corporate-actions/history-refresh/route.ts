import {
  NextResponse,
} from "next/server";

import {
  refreshCorporateActionHistoryV9726,
} from "@/lib/market/refresh-corporate-action-history-v9-7-26";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  apply?: unknown;
  includeValidationEvents?: unknown;
  detectionLookbackCalendarDays?: unknown;
  throughDate?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(
            () => ({}),
          )
      ) as RequestBody;

    const apply =
      body.apply ===
      true;

    const includeValidationEvents =
      body.includeValidationEvents ===
      true;

    if (
      apply &&
      includeValidationEvents
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "VALIDATION_EVENTS_CANNOT_DRIVE_PRODUCTION_REFRESH",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await refreshCorporateActionHistoryV9726({
        dryRun:
          !apply,

        includeValidationEvents,

        detectionLookbackCalendarDays:
          typeof body
            .detectionLookbackCalendarDays ===
          "number"
            ? body
                .detectionLookbackCalendarDays
            : undefined,

        throughDate:
          typeof body
            .throughDate ===
          "string"
            ? body
                .throughDate
            : undefined,
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "UNKNOWN_CORPORATE_ACTION_HISTORY_REFRESH_ERROR",
      },
      {
        status: 500,
      },
    );
  }
}
