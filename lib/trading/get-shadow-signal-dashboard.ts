import { createSupabaseServerClient } from "@/lib/supabase";

export type ShadowEvaluationStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETE"
  | "EXPIRED"
  | "INVALID";

export type ShadowDecisionLabel =
  | "UNKNOWN"
  | "GOOD_SKIP"
  | "BAD_SKIP"
  | "GOOD_ENTRY"
  | "BAD_ENTRY";

interface ShadowTrackRecord {
  id: string;
  signal_id: string;
  stock_code: string;
  signal_status: string;

  signal_score:
    | number
    | string
    | null;

  signal_observed_at: string;

  reference_price:
    | number
    | string;

  price_30m:
    | number
    | string
    | null;

  return_30m:
    | number
    | string
    | null;

  price_60m:
    | number
    | string
    | null;

  return_60m:
    | number
    | string
    | null;

  close_price:
    | number
    | string
    | null;

  close_return:
    | number
    | string
    | null;

  max_return:
    | number
    | string
    | null;

  min_return:
    | number
    | string
    | null;

  evaluation_status:
    ShadowEvaluationStatus;

  decision_label:
    ShadowDecisionLabel;

  last_evaluated_at:
    | string
    | null;

  completed_at:
    | string
    | null;
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
}

export interface ShadowSignalDashboardRow {
  id: string;
  signalId: string;

  stockCode: string;
  stockName: string;

  signalStatus: string;
  signalScore: number | null;
  signalObservedAt: string;

  referencePrice: number;

  price30m: number | null;
  return30m: number | null;

  price60m: number | null;
  return60m: number | null;

  closePrice: number | null;
  closeReturn: number | null;

  maxReturn: number | null;
  minReturn: number | null;

  evaluationStatus:
    ShadowEvaluationStatus;

  decisionLabel:
    ShadowDecisionLabel;

  lastEvaluatedAt:
    | string
    | null;

  completedAt:
    | string
    | null;
}

export interface ShadowSignalDashboard {
  summary: {
    totalTracks: number;
    completed: number;
    pending: number;
    partial: number;
    expired: number;
    invalid: number;

    goodSkip: number;
    badSkip: number;
    goodEntry: number;
    badEntry: number;

    skipAccuracy: number | null;

    goodSkipAverageReturn:
      | number
      | null;

    badSkipAverageReturn:
      | number
      | null;

    averageMaximumReturn:
      | number
      | null;

    averageMinimumReturn:
      | number
      | null;

    latestEvaluatedAt:
      | string
      | null;
  };

  rows: ShadowSignalDashboardRow[];
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function average(
  values: Array<
    number | null
  >,
): number | null {
  const validValues =
    values.filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(value),
    );

  if (
    validValues.length === 0
  ) {
    return null;
  }

  return (
    validValues.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    validValues.length
  );
}

export async function getShadowSignalDashboard(): Promise<ShadowSignalDashboard> {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } = await supabase
    .from(
      "shadow_signal_tracks",
    )
    .select(`
      id,
      signal_id,
      stock_code,
      signal_status,
      signal_score,
      signal_observed_at,
      reference_price,
      price_30m,
      return_30m,
      price_60m,
      return_60m,
      close_price,
      close_return,
      max_return,
      min_return,
      evaluation_status,
      decision_label,
      last_evaluated_at,
      completed_at
    `)
    .order(
      "signal_observed_at",
      {
        ascending: false,
      },
    )
    .limit(300);

  if (error) {
    throw new Error(
      `그림자 추적 조회 실패: ${error.message}`,
    );
  }

  const records =
    (data ??
      []) as ShadowTrackRecord[];

  const stockCodes =
    Array.from(
      new Set(
        records.map(
          (record) =>
            record.stock_code,
        ),
      ),
    );

  let stockNameMap =
    new Map<
      string,
      string
    >();

  if (
    stockCodes.length > 0
  ) {
    const {
      data: stockData,
      error: stockError,
    } = await supabase
      .from("stocks")
      .select(`
        stock_code,
        stock_name
      `)
      .in(
        "stock_code",
        stockCodes,
      );

    if (stockError) {
      throw new Error(
        `종목명 조회 실패: ${stockError.message}`,
      );
    }

    stockNameMap =
      new Map(
        (
          (stockData ??
            []) as StockRecord[]
        ).map(
          (stock) => [
            stock.stock_code,
            stock.stock_name,
          ],
        ),
      );
  }

  const rows:
    ShadowSignalDashboardRow[] =
    records.map((record) => ({
      id:
        record.id,

      signalId:
        record.signal_id,

      stockCode:
        record.stock_code,

      stockName:
        stockNameMap.get(
          record.stock_code,
        ) ??
        record.stock_code,

      signalStatus:
        record.signal_status,

      signalScore:
        toNumber(
          record.signal_score,
        ),

      signalObservedAt:
        record.signal_observed_at,

      referencePrice:
        toNumber(
          record.reference_price,
        ) ??
        0,

      price30m:
        toNumber(
          record.price_30m,
        ),

      return30m:
        toNumber(
          record.return_30m,
        ),

      price60m:
        toNumber(
          record.price_60m,
        ),

      return60m:
        toNumber(
          record.return_60m,
        ),

      closePrice:
        toNumber(
          record.close_price,
        ),

      closeReturn:
        toNumber(
          record.close_return,
        ),

      maxReturn:
        toNumber(
          record.max_return,
        ),

      minReturn:
        toNumber(
          record.min_return,
        ),

      evaluationStatus:
        record.evaluation_status,

      decisionLabel:
        record.decision_label,

      lastEvaluatedAt:
        record.last_evaluated_at,

      completedAt:
        record.completed_at,
    }));

  const goodSkipRows =
    rows.filter(
      (row) =>
        row.decisionLabel ===
        "GOOD_SKIP",
    );

  const badSkipRows =
    rows.filter(
      (row) =>
        row.decisionLabel ===
        "BAD_SKIP",
    );

  const completedRows =
    rows.filter(
      (row) =>
        row.evaluationStatus ===
        "COMPLETE",
    );

  const skipEvaluationCount =
    goodSkipRows.length +
    badSkipRows.length;

  const latestEvaluatedAt =
    rows
      .map(
        (row) =>
          row.lastEvaluatedAt,
      )
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.length > 0,
      )
      .sort()
      .at(-1) ??
    null;

  return {
    summary: {
      totalTracks:
        rows.length,

      completed:
        completedRows.length,

      pending:
        rows.filter(
          (row) =>
            row.evaluationStatus ===
            "PENDING",
        ).length,

      partial:
        rows.filter(
          (row) =>
            row.evaluationStatus ===
            "PARTIAL",
        ).length,

      expired:
        rows.filter(
          (row) =>
            row.evaluationStatus ===
            "EXPIRED",
        ).length,

      invalid:
        rows.filter(
          (row) =>
            row.evaluationStatus ===
            "INVALID",
        ).length,

      goodSkip:
        goodSkipRows.length,

      badSkip:
        badSkipRows.length,

      goodEntry:
        rows.filter(
          (row) =>
            row.decisionLabel ===
            "GOOD_ENTRY",
        ).length,

      badEntry:
        rows.filter(
          (row) =>
            row.decisionLabel ===
            "BAD_ENTRY",
        ).length,

      skipAccuracy:
        skipEvaluationCount > 0
          ? goodSkipRows.length /
            skipEvaluationCount
          : null,

      goodSkipAverageReturn:
        average(
          goodSkipRows.map(
            (row) =>
              row.closeReturn,
          ),
        ),

      badSkipAverageReturn:
        average(
          badSkipRows.map(
            (row) =>
              row.closeReturn,
          ),
        ),

      averageMaximumReturn:
        average(
          completedRows.map(
            (row) =>
              row.maxReturn,
          ),
        ),

      averageMinimumReturn:
        average(
          completedRows.map(
            (row) =>
              row.minReturn,
          ),
        ),

      latestEvaluatedAt,
    },

    rows,
  };
}