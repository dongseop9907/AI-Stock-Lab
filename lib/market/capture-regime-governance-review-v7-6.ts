import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getRegimeGovernanceV76,
} from "@/lib/market/get-regime-governance-v7-6";

interface ExistingReviewRow {
  id: string;

  evidence_fingerprint:
    string;
}

export async function captureRegimeGovernanceReviewV76() {
  const supabase =
    createSupabaseServerClient();

  const governance =
    await getRegimeGovernanceV76();

  const {
    data: existingData,
    error: existingError,
  } =
    await supabase
      .from(
        "market_regime_governance_reviews",
      )
      .select(
        "id,evidence_fingerprint",
      )
      .eq(
        "evidence_fingerprint",
        governance
          .evidenceFingerprint,
      )
      .limit(1)
      .maybeSingle();

  if (
    existingError
  ) {
    throw new Error(
      `Governance duplicate check failed: ${existingError.message}`,
    );
  }

  const existing =
    existingData as
      | ExistingReviewRow
      | null;

  if (
    existing
  ) {
    return {
      reviewId:
        existing.id,

      saved:
        false,

      duplicateSuppressed:
        true,

      governance,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_regime_governance_reviews",
      )
      .insert({
        candidate_policy:
          governance
            .candidatePolicy,

        evidence_version:
          "MARKET_REGIME_FORWARD_EVIDENCE_V7_5",

        evidence_stage:
          governance.metrics
            .evidenceStage,

        recommendation:
          governance
            .recommendation,

        completed_sample:
          governance.metrics
            .completedSample,

        disagreement_sample:
          governance.metrics
            .disagreementSample,

        v6_correct_rate:
          governance.metrics
            .v6CorrectRate,

        v7_correct_rate:
          governance.metrics
            .v7CorrectRate,

        v6_average_score:
          governance.metrics
            .v6AverageScore,

        v7_average_score:
          governance.metrics
            .v7AverageScore,

        v7_head_to_head_win_rate:
          governance.metrics
            .v7HeadToHeadWinRate,

        criteria:
          governance.criteria,

        evidence_snapshot:
          governance
            .evidenceSnapshot,

        evidence_fingerprint:
          governance
            .evidenceFingerprint,

        production_applied:
          false,

        automatic_promotion:
          false,
      })
      .select(
        "id,observed_at,recommendation,candidate_policy",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `Governance review save failed: ${
        error?.message ??
        "NO_INSERT_RESULT"
      }`,
    );
  }

  return {
    reviewId:
      String(data.id),

    saved:
      true,

    duplicateSuppressed:
      false,

    governance,
  };
}