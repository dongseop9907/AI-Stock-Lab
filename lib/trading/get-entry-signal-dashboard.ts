import { createSupabaseServerClient } from "@/lib/supabase";

interface EntrySignalRecord {
  id: string;
  model_id: string;
  stock_code: string;
  observed_at: string;
  status:
    | "GENERATED"
    | "ORDER_CREATED"
    | "SKIPPED"
    | "FAILED";

  score: number | string;

  recommended_entry_price:
    | number
    | string;

  recommended_stop_price:
    | number
    | string;

  recommended_quantity:
    | number
    | string;

  features:
    | Record<string, unknown>
    | null;

  reasons: unknown;

  order_id: string | null;
  error_message: string | null;

  created_at: string;
  updated_at: string;
}

interface EntryModelRecord {
  id: string;
  model_name: string;
  model_version: string;
  status: "CANDIDATE" | "APPROVED";
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
}

export interface EntrySignalDashboardRow {
  id: string;

  stockCode: string;
  stockName: string;

  observedAt: string;
  createdAt: string;

  status:
    | "GENERATED"
    | "ORDER_CREATED"
    | "SKIPPED"
    | "FAILED";

  score: number;

  entryPrice: number;
  stopPrice: number;
  quantity: number;

  modelId: string;
  modelName: string;
  modelVersion: string;
  modelStatus: string;

  features: Record<string, unknown>;
  reasons: string[];

  orderId: string | null;
  errorMessage: string | null;
}

export interface EntryModelOption {
  id: string;
  name: string;
  version: string;
  status: "CANDIDATE" | "APPROVED";
}

export interface EntrySignalDashboardData {
  signals: EntrySignalDashboardRow[];
  models: EntryModelOption[];
}

function toNumber(
  value: number | string,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function parseReasons(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getEntrySignalDashboardData(): Promise<EntrySignalDashboardData> {
  const supabase =
    createSupabaseServerClient();

  const [
    signalResult,
    modelResult,
  ] = await Promise.all([
    supabase
      .from("ai_entry_signals")
      .select(`
        id,
        model_id,
        stock_code,
        observed_at,
        status,
        score,
        recommended_entry_price,
        recommended_stop_price,
        recommended_quantity,
        features,
        reasons,
        order_id,
        error_message,
        created_at,
        updated_at
      `)
      .order("created_at", {
        ascending: false,
      })
      .limit(50),

    supabase
      .from("ai_model_versions")
      .select(`
        id,
        model_name,
        model_version,
        status
      `)
      .eq("purpose", "ENTRY_TIMING")
      .in("status", [
        "CANDIDATE",
        "APPROVED",
      ])
      .order("created_at", {
        ascending: false,
      }),
  ]);

  if (signalResult.error) {
    throw new Error(
      `진입 신호 조회 실패: ${signalResult.error.message}`,
    );
  }

  if (modelResult.error) {
    throw new Error(
      `진입 모델 조회 실패: ${modelResult.error.message}`,
    );
  }

  const signalRecords =
    (signalResult.data ??
      []) as EntrySignalRecord[];

  const modelRecords =
    (modelResult.data ??
      []) as EntryModelRecord[];

  const stockCodes = [
    ...new Set(
      signalRecords.map(
        (signal) =>
          signal.stock_code,
      ),
    ),
  ];

  let stockRecords: StockRecord[] = [];

  if (stockCodes.length > 0) {
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
        `종목 정보 조회 실패: ${stockError.message}`,
      );
    }

    stockRecords =
      (stockData ?? []) as StockRecord[];
  }

  const stockNameMap = new Map(
    stockRecords.map((stock) => [
      stock.stock_code,
      stock.stock_name,
    ]),
  );

  const modelMap = new Map(
    modelRecords.map((model) => [
      model.id,
      model,
    ]),
  );

  return {
    models: modelRecords.map(
      (model) => ({
        id: model.id,
        name: model.model_name,
        version: model.model_version,
        status: model.status,
      }),
    ),

    signals: signalRecords.map(
      (signal) => {
        const model =
          modelMap.get(
            signal.model_id,
          );

        return {
          id: signal.id,

          stockCode:
            signal.stock_code,

          stockName:
            stockNameMap.get(
              signal.stock_code,
            ) ??
            signal.stock_code,

          observedAt:
            signal.observed_at,

          createdAt:
            signal.created_at,

          status: signal.status,

          score:
            toNumber(signal.score),

          entryPrice:
            toNumber(
              signal.recommended_entry_price,
            ),

          stopPrice:
            toNumber(
              signal.recommended_stop_price,
            ),

          quantity:
            toNumber(
              signal.recommended_quantity,
            ),

          modelId:
            signal.model_id,

          modelName:
            model?.model_name ??
            "알 수 없는 모델",

          modelVersion:
            model?.model_version ??
            "-",

          modelStatus:
            model?.status ??
            "UNKNOWN",

          features:
            signal.features ?? {},

          reasons:
            parseReasons(
              signal.reasons,
            ),

          orderId:
            signal.order_id,

          errorMessage:
            signal.error_message,
        };
      },
    ),
  };
}