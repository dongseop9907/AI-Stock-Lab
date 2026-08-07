import {
  getCurrentMarketRegimeFeaturesV7,
} from "@/lib/market/get-current-market-regime-features-v7";

import {
  getMarketDataQualityGateV710,
} from "@/lib/market/get-market-data-quality-gate-v7-10";

import {
  evaluateMarketRegimeV7Policy,
  type MarketRegimeV7Policy,
} from "@/lib/market/market-regime-v7-policy";

import {
  getCurrentMarketRegimeShadowSafe,
} from "@/lib/trading/market-regime-shadow";

export const MARKET_REGIME_V7_FORWARD_POLICY:
  MarketRegimeV7Policy =
    "BLOCK_BREADTH_OR_HIGH_VOL";

export type MarketRegimeShadowAgreementState =
  | "BOTH_BLOCK"
  | "BOTH_ALLOW"
  | "V6_BLOCK_V7_ALLOW"
  | "V6_ALLOW_V7_BLOCK"
  | "NOT_COMPARABLE_DATE_MISMATCH"
  | "NOT_COMPARABLE_MISSING_INPUT";

function resolveAgreementState(
  input: {
    comparisonEligible:
      boolean;

    dateAligned:
      boolean;

    v6WouldBlock:
      boolean;

    v7WouldBlock:
      boolean;
  },
): MarketRegimeShadowAgreementState {
  if (
    !input.comparisonEligible
  ) {
    return input.dateAligned
      ? "NOT_COMPARABLE_MISSING_INPUT"
      : "NOT_COMPARABLE_DATE_MISMATCH";
  }

  if (
    input.v6WouldBlock &&
    input.v7WouldBlock
  ) {
    return "BOTH_BLOCK";
  }

  if (
    !input.v6WouldBlock &&
    !input.v7WouldBlock
  ) {
    return "BOTH_ALLOW";
  }

  if (
    input.v6WouldBlock &&
    !input.v7WouldBlock
  ) {
    return "V6_BLOCK_V7_ALLOW";
  }

  return "V6_ALLOW_V7_BLOCK";
}

/*
 * v7.10 Forward Shadow Comparator
 *
 * v7.7 freshness alone is no longer sufficient.
 * Forward evidence is eligible only when v7.10 confirms:
 *
 * - current market data is fresh/aligned;
 * - latest v7.9 integrity scan covers the same expected market date;
 * - effective integrity errors are zero.
 *
 * WARNING-only integrity findings may pass as PASS_WITH_WARNING.
 *
 * Production order logic remains untouched.
 */
export async function getCurrentMarketRegimeShadowComparisonV73() {
  const [
    v6,
    v7Features,
    qualityGate,
  ] =
    await Promise.all([
      getCurrentMarketRegimeShadowSafe(),
      getCurrentMarketRegimeFeaturesV7(),
      getMarketDataQualityGateV710(),
    ]);

  const v7Decision =
    evaluateMarketRegimeV7Policy(
      MARKET_REGIME_V7_FORWARD_POLICY,
      v7Features,
    );

  const v6InputsComplete =
    v6.regime !==
      "UNKNOWN" &&
    v6.latestMarketDate !==
      null &&
    v6.breadth20 !==
      null &&
    v6.avgReturn20 !==
      null;

  const v7InputsComplete =
    v7Decision.inputsComplete &&
    v7Features.latestMarketDate !==
      null;

  const dateAligned =
    v6.latestMarketDate !==
      null &&
    v7Features.latestMarketDate !==
      null &&
    v6.latestMarketDate ===
      v7Features.latestMarketDate;

  const comparisonEligible =
    v6InputsComplete &&
    v7InputsComplete &&
    dateAligned &&
    qualityGate
      .usableForForwardShadow;

  const agreementState =
    resolveAgreementState({
      comparisonEligible,
      dateAligned,

      v6WouldBlock:
        v6.wouldBlockByRegime,

      v7WouldBlock:
        v7Decision.blocked,
    });

  return {
    version:
      "MARKET_REGIME_SHADOW_COMPARATOR_V7_10",

    mode:
      "FORWARD_SHADOW",

    productionApplied:
      false,

    candidatePolicy:
      MARKET_REGIME_V7_FORWARD_POLICY,

    comparisonEligible,
    dateAligned,
    agreementState,

    observedAt:
      new Date()
        .toISOString(),

    /*
     * Kept for backward-compatible consumers that already expect
     * freshnessGuard in the comparator payload.
     */
    freshnessGuard: {
      status:
        qualityGate
          .freshness
          .status,

      usableForShadowComparison:
        qualityGate
          .freshness
          .usableForShadowComparison,

      expectedMarketDate:
        qualityGate
          .expectedMarketDate,

      dates:
        qualityGate
          .freshness
          .dates,

      coverage:
        qualityGate
          .freshness
          .coverage,

      alignment:
        qualityGate
          .freshness
          .alignment,

      lag:
        qualityGate
          .freshness
          .lag,

      evidenceFingerprint:
        qualityGate
          .freshness
          .evidenceFingerprint,
    },

    dataQualityGate: {
      version:
        qualityGate
          .version,

      status:
        qualityGate
          .status,

      usableForForwardShadow:
        qualityGate
          .usableForForwardShadow,

      expectedMarketDate:
        qualityGate
          .expectedMarketDate,

      integrity:
        qualityGate
          .integrity,

      reasons:
        qualityGate
          .reasons,

      evidenceFingerprint:
        qualityGate
          .evidenceFingerprint,
    },

    v6: {
      regime:
        v6.regime,

      wouldBlock:
        v6.wouldBlockByRegime,

      breadth20:
        v6.breadth20,

      avgReturn20:
        v6.avgReturn20,

      sampleSize:
        v6.sampleSize,

      returnSampleSize:
        v6.returnSampleSize,

      stockCodes:
        v6.stockCodes,

      latestMarketDate:
        v6.latestMarketDate,

      latestSnapshotObservedAt:
        v6.latestSnapshotObservedAt,

      source:
        v6.source,
    },

    v7: {
      policy:
        v7Decision.policy,

      wouldBlock:
        v7Decision.blocked,

      inputsComplete:
        v7Decision.inputsComplete,

      reasons:
        v7Decision.reasons,

      thresholds:
        v7Decision.thresholds,

      features:
        v7Decision.features,

      latestMarketDate:
        v7Features.latestMarketDate,

      dataSource:
        v7Features.dataSource,
    },

    safety: {
      orderQualificationChanged:
        false,

      orderBlockingChanged:
        false,

      productionDecisionApplied:
        false,

      staleDataCanInvalidateShadowComparison:
        true,

      integrityErrorsCanInvalidateShadowComparison:
        true,
    },
  };
}