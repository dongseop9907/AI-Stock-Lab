import { createSupabaseServerClient } from "@/lib/supabase";

interface GenerateDailyReportOptions {
  reportDate?: string;
  accountName?: string;
}

interface PositionRecord {
  stock_code: string;
  quantity: number | string;
  average_price: number | string;
}

interface SnapshotRecord {
  stock_code: string;
  close_price:
    | number
    | string
    | null;

  observed_at: string;
}

interface TradeRecord {
  realized_pnl:
    | number
    | string
    | null;

  realized_return:
    | number
    | string
    | null;

  closed_at: string;
}

interface AutomationRunRecord {
  status:
    | "RUNNING"
    | "SUCCESS"
    | "PARTIAL_FAILURE"
    | "FAILED";

  started_at: string;
  error_message: string | null;
}

function toNumber(
  value: unknown,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
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

function getKoreaDateString(
  date = new Date(),
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
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
    values.year,
    values.month,
    values.day,
  ].join("-");
}

function validateDateString(
  value: string,
): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    throw new Error(
      "REPORT_DATE_FORMAT_INVALID",
    );
  }

  const parsed =
    new Date(
      `${value}T00:00:00+09:00`,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      "REPORT_DATE_INVALID",
    );
  }

  return value;
}

function getKoreaDayRange(
  reportDate: string,
) {
  const start =
    new Date(
      `${reportDate}T00:00:00+09:00`,
    );

  const end =
    new Date(
      start.getTime() +
        24 * 60 * 60 * 1000,
    );

  return {
    startIso:
      start.toISOString(),

    endIso:
      end.toISOString(),
  };
}

export async function generateDailyPerformanceReport(
  options: GenerateDailyReportOptions = {},
) {
  const supabase =
    createSupabaseServerClient();

  const reportDate =
    validateDateString(
      options.reportDate ??
        getKoreaDateString(),
    );

  const accountName =
    options.accountName?.trim() ||
    "default-paper";

  const {
    startIso,
    endIso,
  } = getKoreaDayRange(
    reportDate,
  );

  const {
    data: accountData,
    error: accountError,
  } = await supabase
    .from("paper_accounts")
    .select("*")
    .eq(
      "account_name",
      accountName,
    )
    .maybeSingle();

  if (accountError) {
    throw new Error(
      `모의계좌 조회 실패: ${accountError.message}`,
    );
  }

  if (!accountData) {
    throw new Error(
      "PAPER_ACCOUNT_NOT_FOUND",
    );
  }

  const account =
    accountData as Record<
      string,
      unknown
    >;

  const accountId =
    String(account.id);

  const cashBalance =
    getFirstNumber(
      account,
      [
        "cash_balance",
        "cash",
        "available_cash",
      ],
    );

  const [
    positionResult,
    tradeResult,
    automationResult,
  ] = await Promise.all([
    supabase
      .from("paper_positions")
      .select(`
        stock_code,
        quantity,
        average_price
      `)
      .eq(
        "account_id",
        accountId,
      ),

    supabase
      .from("paper_trade_history")
      .select(`
        realized_pnl,
        realized_return,
        closed_at
      `)
      .eq(
        "account_id",
        accountId,
      )
      .gte(
        "closed_at",
        startIso,
      )
      .lt(
        "closed_at",
        endIso,
      )
      .order(
        "closed_at",
        {
          ascending: false,
        },
      ),

    supabase
      .from(
        "trading_automation_runs",
      )
      .select(`
        status,
        started_at,
        error_message
      `)
      .gte(
        "started_at",
        startIso,
      )
      .lt(
        "started_at",
        endIso,
      )
      .order(
        "started_at",
        {
          ascending: false,
        },
      ),
  ]);

  if (positionResult.error) {
    throw new Error(
      `포지션 조회 실패: ${positionResult.error.message}`,
    );
  }

  if (tradeResult.error) {
    throw new Error(
      `오늘 거래 조회 실패: ${tradeResult.error.message}`,
    );
  }

  if (automationResult.error) {
    throw new Error(
      `자동 운영 기록 조회 실패: ${automationResult.error.message}`,
    );
  }

  const positions =
    (positionResult.data ??
      []) as PositionRecord[];

  const trades =
    (tradeResult.data ??
      []) as TradeRecord[];

  const automationRuns =
    (automationResult.data ??
      []) as AutomationRunRecord[];

  const stockCodes = [
    ...new Set(
      positions.map(
        (position) =>
          position.stock_code,
      ),
    ),
  ];

  const latestPriceMap =
    new Map<string, number>();

  const latestObservedAtMap =
    new Map<string, string>();

  if (stockCodes.length > 0) {
    const {
      data: snapshotData,
      error: snapshotError,
    } = await supabase
      .from("market_snapshots")
      .select(`
        stock_code,
        close_price,
        observed_at
      `)
      .in(
        "stock_code",
        stockCodes,
      )
      .order(
        "observed_at",
        {
          ascending: false,
        },
      )
      .limit(
        Math.max(
          100,
          stockCodes.length * 30,
        ),
      );

    if (snapshotError) {
      throw new Error(
        `현재가 조회 실패: ${snapshotError.message}`,
      );
    }

    for (
      const snapshot
      of (
        snapshotData ??
        []
      ) as SnapshotRecord[]
    ) {
      if (
        latestPriceMap.has(
          snapshot.stock_code,
        )
      ) {
        continue;
      }

      const currentPrice =
        toNumber(
          snapshot.close_price,
        );

      latestPriceMap.set(
        snapshot.stock_code,
        currentPrice,
      );

      latestObservedAtMap.set(
        snapshot.stock_code,
        snapshot.observed_at,
      );
    }
  }

  let positionMarketValue = 0;

  const positionDetails =
    positions.map((position) => {
      const quantity =
        toNumber(
          position.quantity,
        );

      const averagePrice =
        toNumber(
          position.average_price,
        );

      const currentPrice =
        latestPriceMap.get(
          position.stock_code,
        ) || averagePrice;

      const marketValue =
        currentPrice * quantity;

      const investedAmount =
        averagePrice * quantity;

      const unrealizedPnl =
        marketValue -
        investedAmount;

      positionMarketValue +=
        marketValue;

      return {
        stockCode:
          position.stock_code,

        quantity,
        averagePrice,
        currentPrice,
        marketValue,
        unrealizedPnl,

        observedAt:
          latestObservedAtMap.get(
            position.stock_code,
          ) ?? null,
      };
    });

  const accountEquity =
    cashBalance +
    positionMarketValue;

  const winningTrades =
    trades.filter(
      (trade) =>
        toNumber(
          trade.realized_pnl,
        ) > 0,
    ).length;

  const losingTrades =
    trades.filter(
      (trade) =>
        toNumber(
          trade.realized_pnl,
        ) < 0,
    ).length;

  const breakevenTrades =
    trades.length -
    winningTrades -
    losingTrades;

  const realizedPnlDay =
    trades.reduce(
      (sum, trade) =>
        sum +
        toNumber(
          trade.realized_pnl,
        ),
      0,
    );

  const winRate =
    trades.length > 0
      ? winningTrades /
        trades.length
      : null;

  const automationSuccesses =
    automationRuns.filter(
      (run) =>
        run.status ===
        "SUCCESS",
    ).length;

  const automationFailures =
    automationRuns.filter(
      (run) =>
        run.status ===
          "FAILED" ||
        run.status ===
          "PARTIAL_FAILURE",
    ).length;

  const alertMessages: string[] =
    [];

  let alertLevel:
    | "NORMAL"
    | "WARNING"
    | "CRITICAL" =
    "NORMAL";

  const failedRuns =
    automationRuns.filter(
      (run) =>
        run.status ===
          "FAILED",
    );

  if (failedRuns.length > 0) {
    alertLevel = "CRITICAL";

    alertMessages.push(
      `자동 운영 완전 실패 ${failedRuns.length}건`,
    );
  }

  const partialFailures =
    automationRuns.filter(
      (run) =>
        run.status ===
          "PARTIAL_FAILURE",
    );

  if (
    partialFailures.length > 0
  ) {
    if (
      alertLevel !== "CRITICAL"
    ) {
      alertLevel = "WARNING";
    }

    alertMessages.push(
      `자동 운영 일부 실패 ${partialFailures.length}건`,
    );
  }

  if (
    automationRuns.length === 0
  ) {
    if (
      alertLevel !== "CRITICAL"
    ) {
      alertLevel = "WARNING";
    }

    alertMessages.push(
      "오늘 자동 운영 실행 기록이 없습니다.",
    );
  }

  if (
    realizedPnlDay < 0
  ) {
    if (
      alertLevel === "NORMAL"
    ) {
      alertLevel = "WARNING";
    }

    alertMessages.push(
      `오늘 실현손익이 ${Math.round(
        realizedPnlDay,
      ).toLocaleString("ko-KR")}원입니다.`,
    );
  }

  if (
    alertMessages.length === 0
  ) {
    alertMessages.push(
      "특이사항이 없습니다.",
    );
  }

  const reportPayload = {
    account_id:
      accountId,

    report_date:
      reportDate,

    account_equity:
      accountEquity,

    cash_balance:
      cashBalance,

    position_market_value:
      positionMarketValue,

    open_position_count:
      positions.length,

    realized_pnl_day:
      realizedPnlDay,

    closed_trades:
      trades.length,

    winning_trades:
      winningTrades,

    losing_trades:
      losingTrades,

    breakeven_trades:
      breakevenTrades,

    win_rate:
      winRate,

    automation_runs:
      automationRuns.length,

    automation_successes:
      automationSuccesses,

    automation_failures:
      automationFailures,

    alert_level:
      alertLevel,

    alert_messages:
      alertMessages,

    details: {
      accountName,
      period: {
        startIso,
        endIso,
      },

      positions:
        positionDetails,

      failedAutomationRuns:
        automationRuns
          .filter(
            (run) =>
              run.status !==
              "SUCCESS",
          )
          .map((run) => ({
            status:
              run.status,

            startedAt:
              run.started_at,

            errorMessage:
              run.error_message,
          })),
    },

    generated_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString(),
  };

  const {
    data: savedReport,
    error: saveError,
  } = await supabase
    .from(
      "daily_performance_reports",
    )
    .upsert(
      reportPayload,
      {
        onConflict:
          "account_id,report_date",
      },
    )
    .select("*")
    .single();

  if (saveError) {
    throw new Error(
      `일일 보고서 저장 실패: ${saveError.message}`,
    );
  }

  return {
    report:
      savedReport,

    summary: {
      reportDate,
      accountEquity,
      cashBalance,
      positionMarketValue,
      openPositionCount:
        positions.length,

      realizedPnlDay,
      closedTrades:
        trades.length,

      winningTrades,
      losingTrades,
      winRate,

      automationRuns:
        automationRuns.length,

      automationSuccesses,
      automationFailures,

      alertLevel,
      alertMessages,
    },
  };
}