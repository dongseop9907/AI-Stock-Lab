import {
  getRegimeForwardEvidenceV75,
} from "@/lib/market/get-regime-forward-evidence-v7-5";

export type RegimeGovernanceRecommendationV76 =
  | "WAIT_FOR_FORWARD_DATA"
  | "KEEP_SHADOW_INSUFFICIENT_EVIDENCE"
  | "KEEP_SHADOW_MIXED_EVIDENCE"
  | "REWORK_V7_CANDIDATE"
  | "PAPER_GATE_REVIEW_ELIGIBLE";

export interface RegimeGovernanceCriteriaV76 {
  minimumCompletedSample: number;

  minimumDisagreementSample: number;

  minimumV7CorrectRate: number;

  minimumV7HeadToHeadWinRate: number;

  minimumV7AverageDecisionScore: number;

  requireV7AverageScoreAtLeastV6: boolean;
}

/*
 * Governance guardrails are intentionally fixed and conservative.
 * Do not tune these thresholds on the same forward sample merely
 * to make the candidate pass.
 */
export const DEFAULT_REGIME_GOVERNANCE_CRITERIA_V7_6:
  RegimeGovernanceCriteriaV76 = {
    minimumCompletedSample:
      100,

    minimumDisagreementSample:
      30,

    minimumV7CorrectRate:
      0.55,

    minimumV7HeadToHeadWinRate:
      0.60,

    minimumV7AverageDecisionScore:
      0,

    requireV7AverageScoreAtLeastV6:
      true,
  };

function finiteOrNull(
  value:
    | number
    | null,
) {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
      ? value
      : null
  );
}

function fixedOrNull(
  value:
    | number
    | null,

  digits = 8,
) {
  const numeric =
    finiteOrNull(value);

  return numeric ===
    null
    ? null
    : Number(
        numeric.toFixed(
          digits,
        ),
      );
}

export async function getRegimeGovernanceV76(
  criteria:
    RegimeGovernanceCriteriaV76 =
      DEFAULT_REGIME_GOVERNANCE_CRITERIA_V7_6,
) {
  const evidence =
    await getRegimeForwardEvidenceV75();

  const completedSample =
    evidence.sample.completed;

  const disagreementSample =
    evidence.headToHead.sampleSize;

  const v6CorrectRate =
    finiteOrNull(
      evidence.v6
        .correctRate,
    );

  const v7CorrectRate =
    finiteOrNull(
      evidence.v7
        .correctRate,
    );

  const v6AverageScore =
    finiteOrNull(
      evidence.v6
        .averageScore,
    );

  const v7AverageScore =
    finiteOrNull(
      evidence.v7
        .averageScore,
    );

  const v7HeadToHeadWinRate =
    finiteOrNull(
      evidence.headToHead
        .v7WinRate,
    );

  const checks = {
    completedSample:
      completedSample >=
      criteria
        .minimumCompletedSample,

    disagreementSample:
      disagreementSample >=
      criteria
        .minimumDisagreementSample,

    v7CorrectRate:
      v7CorrectRate !==
        null &&
      v7CorrectRate >=
        criteria
          .minimumV7CorrectRate,

    v7HeadToHeadWinRate:
      v7HeadToHeadWinRate !==
        null &&
      v7HeadToHeadWinRate >=
        criteria
          .minimumV7HeadToHeadWinRate,

    v7AverageDecisionScore:
      v7AverageScore !==
        null &&
      v7AverageScore >
        criteria
          .minimumV7AverageDecisionScore,

    v7VsV6AverageScore:
      !criteria
        .requireV7AverageScoreAtLeastV6 ||
      (
        v7AverageScore !==
          null &&
        v6AverageScore !==
          null &&
        v7AverageScore >=
          v6AverageScore
      ),
  };

  let recommendation:
    RegimeGovernanceRecommendationV76;

  const reasons:
    string[] = [];

  if (
    completedSample ===
    0
  ) {
    recommendation =
      "WAIT_FOR_FORWARD_DATA";

    reasons.push(
      "No completed forward outcomes are available yet.",
    );
  } else if (
    !checks.completedSample ||
    !checks.disagreementSample
  ) {
    recommendation =
      "KEEP_SHADOW_INSUFFICIENT_EVIDENCE";

    if (
      !checks.completedSample
    ) {
      reasons.push(
        `Completed sample ${completedSample} is below ${criteria.minimumCompletedSample}.`,
      );
    }

    if (
      !checks.disagreementSample
    ) {
      reasons.push(
        `Direct disagreement sample ${disagreementSample} is below ${criteria.minimumDisagreementSample}.`,
      );
    }
  } else {
    const clearlyBad =
      (
        v7AverageScore !==
          null &&
        v7AverageScore <
          0
      ) ||
      (
        v7CorrectRate !==
          null &&
        v7CorrectRate <
          0.50
      ) ||
      (
        v7HeadToHeadWinRate !==
          null &&
        v7HeadToHeadWinRate <
          0.50
      );

    const allPassed =
      Object.values(
        checks,
      ).every(Boolean);

    if (
      clearlyBad
    ) {
      recommendation =
        "REWORK_V7_CANDIDATE";

      reasons.push(
        "The v7 candidate has enough evidence but at least one core forward metric is below a neutral baseline.",
      );
    } else if (
      allPassed
    ) {
      recommendation =
        "PAPER_GATE_REVIEW_ELIGIBLE";

      reasons.push(
        "All fixed v7.6 forward-evidence guardrails passed.",
      );

      reasons.push(
        "This is only eligibility for human review before paper gating; it is not production approval.",
      );
    } else {
      recommendation =
        "KEEP_SHADOW_MIXED_EVIDENCE";

      for (
        const [
          key,
          passed,
        ]
        of Object.entries(
          checks,
        )
      ) {
        if (
          !passed
        ) {
          reasons.push(
            `Governance check failed: ${key}.`,
          );
        }
      }
    }
  }

  const latestComparison =
    evidence.latestComparison;

  const candidatePolicy =
    latestComparison
      ?.v7_policy ??
    "UNKNOWN";

  /*
   * v7.6.1:
   * Fingerprint only meaningful governance evidence.
   *
   * Do NOT include latestComparisonId.
   * A new comparison row with unchanged forward evidence must not
   * create another governance review.
   */
  const fingerprintObject =
    {
      candidatePolicy,

      totalOutcomeRows:
        evidence.sample
          .totalOutcomeRows,

      pendingSample:
        evidence.sample
          .pending,

      partialSample:
        evidence.sample
          .partial,

      completedSample,

      invalidSample:
        evidence.sample
          .invalid,

      disagreementSample,

      v6CorrectRate:
        fixedOrNull(
          v6CorrectRate,
        ),

      v7CorrectRate:
        fixedOrNull(
          v7CorrectRate,
        ),

      v6AverageScore:
        fixedOrNull(
          v6AverageScore,
        ),

      v7AverageScore:
        fixedOrNull(
          v7AverageScore,
        ),

      v6HeadToHeadWins:
        evidence.headToHead
          .v6Wins,

      v7HeadToHeadWins:
        evidence.headToHead
          .v7Wins,

      headToHeadTies:
        evidence.headToHead
          .ties,

      v7HeadToHeadWinRate:
        fixedOrNull(
          v7HeadToHeadWinRate,
        ),

      recommendation,
    };

  const evidenceFingerprint =
    JSON.stringify(
      fingerprintObject,
    );

  return {
    version:
      "MARKET_REGIME_GOVERNANCE_V7_6_1",

    mode:
      "RECOMMENDATION_ONLY",

    productionApplied:
      false,

    automaticPromotion:
      false,

    candidatePolicy,

    recommendation,

    reasons,

    criteria,

    checks,

    metrics: {
      evidenceStage:
        evidence
          .evidenceStage,

      completedSample,

      disagreementSample,

      v6CorrectRate,

      v7CorrectRate,

      v6AverageScore,

      v7AverageScore,

      v7HeadToHeadWinRate,
    },

    evidenceFingerprint,

    latestComparison,

    safety: {
      changesOrderQualification:
        false,

      changesRiskValidation:
        false,

      changesProductionBlocking:
        false,

      canAutoPromote:
        false,

      nextAllowedStage:
        recommendation ===
          "PAPER_GATE_REVIEW_ELIGIBLE"
          ? "HUMAN_REVIEW_FOR_PAPER_GATE"
          : "KEEP_FORWARD_SHADOW",
    },

    evidenceSnapshot: {
      sample:
        evidence.sample,

      v6:
        evidence.v6,

      v7:
        evidence.v7,

      headToHead:
        evidence.headToHead,

      byAgreement:
        evidence.byAgreement,
    },
  };
}