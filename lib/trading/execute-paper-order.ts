import { createSupabaseServerClient } from "@/lib/supabase";

export interface PaperExecutionResult {
  alreadyFilled: boolean;
  orderId: string;
  accountId?: string;
  stockCode?: string;
  status: string;
  filledQuantity: number;
  filledPrice: number;
  orderAmount?: number;
  remainingCash?: number;
  positionQuantity?: number;
  averagePrice?: number;
  stopPrice?: number;
  executedAt: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function executePaperOrder(
  orderId: string,
): Promise<PaperExecutionResult> {
  if (!isUuid(orderId)) {
    throw new Error("INVALID_ORDER_ID");
  }

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase.rpc(
    "execute_paper_buy_order",
    {
      p_order_id: orderId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("EMPTY_EXECUTION_RESULT");
  }

  return data as PaperExecutionResult;
}