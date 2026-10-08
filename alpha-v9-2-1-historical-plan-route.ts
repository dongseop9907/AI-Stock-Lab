import {
  NextResponse,
} from "next/server";

import {
  buildHistoricalPurgedWalkForwardPlanV921,
} from "@/lib/research/build-purged-walk-forward-plan-v9-2-1";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

type RequestBody = {
  compilationRunId?: unknown;
  universeCode?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  calendarIndexCode?: unknown;
  trainingWindowDays?: unknown;
  purgeDays?: unknown;
  testWindowDays?: unknown;
  embargoDays?: unknown;
  labelHorizonDays?: unknown;
  minimumPitMembers?: unknown;
};

function getOptionalString(
  value: unknown,
) {
  return typeof value === "string"
    ? value
    : undefined;
}

function getOptionalNumber(
  value: unknown,
) {
  const parsed =
    Number(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : undefined;
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

    if (
      typeof body.compilationRunId !==
      "string"
    ) {
      throw new Error(
        "compilationRunId is required.",
      );
    }

    const result =
      await buildHistoricalPurgedWalkForwardPlanV921({
        compilationRunId:
          body.compilationRunId,

        universeCode:
          getOptionalString(
            body.universeCode,
          ),

        startDate:
          getOptionalString(
            body.startDate,
          ),

        endDate:
          getOptionalString(
            body.endDate,
          ),

        calendarIndexCode:
          getOptionalString(
            body.calendarIndexCode,
          ),

        trainingWindowDays:
          getOptionalNumber(
            body.trainingWindowDays,
          ),

        purgeDays:
          getOptionalNumber(
            body.purgeDays,
          ),

        testWindowDays:
          getOptionalNumber(
            body.testWindowDays,
          ),

        embargoDays:
          getOptionalNumber(
            body.embargoDays,
          ),

        labelHorizonDays:
          getOptionalNumber(
            body.labelHorizonDays,
          ),

        minimumPitMembers:
          getOptionalNumber(
            body.minimumPitMembers,
          ),
      });

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
            : "v9.2.1 historical PIT validation plan failed.",
      },
      {
        status: 500,
      },
    );
  }
}
