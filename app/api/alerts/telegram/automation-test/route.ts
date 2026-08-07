import { NextResponse } from "next/server";

import { notifyAutomationFailure } from "@/lib/notifications/notify-automation-failure";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET;

    const providedSecret =
      request.headers.get(
        "x-automation-secret",
      );

    if (
      !expectedSecret ||
      providedSecret !==
        expectedSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "테스트 알림 실행 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const supabase =
      createSupabaseServerClient();

    const {
      data: run,
      error,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .insert({
        trigger_type:
          "SCHEDULED",

        status:
          "PARTIAL_FAILURE",

        started_at:
          new Date().toISOString(),

        finished_at:
          new Date().toISOString(),

        steps: [
          {
            name:
              "텔레그램 알림 시험",

            ok: false,

            statusCode:
              500,

            error:
              "테스트용 자동 운영 오류입니다.",
          },
        ],

        summary: {
          successCount: 0,
          failureCount: 1,
          test: true,
        },

        error_message:
          "테스트용 자동 운영 오류",
      })
      .select(`
        id,
        started_at
      `)
      .single();

    if (error) {
      throw new Error(
        `테스트 실행 기록 생성 실패: ${error.message}`,
      );
    }

    const notification =
      await notifyAutomationFailure({
        runId: run.id,

        triggerType:
          "SCHEDULED",

        status:
          "PARTIAL_FAILURE",

        startedAt:
          run.started_at,

        successCount: 0,
        failureCount: 1,

        steps: [
          {
            name:
              "텔레그램 알림 시험",

            ok: false,

            statusCode: 500,

            error:
              "테스트용 자동 운영 오류입니다.",
          },
        ],

        errorMessage:
          "테스트용 자동 운영 오류",

        cooldownMinutes: 1,
      });

    return NextResponse.json({
      ok: true,
      runId: run.id,
      notification,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "자동 운영 알림 시험 실패",
      },
      {
        status: 500,
      },
    );
  }
}