import { sendTelegramMessage } from "@/lib/notifications/send-telegram-message";
import { createSupabaseServerClient } from "@/lib/supabase";

export interface AutomationFailureStep {
  name: string;
  ok: boolean;
  statusCode?: number;
  error?: string | null;
}

interface NotifyAutomationFailureInput {
  runId: string;

  triggerType:
    | "MANUAL"
    | "SCHEDULED";

  status:
    | "PARTIAL_FAILURE"
    | "FAILED";

  startedAt: string;

  successCount: number;
  failureCount: number;

  steps: AutomationFailureStep[];

  errorMessage?: string | null;

  cooldownMinutes?: number;
}

export interface AutomationFailureNotificationResult {
  sent: boolean;
  suppressed: boolean;
  messageId: number | null;
  reason: string | null;
}

function formatKoreaDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function getStatusLabel(
  status:
    | "PARTIAL_FAILURE"
    | "FAILED",
): string {
  return status === "FAILED"
    ? "전체 실패"
    : "일부 실패";
}

function buildFailureMessage(
  input: NotifyAutomationFailureInput,
): string {
  const failedSteps =
    input.steps.filter(
      (step) => !step.ok,
    );

  const failedLines =
    failedSteps.length > 0
      ? failedSteps
          .slice(0, 8)
          .map((step) => {
            const statusText =
              step.statusCode &&
              step.statusCode > 0
                ? `HTTP ${step.statusCode}`
                : "실행 오류";

            return [
              `• ${step.name}`,
              `  ${statusText}`,
              step.error
                ? `  ${step.error}`
                : null,
            ]
              .filter(Boolean)
              .join("\n");
          })
      : [
          `• ${
            input.errorMessage ??
            "알 수 없는 자동 운영 오류"
          }`,
        ];

  return [
    "🚨 AI Stock Lab 자동 운영 경고",
    "",
    `상태: ${getStatusLabel(
      input.status,
    )}`,

    `실행 방식: ${
      input.triggerType === "SCHEDULED"
        ? "예약 실행"
        : "수동 실행"
    }`,

    `실행 시각: ${formatKoreaDateTime(
      input.startedAt,
    )}`,

    `성공/실패: ${input.successCount}단계 · ${input.failureCount}단계`,
    "",
    "실패 단계:",
    ...failedLines,
    "",
    `실행 ID: ${input.runId.slice(
      0,
      8,
    )}`,
    "",
    "서버 로그와 자동 운영 기록을 확인하세요.",
  ].join("\n");
}

export async function notifyAutomationFailure(
  input: NotifyAutomationFailureInput,
): Promise<AutomationFailureNotificationResult> {
  const supabase =
    createSupabaseServerClient();

  const cooldownMinutes =
    Math.max(
      1,
      Math.floor(
        input.cooldownMinutes ??
          30,
      ),
    );

  /*
   * 수동 테스트 실패는 텔레그램으로
   * 보내지 않고 예약 실행 실패만 알린다.
   */
  if (
    input.triggerType !==
    "SCHEDULED"
  ) {
    return {
      sent: false,
      suppressed: true,
      messageId: null,
      reason:
        "MANUAL_RUN_NOTIFICATION_DISABLED",
    };
  }

  const {
    data: currentRun,
    error: currentRunError,
  } = await supabase
    .from(
      "trading_automation_runs",
    )
    .select(`
      id,
      telegram_alerted_at
    `)
    .eq("id", input.runId)
    .maybeSingle();

  if (currentRunError) {
    throw new Error(
      `자동 운영 알림 상태 조회 실패: ${currentRunError.message}`,
    );
  }

  if (
    currentRun?.telegram_alerted_at
  ) {
    return {
      sent: false,
      suppressed: true,
      messageId: null,
      reason:
        "RUN_ALREADY_NOTIFIED",
    };
  }

  /*
   * 같은 종류의 장애가 반복될 때
   * 30분 동안 추가 알림을 억제한다.
   */
  const cooldownStart =
    new Date(
      Date.now() -
        cooldownMinutes *
          60 *
          1000,
    ).toISOString();

  const {
    data: recentAlert,
    error: recentAlertError,
  } = await supabase
    .from(
      "trading_automation_runs",
    )
    .select(`
      id,
      status,
      telegram_alerted_at
    `)
    .neq("id", input.runId)
    .in("status", [
      "FAILED",
      "PARTIAL_FAILURE",
    ])
    .not(
      "telegram_alerted_at",
      "is",
      null,
    )
    .gte(
      "telegram_alerted_at",
      cooldownStart,
    )
    .order(
      "telegram_alerted_at",
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (recentAlertError) {
    throw new Error(
      `최근 자동 운영 알림 조회 실패: ${recentAlertError.message}`,
    );
  }

  if (recentAlert) {
    return {
      sent: false,
      suppressed: true,
      messageId: null,
      reason:
        "ALERT_COOLDOWN_ACTIVE",
    };
  }

  try {
    const telegram =
      await sendTelegramMessage(
        buildFailureMessage(input),
      );

    const {
      error: updateError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .update({
        telegram_alerted_at:
          new Date().toISOString(),

        telegram_message_id:
          telegram.messageId,

        telegram_alert_error:
          null,
      })
      .eq("id", input.runId);

    if (updateError) {
      throw new Error(
        `자동 운영 텔레그램 기록 저장 실패: ${updateError.message}`,
      );
    }

    return {
      sent: true,
      suppressed: false,
      messageId:
        telegram.messageId,
      reason: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "자동 운영 텔레그램 전송 실패";

    await supabase
      .from(
        "trading_automation_runs",
      )
      .update({
        telegram_alert_error:
          message,
      })
      .eq("id", input.runId);

    throw error;
  }
}