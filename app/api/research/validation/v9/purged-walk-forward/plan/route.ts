import {
  NextResponse,
} from "next/server";

import {
  buildPurgedWalkForwardPlanV92,
} from "@/lib/research/build-purged-walk-forward-plan-v9-2";

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
      await buildPurgedWalkForwardPlanV92({
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

        calendarIndexCode:
          typeof body.calendarIndexCode ===
          "string"
            ? body.calendarIndexCode
            : undefined,

        trainingWindowDays:
          typeof body.trainingWindowDays ===
          "number"
            ? body.trainingWindowDays
            : undefined,

        purgeDays:
          typeof body.purgeDays ===
          "number"
            ? body.purgeDays
            : undefined,

        testWindowDays:
          typeof body.testWindowDays ===
          "number"
            ? body.testWindowDays
            : undefined,

        embargoDays:
          typeof body.embargoDays ===
          "number"
            ? body.embargoDays
            : undefined,

        labelHorizonDays:
          typeof body.labelHorizonDays ===
          "number"
            ? body.labelHorizonDays
            : undefined,

        minimumPitMembers:
          typeof body.minimumPitMembers ===
          "number"
            ? body.minimumPitMembers
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
            : "v9.2 validation-plan build failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
