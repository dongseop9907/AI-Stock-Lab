import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getMarketDataQualityGateV710,
} from "@/lib/market/get-market-data-quality-gate-v7-10";

interface ExistingGateRow {
  id: string;

  evidence_fingerprint:
    string;
}

export async function captureMarketDataQualityGateV710() {
  const supabase =
    createSupabaseServerClient();

  const gate =
    await getMarketDataQualityGateV710();

  const {
    data: existingData,
    error: existingError,
  } =
    await supabase
      .from(
        "market_data_quality_gate_observations",
      )
      .select(
        "id,evidence_fingerprint",
      )
      .eq(
        "evidence_fingerprint",
        gate
          .evidenceFingerprint,
      )
      .limit(1)
      .maybeSingle();

  if (
    existingError
  ) {
    throw new Error(
      `Data quality gate duplicate check failed: ${existingError.message}`,
    );
  }

  const existing =
    existingData as
      | ExistingGateRow
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

      gate,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_data_quality_gate_observations",
      )
      .insert({
        observed_at:
          gate
            .observedAt,

        status:
          gate.status,

        usable_for_forward_shadow:
          gate
            .usableForForwardShadow,

        expected_market_date:
          gate
            .expectedMarketDate,

        freshness_status:
          gate
            .freshness
            .status,

        integrity_scan_id:
          gate.integrity
            ?.scanId ??
          null,

        integrity_status:
          gate.integrity
            ?.status ??
          null,

        integrity_window_end_date:
          gate.integrity
            ?.windowEndDate ??
          null,

        integrity_finished_at:
          gate.integrity
            ?.finishedAt ??
          null,

        effective_error_count:
          gate.integrity
            ?.effectiveErrors ??
          null,

        effective_warning_count:
          gate.integrity
            ?.effectiveWarnings ??
          null,

        reasons:
          gate.reasons,

        metadata: {
          version:
            gate.version,

          mode:
            gate.mode,

          freshness:
            gate.freshness,

          integrity:
            gate.integrity,

          safety:
            gate.safety,
        },

        evidence_fingerprint:
          gate
            .evidenceFingerprint,

        production_applied:
          false,
      })
      .select(
        "id,observed_at,status,usable_for_forward_shadow",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `Data quality gate save failed: ${
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

    gate,
  };
}