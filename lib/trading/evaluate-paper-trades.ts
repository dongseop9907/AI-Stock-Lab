import { createSupabaseServerClient } from "@/lib/supabase";

type EvaluationStage =
  | "DAY_1"
  | "DAY_5"
  | "DAY_20";

type EvaluationVerdict =
  | "PENDING"
  | "PROTECTED_CAPITAL"
  | "EARLY_EXIT"
  | "MIXED"
  | "NEUTRAL";

interface TradeRecord {
  id: string;
  stock_code: string;
  exit_price: number | string;
  closed_at: string;

  post_exit_price_1d: number | string | null;
  post_exit_price_5d: number | string | null;
  post_exit_price_20d: number | string | null;

  post_exit_return_1d: number | string | null;
  post_exit_return_5d: number | string | null;
  post_exit_return_20d: number | string | null;
}

interface SnapshotRecord {
  stock_code: string;
  observed_at: string;
  close_price: number | string | null;
}

interface EvaluationResult {
  stage: EvaluationStage;
  verdict: EvaluationVerdict;
  qualityScore: number;
  reason: string;
}

const EVALUATION_VERSION = "exit-evaluation-v1";
const MATERIAL_MOVE_RATE = 0.03;

function toNullableNumber(
  value: number | string | null,
): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function calculateReturn(
  exitPrice: number,
  futurePrice: number | null,
): number | null {
  if (
    exitPrice <= 0 ||
    futurePrice === null ||
    futurePrice <= 0
  ) {
    return null;
  }

  return (futurePrice - exitPrice) / exitPrice;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function getKoreanDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const values = Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function evaluateExit(
  return1d: number | null,
  return5d: number | null,
  return20d: number | null,
): EvaluationResult {
  const stage: EvaluationStage =
    return20d !== null
      ? "DAY_20"
      : return5d !== null
        ? "DAY_5"
        : "DAY_1";

  /*
   * 1거래일 데이터만 있을 때는 최종 판단을 보류한다.
   */
  if (return5d === null) {
    return {
      stage,
      verdict: "PENDING",
      qualityScore: 0,
      reason:
        "손절 적절성을 판단하기 위한 5거래일 데이터가 아직 부족합니다.",
    };
  }

  const evaluationReturns = [
    return5d,
    return20d,
  ].filter(
    (value): value is number =>
      value !== null,
  );

  const highestReturn = Math.max(
    ...evaluationReturns,
  );

  const lowestReturn = Math.min(
    ...evaluationReturns,
  );

  /*
   * 가격이 매도 후 하락할수록 손절 품질 점수는 양수,
   * 상승할수록 음수가 된다.
   */
  const anchorReturn =
    return20d ?? return5d;

  const qualityScore = clamp(
    -anchorReturn / 0.1,
    -1,
    1,
  );

  if (
    highestReturn >= MATERIAL_MOVE_RATE &&
    lowestReturn <= -MATERIAL_MOVE_RATE
  ) {
    return {
      stage,
      verdict: "MIXED",
      qualityScore,
      reason:
        "매도 후 의미 있는 반등과 추가 하락이 모두 발생해 손절 평가가 혼재합니다.",
    };
  }

  if (highestReturn >= MATERIAL_MOVE_RATE) {
    return {
      stage,
      verdict: "EARLY_EXIT",
      qualityScore,
      reason:
        "매도 후 가격이 3% 이상 상승해 손절이 다소 빨랐을 가능성이 있습니다.",
    };
  }

  if (lowestReturn <= -MATERIAL_MOVE_RATE) {
    return {
      stage,
      verdict: "PROTECTED_CAPITAL",
      qualityScore,
      reason:
        "매도 후 가격이 3% 이상 추가 하락해 손실 확대를 피했습니다.",
    };
  }

  return {
    stage,
    verdict: "NEUTRAL",
    qualityScore,
    reason:
      "매도 후 가격 변화가 ±3% 범위로 손절 효과가 뚜렷하지 않습니다.",
  };
}

function selectTradingDaySnapshots(
  snapshots: SnapshotRecord[],
  closedAt: string,
): SnapshotRecord[] {
  const closedDateKey =
    getKoreanDateKey(closedAt);

  /*
   * 같은 날짜에 여러 번 수집된 데이터가 있다면
   * 해당 날짜의 가장 마지막 시세를 사용한다.
   */
  const latestByDate =
    new Map<string, SnapshotRecord>();

  for (const snapshot of snapshots) {
    if (
      new Date(snapshot.observed_at).getTime() <=
      new Date(closedAt).getTime()
    ) {
      continue;
    }

    const snapshotDateKey =
      getKoreanDateKey(snapshot.observed_at);

    if (snapshotDateKey === closedDateKey) {
      continue;
    }

    latestByDate.set(
      snapshotDateKey,
      snapshot,
    );
  }

  return Array.from(
    latestByDate.values(),
  ).sort(
    (left, right) =>
      new Date(left.observed_at).getTime() -
      new Date(right.observed_at).getTime(),
  );
}

export async function evaluatePaperTrades() {
  const supabase = createSupabaseServerClient();

  const { data: tradeData, error: tradeError } =
    await supabase
      .from("paper_trade_history")
      .select(`
        id,
        stock_code,
        exit_price,
        closed_at,
        post_exit_price_1d,
        post_exit_price_5d,
        post_exit_price_20d,
        post_exit_return_1d,
        post_exit_return_5d,
        post_exit_return_20d
      `)
      .order("closed_at", {
        ascending: false,
      })
      .limit(500);

  if (tradeError) {
    throw new Error(
      `매도 거래 조회 실패: ${tradeError.message}`,
    );
  }

  const trades =
    (tradeData ?? []) as TradeRecord[];

  if (trades.length === 0) {
    return {
      checked: 0,
      updated: 0,
      evaluated: 0,
      results: [],
      skipped: [],
    };
  }

  const stockCodes = Array.from(
    new Set(
      trades.map(
        (trade) => trade.stock_code,
      ),
    ),
  );

  const earliestClosedAt = trades
    .map((trade) => trade.closed_at)
    .sort()[0];

  const { data: snapshotData, error: snapshotError } =
    await supabase
      .from("market_snapshots")
      .select(`
        stock_code,
        observed_at,
        close_price
      `)
      .in("stock_code", stockCodes)
      .gt("observed_at", earliestClosedAt)
      .order("observed_at", {
        ascending: true,
      })
      .limit(20000);

  if (snapshotError) {
    throw new Error(
      `매도 후 시세 조회 실패: ${snapshotError.message}`,
    );
  }

  const snapshotsByStock =
    new Map<string, SnapshotRecord[]>();

  for (
    const snapshot of
    (snapshotData ?? []) as SnapshotRecord[]
  ) {
    const existing =
      snapshotsByStock.get(
        snapshot.stock_code,
      ) ?? [];

    existing.push(snapshot);

    snapshotsByStock.set(
      snapshot.stock_code,
      existing,
    );
  }

  const results: Array<{
    tradeId: string;
    stockCode: string;
    stage: EvaluationStage;
    verdict: EvaluationVerdict;
    qualityScore: number;
    return1d: number | null;
    return5d: number | null;
    return20d: number | null;
  }> = [];

  const skipped: Array<{
    tradeId: string;
    stockCode: string;
    reason: string;
  }> = [];

  let updated = 0;
  let evaluated = 0;

  for (const trade of trades) {
    const exitPrice =
      toNullableNumber(trade.exit_price);

    if (
      exitPrice === null ||
      exitPrice <= 0
    ) {
      skipped.push({
        tradeId: trade.id,
        stockCode: trade.stock_code,
        reason: "INVALID_EXIT_PRICE",
      });

      continue;
    }

    const stockSnapshots =
      snapshotsByStock.get(
        trade.stock_code,
      ) ?? [];

    const tradingDays =
      selectTradingDaySnapshots(
        stockSnapshots,
        trade.closed_at,
      );

    if (tradingDays.length === 0) {
      skipped.push({
        tradeId: trade.id,
        stockCode: trade.stock_code,
        reason: "POST_EXIT_PRICE_NOT_FOUND",
      });

      continue;
    }

    const day1Snapshot = tradingDays[0];
    const day5Snapshot = tradingDays[4];
    const day20Snapshot = tradingDays[19];

    const price1d =
      toNullableNumber(
        day1Snapshot?.close_price ?? null,
      ) ??
      toNullableNumber(
        trade.post_exit_price_1d,
      );

    const price5d =
      toNullableNumber(
        day5Snapshot?.close_price ?? null,
      ) ??
      toNullableNumber(
        trade.post_exit_price_5d,
      );

    const price20d =
      toNullableNumber(
        day20Snapshot?.close_price ?? null,
      ) ??
      toNullableNumber(
        trade.post_exit_price_20d,
      );

    const return1d =
      calculateReturn(exitPrice, price1d) ??
      toNullableNumber(
        trade.post_exit_return_1d,
      );

    const return5d =
      calculateReturn(exitPrice, price5d) ??
      toNullableNumber(
        trade.post_exit_return_5d,
      );

    const return20d =
      calculateReturn(exitPrice, price20d) ??
      toNullableNumber(
        trade.post_exit_return_20d,
      );

    const updatePayload: Record<
      string,
      number
    > = {};

    if (price1d !== null) {
      updatePayload.post_exit_price_1d =
        price1d;
    }

    if (price5d !== null) {
      updatePayload.post_exit_price_5d =
        price5d;
    }

    if (price20d !== null) {
      updatePayload.post_exit_price_20d =
        price20d;
    }

    if (return1d !== null) {
      updatePayload.post_exit_return_1d =
        return1d;
    }

    if (return5d !== null) {
      updatePayload.post_exit_return_5d =
        return5d;
    }

    if (return20d !== null) {
      updatePayload.post_exit_return_20d =
        return20d;
    }

    if (
      Object.keys(updatePayload).length > 0
    ) {
      const { error: updateError } =
        await supabase
          .from("paper_trade_history")
          .update(updatePayload)
          .eq("id", trade.id);

      if (updateError) {
        skipped.push({
          tradeId: trade.id,
          stockCode: trade.stock_code,
          reason: updateError.message,
        });

        continue;
      }

      updated += 1;
    }

    const evaluation = evaluateExit(
      return1d,
      return5d,
      return20d,
    );

    const { error: evaluationError } =
      await supabase
        .from("paper_trade_evaluations")
        .upsert(
          {
            trade_id: trade.id,
            evaluation_version:
              EVALUATION_VERSION,
            evaluation_stage:
              evaluation.stage,
            verdict:
              evaluation.verdict,
            quality_score:
              evaluation.qualityScore,
            reason:
              evaluation.reason,
            metrics: {
              exitPrice,
              postExitPrices: {
                day1: price1d,
                day5: price5d,
                day20: price20d,
              },
              postExitReturns: {
                day1: return1d,
                day5: return5d,
                day20: return20d,
              },
              thresholds: {
                materialMoveRate:
                  MATERIAL_MOVE_RATE,
              },
              availableTradingDays:
                tradingDays.length,
            },
            evaluated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "trade_id,evaluation_version",
          },
        );

    if (evaluationError) {
      skipped.push({
        tradeId: trade.id,
        stockCode: trade.stock_code,
        reason: evaluationError.message,
      });

      continue;
    }

    evaluated += 1;

    results.push({
      tradeId: trade.id,
      stockCode: trade.stock_code,
      stage: evaluation.stage,
      verdict: evaluation.verdict,
      qualityScore:
        evaluation.qualityScore,
      return1d,
      return5d,
      return20d,
    });
  }

  return {
    checked: trades.length,
    updated,
    evaluated,
    results,
    skipped,
  };
}