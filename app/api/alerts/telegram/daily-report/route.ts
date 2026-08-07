import { NextResponse } from "next/server";

import { sendTelegramMessage } from "@/lib/notifications/send-telegram-message";
import { createSupabaseServerClient } from "@/lib/supabase";
import { generateDailyPerformanceReport } from "@/lib/trading/generate-daily-performance-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramDailyReportRequest {
  reportDate?: unknown;
  accountName?: unknown;
  force?: unknown;
  secret?: unknown;
}

function formatMoney(
  value: number,
): string {
  const formatted =
    new Intl.NumberFormat(
      "ko-KR",
    ).format(
      Math.round(value),
    );

  return `${formatted}원`;
}

function formatSignedMoney(
  value: number,
): string {
  const absolute =
    new Intl.NumberFormat(
      "ko-KR",
    ).format(
      Math.round(
        Math.abs(value),
      ),
    );

  if (value > 0) {
    return `+${absolute}원`;
  }

  if (value < 0) {
    return `-${absolute}원`;
  }

  return "0원";
}

function formatPercent(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return `${(
    value * 100
  ).toFixed(2)}%`;
}

function getAlertSymbol(
  level: string,
): string {
  if (level === "CRITICAL") {
    return "🔴";
  }

  if (level === "WARNING") {
    return "🟡";
  }

  return "🟢";
}

function getAlertLabel(
  level: string,
): string {
  if (level === "CRITICAL") {
    return "심각";
  }

  if (level === "WARNING") {
    return "주의";
  }

  return "정상";
}

function buildDailyReportMessage(
  summary: {
    reportDate: string;
    accountEquity: number;
    cashBalance: number;
    positionMarketValue: number;
    openPositionCount: number;

    realizedPnlDay: number;
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number | null;

    automationRuns: number;
    automationSuccesses: number;
    automationFailures: number;

    alertLevel: string;
    alertMessages: string[];
  },
): string {
  const alertLines =
    summary.alertMessages.length > 0
      ? summary.alertMessages.map(
          (message) =>
            `• ${message}`,
        )
      : ["• 특이사항 없음"];

  return [
    "📊 AI Stock Lab 일일보고서",
    "",
    `기준일: ${summary.reportDate}`,
    "",
    `계좌 평가금액: ${formatMoney(
      summary.accountEquity,
    )}`,

    `현금 잔액: ${formatMoney(
      summary.cashBalance,
    )}`,

    `보유주식 평가액: ${formatMoney(
      summary.positionMarketValue,
    )}`,

    `보유 포지션: ${summary.openPositionCount}개`,
    "",
    `당일 실현손익: ${formatSignedMoney(
      summary.realizedPnlDay,
    )}`,

    `종료 거래: ${summary.closedTrades}건`,

    `승리/패배: ${summary.winningTrades}승 · ${summary.losingTrades}패`,

    `승률: ${formatPercent(
      summary.winRate,
    )}`,
    "",
    `자동 운영: ${summary.automationRuns}회`,

    `성공/실패: ${summary.automationSuccesses}회 · ${summary.automationFailures}회`,
    "",
    `${getAlertSymbol(
      summary.alertLevel,
    )} 상태: ${getAlertLabel(
      summary.alertLevel,
    )}`,
    ...alertLines,
  ].join("\n");
}

export async function POST(
  request: Request,
) {
  const supabase =
    createSupabaseServerClient();

  let reportId: string | null =
    null;

  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as TelegramDailyReportRequest;

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
              "텔레그램 보고서 전송 권한이 없습니다.",
          },
          {
            status: 401,
          },
        );
      }
    }

    const reportDate =
      typeof body.reportDate ===
      "string"
        ? body.reportDate
        : undefined;

    const accountName =
      typeof body.accountName ===
      "string"
        ? body.accountName
        : undefined;

    const force =
      body.force === true;

    /*
     * 최신 데이터로 일일보고서를 먼저
     * 생성하거나 갱신한다.
     */
    const generated =
      await generateDailyPerformanceReport({
        reportDate,
        accountName,
      });

    const report =
      generated.report as Record<
        string,
        unknown
      >;

    reportId =
      String(report.id);

    const alreadyNotified =
      typeof report.telegram_notified_at ===
        "string" &&
      report.telegram_notified_at.length >
        0;

    if (
      alreadyNotified &&
      !force
    ) {
      return NextResponse.json({
        ok: true,
        sent: false,
        duplicated: true,
        reportId,
        message:
          "오늘 보고서는 이미 텔레그램으로 전송되었습니다.",
        summary:
          generated.summary,
      });
    }

    const message =
      buildDailyReportMessage(
        generated.summary,
      );

    const telegramResult =
      await sendTelegramMessage(
        message,
      );

    const {
      error: updateError,
    } = await supabase
      .from(
        "daily_performance_reports",
      )
      .update({
        telegram_notified_at:
          new Date().toISOString(),

        telegram_message_id:
          telegramResult.messageId,

        telegram_notification_error:
          null,

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", reportId);

    if (updateError) {
      throw new Error(
        `텔레그램 전송 기록 저장 실패: ${updateError.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      duplicated: false,

      reportId,

      telegram: {
        messageId:
          telegramResult.messageId,
      },

      summary:
        generated.summary,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "텔레그램 일일보고서 전송 중 오류가 발생했습니다.";

    if (reportId) {
      await supabase
        .from(
          "daily_performance_reports",
        )
        .update({
          telegram_notification_error:
            message,

          updated_at:
            new Date().toISOString(),
        })
        .eq("id", reportId);
    }

    return NextResponse.json(
      {
        ok: false,
        reportId,
        message,
      },
      {
        status: 500,
      },
    );
  }
}