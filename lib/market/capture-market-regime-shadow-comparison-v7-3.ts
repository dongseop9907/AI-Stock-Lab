import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getCurrentMarketRegimeShadowComparisonV73,
} from "@/lib/market/market-regime-shadow-comparator-v7-3";

interface LatestComparisonRow {
  id: string;

  comparison_eligible:
    boolean;

  v6_market_date:
    string | null;

  v7_market_date:
    string | null;

  agreement_state:
    string;

  v6_would_block:
    boolean;

  v7_would_block:
    boolean;

  v7_policy:
    string;

  metadata:
    Record<string, unknown> | null;
}

function sameNullableString(
  left:
    string | null,

  right:
    string | null,
) {
  return left ===
    right;
}

export async function captureMarketRegimeShadowComparisonV73() {
  const supabase =
    createSupabaseServerClient();

  const comparison =
    await getCurrentMarketRegimeShadowComparisonV73();

  const {
    data: latestData,
    error: latestError,
  } =
    await supabase
      .from(
        "market_regime_shadow_comparisons",
      )
      .select(`
        id,
        comparison_eligible,
        v6_market_date,
        v7_market_date,
        agreement_state,
        v6_would_block,
        v7_would_block,
        v7_policy,
        metadata
      `)
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    latestError
  ) {
    throw new Error(
      `Latest v7.10 shadow comparison load failed: ${latestError.message}`,
    );
  }

  const latest =
    latestData as
      | LatestComparisonRow
      | null;

  const latestMetadata =
    latest?.metadata &&
    typeof latest
      .metadata ===
      "object"
      ? latest.metadata
      : {};

  const latestV6Snapshot =
    typeof latestMetadata
      .v6LatestSnapshotObservedAt ===
      "string"
      ? latestMetadata
          .v6LatestSnapshotObservedAt
      : null;

  const latestQualityGateFingerprint =
    typeof latestMetadata
      .dataQualityGateEvidenceFingerprint ===
      "string"
      ? latestMetadata
          .dataQualityGateEvidenceFingerprint
      : null;

  const sameObservation =
    latest !==
      null &&
    latest
      .comparison_eligible ===
      comparison
        .comparisonEligible &&
    sameNullableString(
      latest.v6_market_date,
      comparison.v6
        .latestMarketDate,
    ) &&
    sameNullableString(
      latest.v7_market_date,
      comparison.v7
        .latestMarketDate,
    ) &&
    latest.agreement_state ===
      comparison
        .agreementState &&
    latest.v6_would_block ===
      comparison.v6
        .wouldBlock &&
    latest.v7_would_block ===
      comparison.v7
        .wouldBlock &&
    latest.v7_policy ===
      comparison
        .candidatePolicy &&
    sameNullableString(
      latestV6Snapshot,
      comparison.v6
        .latestSnapshotObservedAt,
    ) &&
    latestQualityGateFingerprint ===
      comparison
        .dataQualityGate
        .evidenceFingerprint;

  if (
    sameObservation &&
    latest
  ) {
    return {
      comparisonId:
        latest.id,

      saved:
        false,

      duplicateSuppressed:
        true,

      comparison,
    };
  }

  const f =
    comparison.v7
      .features;

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_regime_shadow_comparisons",
      )
      .insert({
        observed_at:
          comparison
            .observedAt,

        v6_market_date:
          comparison.v6
            .latestMarketDate,

        v7_market_date:
          comparison.v7
            .latestMarketDate,

        comparison_eligible:
          comparison
            .comparisonEligible,

        agreement_state:
          comparison
            .agreementState,

        v6_regime:
          comparison.v6
            .regime,

        v6_would_block:
          comparison.v6
            .wouldBlock,

        v6_breadth_20:
          comparison.v6
            .breadth20,

        v6_avg_return_20:
          comparison.v6
            .avgReturn20,

        v6_source:
          comparison.v6
            .source,

        v6_latest_snapshot_observed_at:
          comparison.v6
            .latestSnapshotObservedAt,

        v7_policy:
          comparison
            .candidatePolicy,

        v7_would_block:
          comparison.v7
            .wouldBlock,

        v7_inputs_complete:
          comparison.v7
            .inputsComplete,

        v7_breadth_20:
          f.breadth20,

        v7_breadth_60:
          f.breadth60,

        v7_kospi_return_20:
          f.kospiReturn20,

        v7_kospi_return_60:
          f.kospiReturn60,

        v7_kosdaq_return_20:
          f.kosdaqReturn20,

        v7_kosdaq_return_60:
          f.kosdaqReturn60,

        v7_average_volatility_20:
          f.averageVolatility20,

        v7_kospi_drawdown_60:
          f.kospiDrawdown60,

        v7_kosdaq_drawdown_60:
          f.kosdaqDrawdown60,

        production_applied:
          false,

        metadata: {
          version:
            comparison.version,

          mode:
            comparison.mode,

          dateAligned:
            comparison.dateAligned,

          v6LatestSnapshotObservedAt:
            comparison.v6
              .latestSnapshotObservedAt,

          v6SampleSize:
            comparison.v6
              .sampleSize,

          v6ReturnSampleSize:
            comparison.v6
              .returnSampleSize,

          v6StockCodes:
            comparison.v6
              .stockCodes,

          v7Thresholds:
            comparison.v7
              .thresholds,

          v7Reasons:
            comparison.v7
              .reasons,

          v7DataSource:
            comparison.v7
              .dataSource,

          freshnessStatus:
            comparison
              .freshnessGuard
              .status,

          freshnessEvidenceFingerprint:
            comparison
              .freshnessGuard
              .evidenceFingerprint,

          dataQualityGateStatus:
            comparison
              .dataQualityGate
              .status,

          dataQualityGateEvidenceFingerprint:
            comparison
              .dataQualityGate
              .evidenceFingerprint,

          dataQualityGate:
            comparison
              .dataQualityGate,

          forwardValidation:
            true,

          productionBlocking:
            false,
        },
      })
      .select(`
        id,
        observed_at,
        v6_market_date,
        v7_market_date,
        comparison_eligible,
        agreement_state,
        v6_regime,
        v6_would_block,
        v7_policy,
        v7_would_block,
        production_applied
      `)
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `v7.10 shadow comparison save failed: ${
        error?.message ??
        "NO_INSERT_RESULT"
      }`,
    );
  }

  return {
    comparisonId:
      String(data.id),

    saved:
      true,

    duplicateSuppressed:
      false,

    comparison,
  };
}