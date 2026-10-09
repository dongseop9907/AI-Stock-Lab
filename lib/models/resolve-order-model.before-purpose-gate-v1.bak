import type { ModelStatus } from "@/lib/trading/types";
import { createSupabaseServerClient } from "@/lib/supabase";

export type OrderTradingMode = "PAPER" | "LIVE";

export type OrderModelStatus = ModelStatus;

export type OrderModelPurpose =
  | "STOCK_SELECTION"
  | "ENTRY_TIMING"
  | "STOP_LOSS"
  | "TRAILING_STOP"
  | "TEST";

export interface OrderModel {
  id: string;
  modelName: string;
  modelVersion: string;
  purpose: OrderModelPurpose;
  status: OrderModelStatus;
  trainingTradeCount: number;
  metrics: Record<string, unknown>;
  createdAt: string;
  approvedAt: string | null;
}

interface ModelRecord {
  id: string;
  model_name: string;
  model_version: string;
  purpose: OrderModelPurpose;
  status: OrderModelStatus;
  training_trade_count: number;
  metrics: Record<string, unknown> | null;
  created_at: string;
  approved_at: string | null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function resolveOrderModel(
  modelId: string,
  tradingMode: OrderTradingMode,
): Promise<OrderModel> {
  if (!modelId || !isUuid(modelId)) {
    throw new Error("INVALID_MODEL_ID");
  }

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_model_versions")
    .select(`
      id,
      model_name,
      model_version,
      purpose,
      status,
      training_trade_count,
      metrics,
      created_at,
      approved_at
    `)
    .eq("id", modelId)
    .single();

  if (error || !data) {
    throw new Error("ORDER_MODEL_NOT_FOUND");
  }

  const model = data as ModelRecord;

  /*
   * 거절 또는 은퇴 모델은 모의투자에서도 새 주문에 사용할 수 없다.
   */
  if (model.status === "REJECTED") {
    throw new Error("REJECTED_MODEL_NOT_ALLOWED");
  }

  if (model.status === "RETIRED") {
    throw new Error("RETIRED_MODEL_NOT_ALLOWED");
  }

  /*
   * 실거래에서는 승인 모델만 사용할 수 있다.
   */
  if (
    tradingMode === "LIVE" &&
    model.status !== "APPROVED"
  ) {
    throw new Error("LIVE_TRADING_REQUIRES_APPROVED_MODEL");
  }

  /*
   * TEST 모델은 실제계좌에 절대 사용할 수 없다.
   */
  if (
    tradingMode === "LIVE" &&
    model.purpose === "TEST"
  ) {
    throw new Error("TEST_MODEL_NOT_ALLOWED_FOR_LIVE");
  }

  /*
   * 매수 시점 판단 주문은 ENTRY_TIMING 모델만 실제계좌에 허용한다.
   */
  if (
    tradingMode === "LIVE" &&
    model.purpose !== "ENTRY_TIMING"
  ) {
    throw new Error(
      "LIVE_BUY_REQUIRES_ENTRY_TIMING_MODEL",
    );
  }

  return {
    id: model.id,
    modelName: model.model_name,
    modelVersion: model.model_version,
    purpose: model.purpose,
    status: model.status,
    trainingTradeCount:
      model.training_trade_count,
    metrics: model.metrics ?? {},
    createdAt: model.created_at,
    approvedAt: model.approved_at,
  };
}