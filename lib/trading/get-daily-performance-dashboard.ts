import { createSupabaseServerClient } from "@/lib/supabase";

export type DailyAlertLevel =
  | "NORMAL"
  | "WARNING"
  | "CRITICAL";

interface DailyReportRecord {
  id: string;
  report_date: string;

  account_equity: number | string;
  cash_balance: number | string;
  position_market_value: number | string;
  open_position_count: number | string;

  realized_pnl_day: number | string;
  closed_trades: number | string;
  winning_trades: number | string;
  losing_trades: number | string;
  breakeven_trades: number | string;
  win_rate: number | string | null;

  automation_runs: number | string;
  automation_successes: number | string;
  automation_failures: number | string;

  alert_level: DailyAlertLevel;
  alert_messages: unknown;

  generated_at: string;
}

export interface DailyPerformanceRow {
  id: string;
  reportDate: string;

  accountEquity: number;
  cashBalance: number;
  positionMarketValue: number;
  openPositionCount: number;

  realizedPnlDay: number;

  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number | null;

  automationRuns: number;
  automationSuccesses: number;
  automationFailures: number;

  alertLevel: DailyAlertLevel;
  alertMessages: string[];

  cumulativeReturn: number;
  drawdown: number;

  generatedAt: string;
}

export interface DailyPerformanceDashboard {
  initialBalance: number;

  summary: {
    latestReportDate: string | null;

    accountEquity: number;
    dailyEquityChange: number;
    dailyEquityReturn: number | null;

    cumulativeReturn: number;
    maxDrawdown: number;

    totalRealizedPnl: number;

    totalClosedTrades: number;
    totalWinningTrades: number;
    totalLosingTrades: number;
    overallWinRate: number | null;

    automationRuns: number;
    automationFailures: number;

    alertLevel: DailyAlertLevel;
  };

  reports: DailyPerformanceRow[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function toNullableNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function getFirstNumber(
  record: Record<string, unknown>,
  keys: string[],
): number {
  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === "number" ||
      typeof value === "string"
    ) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function parseMessages(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string",
  );
}

export async function getDailyPerformanceDashboard(): Promise<DailyPerformanceDashboard> {
  const supabase =
    createSupabaseServerClient();

  const {
    data: accountData,
    error: accountError,
  } = await supabase
    .from("paper_accounts")
    .select("*")
    .eq(
      "account_name",
      "default-paper",
    )
    .maybeSingle();

  if (accountError) {
    throw new Error(
      `모의계좌 조회 실패: ${accountError.message}`,
    );
  }

  if (!accountData) {
    throw new Error(
      "기본 모의계좌가 없습니다.",
    );
  }

  const account =
    accountData as Record<
      string,
      unknown
    >;

  const accountId =
    String(account.id);

  const initialBalance =
    getFirstNumber(
      account,
      [
        "initial_cash",
        "initial_balance",
        "initial_capital",
      ],
    );

  const {
    data: reportData,
    error: reportError,
  } = await supabase
    .from(
      "daily_performance_reports",
    )
    .select(`
      id,
      report_date,
      account_equity,
      cash_balance,
      position_market_value,
      open_position_count,
      realized_pnl_day,
      closed_trades,
      winning_trades,
      losing_trades,
      breakeven_trades,
      win_rate,
      automation_runs,
      automation_successes,
      automation_failures,
      alert_level,
      alert_messages,
      generated_at
    `)
    .eq(
      "account_id",
      accountId,
    )
    .order(
      "report_date",
      {
        ascending: false,
      },
    )
    .limit(120);

  if (reportError) {
    throw new Error(
      `일일 성과 조회 실패: ${reportError.message}`,
    );
  }

  const records = (
    (reportData ??
      []) as DailyReportRecord[]
  ).reverse();

  let peakEquity = 0;
  let maxDrawdown = 0;

  const rows: DailyPerformanceRow[] =
    records.map((report) => {
      const accountEquity =
        toNumber(
          report.account_equity,
        );

      peakEquity = Math.max(
        peakEquity,
        accountEquity,
      );

      const drawdown =
        peakEquity > 0
          ? accountEquity /
              peakEquity -
            1
          : 0;

      maxDrawdown = Math.min(
        maxDrawdown,
        drawdown,
      );

      const cumulativeReturn =
        initialBalance > 0
          ? accountEquity /
              initialBalance -
            1
          : 0;

      return {
        id: report.id,

        reportDate:
          report.report_date,

        accountEquity,

        cashBalance:
          toNumber(
            report.cash_balance,
          ),

        positionMarketValue:
          toNumber(
            report.position_market_value,
          ),

        openPositionCount:
          toNumber(
            report.open_position_count,
          ),

        realizedPnlDay:
          toNumber(
            report.realized_pnl_day,
          ),

        closedTrades:
          toNumber(
            report.closed_trades,
          ),

        winningTrades:
          toNumber(
            report.winning_trades,
          ),

        losingTrades:
          toNumber(
            report.losing_trades,
          ),

        breakevenTrades:
          toNumber(
            report.breakeven_trades,
          ),

        winRate:
          toNullableNumber(
            report.win_rate,
          ),

        automationRuns:
          toNumber(
            report.automation_runs,
          ),

        automationSuccesses:
          toNumber(
            report.automation_successes,
          ),

        automationFailures:
          toNumber(
            report.automation_failures,
          ),

        alertLevel:
          report.alert_level,

        alertMessages:
          parseMessages(
            report.alert_messages,
          ),

        cumulativeReturn,
        drawdown,

        generatedAt:
          report.generated_at,
      };
    });

  const latest =
    rows.at(-1) ?? null;

  const previous =
    rows.at(-2) ?? null;

  const dailyEquityChange =
    latest
      ? latest.accountEquity -
        (
          previous?.accountEquity ??
          initialBalance
        )
      : 0;

  const comparisonEquity =
    previous?.accountEquity ??
    initialBalance;

  const dailyEquityReturn =
    latest &&
    comparisonEquity > 0
      ? dailyEquityChange /
        comparisonEquity
      : null;

  const totalWinningTrades =
    rows.reduce(
      (sum, report) =>
        sum +
        report.winningTrades,
      0,
    );

  const totalLosingTrades =
    rows.reduce(
      (sum, report) =>
        sum +
        report.losingTrades,
      0,
    );

  const totalClosedTrades =
    rows.reduce(
      (sum, report) =>
        sum +
        report.closedTrades,
      0,
    );

  return {
    initialBalance,

    summary: {
      latestReportDate:
        latest?.reportDate ??
        null,

      accountEquity:
        latest?.accountEquity ??
        initialBalance,

      dailyEquityChange,
      dailyEquityReturn,

      cumulativeReturn:
        latest?.cumulativeReturn ??
        0,

      maxDrawdown,

      totalRealizedPnl:
        rows.reduce(
          (sum, report) =>
            sum +
            report.realizedPnlDay,
          0,
        ),

      totalClosedTrades,
      totalWinningTrades,
      totalLosingTrades,

      overallWinRate:
        totalClosedTrades > 0
          ? totalWinningTrades /
            totalClosedTrades
          : null,

      automationRuns:
        rows.reduce(
          (sum, report) =>
            sum +
            report.automationRuns,
          0,
        ),

      automationFailures:
        rows.reduce(
          (sum, report) =>
            sum +
            report.automationFailures,
          0,
        ),

      alertLevel:
        latest?.alertLevel ??
        "NORMAL",
    },

    reports: rows,
  };
}