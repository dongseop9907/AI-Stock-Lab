import { createSupabaseServerClient } from "@/lib/supabase";
import { executePaperOrder } from "@/lib/trading/execute-paper-order";

interface ApprovedOrderRecord {
  id: string;
  stock_code: string;
  created_at: string;
}

export interface ApprovedOrderExecutionResult {
  orderId: string;
  stockCode: string;
  executed: boolean;
  error: string | null;
  execution: unknown;
}

export async function executeApprovedPaperOrders(
  requestedMaxOrders = 5,
) {
  const maxOrders = Math.min(
    20,
    Math.max(
      1,
      Math.floor(requestedMaxOrders),
    ),
  );

  const supabase =
    createSupabaseServerClient();

  const { data, error } = await supabase
    .from("paper_order_requests")
    .select(`
      id,
      stock_code,
      created_at
    `)
    .eq("side", "BUY")
    .eq("status", "RISK_APPROVED")
    .order("created_at", {
      ascending: true,
    })
    .limit(maxOrders);

  if (error) {
    throw new Error(
      `승인 주문 조회 실패: ${error.message}`,
    );
  }

  const orders =
    (data ?? []) as ApprovedOrderRecord[];

  const results:
    ApprovedOrderExecutionResult[] = [];

  let executed = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const execution =
        await executePaperOrder(order.id);

      executed += 1;

      results.push({
        orderId: order.id,
        stockCode: order.stock_code,
        executed: true,
        error: null,
        execution,
      });
    } catch (error) {
      failed += 1;

      results.push({
        orderId: order.id,
        stockCode: order.stock_code,
        executed: false,
        error:
          error instanceof Error
            ? error.message
            : "주문 체결 중 오류가 발생했습니다.",
        execution: null,
      });
    }
  }

  return {
    maxOrders,
    checked: orders.length,
    executed,
    failed,
    results,
  };
}