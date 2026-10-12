import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export interface CreateCommittedRiskPaperBuyOrderInput {
  accountId: string;
  stockCode: string;
  requestedQuantity: number;
  entryPrice: number;
  stopPrice: number;
  riskDecisionId: string;
  preflightApproved: boolean;
  equity: number;
  maxAggregateOpenRiskRate?: number;
}

export interface CommittedRiskSnapshot {
  maxAggregateOpenRiskRate?: number;
  riskBudgetAmount?: number;
  equity?: number;
  openPositionRiskAmount?: number;
  activeBuyReservedRiskAmount?: number;
  committedRiskBefore?: number;
  proposedTradeRiskAmount?: number;
  committedRiskAfter?: number;
  invalidOpenPositionStopCount?: number;
  approved?: boolean;
  reason?: string;
}

export interface CommittedRiskOrder {
  id: string;
  stock_code: string;
  side: string;
  requested_quantity: number;
  approved_quantity: number;
  entry_price: number | string;
  stop_price: number | string | null;
  status: string;
  created_at: string;
}

export interface CreateCommittedRiskPaperBuyOrderResult {
  idempotent: boolean;
  order: CommittedRiskOrder;
  committedRisk: CommittedRiskSnapshot;
}

function assertPositive(
  value: number,
  label: string,
) {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(
      `${label}_INVALID`,
    );
  }
}

export async function createPaperBuyOrderWithCommittedRisk(
  input: CreateCommittedRiskPaperBuyOrderInput,
): Promise<CreateCommittedRiskPaperBuyOrderResult> {
  if (!input.accountId) {
    throw new Error(
      "ACCOUNT_ID_REQUIRED",
    );
  }

  if (!input.stockCode?.trim()) {
    throw new Error(
      "STOCK_CODE_REQUIRED",
    );
  }

  if (
    !Number.isInteger(
      input.requestedQuantity,
    ) ||
    input.requestedQuantity <= 0
  ) {
    throw new Error(
      "REQUESTED_QUANTITY_INVALID",
    );
  }

  assertPositive(
    input.entryPrice,
    "ENTRY_PRICE",
  );

  assertPositive(
    input.stopPrice,
    "STOP_PRICE",
  );

  assertPositive(
    input.equity,
    "EQUITY",
  );

  if (!input.riskDecisionId) {
    throw new Error(
      "RISK_DECISION_ID_REQUIRED",
    );
  }

  const rate =
    input.maxAggregateOpenRiskRate ??
    0.02;

  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 1
  ) {
    throw new Error(
      "MAX_AGGREGATE_OPEN_RISK_RATE_INVALID",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "create_paper_buy_order_with_committed_risk_v3",
      {
        p_account_id:
          input.accountId,
        p_stock_code:
          input.stockCode,
        p_requested_quantity:
          input.requestedQuantity,
        p_entry_price:
          input.entryPrice,
        p_stop_price:
          input.stopPrice,
        p_risk_decision_id:
          input.riskDecisionId,
        p_preflight_approved:
          input.preflightApproved,
        p_equity:
          input.equity,
        p_max_aggregate_open_risk_rate:
          rate,
      },
    );

  if (error) {
    throw new Error(
      `COMMITTED_RISK_ORDER_CREATE_FAILED:${error.message}`,
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error(
      "COMMITTED_RISK_ORDER_INVALID_RESPONSE",
    );
  }

  const result =
    data as unknown as
      CreateCommittedRiskPaperBuyOrderResult;

  if (
    !result.order ||
    !result.order.id ||
    !result.order.status
  ) {
    throw new Error(
      "COMMITTED_RISK_ORDER_RESPONSE_MISSING_ORDER",
    );
  }

  return result;
}

export async function releasePaperBuyCommittedRisk(
  orderId: string,
  reason = "RELEASED",
) {
  if (!orderId) {
    throw new Error(
      "ORDER_ID_REQUIRED",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "release_paper_buy_risk_v3",
      {
        p_order_id:
          orderId,
        p_reason:
          reason,
      },
    );

  if (error) {
    throw new Error(
      `COMMITTED_RISK_RELEASE_FAILED:${error.message}`,
    );
  }

  return data;
}
