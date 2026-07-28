import { createSupabaseServerClient } from "@/lib/supabase";

interface AccountRecord {
  id: string;
  account_name: string;

  initial_balance?: number | string | null;
  initial_cash?: number | string | null;
  initial_cash_balance?: number | string | null;

  cash_balance?: number | string | null;
  cash?: number | string | null;
  available_cash?: number | string | null;

  realized_pnl?: number | string | null;
  daily_pnl?: number | string | null;

  trading_mode?: string | null;
  mode?: string | null;

  [key: string]: unknown;
}

interface PositionRecord {
  id: string;
  stock_code: string;
  sector: string | null;
  quantity: number | string;
  average_price: number | string;
  current_stop_price:
    | number
    | string;
  highest_price:
    | number
    | string
    | null;
  trailing_stop_active: boolean;
  model_id: string | null;
  model_snapshot:
    | Record<string, unknown>
    | null;
}

interface SnapshotRecord {
  stock_code: string;
  observed_at: string;
  close_price:
    | number
    | string
    | null;
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
}

export interface PaperPositionDashboardRow {
  id: string;

  stockCode: string;
  stockName: string;
  sector: string | null;

  quantity: number;
  averagePrice: number;
  currentPrice: number;
  stopPrice: number;
  highestPrice: number;

  investedAmount: number;
  marketValue: number;

  unrealizedPnl: number;
  unrealizedReturn: number;

  stopDistanceRate: number;

  trailingStopActive: boolean;

  modelId: string | null;
  modelName: string | null;
  modelVersion: string | null;

  priceObservedAt: string | null;
}

export interface PaperAccountDashboard {
  account: {
    id: string;
    name: string;
    mode: string;

    initialBalance: number;
    cashBalance: number;

    positionMarketValue: number;
    accountEquity: number;

    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    totalReturn: number;

    exposureRate: number;
    openPositionCount: number;
  };

  positions:
    PaperPositionDashboardRow[];
}

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

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

function getFirstString(
  record: Record<string, unknown>,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value;
    }
  }

  return fallback;
}

function getSnapshotString(
  snapshot:
    | Record<string, unknown>
    | null,
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

export async function getPaperAccountDashboard(): Promise<PaperAccountDashboard> {
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
    accountData as AccountRecord;

  const {
    data: positionData,
    error: positionError,
  } = await supabase
    .from("paper_positions")
    .select(`
      id,
      stock_code,
      sector,
      quantity,
      average_price,
      current_stop_price,
      highest_price,
      trailing_stop_active,
      model_id,
      model_snapshot
    `)
    .eq(
      "account_id",
      account.id,
    )
    .order("stock_code", {
      ascending: true,
    });

  if (positionError) {
    throw new Error(
      `보유 포지션 조회 실패: ${positionError.message}`,
    );
  }

  const positions =
    (positionData ??
      []) as PositionRecord[];

  const stockCodes = [
    ...new Set(
      positions.map(
        (position) =>
          position.stock_code,
      ),
    ),
  ];

  const latestSnapshotMap =
    new Map<
      string,
      SnapshotRecord
    >();

  const stockNameMap =
    new Map<string, string>();

  if (stockCodes.length > 0) {
    const [
      snapshotResult,
      stockResult,
    ] = await Promise.all([
      supabase
        .from("market_snapshots")
        .select(`
          stock_code,
          observed_at,
          close_price
        `)
        .in(
          "stock_code",
          stockCodes,
        )
        .order("observed_at", {
          ascending: false,
        })
        .limit(
          Math.max(
            100,
            stockCodes.length * 20,
          ),
        ),

      supabase
        .from("stocks")
        .select(`
          stock_code,
          stock_name
        `)
        .in(
          "stock_code",
          stockCodes,
        ),
    ]);

    if (snapshotResult.error) {
      throw new Error(
        `포지션 현재가 조회 실패: ${snapshotResult.error.message}`,
      );
    }

    if (stockResult.error) {
      throw new Error(
        `종목명 조회 실패: ${stockResult.error.message}`,
      );
    }

    for (
      const snapshot
      of (
        snapshotResult.data ??
        []
      ) as SnapshotRecord[]
    ) {
      if (
        !latestSnapshotMap.has(
          snapshot.stock_code,
        )
      ) {
        latestSnapshotMap.set(
          snapshot.stock_code,
          snapshot,
        );
      }
    }

    for (
      const stock
      of (
        stockResult.data ??
        []
      ) as StockRecord[]
    ) {
      stockNameMap.set(
        stock.stock_code,
        stock.stock_name,
      );
    }
  }

  const dashboardPositions =
    positions.map((position) => {
      const quantity =
        toNumber(position.quantity);

      const averagePrice =
        toNumber(
          position.average_price,
        );

      const latestSnapshot =
        latestSnapshotMap.get(
          position.stock_code,
        );

      const currentPrice =
        toNumber(
          latestSnapshot?.close_price,
        ) || averagePrice;

      const stopPrice =
        toNumber(
          position.current_stop_price,
        );

      const highestPrice =
        toNumber(
          position.highest_price,
        ) ||
        Math.max(
          averagePrice,
          currentPrice,
        );

      const investedAmount =
        averagePrice * quantity;

      const marketValue =
        currentPrice * quantity;

      const unrealizedPnl =
        marketValue -
        investedAmount;

      const unrealizedReturn =
        investedAmount > 0
          ? unrealizedPnl /
            investedAmount
          : 0;

      const stopDistanceRate =
        currentPrice > 0
          ? stopPrice /
              currentPrice -
            1
          : 0;

      return {
        id: position.id,

        stockCode:
          position.stock_code,

        stockName:
          stockNameMap.get(
            position.stock_code,
          ) ??
          position.stock_code,

        sector: position.sector,

        quantity,
        averagePrice,
        currentPrice,
        stopPrice,
        highestPrice,

        investedAmount,
        marketValue,

        unrealizedPnl,
        unrealizedReturn,
        stopDistanceRate,

        trailingStopActive:
          position.trailing_stop_active,

        modelId:
          position.model_id,

        modelName:
          getSnapshotString(
            position.model_snapshot,
            "modelName",
          ),

        modelVersion:
          getSnapshotString(
            position.model_snapshot,
            "modelVersion",
          ),

        priceObservedAt:
          latestSnapshot?.observed_at ??
          null,
      };
    });

  const initialBalance =
  getFirstNumber(
    account,
    [
      "initial_balance",
      "initial_cash",
      "initial_cash_balance",
    ],
  );

const cashBalance =
  getFirstNumber(
    account,
    [
      "cash_balance",
      "cash",
      "available_cash",
    ],
  );

const realizedPnl =
  getFirstNumber(
    account,
    [
      "realized_pnl",
      "total_realized_pnl",
    ],
  );

  const positionMarketValue =
    dashboardPositions.reduce(
      (sum, position) =>
        sum +
        position.marketValue,
      0,
    );

  const unrealizedPnl =
    dashboardPositions.reduce(
      (sum, position) =>
        sum +
        position.unrealizedPnl,
      0,
    );

  const accountEquity =
    cashBalance +
    positionMarketValue;

  const totalPnl =
    accountEquity -
    initialBalance;

  const totalReturn =
    initialBalance > 0
      ? totalPnl /
        initialBalance
      : 0;

  const exposureRate =
    accountEquity > 0
      ? positionMarketValue /
        accountEquity
      : 0;

  return {
    account: {
      id: account.id,
      name: getFirstString(
  account,
  ["account_name"],
  "default-paper",
),
      mode: getFirstString(
  account,
  [
    "trading_mode",
    "mode",
  ],
  "PAPER",
),

      initialBalance,
      cashBalance,

      positionMarketValue,
      accountEquity,

      realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalReturn,

      exposureRate,
      openPositionCount:
        dashboardPositions.length,
    },

    positions:
      dashboardPositions,
  };
}