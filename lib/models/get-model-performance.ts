import { createSupabaseServerClient } from "@/lib/supabase";

interface ModelPerformanceRecord {
  model_id: string;
  model_name: string;
  model_version: string;
  purpose: string;
  status: string;
  training_trade_count: number | string;

  buy_order_count: number | string;
  risk_approved_count: number | string;
  risk_rejected_count: number | string;
  filled_buy_count: number | string;
  risk_approval_rate: number | string | null;

  closed_trade_count: number | string;
  winning_trade_count: number | string;
  losing_trade_count: number | string;
  breakeven_trade_count: number | string;

  win_rate: number | string | null;

  total_realized_pnl: number | string;
  average_realized_pnl: number | string | null;
  average_realized_return: number | string | null;
  best_trade_return: number | string | null;
  worst_trade_return: number | string | null;
  profit_factor: number | string | null;

  evaluated_trade_count: number | string;
  average_stop_quality_score: number | string | null;

  pending_evaluation_count: number | string;
  protected_capital_count: number | string;
  early_exit_count: number | string;
  mixed_exit_count: number | string;
  neutral_exit_count: number | string;

  day_1_evaluation_count: number | string;
  day_5_evaluation_count: number | string;
  day_20_evaluation_count: number | string;

  created_at: string;
  evaluated_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
}

export interface ModelPerformance {
  modelId: string;
  modelName: string;
  modelVersion: string;
  purpose: string;
  status: string;
  trainingTradeCount: number;

  orders: {
    requested: number;
    riskApproved: number;
    riskRejected: number;
    filled: number;
    approvalRate: number | null;
  };

  trades: {
    closed: number;
    winning: number;
    losing: number;
    breakeven: number;

    winRate: number | null;

    totalRealizedPnl: number;
    averageRealizedPnl: number | null;
    averageReturn: number | null;

    bestReturn: number | null;
    worstReturn: number | null;
    profitFactor: number | null;
  };

  exitQuality: {
    evaluated: number;
    averageScore: number | null;

    pending: number;
    protectedCapital: number;
    earlyExit: number;
    mixed: number;
    neutral: number;

    day1: number;
    day5: number;
    day20: number;
  };

  createdAt: string;
  evaluatedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
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

function toRequiredNumber(
  value: number | string | null,
): number {
  return toNumber(value) ?? 0;
}

export async function getModelPerformance(): Promise<
  ModelPerformance[]
> {
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
      toRequiredNumber(
        row.training_trade_count,
      ),

    orders: {
      requested:
        toRequiredNumber(
          row.buy_order_count,
        ),

      riskApproved:
        toRequiredNumber(
          row.risk_approved_count,
        ),

      riskRejected:
        toRequiredNumber(
          row.risk_rejected_count,
        ),

      filled:
        toRequiredNumber(
          row.filled_buy_count,
        ),

      approvalRate:
        toNumber(
          row.risk_approval_rate,
        ),
    },

    trades: {
      closed:
        toRequiredNumber(
          row.closed_trade_count,
        ),

      winning:
        toRequiredNumber(
          row.winning_trade_count,
        ),

      losing:
        toRequiredNumber(
          row.losing_trade_count,
        ),

      breakeven:
        toRequiredNumber(
          row.breakeven_trade_count,
        ),

      winRate:
        toNumber(row.win_rate),

      totalRealizedPnl:
        toRequiredNumber(
          row.total_realized_pnl,
        ),

      averageRealizedPnl:
        toNumber(
          row.average_realized_pnl,
        ),

      averageReturn:
        toNumber(
          row.average_realized_return,
        ),

      bestReturn:
        toNumber(
          row.best_trade_return,
        ),

      worstReturn:
        toNumber(
          row.worst_trade_return,
        ),

      profitFactor:
        toNumber(row.profit_factor),
    },

    exitQuality: {
      evaluated:
        toRequiredNumber(
          row.evaluated_trade_count,
        ),

      averageScore:
        toNumber(
          row.average_stop_quality_score,
        ),

      pending:
        toRequiredNumber(
          row.pending_evaluation_count,
        ),

      protectedCapital:
        toRequiredNumber(
          row.protected_capital_count,
        ),

      earlyExit:
        toRequiredNumber(
          row.early_exit_count,
        ),

      mixed:
        toRequiredNumber(
          row.mixed_exit_count,
        ),

      neutral:
        toRequiredNumber(
          row.neutral_exit_count,
        ),

      day1:
        toRequiredNumber(
          row.day_1_evaluation_count,
        ),

      day5:
        toRequiredNumber(
          row.day_5_evaluation_count,
        ),

      day20:
        toRequiredNumber(
          row.day_20_evaluation_count,
        ),
    },

    createdAt: row.created_at,
    evaluatedAt: row.evaluated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
  }));
}