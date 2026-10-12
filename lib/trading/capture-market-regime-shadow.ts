import { createSupabaseServerClient } from "@/lib/supabase";

import {
  getCurrentMarketRegimeShadowSafe,
} from "@/lib/trading/market-regime-shadow";

interface LatestObservationRecord {
  id: string;
  observed_at: string;
  market_date: string | null;
  regime: string;
  breadth_20: number | string | null;
  avg_return_20: number | string | null;
  source: string;
  metadata: Record<string, unknown> | null;
}

function toNullableNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function almostEqual(
  left: number | null,
  right: number | null,
  epsilon = 0.000001,
): boolean {
  if (
    left === null ||
    right === null
  ) {
    return left === right;
  }

  return (
    Math.abs(
      left - right,
    ) <= epsilon
  );
}

/*
 * Regime Shadow v6.5
 *
 * 같은 시장 snapshot에 대해 자동화가 여러 번 실행되더라도
 * 동일한 Regime 관측을 계속 중복 저장하지 않는다.
 *
 * 새로운 snapshot/일봉/Regime 변화가 있으면 새 행을 저장한다.
 */
export async function captureCurrentMarketRegimeShadow() {
  const supabase =
    createSupabaseServerClient();

  const regime =
    await getCurrentMarketRegimeShadowSafe();

  const {
    data: latestData,
    error: latestError,
  } =
    await supabase
      .from(
        "market_regime_observations",
      )
      .select(`
        id,
        observed_at,
        market_date,
        regime,
        breadth_20,
        avg_return_20,
        source,
        metadata
      `)
      .order(
        "observed_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (latestError) {
    throw new Error(
      `최근 시장 Regime 조회 실패: ${latestError.message}`,
    );
  }

  const latest =
    latestData as
      | LatestObservationRecord
      | null;

  const latestMetadata =
    latest?.metadata &&
    typeof latest.metadata ===
      "object"
      ? latest.metadata
      : {};

  const latestSnapshotObservedAt =
    typeof latestMetadata
      .latestSnapshotObservedAt ===
      "string"
      ? latestMetadata
          .latestSnapshotObservedAt
      : null;

  const sameSnapshot =
    latestSnapshotObservedAt ===
      regime.latestSnapshotObservedAt;

  const sameMarketDate =
    (
      latest?.market_date ??
      null
    ) ===
    regime.latestMarketDate;

  const sameRegime =
    latest?.regime ===
    regime.regime;

  const sameSource =
    latest?.source ===
    regime.source;

  const sameBreadth =
    almostEqual(
      toNullableNumber(
        latest?.breadth_20,
      ),
      regime.breadth20,
    );

  const sameReturn =
    almostEqual(
      toNullableNumber(
        latest?.avg_return_20,
      ),
      regime.avgReturn20,
    );

  /*
   * 시장 입력과 계산 결과가 완전히 동일하면
   * 새 행을 만들 필요가 없다.
   *
   * Forward validation 관점에서도
   * "새 시장 정보"가 생겼을 때만 관측을 추가하는 편이
   * 중복 샘플 편향을 줄여준다.
   */
  if (
    latest &&
    sameSnapshot &&
    sameMarketDate &&
    sameRegime &&
    sameSource &&
    sameBreadth &&
    sameReturn
  ) {
    return {
      observationId:
        String(latest.id),

      saved: false,
      duplicateSuppressed: true,

      regime,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_regime_observations",
      )
      .insert({
        observed_at:
          regime.observedAt,

        market_date:
          regime.latestMarketDate,

        regime:
          regime.regime,

        would_block_by_regime:
          regime.wouldBlockByRegime,

        breadth_20:
          regime.breadth20,

        avg_return_20:
          regime.avgReturn20,

        sample_size:
          regime.sampleSize,

        return_sample_size:
          regime.returnSampleSize,

        stock_codes:
          regime.stockCodes,

        source:
          regime.source,

        reason:
          regime.reason,

        metadata: {
          mode:
            regime.mode,

          appliedToOrders:
            regime.appliedToOrders,

          latestSnapshotObservedAt:
            regime.latestSnapshotObservedAt,

          forwardValidation:
            true,

          productionBlocking:
            false,

          version:
            "REGIME_SHADOW_V6_5",
        },
      })
      .select(`
        id,
        observed_at,
        market_date,
        regime,
        would_block_by_regime,
        breadth_20,
        avg_return_20
      `)
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `시장 Regime SHADOW 저장 실패: ${
        error?.message ??
        "저장 결과가 없습니다."
      }`,
    );
  }

  return {
    observationId:
      String(data.id),

    saved: true,
    duplicateSuppressed: false,

    regime,
  };
}