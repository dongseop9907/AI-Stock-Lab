import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getMarketDataFreshnessV77,
} from "@/lib/market/get-market-data-freshness-v7-7";

export type MarketDataQualityGateStatusV710 =
  | "PASS"
  | "PASS_WITH_WARNING"
  | "FAIL_FRESHNESS"
  | "FAIL_NO_INTEGRITY_SCAN"
  | "FAIL_SCAN_NOT_FINAL"
  | "FAIL_SCAN_DATE_MISMATCH"
  | "FAIL_INTEGRITY_ERRORS";

interface IntegrityScanRow {
  id: string;

  started_at:
    string;

  finished_at:
    string | null;

  status:
    string;

  window_start_date:
    string;

  window_end_date:
    string;

  error_count:
    number | null;

  warning_count:
    number | null;

  before_summary:
    unknown;

  after_summary:
    unknown;
}

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

function finiteIntegerOrNull(
  value: unknown,
): number | null {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(
      parsed,
    ),
  );
}

function getSummaryCounts(
  summary: unknown,
) {
  if (
    !isRecord(
      summary,
    )
  ) {
    return {
      errors:
        null,

      warnings:
        null,
    };
  }

  const counts =
    summary.counts;

  if (
    !isRecord(
      counts,
    )
  ) {
    return {
      errors:
        null,

      warnings:
        null,
    };
  }

  return {
    errors:
      finiteIntegerOrNull(
        counts.errors,
      ),

    warnings:
      finiteIntegerOrNull(
        counts.warnings,
      ),
  };
}

/*
 * v7.10 Market Data Quality Gate
 *
 * PASS requirements:
 * 1. v7.7 freshness is FRESH and usable.
 * 2. The newest v7.9 integrity scan exists and is final.
 * 3. That scan covers the same expected market date.
 * 4. Effective post-scan errors are zero.
 *
 * WARNING-only integrity findings do not block forward shadow.
 * They produce PASS_WITH_WARNING instead.
 *
 * This gate affects forward-shadow evidence only.
 * Production orders remain untouched.
 */
export async function getMarketDataQualityGateV710(
  input: {
    now?: string;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const freshness =
    await getMarketDataFreshnessV77({
      now:
        input.now,
    });

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_data_integrity_scans",
      )
      .select(`
        id,
        started_at,
        finished_at,
        status,
        window_start_date,
        window_end_date,
        error_count,
        warning_count,
        before_summary,
        after_summary
      `)
      .order(
        "started_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `Data quality integrity scan load failed: ${error.message}`,
    );
  }

  const latestScan =
    data as
      | IntegrityScanRow
      | null;

  let status:
    MarketDataQualityGateStatusV710;

  const reasons:
    string[] = [];

  const freshnessPassed =
    freshness.status ===
      "FRESH" &&
    freshness
      .usableForShadowComparison;

  let effectiveErrors:
    number | null =
      null;

  let effectiveWarnings:
    number | null =
      null;

  if (
    latestScan
  ) {
    const afterCounts =
      getSummaryCounts(
        latestScan
          .after_summary,
      );

    const beforeCounts =
      getSummaryCounts(
        latestScan
          .before_summary,
      );

    effectiveErrors =
      afterCounts.errors ??
      beforeCounts.errors ??
      finiteIntegerOrNull(
        latestScan
          .error_count,
      );

    effectiveWarnings =
      afterCounts.warnings ??
      beforeCounts.warnings ??
      finiteIntegerOrNull(
        latestScan
          .warning_count,
      );
  }

  const finalScanStatuses =
    new Set([
      "CLEAN",
      "WARNING",
      "ERROR",
      "REPAIRED",
      "REPAIR_PARTIAL",
    ]);

  const scanFinal =
    latestScan !==
      null &&
    latestScan
      .finished_at !==
      null &&
    finalScanStatuses.has(
      latestScan.status,
    );

  const scanDateAligned =
    latestScan !==
      null &&
    latestScan
      .window_end_date ===
      freshness
        .expectedMarketDate;

  if (
    !freshnessPassed
  ) {
    status =
      "FAIL_FRESHNESS";

    reasons.push(
      `Freshness gate is ${freshness.status}; forward-shadow evidence must not use stale or misaligned market data.`,
    );
  } else if (
    latestScan ===
    null
  ) {
    status =
      "FAIL_NO_INTEGRITY_SCAN";

    reasons.push(
      "No v7.9 integrity scan is available for the current expected market date.",
    );
  } else if (
    !scanFinal
  ) {
    status =
      "FAIL_SCAN_NOT_FINAL";

    reasons.push(
      `Latest integrity scan is not final: status=${latestScan.status}.`,
    );
  } else if (
    !scanDateAligned
  ) {
    status =
      "FAIL_SCAN_DATE_MISMATCH";

    reasons.push(
      `Latest integrity scan ends on ${latestScan.window_end_date}, but expected market date is ${freshness.expectedMarketDate}.`,
    );
  } else if (
    effectiveErrors ===
      null ||
    effectiveErrors >
      0 ||
    latestScan.status ===
      "ERROR" ||
    latestScan.status ===
      "REPAIR_PARTIAL"
  ) {
    status =
      "FAIL_INTEGRITY_ERRORS";

    reasons.push(
      `Latest integrity scan has ${effectiveErrors ?? "unknown"} effective error(s) with status=${latestScan.status}.`,
    );
  } else if (
    (
      effectiveWarnings ??
      0
    ) >
      0 ||
    latestScan.status ===
      "WARNING"
  ) {
    status =
      "PASS_WITH_WARNING";

    reasons.push(
      `Integrity scan has zero errors and ${effectiveWarnings ?? 0} warning(s); warning-only findings are observational and do not block forward shadow.`,
    );
  } else {
    status =
      "PASS";

    reasons.push(
      "Freshness and integrity checks both passed for the current expected market date.",
    );
  }

  const usableForForwardShadow =
    status ===
      "PASS" ||
    status ===
      "PASS_WITH_WARNING";

  const evidenceFingerprint =
    JSON.stringify({
      status,

      usableForForwardShadow,

      expectedMarketDate:
        freshness
          .expectedMarketDate,

      freshnessStatus:
        freshness.status,

      freshnessFingerprint:
        freshness
          .evidenceFingerprint,

      integrityScanId:
        latestScan
          ?.id ??
        null,

      integrityStatus:
        latestScan
          ?.status ??
        null,

      integrityWindowEndDate:
        latestScan
          ?.window_end_date ??
        null,

      integrityFinishedAt:
        latestScan
          ?.finished_at ??
        null,

      effectiveErrors,

      effectiveWarnings,
    });

  return {
    version:
      "MARKET_DATA_QUALITY_GATE_V7_10",

    mode:
      "FORWARD_EVIDENCE_GATE",

    productionApplied:
      false,

    observedAt:
      new Date()
        .toISOString(),

    status,

    usableForForwardShadow,

    expectedMarketDate:
      freshness
        .expectedMarketDate,

    freshness: {
      status:
        freshness.status,

      usableForShadowComparison:
        freshness
          .usableForShadowComparison,

      evidenceFingerprint:
        freshness
          .evidenceFingerprint,

      dates:
        freshness.dates,

      coverage:
        freshness.coverage,

      alignment:
        freshness.alignment,

      lag:
        freshness.lag,
    },

    integrity: latestScan
      ? {
          scanId:
            latestScan.id,

          status:
            latestScan.status,

          startedAt:
            latestScan
              .started_at,

          finishedAt:
            latestScan
              .finished_at,

          windowStartDate:
            latestScan
              .window_start_date,

          windowEndDate:
            latestScan
              .window_end_date,

          effectiveErrors,

          effectiveWarnings,

          final:
            scanFinal,

          dateAligned:
            scanDateAligned,
        }
      : null,

    reasons,

    evidenceFingerprint,

    safety: {
      changesProductionOrders:
        false,

      changesRiskValidation:
        false,

      gatesForwardShadowEvidence:
        true,

      warningOnlyCanPass:
        true,
    },
  };
}