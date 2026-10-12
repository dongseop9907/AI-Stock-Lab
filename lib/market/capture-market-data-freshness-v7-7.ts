import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getMarketDataFreshnessV77,
} from "@/lib/market/get-market-data-freshness-v7-7";

interface ExistingFreshnessRow {
  id: string;

  evidence_fingerprint:
    string;
}

export async function captureMarketDataFreshnessV77() {
  const supabase =
    createSupabaseServerClient();

  const freshness =
    await getMarketDataFreshnessV77();

  const {
    data: existingData,
    error: existingError,
  } =
    await supabase
      .from(
        "market_data_freshness_observations",
      )
      .select(
        "id,evidence_fingerprint",
      )
      .eq(
        "evidence_fingerprint",
        freshness
          .evidenceFingerprint,
      )
      .limit(1)
      .maybeSingle();

  if (
    existingError
  ) {
    throw new Error(
      `Freshness duplicate check failed: ${existingError.message}`,
    );
  }

  const existing =
    existingData as
      | ExistingFreshnessRow
      | null;

  if (
    existing
  ) {
    return {
      observationId:
        existing.id,

      saved:
        false,

      duplicateSuppressed:
        true,

      freshness,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_data_freshness_observations",
      )
      .insert({
        observed_at:
          freshness
            .observedAt,

        status:
          freshness.status,

        usable_for_shadow_comparison:
          freshness
            .usableForShadowComparison,

        expected_market_date:
          freshness
            .expectedMarketDate,

        kospi_latest_date:
          freshness
            .dates
            .kospiLatestDate,

        kosdaq_latest_date:
          freshness
            .dates
            .kosdaqLatestDate,

        stock_latest_date:
          freshness
            .dates
            .stockLatestDate,

        oldest_active_stock_latest_date:
          freshness
            .dates
            .oldestActiveStockLatestDate,

        active_stock_count:
          freshness
            .coverage
            .activeStockCount,

        active_stock_current_count:
          freshness
            .coverage
            .activeStockCurrentCount,

        business_weekday_lag:
          freshness
            .lag
            .businessWeekdayLag,

        index_date_aligned:
          freshness
            .alignment
            .indexDateAligned,

        all_source_dates_aligned:
          freshness
            .alignment
            .allSourceDatesAligned,

        stock_coverage_complete:
          freshness
            .coverage
            .stockCoverageComplete,

        reasons:
          freshness.reasons,

        metadata: {
          version:
            freshness.version,

          mode:
            freshness.mode,

          koreanClock:
            freshness.koreanClock,

          heuristic:
            freshness.heuristic,

          missingActiveStocks:
            freshness
              .coverage
              .missingActiveStocks,

          safety:
            freshness.safety,
        },

        evidence_fingerprint:
          freshness
            .evidenceFingerprint,

        production_applied:
          false,
      })
      .select(
        "id,observed_at,status,usable_for_shadow_comparison",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `Freshness observation save failed: ${
        error?.message ??
        "NO_INSERT_RESULT"
      }`,
    );
  }

  return {
    observationId:
      String(data.id),

    saved:
      true,

    duplicateSuppressed:
      false,

    freshness,
  };
}