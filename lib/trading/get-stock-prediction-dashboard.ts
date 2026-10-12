import { createSupabaseServerClient } from "@/lib/supabase";

export type StockPredictionDirection =
  | "UP"
  | "NEUTRAL"
  | "DOWN";

interface LatestPredictionRecord {
  prediction_date: string;
  generated_at: string;
  model_name: string;
  model_version: string;
}

interface PredictionRecord {
  id: string;
  stock_code: string;
  prediction_date: string;
  generated_at: string;

  model_name: string;
  model_version: string;

  score: number | string;
  direction: StockPredictionDirection;
  confidence: number | string;
  is_candidate: boolean;

  price_momentum:
    | number
    | string
    | null;

  intraday_return:
    | number
    | string
    | null;

  volume_ratio:
    | number
    | string
    | null;

  range_position:
    | number
    | string
    | null;

  disclosure_score:
    | number
    | string
    | null;

  positive_disclosure_count:
    | number
    | string;

  negative_disclosure_count:
    | number
    | string;

  neutral_disclosure_count:
    | number
    | string;

  latest_disclosure_date:
    | string
    | null;

  reasons: unknown;
  raw_payload: unknown;
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
  market: string | null;
  sector: string | null;
}

export interface StockPredictionDashboardRow {
  id: string;

  stockCode: string;
  stockName: string;
  market: string | null;
  sector: string | null;

  score: number;
  direction: StockPredictionDirection;
  confidence: number;
  isCandidate: boolean;

  latestPrice: number | null;

  priceMomentum: number | null;
  intradayReturn: number | null;
  volumeRatio: number | null;
  rangePosition: number | null;

  disclosureScore: number | null;

  positiveDisclosureCount: number;
  negativeDisclosureCount: number;
  neutralDisclosureCount: number;

  latestDisclosureDate:
    | string
    | null;

  reasons: string[];
}

export interface StockPredictionDashboard {
  predictionDate: string;
  generatedAt: string;

  modelName: string;
  modelVersion: string;

  candidateThreshold: number;

  summary: {
    total: number;
    candidateCount: number;

    upCount: number;
    neutralCount: number;
    downCount: number;

    averageScore: number | null;
    averageConfidence: number | null;

    positiveDisclosureCount: number;
    negativeDisclosureCount: number;
  };

  rows: StockPredictionDashboardRow[];
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function toInteger(
  value: unknown,
): number {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? Math.floor(parsed)
    : 0;
}

function average(
  values: Array<number | null>,
): number | null {
  const valid =
    values.filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(value),
    );

  if (valid.length === 0) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    valid.length
  );
}

function getReasons(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (
        item,
      ): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRawNumber(
  value: unknown,
  key: string,
): number | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return toNumber(
    (
      value as Record<
        string,
        unknown
      >
    )[key],
  );
}

export async function getStockPredictionDashboard(): Promise<StockPredictionDashboard | null> {
  const supabase =
    createSupabaseServerClient();

  const {
    data: latestData,
    error: latestError,
  } = await supabase
    .from("ai_stock_predictions")
    .select(`
      prediction_date,
      generated_at,
      model_name,
      model_version
    `)
    .order("generated_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(
      `최신 AI 예측 조회 실패: ${latestError.message}`,
    );
  }

  if (!latestData) {
    return null;
  }

  const latest =
    latestData as
      LatestPredictionRecord;

  const {
    data: predictionData,
    error: predictionError,
  } = await supabase
    .from("ai_stock_predictions")
    .select(`
      id,
      stock_code,
      prediction_date,
      generated_at,
      model_name,
      model_version,
      score,
      direction,
      confidence,
      is_candidate,
      price_momentum,
      intraday_return,
      volume_ratio,
      range_position,
      disclosure_score,
      positive_disclosure_count,
      negative_disclosure_count,
      neutral_disclosure_count,
      latest_disclosure_date,
      reasons,
      raw_payload
    `)
    .eq(
      "prediction_date",
      latest.prediction_date,
    )
    .eq(
      "model_name",
      latest.model_name,
    )
    .eq(
      "model_version",
      latest.model_version,
    )
    .order("score", {
      ascending: false,
    });

  if (predictionError) {
    throw new Error(
      `AI 예측 결과 조회 실패: ${predictionError.message}`,
    );
  }

  const records =
    (predictionData ??
      []) as PredictionRecord[];

  const stockCodes =
    Array.from(
      new Set(
        records.map(
          (record) =>
            record.stock_code,
        ),
      ),
    );

  let stockMap =
    new Map<
      string,
      StockRecord
    >();

  if (stockCodes.length > 0) {
    const {
      data: stockData,
      error: stockError,
    } = await supabase
      .from("stocks")
      .select(`
        stock_code,
        stock_name,
        market,
        sector
      `)
      .in(
        "stock_code",
        stockCodes,
      );

    if (stockError) {
      throw new Error(
        `예측 종목 정보 조회 실패: ${stockError.message}`,
      );
    }

    stockMap =
      new Map(
        (
          (stockData ??
            []) as StockRecord[]
        ).map(
          (stock) => [
            stock.stock_code,
            stock,
          ],
        ),
      );
  }

  const rows:
    StockPredictionDashboardRow[] =
    records.map((record) => {
      const stock =
        stockMap.get(
          record.stock_code,
        );

      return {
        id:
          record.id,

        stockCode:
          record.stock_code,

        stockName:
          stock?.stock_name ??
          record.stock_code,

        market:
          stock?.market ??
          null,

        sector:
          stock?.sector ??
          null,

        score:
          toNumber(
            record.score,
          ) ??
          0,

        direction:
          record.direction,

        confidence:
          toNumber(
            record.confidence,
          ) ??
          0,

        isCandidate:
          Boolean(
            record.is_candidate,
          ),

        latestPrice:
          getRawNumber(
            record.raw_payload,
            "latestPrice",
          ),

        priceMomentum:
          toNumber(
            record.price_momentum,
          ),

        intradayReturn:
          toNumber(
            record.intraday_return,
          ),

        volumeRatio:
          toNumber(
            record.volume_ratio,
          ),

        rangePosition:
          toNumber(
            record.range_position,
          ),

        disclosureScore:
          toNumber(
            record.disclosure_score,
          ),

        positiveDisclosureCount:
          toInteger(
            record
              .positive_disclosure_count,
          ),

        negativeDisclosureCount:
          toInteger(
            record
              .negative_disclosure_count,
          ),

        neutralDisclosureCount:
          toInteger(
            record
              .neutral_disclosure_count,
          ),

        latestDisclosureDate:
          record
            .latest_disclosure_date,

        reasons:
          getReasons(
            record.reasons,
          ),
      };
    });

  const firstRawPayload =
    records[0]?.raw_payload;

  const candidateThreshold =
    getRawNumber(
      firstRawPayload,
      "candidateThreshold",
    ) ??
    0.62;

  return {
    predictionDate:
      latest.prediction_date,

    generatedAt:
      latest.generated_at,

    modelName:
      latest.model_name,

    modelVersion:
      latest.model_version,

    candidateThreshold,

    summary: {
      total:
        rows.length,

      candidateCount:
        rows.filter(
          (row) =>
            row.isCandidate,
        ).length,

      upCount:
        rows.filter(
          (row) =>
            row.direction ===
            "UP",
        ).length,

      neutralCount:
        rows.filter(
          (row) =>
            row.direction ===
            "NEUTRAL",
        ).length,

      downCount:
        rows.filter(
          (row) =>
            row.direction ===
            "DOWN",
        ).length,

      averageScore:
        average(
          rows.map(
            (row) =>
              row.score,
          ),
        ),

      averageConfidence:
        average(
          rows.map(
            (row) =>
              row.confidence,
          ),
        ),

      positiveDisclosureCount:
        rows.reduce(
          (sum, row) =>
            sum +
            row
              .positiveDisclosureCount,
          0,
        ),

      negativeDisclosureCount:
        rows.reduce(
          (sum, row) =>
            sum +
            row
              .negativeDisclosureCount,
          0,
        ),
    },

    rows,
  };
}