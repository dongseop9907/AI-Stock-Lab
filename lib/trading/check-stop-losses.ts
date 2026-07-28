import { createSupabaseServerClient } from "@/lib/supabase";

interface PositionRecord {
  id: string;
  account_id: string;
  stock_code: string;
  quantity: number;
  average_price: number | string;
  current_stop_price: number | string;
}

interface SnapshotRecord {
  stock_code: string;
  close_price: number | string | null;
  observed_at: string;
}

export interface StopLossExecutionResult {
  alreadyClosed: boolean;
  tradeId: string;
  sellOrderId?: string;
  accountId?: string;
  stockCode: string;
  status?: string;
  exitReason?: string;
  quantity: number;
  entryPrice?: number;
  exitPrice: number;
  stopPrice?: number;
  entryAmount?: number;
  exitAmount?: number;
  realizedPnl: number;
  realizedReturn?: number;
  remainingCash?: number;
  closedAt: string;
}

function toNumber(
  value: number | string | null,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export async function checkAndExecuteStopLosses() {
  const supabase = createSupabaseServerClient();

  const { data: positionData, error: positionError } =
    await supabase
      .from("paper_positions")
      .select(`
        id,
        account_id,
        stock_code,
        quantity,
        average_price,
        current_stop_price
      `)
      .order("opened_at", {
        ascending: true,
      });

  if (positionError) {
    throw new Error(
      `보유 종목 조회 실패: ${positionError.message}`,
    );
  }

  const positions =
    (positionData ?? []) as PositionRecord[];

  if (positions.length === 0) {
    return {
      checked: 0,
      triggered: 0,
      executed: 0,
      executions: [],
      skipped: [],
    };
  }

  const stockCodes = Array.from(
    new Set(
      positions.map(
        (position) => position.stock_code,
      ),
    ),
  );

  const { data: snapshotData, error: snapshotError } =
    await supabase
      .from("market_snapshots")
      .select(`
        stock_code,
        close_price,
        observed_at
      `)
      .in("stock_code", stockCodes)
      .order("observed_at", {
        ascending: false,
      })
      .limit(5000);

  if (snapshotError) {
    throw new Error(
      `최신 시세 조회 실패: ${snapshotError.message}`,
    );
  }

  const latestSnapshotByStock =
    new Map<string, SnapshotRecord>();

  for (
    const snapshot of
    (snapshotData ?? []) as SnapshotRecord[]
  ) {
    if (
      !latestSnapshotByStock.has(
        snapshot.stock_code,
      )
    ) {
      latestSnapshotByStock.set(
        snapshot.stock_code,
        snapshot,
      );
    }
  }

  const executions: StopLossExecutionResult[] = [];

  const skipped: Array<{
    positionId: string;
    stockCode: string;
    reason: string;
  }> = [];

  let triggered = 0;

  for (const position of positions) {
    const snapshot = latestSnapshotByStock.get(
      position.stock_code,
    );

    if (!snapshot) {
      skipped.push({
        positionId: position.id,
        stockCode: position.stock_code,
        reason: "LATEST_PRICE_NOT_FOUND",
      });

      continue;
    }

    const currentPrice = toNumber(
      snapshot.close_price,
    );

    const stopPrice = toNumber(
      position.current_stop_price,
    );

    if (currentPrice <= 0 || stopPrice <= 0) {
      skipped.push({
        positionId: position.id,
        stockCode: position.stock_code,
        reason: "INVALID_PRICE",
      });

      continue;
    }

    if (currentPrice > stopPrice) {
      continue;
    }

    triggered += 1;

    const { data, error } = await supabase.rpc(
      "execute_paper_stop_loss",
      {
        p_position_id: position.id,
        p_exit_price: currentPrice,
        p_observed_at: snapshot.observed_at,
      },
    );

    if (error) {
      skipped.push({
        positionId: position.id,
        stockCode: position.stock_code,
        reason: error.message,
      });

      continue;
    }

    executions.push(
      data as StopLossExecutionResult,
    );
  }

  return {
    checked: positions.length,
    triggered,
    executed: executions.length,
    executions,
    skipped,
  };
}