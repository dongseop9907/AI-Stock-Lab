import { createHash } from "node:crypto";

export const ALPHA_CANDIDATE_SCORER_VERSION =
  "ALPHA_V1_CANDIDATE_SCORER";

export const ALPHA_FEATURE_SET_VERSION =
  "ALPHA_FEATURES_V1";

export type AlphaTrack =
  | "STABLE"
  | "AGGRESSIVE";

export type AlphaPositiveDimension =
  | "catalyst"
  | "flow"
  | "marketRegime"
  | "priceVolume"
  | "liquidity"
  | "eventPersistence";

export type AlphaDimension =
  | AlphaPositiveDimension
  | "riskPenalty";

export interface AlphaFeatureEvidence {
  /**
   * Normalized feature score.
   *
   * Positive dimensions:
   *   0 = strongly unfavorable
   *   0.5 = neutral
   *   1 = strongly favorable
   *
   * riskPenalty:
   *   0 = low risk
   *   1 = high risk
   */
  score: number;

  /**
   * Confidence in this feature [0, 1].
   */
  confidence: number;

  /**
   * When this information became available to the strategy.
   * This, not event time, is used for look-ahead protection.
   */
  availableAt: string;

  /**
   * Optional real-world event/observation timestamp.
   */
  observedAt?: string;

  source: string;
  sourceVersion?: string;
  sourceId?: string;

  /**
   * Optional freshness contract.
   * If decisionAt - availableAt is greater than this value,
   * the feature is excluded as stale.
   */
  maxAgeMinutes?: number;

  metadata?: Record<string, unknown>;
}

export type AlphaRiskPolicy =
  | "REQUIRED"
  | "DEFER_TO_PREFLIGHT";

export interface AlphaCandidateInput {
  stockCode: string;

  /**
   * Exact decision timestamp used by backtest/shadow/paper/live.
   */
  decisionAt: string;

  modelId?: string;
  modelVersion?: string;

  /**
   * REQUIRED:
   *   Candidate score expects trade-specific risk evidence.
   *   Missing risk receives the historical neutral 0.5 penalty.
   *
   * DEFER_TO_PREFLIGHT:
   *   Candidate ranking intentionally runs before a concrete
   *   entry/stop/qty exists. Missing risk contributes no artificial
   *   penalty. validateBuyRisk() must be bound later before execution.
   */
  riskPolicy?: AlphaRiskPolicy;

  features: Partial<
    Record<AlphaDimension, AlphaFeatureEvidence>
  >;

  metadata?: Record<string, unknown>;
}

export interface AlphaTrackPolicy {
  minimumScore: number;
  minimumQuality: number;
  minimumCoverage: number;
  maximumRiskPenalty: number;
}

export interface AlphaDimensionResult {
  dimension: AlphaPositiveDimension;
  weight: number;

  included: boolean;
  rawScore: number | null;
  confidence: number | null;
  effectiveScore: number;
  contribution: number;

  availableAt: string | null;
  source: string | null;

  issue:
    | "MISSING"
    | "STALE"
    | "LOOKAHEAD"
    | "INVALID"
    | null;
}

export interface AlphaRiskResult {
  included: boolean;
  rawScore: number | null;
  confidence: number | null;
  effectivePenalty: number;
  weightedPenalty: number;
  availableAt: string | null;
  source: string | null;

  issue:
    | "MISSING"
    | "STALE"
    | "LOOKAHEAD"
    | "INVALID"
    | null;
}

export interface AlphaCandidateScore {
  scorerVersion: string;
  featureSetVersion: string;
  inputFingerprint: string;

  stockCode: string;
  decisionAt: string;
  track: AlphaTrack;

  /**
   * Positive dimensions before risk penalty.
   */
  baseScore: number;

  /**
   * Base score minus risk penalty.
   */
  riskAdjustedScore: number;

  /**
   * Final ranking score after shrinking low-quality
   * observations toward neutral 0.5.
   */
  score: number;

  coverage: number;
  quality: number;

  riskPenalty: number;

  eligibleForEntryTiming: boolean;

  dimensions: AlphaDimensionResult[];
  risk: AlphaRiskResult;

  blockingIssues: string[];
  warnings: string[];
  reasons: string[];

  metadata: {
    modelId: string | null;
    modelVersion: string | null;
    riskPolicy: AlphaRiskPolicy;
    positiveWeightCovered: number;
    totalPositiveWeight: number;
    missingDimensions: AlphaPositiveDimension[];
    staleDimensions: AlphaDimension[];
    lookaheadDimensions: AlphaDimension[];
  };
}

export interface RankedAlphaCandidate
  extends AlphaCandidateScore {
  rank: number;
}

const POSITIVE_WEIGHTS: Record<
  AlphaPositiveDimension,
  number
> = {
  catalyst: 0.25,
  flow: 0.20,
  marketRegime: 0.10,
  priceVolume: 0.20,
  liquidity: 0.10,
  eventPersistence: 0.15,
};

const RISK_PENALTY_WEIGHT = 0.18;

export const ALPHA_TRACK_POLICIES: Record<
  AlphaTrack,
  AlphaTrackPolicy
> = {
  STABLE: {
    minimumScore: 0.68,
    minimumQuality: 0.78,
    minimumCoverage: 0.80,
    maximumRiskPenalty: 0.55,
  },

  AGGRESSIVE: {
    minimumScore: 0.60,
    minimumQuality: 0.65,
    minimumCoverage: 0.65,
    maximumRiskPenalty: 0.75,
  },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseTime(value: string): number | null {
  const time = new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : null;
}

function normalizeStockCode(
  value: string,
): string {
  const trimmed = value.trim();

  if (!/^\d{6}$/.test(trimmed)) {
    throw new Error(
      `INVALID_STOCK_CODE:${value}`,
    );
  }

  return trimmed;
}

function stableObject(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>,
      )
        .sort(([a], [b]) =>
          a.localeCompare(b),
        )
        .map(([key, child]) => [
          key,
          stableObject(child),
        ]),
    );
  }

  return value;
}

function fingerprint(
  value: unknown,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        stableObject(value),
      ),
    )
    .digest("hex");
}

/**
 * Confidence shrinks uncertain evidence toward neutral 0.5.
 *
 * confidence=1 -> keep raw score.
 * confidence=0 -> neutral 0.5.
 */
function confidenceAdjusted(
  score: number,
  confidence: number,
): number {
  return (
    0.5 +
    (clamp01(score) - 0.5) *
      clamp01(confidence)
  );
}

interface EvidenceEvaluation {
  included: boolean;
  score: number | null;
  confidence: number | null;
  effective: number;
  availableAt: string | null;
  source: string | null;
  issue:
    | "MISSING"
    | "STALE"
    | "LOOKAHEAD"
    | "INVALID"
    | null;
}

function evaluateEvidence(
  evidence: AlphaFeatureEvidence | undefined,
  decisionAtMs: number,
): EvidenceEvaluation {
  if (!evidence) {
    return {
      included: false,
      score: null,
      confidence: null,
      effective: 0.5,
      availableAt: null,
      source: null,
      issue: "MISSING",
    };
  }

  if (
    !Number.isFinite(evidence.score) ||
    evidence.score < 0 ||
    evidence.score > 1 ||
    !Number.isFinite(evidence.confidence) ||
    evidence.confidence < 0 ||
    evidence.confidence > 1
  ) {
    return {
      included: false,
      score: null,
      confidence: null,
      effective: 0.5,
      availableAt:
        evidence.availableAt ?? null,
      source:
        evidence.source ?? null,
      issue: "INVALID",
    };
  }

  const availableAtMs =
    parseTime(evidence.availableAt);

  if (availableAtMs === null) {
    return {
      included: false,
      score: evidence.score,
      confidence: evidence.confidence,
      effective: 0.5,
      availableAt:
        evidence.availableAt,
      source:
        evidence.source,
      issue: "INVALID",
    };
  }

  if (availableAtMs > decisionAtMs) {
    return {
      included: false,
      score: evidence.score,
      confidence: evidence.confidence,
      effective: 0.5,
      availableAt:
        evidence.availableAt,
      source:
        evidence.source,
      issue: "LOOKAHEAD",
    };
  }

  if (
    evidence.maxAgeMinutes !== undefined
  ) {
    if (
      !Number.isFinite(
        evidence.maxAgeMinutes,
      ) ||
      evidence.maxAgeMinutes < 0
    ) {
      return {
        included: false,
        score: evidence.score,
        confidence:
          evidence.confidence,
        effective: 0.5,
        availableAt:
          evidence.availableAt,
        source:
          evidence.source,
        issue: "INVALID",
      };
    }

    const ageMinutes =
      (
        decisionAtMs -
        availableAtMs
      ) / 60_000;

    if (
      ageMinutes >
      evidence.maxAgeMinutes
    ) {
      return {
        included: false,
        score: evidence.score,
        confidence:
          evidence.confidence,
        effective: 0.5,
        availableAt:
          evidence.availableAt,
        source:
          evidence.source,
        issue: "STALE",
      };
    }
  }

  return {
    included: true,
    score: evidence.score,
    confidence: evidence.confidence,
    effective:
      confidenceAdjusted(
        evidence.score,
        evidence.confidence,
      ),
    availableAt:
      evidence.availableAt,
    source:
      evidence.source,
    issue: null,
  };
}

export function scoreAlphaCandidate(
  input: AlphaCandidateInput,
  track: AlphaTrack = "STABLE",
): AlphaCandidateScore {
  const stockCode =
    normalizeStockCode(
      input.stockCode,
    );

  const decisionAtMs =
    parseTime(input.decisionAt);

  if (decisionAtMs === null) {
    throw new Error(
      `INVALID_DECISION_AT:${input.decisionAt}`,
    );
  }

  const policy =
    ALPHA_TRACK_POLICIES[track];

  const positiveDimensions =
    Object.keys(
      POSITIVE_WEIGHTS,
    ) as AlphaPositiveDimension[];

  const dimensions:
    AlphaDimensionResult[] = [];

  const missingDimensions:
    AlphaPositiveDimension[] = [];

  const staleDimensions:
    AlphaDimension[] = [];

  const lookaheadDimensions:
    AlphaDimension[] = [];

  let positiveWeightCovered = 0;
  let weightedConfidence = 0;
  let baseScore = 0;

  for (
    const dimension
    of positiveDimensions
  ) {
    const weight =
      POSITIVE_WEIGHTS[dimension];

    const result =
      evaluateEvidence(
        input.features[dimension],
        decisionAtMs,
      );

    if (result.included) {
      positiveWeightCovered += weight;

      weightedConfidence +=
        weight *
        (
          result.confidence ??
          0
        );
    }

    if (
      result.issue === "MISSING"
    ) {
      missingDimensions.push(
        dimension,
      );
    }

    if (
      result.issue === "STALE"
    ) {
      staleDimensions.push(
        dimension,
      );
    }

    if (
      result.issue === "LOOKAHEAD"
    ) {
      lookaheadDimensions.push(
        dimension,
      );
    }

    const contribution =
      weight * result.effective;

    baseScore += contribution;

    dimensions.push({
      dimension,
      weight,

      included:
        result.included,

      rawScore:
        result.score,

      confidence:
        result.confidence,

      effectiveScore:
        round6(
          result.effective,
        ),

      contribution:
        round6(
          contribution,
        ),

      availableAt:
        result.availableAt,

      source:
        result.source,

      issue:
        result.issue,
    });
  }

  const risk =
    evaluateEvidence(
      input.features.riskPenalty,
      decisionAtMs,
    );

  if (
    risk.issue === "STALE"
  ) {
    staleDimensions.push(
      "riskPenalty",
    );
  }

  if (
    risk.issue === "LOOKAHEAD"
  ) {
    lookaheadDimensions.push(
      "riskPenalty",
    );
  }

  const riskPolicy =
    input.riskPolicy ??
    "REQUIRED";

  /**
   * Candidate selection and trade preflight are separate phases.
   *
   * REQUIRED:
   *   Historical behavior. Missing risk receives neutral 0.5 penalty.
   *
   * DEFER_TO_PREFLIGHT:
   *   No trade-specific risk exists yet, so do not fabricate a penalty.
   *   Execution must still bind validateBuyRisk() later.
   */
  const effectiveRiskPenalty =
    risk.included
      ? risk.effective
      : riskPolicy ===
          "DEFER_TO_PREFLIGHT"
        ? 0
        : 0.5;

  const weightedRiskPenalty =
    effectiveRiskPenalty *
    RISK_PENALTY_WEIGHT;

  const totalPositiveWeight =
    Object.values(
      POSITIVE_WEIGHTS,
    ).reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  const coverage =
    totalPositiveWeight > 0
      ? positiveWeightCovered /
        totalPositiveWeight
      : 0;

  const meanConfidence =
    positiveWeightCovered > 0
      ? weightedConfidence /
        positiveWeightCovered
      : 0;

  /**
   * Quality includes both:
   * - how much of the feature set exists
   * - how trustworthy those features are
   */
  const quality =
    coverage *
    meanConfidence;

  const riskAdjustedScore =
    clamp01(
      baseScore -
      weightedRiskPenalty,
    );

  /**
   * Low-quality data is shrunk toward neutral 0.5.
   * This prevents a sparse feature set from producing
   * an artificially extreme ranking score.
   */
  const finalScore =
    clamp01(
      0.5 +
      (
        riskAdjustedScore -
        0.5
      ) *
        quality,
    );

  const blockingIssues:
    string[] = [];

  const warnings:
    string[] = [];

  if (
    lookaheadDimensions.length > 0
  ) {
    blockingIssues.push(
      `LOOKAHEAD_FEATURES:${lookaheadDimensions.join(",")}`,
    );
  }

  const invalidDimensions =
    dimensions
      .filter(
        (row) =>
          row.issue === "INVALID",
      )
      .map(
        (row) =>
          row.dimension,
      );

  if (
    risk.issue === "INVALID"
  ) {
    invalidDimensions.push(
      "riskPenalty" as AlphaPositiveDimension,
    );
  }

  if (
    invalidDimensions.length > 0
  ) {
    blockingIssues.push(
      `INVALID_FEATURES:${invalidDimensions.join(",")}`,
    );
  }

  if (
    coverage <
    policy.minimumCoverage
  ) {
    blockingIssues.push(
      `INSUFFICIENT_COVERAGE:${round6(coverage)}<${policy.minimumCoverage}`,
    );
  }

  if (
    quality <
    policy.minimumQuality
  ) {
    blockingIssues.push(
      `INSUFFICIENT_QUALITY:${round6(quality)}<${policy.minimumQuality}`,
    );
  }

  if (
    effectiveRiskPenalty >
    policy.maximumRiskPenalty
  ) {
    blockingIssues.push(
      `RISK_TOO_HIGH:${round6(effectiveRiskPenalty)}>${policy.maximumRiskPenalty}`,
    );
  }

  if (
    finalScore <
    policy.minimumScore
  ) {
    blockingIssues.push(
      `ALPHA_SCORE_BELOW_THRESHOLD:${round6(finalScore)}<${policy.minimumScore}`,
    );
  }

  if (
    missingDimensions.length > 0
  ) {
    warnings.push(
      `MISSING_FEATURES:${missingDimensions.join(",")}`,
    );
  }

  if (
    staleDimensions.length > 0
  ) {
    warnings.push(
      `STALE_FEATURES:${staleDimensions.join(",")}`,
    );
  }

  if (!risk.included) {
    if (
      riskPolicy ===
      "DEFER_TO_PREFLIGHT"
    ) {
      warnings.push(
        "RISK_DEFERRED_TO_PREFLIGHT_NO_CANDIDATE_STAGE_PENALTY",
      );
    } else {
      warnings.push(
        "RISK_EVIDENCE_MISSING_OR_UNUSABLE_NEUTRAL_PENALTY_APPLIED",
      );
    }
  }

  const reasons =
    dimensions
      .filter(
        (row) =>
          row.included,
      )
      .sort(
        (left, right) =>
          right.contribution -
          left.contribution,
      )
      .slice(0, 3)
      .map(
        (row) =>
          `${row.dimension} contribution=${row.contribution}`,
      );

  reasons.push(
    `riskPenalty=${round6(effectiveRiskPenalty)}`,
    `coverage=${round6(coverage)}`,
    `quality=${round6(quality)}`,
  );

  const eligibleForEntryTiming =
    blockingIssues.length === 0;

  const inputFingerprint =
    fingerprint({
      scorerVersion:
        ALPHA_CANDIDATE_SCORER_VERSION,

      featureSetVersion:
        ALPHA_FEATURE_SET_VERSION,

      track,
      stockCode,
      decisionAt:
        input.decisionAt,

      modelId:
        input.modelId ?? null,

      modelVersion:
        input.modelVersion ?? null,

      riskPolicy,

      features:
        input.features,

      metadata:
        input.metadata ?? null,
    });

  return {
    scorerVersion:
      ALPHA_CANDIDATE_SCORER_VERSION,

    featureSetVersion:
      ALPHA_FEATURE_SET_VERSION,

    inputFingerprint,

    stockCode,
    decisionAt:
      input.decisionAt,
    track,

    baseScore:
      round6(baseScore),

    riskAdjustedScore:
      round6(
        riskAdjustedScore,
      ),

    score:
      round6(finalScore),

    coverage:
      round6(coverage),

    quality:
      round6(quality),

    riskPenalty:
      round6(
        effectiveRiskPenalty,
      ),

    eligibleForEntryTiming,

    dimensions,

    risk: {
      included:
        risk.included,

      rawScore:
        risk.score,

      confidence:
        risk.confidence,

      effectivePenalty:
        round6(
          effectiveRiskPenalty,
        ),

      weightedPenalty:
        round6(
          weightedRiskPenalty,
        ),

      availableAt:
        risk.availableAt,

      source:
        risk.source,

      issue:
        risk.issue,
    },

    blockingIssues,
    warnings,
    reasons,

    metadata: {
      modelId:
        input.modelId ?? null,

      modelVersion:
        input.modelVersion ??
        null,

      riskPolicy,

      positiveWeightCovered:
        round6(
          positiveWeightCovered,
        ),

      totalPositiveWeight:
        round6(
          totalPositiveWeight,
        ),

      missingDimensions,

      staleDimensions,

      lookaheadDimensions,
    },
  };
}

export function rankAlphaCandidates(
  inputs: AlphaCandidateInput[],
  track: AlphaTrack = "STABLE",
): RankedAlphaCandidate[] {
  const scored =
    inputs.map((input) =>
      scoreAlphaCandidate(
        input,
        track,
      ),
    );

  scored.sort((left, right) => {
    if (
      left.eligibleForEntryTiming !==
      right.eligibleForEntryTiming
    ) {
      return left.eligibleForEntryTiming
        ? -1
        : 1;
    }

    if (
      right.score !== left.score
    ) {
      return (
        right.score -
        left.score
      );
    }

    if (
      right.quality !== left.quality
    ) {
      return (
        right.quality -
        left.quality
      );
    }

    return left.stockCode.localeCompare(
      right.stockCode,
    );
  });

  return scored.map(
    (candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }),
  );
}
