import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutomationRequest {
  triggerType?: unknown;
  includeMarketSync?: unknown;
  autoOrder?: unknown;
  maxOrders?: unknown;
  secret?: unknown;
}

interface AutomationStepResult {
  name: string;
  path: string;
  ok: boolean;
  statusCode: number;
  startedAt: string;
  finishedAt: string;
  payload: unknown;
  error: string | null;
}

interface StepDefinition {
  name: string;
  path: string;
  body: Record<string, unknown>;
  critical: boolean;
}

function clampMaxOrders(
  value: unknown,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(
    5,
    Math.max(
      1,
      Math.floor(parsed),
    ),
  );
}

function parseBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  return typeof value === "boolean"
    ? value
    : fallback;
}

async function executeStep(
  origin: string,
  definition: StepDefinition,
): Promise<AutomationStepResult> {
  const startedAt =
    new Date().toISOString();

  try {
    const response = await fetch(
      `${origin}${definition.path}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",
        },

        body: JSON.stringify(
          definition.body,
        ),

        cache: "no-store",
      },
    );

    const payload = await response
      .json()
      .catch(async () => ({
        message:
          await response.text().catch(
            () => "",
          ),
      }));

    const payloadRecord =
      payload &&
      typeof payload === "object"
        ? payload as Record<
            string,
            unknown
          >
        : {};

    const ok =
      response.ok &&
      payloadRecord.ok !== false;

    return {
      name: definition.name,
      path: definition.path,
      ok,
      statusCode:
        response.status,

      startedAt,
      finishedAt:
        new Date().toISOString(),

      payload,

      error: ok
        ? null
        : String(
            payloadRecord.message ??
              `HTTP ${response.status}`,
          ),
    };
  } catch (error) {
    return {
      name: definition.name,
      path: definition.path,
      ok: false,
      statusCode: 0,

      startedAt,
      finishedAt:
        new Date().toISOString(),

      payload: null,

      error:
        error instanceof Error
          ? error.message
          : "자동 운영 단계 실행 실패",
    };
  }
}

export async function POST(
  request: Request,
) {
  const supabase =
    createSupabaseServerClient();

  let runId: string | null = null;

  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as AutomationRequest;

    const triggerType =
      body.triggerType === "SCHEDULED"
        ? "SCHEDULED"
        : "MANUAL";

    /*
     * 개발 환경에서는 대시보드 수동 실행을 허용하고,
     * 배포 환경에서는 비밀키를 필수로 사용한다.
     */
    if (
      process.env.NODE_ENV ===
      "production"
    ) {
      const expectedSecret =
        process.env
          .TRADING_AUTOMATION_SECRET;

      const providedSecret =
        request.headers.get(
          "x-automation-secret",
        ) ??
        String(
          body.secret ?? "",
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
              "자동 운영 실행 권한이 없습니다.",
          },
          {
            status: 401,
          },
        );
      }
    }

    const includeMarketSync =
      parseBoolean(
        body.includeMarketSync,
        true,
      );

    /*
     * 처음에는 반드시 false로 실행한다.
     * 신호가 정상인지 확인한 뒤 true로 바꾼다.
     */
    const autoOrder =
      parseBoolean(
        body.autoOrder,
        false,
      );

    const maxOrders =
      clampMaxOrders(
        body.maxOrders,
      );

    const marketSyncPath =
      process.env
        .MARKET_SYNC_API_PATH
        ?.trim();

    if (
      includeMarketSync &&
      !marketSyncPath
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "MARKET_SYNC_API_PATH 환경변수가 설정되지 않았습니다.",
        },
        {
          status: 500,
        },
      );
    }

    /*
     * 15분 이내 실행 중인 사이클이 있다면
     * 중복 실행을 차단한다.
     */
    const runningCutoff =
      new Date(
        Date.now() -
          15 * 60 * 1000,
      ).toISOString();

    const {
      data: running,
      error: runningError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .select(`
        id,
        started_at
      `)
      .eq("status", "RUNNING")
      .gte(
        "started_at",
        runningCutoff,
      )
      .limit(1)
      .maybeSingle();

    if (runningError) {
      throw new Error(
        `실행 상태 확인 실패: ${runningError.message}`,
      );
    }

    if (running) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "이미 자동 운영 사이클이 실행 중입니다.",
          running,
        },
        {
          status: 409,
        },
      );
    }

    const {
      data: createdRun,
      error: createError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .insert({
        trigger_type:
          triggerType,

        status: "RUNNING",

        summary: {
          includeMarketSync,
          autoOrder,
          maxOrders,
        },
      })
      .select("id")
      .single();

    if (createError) {
      throw new Error(
        `자동 운영 기록 생성 실패: ${createError.message}`,
      );
    }

    runId = createdRun.id;

    const steps: StepDefinition[] =
      [];

    if (
      includeMarketSync &&
      marketSyncPath
    ) {
      steps.push({
        name: "시세 동기화",
        path: marketSyncPath,
        body: {},
        critical: true,
      });
    }

    steps.push({
      name: "진입 신호 생성",
      path:
        "/api/signals/entry/generate",

      body: {
        autoOrder,
        maxOrders,
      },

      critical: true,
    });

    /*
     * 모의주문 생성이 켜진 경우에만
     * 승인 주문을 자동 체결한다.
     */
    if (autoOrder) {
      steps.push({
        name: "승인 주문 체결",
        path:
          "/api/orders/paper/execute-approved",

        body: {
          maxOrders,
        },

        critical: false,
      });
    }

    steps.push(
      {
        name: "트레일링 손절 갱신",
        path:
          "/api/trading/trailing-stop/update",

        body: {},
        critical: false,
      },
      {
        name: "손절 조건 검사",
        path:
          "/api/trading/stop-loss/check",

        body: {},
        critical: false,
      },
      {
        name: "종료 거래 평가",
        path:
          "/api/trading/trades/evaluate",

        body: {},
        critical: false,
      },
      {
        name: "모델 지표 갱신",
        path:
          "/api/models/metrics/refresh",

        body: {},
        critical: false,
      },
    );

    const origin =
      new URL(request.url).origin;

    const results:
      AutomationStepResult[] = [];

    for (const step of steps) {
      const result =
        await executeStep(
          origin,
          step,
        );

      results.push(result);

      if (
        !result.ok &&
        step.critical
      ) {
        break;
      }
    }

    const successCount =
      results.filter(
        (result) => result.ok,
      ).length;

    const failureCount =
      results.length -
      successCount;

    const finalStatus =
      failureCount === 0 &&
      results.length ===
        steps.length
        ? "SUCCESS"
        : successCount > 0
          ? "PARTIAL_FAILURE"
          : "FAILED";

    const finishedAt =
      new Date().toISOString();

    const summary = {
      includeMarketSync,
      autoOrder,
      maxOrders,

      requestedSteps:
        steps.length,

      completedSteps:
        results.length,

      successCount,
      failureCount,

      stoppedEarly:
        results.length <
        steps.length,
    };

    const {
      error: updateError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .update({
        status: finalStatus,
        finished_at:
          finishedAt,
        steps: results,
        summary,
      })
      .eq("id", runId);

    if (updateError) {
      throw new Error(
        `자동 운영 결과 저장 실패: ${updateError.message}`,
      );
    }

    return NextResponse.json({
      ok:
        finalStatus ===
        "SUCCESS",

      runId,
      status: finalStatus,
      summary,
      steps: results,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "자동 운영 사이클 실행 중 오류가 발생했습니다.";

    if (runId) {
      await supabase
        .from(
          "trading_automation_runs",
        )
        .update({
          status: "FAILED",

          finished_at:
            new Date().toISOString(),

          error_message:
            message,
        })
        .eq("id", runId);
    }

    return NextResponse.json(
      {
        ok: false,
        runId,
        message,
      },
      {
        status: 500,
      },
    );
  }
}