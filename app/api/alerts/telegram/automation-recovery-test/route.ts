import { NextResponse } from "next/server";

import { notifyAutomationRecovery } from "@/lib/notifications/notify-automation-recovery";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET
        ?.trim();

    const providedSecret =
      request.headers
        .get(
          "x-automation-secret",
        )
        ?.trim();

    if (
      !expectedSecret ||
      providedSecret !==
        expectedSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "복구 알림 테스트 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const supabase =
      createSupabaseServerClient();

    const now =
      Date.now();

    const failureStartedAt =
      new Date(
        now -
          2 *
            60 *
            1000,
      ).toISOString();

    const failureFinishedAt =
      new Date(
        now -
          90 *
            1000,
      ).toISOString();

    /*
     * 실패 텔레그램 알림을 이미 받았다고
     * 가정하는 테스트 실행 기록
     */
    const {
      data: failedRun,
      error: failedRunError,
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
          failureStartedAt,

        finished_at:
          failureFinishedAt,

        steps: [
          {
            name:
              "복구 알림 시험용 장애",

            ok: false,

            statusCode: 500,

            error:
              "테스트용 장애입니다.",
          },
        ],

        summary: {
          successCount: 0,
          failureCount: 1,
          test: true,
        },

        error_message:
          "테스트용 장애입니다.",

        telegram_alerted_at:
          failureFinishedAt,

        telegram_message_id:
          -1,
      })
      .select(`
        id,
        started_at
      `)
      .single();

    if (failedRunError) {
      throw new Error(
        `테스트 장애 기록 생성 실패: ${failedRunError.message}`,
      );
    }

    const successStartedAt =
      new Date().toISOString();

    const {
      data: successRun,
      error: successRunError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .insert({
        trigger_type:
          "SCHEDULED",

        status:
          "SUCCESS",

        started_at:
          successStartedAt,

        finished_at:
          successStartedAt,

        steps: [
          {
            name:
              "복구 알림 시험",

            ok: true,

            statusCode: 200,
          },
        ],

        summary: {
          successCount: 1,
          failureCount: 0,
          test: true,
        },

        error_message:
          null,
      })
      .select(`
        id,
        started_at
      `)
      .single();

    if (successRunError) {
      throw new Error(
        `테스트 복구 기록 생성 실패: ${successRunError.message}`,
      );
    }

    const notification =
      await notifyAutomationRecovery({
        runId:
          successRun.id,

        triggerType:
          "SCHEDULED",

        status:
          "SUCCESS",

        startedAt:
          successRun.started_at,

        successCount: 1,

        steps: [
          {
            name:
              "복구 알림 시험",

            ok: true,
          },
        ],
      });

    return NextResponse.json({
      ok: true,

      failedRunId:
        failedRun.id,

      successRunId:
        successRun.id,

      notification,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "복구 알림 테스트 실패",
      },
      {
        status: 500,
      },
    );
  }
}