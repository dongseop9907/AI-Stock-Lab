import { createSupabaseServerClient } from "@/lib/supabase";

interface ModelPerformanceRecord {
  model_id: string;
  model_name: string;
  model_version: string;
  purpose: string;
  status: string;
  training_trade_count: number;

  buy_order_count: number | string;
  risk_approved_count: number | string;
  risk_rejected_count: number | string;
  filled_buy_count: number | string;

  closed_trade_count: number | string;
  winning_trade_count: number | string;
  losing_trade_count: number | string;

  win_rate: number | string | null;
  total_realized_pnl: number | string;
  average_realized_return: number | string | null;
  profit_factor: number | string | null;

  average_stop_quality_score:
    | number
    | string
    | null;

  protected_capital_count: number | string;
  early_exit_count: number | string;
  mixed_exit_count: number | string;
  neutral_exit_count: number | string;

  created_at: string;
  approved_at: string | null;
}

function toNumber(
  value: number | string | null,
): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

export async function getModelPerformance() {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_model_performance_summary")
    .select("*")
    .order("closed_trade_count", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw new Error(
      `모델 성과 조회 실패: ${error.message}`,
    );
  }

  return (
    (data ?? []) as ModelPerformanceRecord[]
  ).map((row) => ({
    modelId: row.model_id,
    modelName: row.model_name,
    modelVersion: row.model_version,
    purpose: row.purpose,
    status: row.status,
    trainingTradeCount:
      Number(row.training_trade_count),

    orders: {
      requested:
        Number(row.buy_order_count),
      riskApproved:
        Number(row.risk_approved_count),
      riskRejected:
        Number(row.risk_rejected_count),
      filled:
        Number(row.filled_buy_count),
    },

    trades: {
      closed:
        Number(row.closed_trade_count),
      winning:
        Number(row.winning_trade_count),
      losing:
        Number(row.losing_trade_count),
      winRate:
        toNumber(row.win_rate),
      totalRealizedPnl:
        toNumber(
          row.total_realized_pnl,
        ) ?? 0,
      averageReturn:
        toNumber(
          row.average_realized_return,
        ),
      profitFactor:
        toNumber(row.profit_factor),
    },

    exitQuality: {
      averageScore:
        toNumber(
          row.average_stop_quality_score,
        ),
      protectedCapital:
        Number(
          row.protected_capital_count,
        ),
      earlyExit:
        Number(row.early_exit_count),
      mixed:
        Number(row.mixed_exit_count),
      neutral:
        Number(row.neutral_exit_count),
    },

    createdAt: row.created_at,
    approvedAt: row.approved_at,
  }));
}