import type {
  MarketRegimeFeatureVectorV7,
} from "@/lib/market/market-regime-feature-engine";

export type MarketRegimeV7Policy =
  | "CONTROL"
  | "BLOCK_BREADTH20_LOW"
  | "BLOCK_HIGH_VOL20"
  | "BLOCK_KOSDAQ20_NEGATIVE"
  | "BLOCK_BREADTH_OR_HIGH_VOL"
  | "BLOCK_BREADTH_OR_KOSDAQ_WEAK";

export interface MarketRegimeV7PolicyThresholds {
  breadth20Max: number;
  highVolatility20Min: number;
  kosdaqReturn20Max: number;
}

export const DEFAULT_MARKET_REGIME_V7_THRESHOLDS:
  MarketRegimeV7PolicyThresholds = {
    breadth20Max: 0.40,
    highVolatility20Min: 0.30,
    kosdaqReturn20Max: 0,
  };

export const MARKET_REGIME_V7_POLICY_CANDIDATES:
  MarketRegimeV7Policy[] = [
    "CONTROL",
    "BLOCK_BREADTH20_LOW",
    "BLOCK_HIGH_VOL20",
    "BLOCK_KOSDAQ20_NEGATIVE",
    "BLOCK_BREADTH_OR_HIGH_VOL",
    "BLOCK_BREADTH_OR_KOSDAQ_WEAK",
  ];

function averageNullable(
  values: Array<number | null>,
): number | null {
  const usable =
    values.filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(value),
    );

  if (usable.length === 0) {
    return null;
  }

  return (
    usable.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    usable.length
  );
}

export function normalizeMarketRegimeV7Policy(
  value: unknown,
): MarketRegimeV7Policy {
  return MARKET_REGIME_V7_POLICY_CANDIDATES
    .includes(
      value as MarketRegimeV7Policy,
    )
    ? (
        value as
          MarketRegimeV7Policy
      )
    : "CONTROL";
}

export function evaluateMarketRegimeV7Policy(
  policy:
    MarketRegimeV7Policy,

  features:
    MarketRegimeFeatureVectorV7,

  thresholds:
    MarketRegimeV7PolicyThresholds =
      DEFAULT_MARKET_REGIME_V7_THRESHOLDS,
) {
  const breadth20 =
    features.breadth
      .breadth20;

  const kosdaqReturn20 =
    features.kosdaq
      ?.return20 ??
    null;

  const averageVolatility20 =
    averageNullable([
      features.kospi
        ?.realizedVolatility20 ??
        null,

      features.kosdaq
        ?.realizedVolatility20 ??
        null,
    ]);

  const breadthLow =
    breadth20 !== null &&
    breadth20 <=
      thresholds.breadth20Max;

  const highVolatility =
    averageVolatility20 !==
      null &&
    averageVolatility20 >=
      thresholds
        .highVolatility20Min;

  const kosdaqWeak =
    kosdaqReturn20 !==
      null &&
    kosdaqReturn20 <=
      thresholds
        .kosdaqReturn20Max;

  let blocked =
    false;

  switch (policy) {
    case "BLOCK_BREADTH20_LOW":
      blocked =
        breadthLow;
      break;

    case "BLOCK_HIGH_VOL20":
      blocked =
        highVolatility;
      break;

    case "BLOCK_KOSDAQ20_NEGATIVE":
      blocked =
        kosdaqWeak;
      break;

    case "BLOCK_BREADTH_OR_HIGH_VOL":
      blocked =
        breadthLow ||
        highVolatility;
      break;

    case "BLOCK_BREADTH_OR_KOSDAQ_WEAK":
      blocked =
        breadthLow ||
        kosdaqWeak;
      break;

    case "CONTROL":
    default:
      blocked =
        false;
      break;
  }

  const reasons:
    string[] = [];

  if (breadthLow) {
    reasons.push(
      `breadth20<=${thresholds.breadth20Max}`,
    );
  }

  if (highVolatility) {
    reasons.push(
      `averageVolatility20>=${thresholds.highVolatility20Min}`,
    );
  }

  if (kosdaqWeak) {
    reasons.push(
      `kosdaqReturn20<=${thresholds.kosdaqReturn20Max}`,
    );
  }

  const inputsComplete =
    breadth20 !== null &&
    averageVolatility20 !==
      null &&
    kosdaqReturn20 !== null &&
    features.kospi !== null &&
    features.kosdaq !== null;

  return {
    version:
      "MARKET_REGIME_POLICY_V7_1",

    policy,
    blocked,

    inputsComplete,

    thresholds,

    features: {
      latestMarketDate:
        features.latestMarketDate,

      breadth20,

      breadth60:
        features.breadth
          .breadth60,

      kospiReturn20:
        features.kospi
          ?.return20 ??
        null,

      kospiReturn60:
        features.kospi
          ?.return60 ??
        null,

      kosdaqReturn20,

      kosdaqReturn60:
        features.kosdaq
          ?.return60 ??
        null,

      averageVolatility20,

      kospiDrawdown60:
        features.kospi
          ?.drawdown60 ??
        null,

      kosdaqDrawdown60:
        features.kosdaq
          ?.drawdown60 ??
        null,
    },

    reasons,
  };
}