import { sendTelegramMessage } from "@/lib/notifications/send-telegram-message";
import { createSupabaseServerClient } from "@/lib/supabase";

type TriggerType =
  | "MANUAL"
  | "SCHEDULED";

interface RecoveryStep {
  name: string;
  ok: boolean;
}

interface NotifyAutomationRecoveryInput {
  runId: string;
  triggerType: TriggerType;
  status: "SUCCESS";
  startedAt: string;
  successCount: number;
  steps: RecoveryStep[];
}

interface FailureRunRecord {
  id: string;

  status:
    | "FAILED"
    | "PARTIAL_FAILURE";

  started_at: string;
  finished_at: string | null;

  error_message: string | null;

  telegram_alerted_at: string | null;
  recovery_alerted_at: string | null;
}

export interface AutomationRecoveryNotificationResult {
  sent: boolean;
  suppressed: boolean;

  messageId: number | null;

  recoveredFailureRunId:
    | string
    | null;

  reason: string | null;
}

function formatKoreaDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Asia/Seoul",

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

  return [
    `${values.year}.${values.month}.${values.day}`,
    `${values.hour}:${values.minute}:${values.second}`,
  ].join(" ");
}

function getFailureLabel(
  status:
    | "FAILED"
    | "PARTIAL_FAILURE",
): string {
  return status === "FAILED"
    ? "전체 실패"
    : "일부 실패";
}

function getDurationMinutes(
  failureStartedAt: string,
  recoveredAt: string,
): number {
  const failureTime =
    new Date(
      failureStartedAt,
    ).getTime();

  const recoveredTime =
    new Date(
      recoveredAt,
    ).getTime();

  if (
    !Number.isFinite(
      failureTime,
    ) ||
    !Number.isFinite(
      recoveredTime,
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      (
        recoveredTime -
        failureTime
      ) /
        60000,
    ),
  );
}

function buildRecoveryMessage(
  input: NotifyAutomationRecoveryInput,
  failure: FailureRunRecord,
): string {
  const durationMinutes =
    getDurationMinutes(
      failure.started_at,
      input.startedAt,
    );

  const errorLine =
    failure.error_message
      ? [
          "",
          "이전 오류:",
          `• ${failure.error_message}`,
        ]
      : [];

  return [
    "✅ AI Stock Lab 자동 운영 복구",
    "",
    `이전 상태: ${getFailureLabel(
      failure.status,
    )}`,

    `장애 시작: ${formatKoreaDateTime(
      failure.started_at,
    )}`,

    `복구 시각: ${formatKoreaDateTime(
      input.startedAt,
    )}`,

    `추정 장애 시간: ${durationMinutes}분`,
    "",
    `복구 실행 결과: ${input.successCount}단계 성공`,

    `복구 실행 ID: ${input.runId.slice(
      0,
      8,
    )}`,

    `장애 실행 ID: ${failure.id.slice(
      0,
      8,
    )}`,

    ...errorLine,
    "",
    "자동 운영이 다시 정상 상태로 전환되었습니다.",
  ].join("\n");
}

export async function notifyAutomationRecovery(
  input: NotifyAutomationRecoveryInput,
): Promise<AutomationRecoveryNotificationResult> {
  /*
   * 예약 실행의 정상 복구에 대해서만
   * 텔레그램 알림을 전송한다.
   */
  if (
    input.triggerType !==
    "SCHEDULED"
  ) {
    return {
      sent: false,
      suppressed: true,

      messageId: null,

      recoveredFailureRunId:
        null,

      reason:
        "MANUAL_RUN_RECOVERY_NOTIFICATION_DISABLED",
    };
  }

  const supabase =
    createSupabaseServerClient();

  /*
   * 아직 복구 처리되지 않은 가장 최근
   * 실패 실행을 조회한다.
   *
   * 실패 텔레그램 알림이 실제로 전송된
   * 실행만 복구 알림 대상으로 삼는다.
   */
  const {
    data: failureData,
    error: failureError,
  } = await supabase
    .from(
      "trading_automation_runs",
    )
    .select(`
      id,
      status,
      started_at,
      finished_at,
      error_message,
      telegram_alerted_at,
      recovery_alerted_at
    `)
    .eq(
      "trigger_type",
      "SCHEDULED",
    )
    .in(
      "status",
      [
        "FAILED",
        "PARTIAL_FAILURE",
      ],
    )
    .not(
      "telegram_alerted_at",
      "is",
      null,
    )
    .is(
      "recovery_alerted_at",
      null,
    )
    .lt(
      "started_at",
      input.startedAt,
    )
    .order(
      "started_at",
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (failureError) {
    throw new Error(
      `미복구 장애 조회 실패: ${failureError.message}`,
    );
  }

  if (!failureData) {
    return {
      sent: false,
      suppressed: true,

      messageId: null,

      recoveredFailureRunId:
        null,

      reason:
        "NO_UNRESOLVED_FAILURE",
    };
  }

  const failure =
    failureData as FailureRunRecord;

  try {
    const telegram =
      await sendTelegramMessage(
        buildRecoveryMessage(
          input,
          failure,
        ),
      );

    const recoveredAt =
      new Date().toISOString();

    const {
      error: updateError,
    } = await supabase
      .from(
        "trading_automation_runs",
      )
      .update({
        recovery_alerted_at:
          recoveredAt,

        recovery_message_id:
          telegram.messageId,

        recovery_alert_error:
          null,

        recovered_by_run_id:
          input.runId,
      })
      .eq(
        "id",
        failure.id,
      )
      .is(
        "recovery_alerted_at",
        null,
      );

    if (updateError) {
      throw new Error(
        `복구 알림 기록 저장 실패: ${updateError.message}`,
      );
    }

    return {
      sent: true,
      suppressed: false,

      messageId:
        telegram.messageId,

      recoveredFailureRunId:
        failure.id,

      reason: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "자동 운영 복구 알림 전송 실패";

    await supabase
      .from(
        "trading_automation_runs",
      )
      .update({
        recovery_alert_error:
          message,
      })
      .eq(
        "id",
        failure.id,
      );

    throw error;
  }
}