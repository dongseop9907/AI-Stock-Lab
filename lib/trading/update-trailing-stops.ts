import { createSupabaseServerClient } from "@/lib/supabase";

import { DEFAULT_TRAILING_STOP_POLICY } from "@/lib/trading/trailing-stop-policy";

interface PositionRecord {
  id: string;
  stock_code: string;
}

interface SnapshotRecord {
  stock_code: string;
  observed_at: string;
  high_price: number | string | null;
  close_price: number | string | null;
}

interface TrailingUpdateResult {
  positionId: string;
  stockCode: string;

  averagePrice: number;
  currentPrice: number;

  previousHighestPrice: number;
  highestPrice: number;

  activationPrice: number;

  oldStopPrice: number;
  newStopPrice: number;

  trailingActive: boolean;
  activatedNow: boolean;
  stopRaised: boolean;
  triggered: boolean;

  observedAt: string;
}

interface ExitResult {
  alreadyClosed: boolean;
  tradeId: string;
  stockCode: string;
  status?: string;
  exitReason?: string;
  quantity: number;
  entryPrice?: number;
  exitPrice: number;
  stopPrice?: number;
  realizedPnl: number;
  realizedReturn?: number;
  closedAt: string;
}

function toNumber(
  value: number | string | null,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export async function updateTrailingStops() {
  const supabase = createSupabaseServerClient();

  const { data: positionData, error: positionError } =
    await supabase
      .from("paper_positions")
      .select(`
        id,
        stock_code
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
      activated: 0,
      raised: 0,
      triggered: 0,
      executed: 0,
      updates: [],
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
        observed_at,
        high_price,
        close_price
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
      latestSnapshotByStock.has(
        snapshot.stock_code,
      )
    ) {
      continue;
    }

    latestSnapshotByStock.set(
      snapshot.stock_code,
      snapshot,
    );
  }

  const updates: TrailingUpdateResult[] = [];
  const executions: ExitResult[] = [];

  const skipped: Array<{
    positionId: string;
    stockCode: string;
    reason: string;
  }> = [];

  let activated = 0;
  let raised = 0;
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

    const snapshotHigh = toNumber(
      snapshot.high_price,
    );

    if (currentPrice <= 0) {
      skipped.push({
        positionId: position.id,
        stockCode: position.stock_code,
        reason: "INVALID_CURRENT_PRICE",
      });

      continue;
    }

    const { data, error } = await supabase.rpc(
      "update_paper_trailing_stop",
      {
        p_position_id: position.id,
        p_current_price: currentPrice,
        p_snapshot_high:
          snapshotHigh > 0
            ? snapshotHigh
            : currentPrice,
        p_observed_at: snapshot.observed_at,
        p_activation_rate:
          DEFAULT_TRAILING_STOP_POLICY.activationRate,
        p_trailing_distance_rate:
          DEFAULT_TRAILING_STOP_POLICY
            .trailingDistanceRate,
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

    const update =
      data as TrailingUpdateResult;

    updates.push(update);

    if (update.activatedNow) {
      activated += 1;
    }

    if (update.stopRaised) {
      raised += 1;
    }

    if (!update.triggered) {
      continue;
    }

    triggered += 1;

    /*
     * 현재가가 새 손절가 이하라면
     * 기존 모의 손절 매도 함수를 실행한다.
     */
    const {
      data: executionData,
      error: executionError,
    } = await supabase.rpc(
      "execute_paper_stop_loss",
      {
        p_position_id: position.id,
        p_exit_price: currentPrice,
        p_observed_at: snapshot.observed_at,
      },
    );

    if (executionError) {
      skipped.push({
        positionId: position.id,
        stockCode: position.stock_code,
        reason: executionError.message,
      });

      continue;
    }

    executions.push(
      executionData as ExitResult,
    );
  }

  return {
    checked: positions.length,
    activated,
    raised,
    triggered,
    executed: executions.length,
    updates,
    executions,
    skipped,
  };
}