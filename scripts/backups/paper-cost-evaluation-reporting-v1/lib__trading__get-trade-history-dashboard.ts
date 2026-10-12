import { createSupabaseServerClient } from "@/lib/supabase";

interface TradeRecord {
  id: string;
  model_id: string | null;
  model_snapshot: Record<string, unknown> | null;

  stock_code: string;
  quantity: number | string;

  entry_price: number | string;
  exit_price: number | string;
  stop_price: number | string;

  realized_pnl: number | string;
  realized_return: number | string;

  exit_reason:
    | "STOP_LOSS"
    | "TRAILING_STOP"
    | "MODEL_EXIT"
    | "MANUAL";

  opened_at: string;
  closed_at: string;

  post_exit_price_1d:
    | number
    | string
    | null;

  post_exit_price_5d:
    | number
    | string
    | null;

  post_exit_price_20d:
    | number
    | string
    | null;

  post_exit_return_1d:
    | number
    | string
    | null;

  post_exit_return_5d:
    | number
    | string
    | null;

  post_exit_return_20d:
    | number
    | string
    | null;
}

interface EvaluationRecord {
  trade_id: string;
  evaluation_stage:
    | "DAY_1"
    | "DAY_5"
    | "DAY_20";

  verdict:
    | "PENDING"
    | "PROTECTED_CAPITAL"
    | "EARLY_EXIT"
    | "MIXED"
    | "NEUTRAL";

  quality_score:
    | number
    | string
    | null;

  reason: string;
  evaluated_at: string;
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
}

interface ModelRecord {
  id: string;
  model_name: string;
  model_version: string;
}

export interface TradeHistoryDashboardRow {
  id: string;

  stockCode: string;
  stockName: string;

  quantity: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;

  realizedPnl: number;
  realizedReturn: number;

  exitReason:
    | "STOP_LOSS"
    | "TRAILING_STOP"
    | "MODEL_EXIT"
    | "MANUAL";

  openedAt: string;
  closedAt: string;

  holdingMinutes: number;

  modelId: string | null;
  modelName: string | null;
  modelVersion: string | null;

  postExit: {
    price1d: number | null;
    price5d: number | null;
    price20d: number | null;

    return1d: number | null;
    return5d: number | null;
    return20d: number | null;
  };

  evaluation: {
    stage: string | null;
    verdict: string | null;
    qualityScore: number | null;
    reason: string | null;
    evaluatedAt: string | null;
  };
}

export interface TradeHistoryDashboard {
  summary: {
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;

    winRate: number | null;

    totalRealizedPnl: number;
    averageReturn: number | null;

    protectedCapitalCount: number;
    earlyExitCount: number;
    mixedExitCount: number;
    neutralExitCount: number;
    pendingCount: number;
  };

  trades: TradeHistoryDashboardRow[];
}

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
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

function toRequiredNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number {
  return toNumber(value) ?? 0;
}

function getSnapshotString(
  snapshot: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!snapshot) {
    return null;
  }

  const value = snapshot[key];

  return typeof value === "string"
    ? value
    : null;
}

export async function getTradeHistoryDashboard(): Promise<TradeHistoryDashboard> {
  const supabase =
    createSupabaseServerClient();

  const {
    data: tradeData,
    error: tradeError,
  } = await supabase
    .from("paper_trade_history")
    .select(`
      id,
      model_id,
      model_snapshot,
      stock_code,
      quantity,
      entry_price,
      exit_price,
      stop_price,
      realized_pnl,
      realized_return,
      exit_reason,
      opened_at,
      closed_at,
      post_exit_price_1d,
      post_exit_price_5d,
      post_exit_price_20d,
      post_exit_return_1d,
      post_exit_return_5d,
      post_exit_return_20d
    `)
    .order("closed_at", {
      ascending: false,
    })
    .limit(100);

  if (tradeError) {
    throw new Error(
      `거래 이력 조회 실패: ${tradeError.message}`,
    );
  }

  const trades =
    (tradeData ?? []) as TradeRecord[];

  if (trades.length === 0) {
    return {
      summary: {
        closedTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        winRate: null,
        totalRealizedPnl: 0,
        averageReturn: null,
        protectedCapitalCount: 0,
        earlyExitCount: 0,
        mixedExitCount: 0,
        neutralExitCount: 0,
        pendingCount: 0,
      },

      trades: [],
    };
  }

  const tradeIds = trades.map(
    (trade) => trade.id,
  );

  const stockCodes = [
    ...new Set(
      trades.map(
        (trade) => trade.stock_code,
      ),
    ),
  ];

  const modelIds = [
    ...new Set(
      trades
        .map((trade) => trade.model_id)
        .filter(
          (value): value is string =>
            value !== null,
        ),
    ),
  ];

  const [
    evaluationResult,
    stockResult,
    modelResult,
  ] = await Promise.all([
    supabase
      .from("paper_trade_evaluations")
      .select(`
        trade_id,
        evaluation_stage,
        verdict,
        quality_score,
        reason,
        evaluated_at
      `)
      .in("trade_id", tradeIds)
      .order("evaluated_at", {
        ascending: false,
      }),

    supabase
      .from("stocks")
      .select(`
        stock_code,
        stock_name
      `)
      .in("stock_code", stockCodes),

    modelIds.length > 0
      ? supabase
          .from("ai_model_versions")
          .select(`
            id,
            model_name,
            model_version
          `)
          .in("id", modelIds)
      : Promise.resolve({
          data: [],
          error: null,
        }),
  ]);

  if (evaluationResult.error) {
    throw new Error(
      `손절 평가 조회 실패: ${evaluationResult.error.message}`,
    );
  }

  if (stockResult.error) {
    throw new Error(
      `종목명 조회 실패: ${stockResult.error.message}`,
    );
  }

  if (modelResult.error) {
    throw new Error(
      `거래 모델 조회 실패: ${modelResult.error.message}`,
    );
  }

  const evaluations =
    (evaluationResult.data ??
      []) as EvaluationRecord[];

  const stocks =
    (stockResult.data ??
      []) as StockRecord[];

  const models =
    (modelResult.data ??
      []) as ModelRecord[];

  /*
   * 거래별 가장 최근 평가만 사용한다.
   */
  const latestEvaluationMap =
    new Map<string, EvaluationRecord>();

  for (const evaluation of evaluations) {
    if (
      !latestEvaluationMap.has(
        evaluation.trade_id,
      )
    ) {
      latestEvaluationMap.set(
        evaluation.trade_id,
        evaluation,
      );
    }
  }

  const stockNameMap = new Map(
    stocks.map((stock) => [
      stock.stock_code,
      stock.stock_name,
    ]),
  );

  const modelMap = new Map(
    models.map((model) => [
      model.id,
      model,
    ]),
  );

  const rows: TradeHistoryDashboardRow[] =
    trades.map((trade) => {
      const evaluation =
        latestEvaluationMap.get(
          trade.id,
        );

      const model = trade.model_id
        ? modelMap.get(trade.model_id)
        : undefined;

      const openedTime =
        new Date(
          trade.opened_at,
        ).getTime();

      const closedTime =
        new Date(
          trade.closed_at,
        ).getTime();

      const holdingMinutes =
        Number.isFinite(openedTime) &&
        Number.isFinite(closedTime)
          ? Math.max(
              0,
              Math.round(
                (
                  closedTime -
                  openedTime
                ) /
                  60_000,
              ),
            )
          : 0;

      return {
        id: trade.id,

        stockCode:
          trade.stock_code,

        stockName:
          stockNameMap.get(
            trade.stock_code,
          ) ?? trade.stock_code,

        quantity:
          toRequiredNumber(
            trade.quantity,
          ),

        entryPrice:
          toRequiredNumber(
            trade.entry_price,
          ),

        exitPrice:
          toRequiredNumber(
            trade.exit_price,
          ),

        stopPrice:
          toRequiredNumber(
            trade.stop_price,
          ),

        realizedPnl:
          toRequiredNumber(
            trade.realized_pnl,
          ),

        realizedReturn:
          toRequiredNumber(
            trade.realized_return,
          ),

        exitReason:
          trade.exit_reason,

        openedAt:
          trade.opened_at,

        closedAt:
          trade.closed_at,

        holdingMinutes,

        modelId:
          trade.model_id,

        modelName:
          model?.model_name ??
          getSnapshotString(
            trade.model_snapshot,
            "modelName",
          ),

        modelVersion:
          model?.model_version ??
          getSnapshotString(
            trade.model_snapshot,
            "modelVersion",
          ),

        postExit: {
          price1d:
            toNumber(
              trade.post_exit_price_1d,
            ),

          price5d:
            toNumber(
              trade.post_exit_price_5d,
            ),

          price20d:
            toNumber(
              trade.post_exit_price_20d,
            ),

          return1d:
            toNumber(
              trade.post_exit_return_1d,
            ),

          return5d:
            toNumber(
              trade.post_exit_return_5d,
            ),

          return20d:
            toNumber(
              trade.post_exit_return_20d,
            ),
        },

        evaluation: {
          stage:
            evaluation?.evaluation_stage ??
            null,

          verdict:
            evaluation?.verdict ??
            null,

          qualityScore:
            toNumber(
              evaluation?.quality_score,
            ),

          reason:
            evaluation?.reason ??
            null,

          evaluatedAt:
            evaluation?.evaluated_at ??
            null,
        },
      };
    });

  const winningTrades =
    rows.filter(
      (trade) =>
        trade.realizedPnl > 0,
    ).length;

  const losingTrades =
    rows.filter(
      (trade) =>
        trade.realizedPnl < 0,
    ).length;

  const breakevenTrades =
    rows.filter(
      (trade) =>
        trade.realizedPnl === 0,
    ).length;

  const totalRealizedPnl =
    rows.reduce(
      (sum, trade) =>
        sum + trade.realizedPnl,
      0,
    );

  const averageReturn =
    rows.length > 0
      ? rows.reduce(
          (sum, trade) =>
            sum +
            trade.realizedReturn,
          0,
        ) / rows.length
      : null;

  return {
    summary: {
      closedTrades:
        rows.length,

      winningTrades,
      losingTrades,
      breakevenTrades,

      winRate:
        rows.length > 0
          ? winningTrades /
            rows.length
          : null,

      totalRealizedPnl,
      averageReturn,

      protectedCapitalCount:
        rows.filter(
          (trade) =>
            trade.evaluation.verdict ===
            "PROTECTED_CAPITAL",
        ).length,

      earlyExitCount:
        rows.filter(
          (trade) =>
            trade.evaluation.verdict ===
            "EARLY_EXIT",
        ).length,

      mixedExitCount:
        rows.filter(
          (trade) =>
            trade.evaluation.verdict ===
            "MIXED",
        ).length,

      neutralExitCount:
        rows.filter(
          (trade) =>
            trade.evaluation.verdict ===
            "NEUTRAL",
        ).length,

      pendingCount:
        rows.filter(
          (trade) =>
            trade.evaluation.verdict ===
              "PENDING" ||
            trade.evaluation.verdict ===
              null,
        ).length,
    },

    trades: rows,
  };
}