#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = 'ALPHA_V1_CANDIDATE_SCORING_INSTALLER';

const scorer = String.raw`import { createHash } from "node:crypto";

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

export interface AlphaCandidateInput {
  stockCode: string;

  /**
   * Exact decision timestamp used by backtest/shadow/paper/live.
   */
  decisionAt: string;

  modelId?: string;
  modelVersion?: string;

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
      \`INVALID_STOCK_CODE:\${value}\`,
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
      \`INVALID_DECISION_AT:\${input.decisionAt}\`,
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

  /**
   * Missing risk is intentionally conservative:
   * use neutral 0.5 rather than zero risk.
   */
  const effectiveRiskPenalty =
    risk.included
      ? risk.effective
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
      \`LOOKAHEAD_FEATURES:\${lookaheadDimensions.join(",")}\`,
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
      \`INVALID_FEATURES:\${invalidDimensions.join(",")}\`,
    );
  }

  if (
    coverage <
    policy.minimumCoverage
  ) {
    blockingIssues.push(
      \`INSUFFICIENT_COVERAGE:\${round6(coverage)}<\${policy.minimumCoverage}\`,
    );
  }

  if (
    quality <
    policy.minimumQuality
  ) {
    blockingIssues.push(
      \`INSUFFICIENT_QUALITY:\${round6(quality)}<\${policy.minimumQuality}\`,
    );
  }

  if (
    effectiveRiskPenalty >
    policy.maximumRiskPenalty
  ) {
    blockingIssues.push(
      \`RISK_TOO_HIGH:\${round6(effectiveRiskPenalty)}>\${policy.maximumRiskPenalty}\`,
    );
  }

  if (
    finalScore <
    policy.minimumScore
  ) {
    blockingIssues.push(
      \`ALPHA_SCORE_BELOW_THRESHOLD:\${round6(finalScore)}<\${policy.minimumScore}\`,
    );
  }

  if (
    missingDimensions.length > 0
  ) {
    warnings.push(
      \`MISSING_FEATURES:\${missingDimensions.join(",")}\`,
    );
  }

  if (
    staleDimensions.length > 0
  ) {
    warnings.push(
      \`STALE_FEATURES:\${staleDimensions.join(",")}\`,
    );
  }

  if (!risk.included) {
    warnings.push(
      "RISK_EVIDENCE_MISSING_OR_UNUSABLE_NEUTRAL_PENALTY_APPLIED",
    );
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
          \`\${row.dimension} contribution=\${row.contribution}\`,
      );

  reasons.push(
    \`riskPenalty=\${round6(effectiveRiskPenalty)}\`,
    \`coverage=\${round6(coverage)}\`,
    \`quality=\${round6(quality)}\`,
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
`;

const smoke = String.raw`import assert from "node:assert/strict";

import {
  ALPHA_CANDIDATE_SCORER_VERSION,
  rankAlphaCandidates,
  type AlphaCandidateInput,
} from "../lib/alpha/candidate-scoring";

const decisionAt =
  "2026-10-06T06:00:00.000Z";

function evidence(
  score: number,
  confidence: number,
  availableAt: string,
  source: string,
  maxAgeMinutes = 1_440,
) {
  return {
    score,
    confidence,
    availableAt,
    source,
    sourceVersion: "smoke-v1",
    maxAgeMinutes,
  };
}

const inputs: AlphaCandidateInput[] = [
  {
    stockCode: "000660",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      catalyst:
        evidence(
          0.82,
          0.90,
          "2026-10-06T05:20:00.000Z",
          "DISCLOSURE_NEWS",
          720,
        ),

      flow:
        evidence(
          0.78,
          0.88,
          "2026-10-06T05:55:00.000Z",
          "SUPPLY_DEMAND",
          60,
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
          60,
        ),

      priceVolume:
        evidence(
          0.80,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
          120,
        ),

      liquidity:
        evidence(
          0.92,
          0.98,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
          120,
        ),

      eventPersistence:
        evidence(
          0.72,
          0.85,
          "2026-10-06T05:20:00.000Z",
          "EVENT_PERSISTENCE",
          720,
        ),

      riskPenalty:
        evidence(
          0.28,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
          120,
        ),
    },
  },

  {
    stockCode: "005930",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      catalyst:
        evidence(
          0.58,
          0.85,
          "2026-10-06T05:15:00.000Z",
          "DISCLOSURE_NEWS",
        ),

      flow:
        evidence(
          0.56,
          0.82,
          "2026-10-06T05:50:00.000Z",
          "SUPPLY_DEMAND",
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
        ),

      priceVolume:
        evidence(
          0.59,
          0.88,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
        ),

      liquidity:
        evidence(
          0.98,
          0.99,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
        ),

      eventPersistence:
        evidence(
          0.52,
          0.75,
          "2026-10-06T05:15:00.000Z",
          "EVENT_PERSISTENCE",
        ),

      riskPenalty:
        evidence(
          0.35,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
        ),
    },
  },

  {
    stockCode: "035420",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      /**
       * Deliberate future feature:
       * must trigger LOOKAHEAD_FEATURES.
       */
      catalyst:
        evidence(
          0.95,
          0.99,
          "2026-10-06T06:05:00.000Z",
          "FUTURE_DISCLOSURE",
        ),

      flow:
        evidence(
          0.85,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "SUPPLY_DEMAND",
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
        ),

      priceVolume:
        evidence(
          0.85,
          0.92,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
        ),

      liquidity:
        evidence(
          0.90,
          0.95,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
        ),

      eventPersistence:
        evidence(
          0.80,
          0.90,
          "2026-10-06T05:30:00.000Z",
          "EVENT_PERSISTENCE",
        ),

      riskPenalty:
        evidence(
          0.25,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
        ),
    },
  },
];

const stable =
  rankAlphaCandidates(
    inputs,
    "STABLE",
  );

const aggressive =
  rankAlphaCandidates(
    inputs,
    "AGGRESSIVE",
  );

const stable660 =
  stable.find(
    (row) =>
      row.stockCode === "000660",
  );

const stable930 =
  stable.find(
    (row) =>
      row.stockCode === "005930",
  );

const lookahead =
  stable.find(
    (row) =>
      row.stockCode === "035420",
  );

assert(stable660);
assert(stable930);
assert(lookahead);

assert.equal(
  stable660.scorerVersion,
  ALPHA_CANDIDATE_SCORER_VERSION,
);

assert.equal(
  stable660.eligibleForEntryTiming,
  true,
  "000660 should qualify for STABLE in the smoke contract",
);

assert.equal(
  stable930.eligibleForEntryTiming,
  false,
  "005930 should remain below the STABLE threshold",
);

assert.equal(
  lookahead.eligibleForEntryTiming,
  false,
  "look-ahead candidate must never be eligible",
);

assert(
  lookahead.blockingIssues.some(
    (issue) =>
      issue.startsWith(
        "LOOKAHEAD_FEATURES:",
      ),
  ),
  "look-ahead violation was not detected",
);

assert.equal(
  stable[0]?.stockCode,
  "000660",
  "expected 000660 to rank first in STABLE smoke data",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_CANDIDATE_SCORING_SMOKE_PASS",

      scorerVersion:
        ALPHA_CANDIDATE_SCORER_VERSION,

      stable:
        stable.map((row) => ({
          rank: row.rank,
          stockCode:
            row.stockCode,
          score:
            row.score,
          coverage:
            row.coverage,
          quality:
            row.quality,
          riskPenalty:
            row.riskPenalty,
          eligibleForEntryTiming:
            row.eligibleForEntryTiming,
          blockingIssues:
            row.blockingIssues,
        })),

      aggressive:
        aggressive.map((row) => ({
          rank: row.rank,
          stockCode:
            row.stockCode,
          score:
            row.score,
          eligibleForEntryTiming:
            row.eligibleForEntryTiming,
        })),

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkRequests: 0,
        ordersCreated: 0,
      },

      nextGate:
        "ALPHA_V1_REAL_FEATURE_ADAPTERS",
    },
    null,
    2,
  ),
);
`;

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const scorerFile =
    path.join(
      root,
      'lib',
      'alpha',
      'candidate-scoring.ts',
    );

  const smokeFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-candidate-scoring-smoke.ts',
    );

  atomicWrite(
    scorerFile,
    scorer,
  );

  atomicWrite(
    smokeFile,
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CANDIDATE_SCORING_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/alpha/candidate-scoring.ts',
          'scripts/alpha-v1-candidate-scoring-smoke.ts',
        ],

        architecture: {
          alphaPurpose:
            'CANDIDATE_RANKING_ONLY',

          entryTimingPurpose:
            'ENTRY_TIMING_ONLY',

          alphaCreatesOrders:
            false,

          alphaWritesDatabase:
            false,

          lookaheadProtection:
            'AVAILABLE_AT_MUST_BE_LTE_DECISION_AT',

          tracks: [
            'STABLE',
            'AGGRESSIVE',
          ],

          dimensions: [
            'catalyst',
            'flow',
            'marketRegime',
            'priceVolume',
            'liquidity',
            'eventPersistence',
            'riskPenalty',
          ],
        },

        nextAction:
          'RUN_ALPHA_V1_SMOKE_TEST',
      },
      null,
      2,
    ),
  );

  const npx =
    process.platform === 'win32'
      ? 'npx.cmd'
      : 'npx';

  const child =
    spawnSync(
      npx,
      [
        'tsx',
        '.\\scripts\\alpha-v1-candidate-scoring-smoke.ts',
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        shell: false,
      },
    );

  if (child.error) {
    throw child.error;
  }

  if (child.status !== 0) {
    process.exitCode =
      child.status ?? 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CANDIDATE_SCORING_INSTALL_OR_SMOKE_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          networkRequests: 0,
          ordersCreated: 0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
