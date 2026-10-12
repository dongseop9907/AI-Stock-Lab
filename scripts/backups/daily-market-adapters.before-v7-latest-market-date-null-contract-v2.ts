import type {
  AlphaFeatureEvidence,
} from "./candidate-scoring";

export interface DailyAlphaBarLike {
  stock_code: string;
  trading_date: string;
  open_price: number | string | null;
  high_price: number | string | null;
  low_price: number | string | null;
  close_price: number | string | null;
  volume: number | string | null;
  trading_value?: number | string | null;
  adjusted_price?: boolean | null;
  source?: string | null;
  updated_at?: string | null;
}

export interface V7MarketIndexFeatureLike {
  return20?: number | null;
  return60?: number | null;
  realizedVolatility20?: number | null;
  drawdown60?: number | null;
}

export interface V7MarketRegimeFeatureVectorLike {
  latestMarketDate: string;

  breadth: {
    breadth20: number | null;
    breadth60: number | null;
  };

  kospi?: V7MarketIndexFeatureLike | null;
  kosdaq?: V7MarketIndexFeatureLike | null;

  dataSource?: {
    index?: string;
    breadth?: string;
    activeStockCount?: number;
    historyStartDate?: string;
  };
}

export interface V7PolicyEvaluationLike {
  version?: string;
  policy?: string;
  blocked: boolean;
  inputsComplete: boolean;
  reasons?: string[];

  features?: {
    latestMarketDate?: string | null;
    breadth20?: number | null;
    breadth60?: number | null;
    kospiReturn20?: number | null;
    kospiReturn60?: number | null;
    kosdaqReturn20?: number | null;
    kosdaqReturn60?: number | null;
    averageVolatility20?: number | null;
    kospiDrawdown60?: number | null;
    kosdaqDrawdown60?: number | null;
  };
}

function clamp01(
  value: number,
): number {
  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

function scale(
  value: number | null,
  low: number,
  high: number,
): number {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return 0.5;
  }

  if (high <= low) {
    return 0.5;
  }

  return clamp01(
    (value - low) /
    (high - low),
  );
}

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

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Conservative completed-daily-bar availability:
 * the final value for a Korean trading date becomes Alpha-usable
 * at 00:00 KST on the following calendar day.
 *
 * 00:00 KST next day = 15:00 UTC on trading date.
 */
function completedTradingDateAvailableAt(
  sqlDate: string,
): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      sqlDate,
    )
  ) {
    return null;
  }

  const [
    year,
    month,
    day,
  ] =
    sqlDate
      .split("-")
      .map(Number);

  const milliseconds =
    Date.UTC(
      year,
      month - 1,
      day,
      15,
      0,
      0,
      0,
    );

  const result =
    new Date(
      milliseconds,
    );

  return Number.isFinite(
    result.getTime(),
  )
    ? result.toISOString()
    : null;
}

function returnOverBars(
  rows: Array<{
    close: number;
  }>,
  periods: number,
): number | null {
  if (
    rows.length <=
    periods
  ) {
    return null;
  }

  const latest =
    rows.at(-1)
      ?.close;

  const previous =
    rows[
      rows.length -
      1 -
      periods
    ]?.close;

  if (
    latest === undefined ||
    previous === undefined ||
    previous <= 0
  ) {
    return null;
  }

  return (
    latest /
    previous -
    1
  );
}

export function buildV7MarketRegimeEvidence(
  input: {
    decisionAt: string;
    features: V7MarketRegimeFeatureVectorLike;
    policy: V7PolicyEvaluationLike;
  },
): AlphaFeatureEvidence | undefined {
  const availableAt =
    completedTradingDateAvailableAt(
      input.features
        .latestMarketDate,
    );

  if (!availableAt) {
    return undefined;
  }

  const decisionAtMs =
    new Date(
      input.decisionAt,
    ).getTime();

  const availableAtMs =
    new Date(
      availableAt,
    ).getTime();

  if (
    !Number.isFinite(
      decisionAtMs,
    ) ||
    !Number.isFinite(
      availableAtMs,
    ) ||
    availableAtMs >
      decisionAtMs
  ) {
    return undefined;
  }

  const breadth20 =
    input.features
      .breadth
      .breadth20;

  const breadth60 =
    input.features
      .breadth
      .breadth60;

  const averageReturn20 =
    averageNullable([
      input.features
        .kospi
        ?.return20 ??
        null,

      input.features
        .kosdaq
        ?.return20 ??
        null,
    ]);

  const averageReturn60 =
    averageNullable([
      input.features
        .kospi
        ?.return60 ??
        null,

      input.features
        .kosdaq
        ?.return60 ??
        null,
    ]);

  const averageVolatility20 =
    averageNullable([
      input.features
        .kospi
        ?.realizedVolatility20 ??
        null,

      input.features
        .kosdaq
        ?.realizedVolatility20 ??
        null,
    ]);

  const averageDrawdown60 =
    averageNullable([
      input.features
        .kospi
        ?.drawdown60 ??
        null,

      input.features
        .kosdaq
        ?.drawdown60 ??
        null,
    ]);

  const breadth20Score =
    scale(
      breadth20,
      0.25,
      0.75,
    );

  const breadth60Score =
    scale(
      breadth60,
      0.20,
      0.75,
    );

  const return20Score =
    scale(
      averageReturn20,
      -0.10,
      0.15,
    );

  const return60Score =
    scale(
      averageReturn60,
      -0.20,
      0.30,
    );

  /**
   * Lower realized volatility is better for candidate selection.
   */
  const volatilityScore =
    averageVolatility20 ===
      null
      ? 0.5
      : clamp01(
          1 -
          scale(
            averageVolatility20,
            0.05,
            0.40,
          ),
        );

  /**
   * 0 drawdown is strongest; -30% or worse maps to 0.
   */
  const drawdownScore =
    scale(
      averageDrawdown60,
      -0.30,
      0,
    );

  let score =
    clamp01(
      breadth20Score *
        0.30 +
      breadth60Score *
        0.10 +
      return20Score *
        0.20 +
      return60Score *
        0.10 +
      volatilityScore *
        0.15 +
      drawdownScore *
        0.15,
    );

  /**
   * Reuse the existing V7 policy as a guardrail without duplicating
   * its blocking logic. A blocked regime cannot become a strongly
   * positive Alpha regime feature.
   */
  if (
    input.policy.blocked
  ) {
    score =
      Math.min(
        score,
        0.45,
      );
  }

  const rawCompleteness = [
    breadth20,
    breadth60,
    averageReturn20,
    averageReturn60,
    averageVolatility20,
    averageDrawdown60,
  ].filter(
    (value) =>
      value !== null &&
      Number.isFinite(value),
  ).length /
  6;

  const confidence =
    clamp01(
      0.60 +
      rawCompleteness *
        0.30 +
      (
        input.policy
          .inputsComplete
          ? 0.05
          : 0
      ),
    );

  return {
    score,
    confidence,

    availableAt,
    observedAt:
      availableAt,

    source:
      "MARKET_REGIME_V7_DAILY_BARS",

    sourceVersion:
      input.policy
        .version ??
      "MARKET_REGIME_POLICY_V7_1",

    maxAgeMinutes:
      10 *
      24 *
      60,

    metadata: {
      latestMarketDate:
        input.features
          .latestMarketDate,

      policy:
        input.policy
          .policy ??
        null,

      blocked:
        input.policy
          .blocked,

      inputsComplete:
        input.policy
          .inputsComplete,

      reasons:
        input.policy
          .reasons ??
        [],

      breadth20,
      breadth60,
      averageReturn20,
      averageReturn60,
      averageVolatility20,
      averageDrawdown60,

      components: {
        breadth20Score,
        breadth60Score,
        return20Score,
        return60Score,
        volatilityScore,
        drawdownScore,
      },

      dataSource:
        input.features
          .dataSource ??
        null,
    },
  };
}

export function buildDailyPriceVolumeEvidence(
  input: {
    stockCode: string;
    market: string | null | undefined;
    decisionAt: string;
    rows: DailyAlphaBarLike[];
    v7Features: V7MarketRegimeFeatureVectorLike;
  },
): AlphaFeatureEvidence | undefined {
  const decisionAtMs =
    new Date(
      input.decisionAt,
    ).getTime();

  if (
    !Number.isFinite(
      decisionAtMs,
    )
  ) {
    throw new Error(
      `INVALID_DECISION_AT:${input.decisionAt}`,
    );
  }

  const stockCode =
    String(
      input.stockCode,
    )
      .trim()
      .padStart(
        6,
        "0",
      );

  const usable =
    input.rows
      .filter(
        (row) =>
          String(
            row.stock_code,
          )
            .trim()
            .padStart(
              6,
              "0",
            ) ===
          stockCode,
      )
      .map(
        (row) => {
          const open =
            toNumber(
              row.open_price,
            );

          const high =
            toNumber(
              row.high_price,
            );

          const low =
            toNumber(
              row.low_price,
            );

          const close =
            toNumber(
              row.close_price,
            );

          const volume =
            toNumber(
              row.volume,
            );

          const availableAt =
            completedTradingDateAvailableAt(
              String(
                row.trading_date,
              ),
            );

          return {
            tradingDate:
              String(
                row.trading_date,
              ),

            availableAt,

            open,
            high,
            low,
            close,
            volume,

            adjusted:
              row.adjusted_price ===
              true,

            source:
              row.source ??
              null,
          };
        },
      )
      .filter(
        (
          row,
        ): row is {
          tradingDate: string;
          availableAt: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
          adjusted: boolean;
          source: string | null;
        } => {
          if (
            row.availableAt ===
              null ||
            row.open ===
              null ||
            row.high ===
              null ||
            row.low ===
              null ||
            row.close ===
              null ||
            row.volume ===
              null ||
            !row.adjusted
          ) {
            return false;
          }

          const availableMs =
            new Date(
              row.availableAt,
            ).getTime();

          return (
            Number.isFinite(
              availableMs,
            ) &&
            availableMs <=
              decisionAtMs &&
            row.open >
              0 &&
            row.high >
              0 &&
            row.low >
              0 &&
            row.close >
              0 &&
            row.volume >=
              0
          );
        },
      )
      .sort(
        (a, b) =>
          a.tradingDate
            .localeCompare(
              b.tradingDate,
            ),
      );

  if (
    usable.length <
    61
  ) {
    return undefined;
  }

  const latest =
    usable.at(-1);

  if (!latest) {
    return undefined;
  }

  const return20 =
    returnOverBars(
      usable,
      20,
    );

  const return60 =
    returnOverBars(
      usable,
      60,
    );

  if (
    return20 === null ||
    return60 === null
  ) {
    return undefined;
  }

  const marketNormalized =
    String(
      input.market ??
      "",
    )
      .trim()
      .toUpperCase();

  const benchmark =
    marketNormalized.includes(
      "KOSDAQ",
    )
      ? input
          .v7Features
          .kosdaq
      : input
          .v7Features
          .kospi;

  const benchmarkReturn20 =
    benchmark
      ?.return20 ??
    null;

  const benchmarkReturn60 =
    benchmark
      ?.return60 ??
    null;

  const relativeStrength20 =
    benchmarkReturn20 ===
      null
      ? null
      : return20 -
        benchmarkReturn20;

  const relativeStrength60 =
    benchmarkReturn60 ===
      null
      ? null
      : return60 -
        benchmarkReturn60;

  const recentFive =
    usable.slice(
      -5,
    );

  const baselineTwenty =
    usable.slice(
      -25,
      -5,
    );

  const recentFiveAverageVolume =
    recentFive.reduce(
      (sum, row) =>
        sum + row.volume,
      0,
    ) /
    recentFive.length;

  const baselineTwentyAverageVolume =
    baselineTwenty.length >
      0
      ? (
          baselineTwenty.reduce(
            (sum, row) =>
              sum + row.volume,
            0,
          ) /
          baselineTwenty.length
        )
      : 0;

  const volumeExpansion =
    baselineTwentyAverageVolume >
      0
      ? recentFiveAverageVolume /
        baselineTwentyAverageVolume
      : 1;

  const rangeRows =
    usable.slice(
      -61,
    );

  const rangeHigh =
    Math.max(
      ...rangeRows.map(
        (row) =>
          row.high,
      ),
    );

  const rangeLow =
    Math.min(
      ...rangeRows.map(
        (row) =>
          row.low,
      ),
    );

  const rangePosition60 =
    rangeHigh >
      rangeLow
      ? clamp01(
          (
            latest.close -
            rangeLow
          ) /
          (
            rangeHigh -
            rangeLow
          ),
        )
      : 0.5;

  const return20Score =
    scale(
      return20,
      -0.12,
      0.18,
    );

  const return60Score =
    scale(
      return60,
      -0.20,
      0.35,
    );

  const relativeStrength20Score =
    scale(
      relativeStrength20,
      -0.08,
      0.12,
    );

  const relativeStrength60Score =
    scale(
      relativeStrength60,
      -0.12,
      0.20,
    );

  const volumeExpansionScore =
    scale(
      volumeExpansion,
      0.70,
      1.60,
    );

  const score =
    clamp01(
      return20Score *
        0.15 +
      return60Score *
        0.15 +
      relativeStrength20Score *
        0.25 +
      relativeStrength60Score *
        0.20 +
      volumeExpansionScore *
        0.15 +
      rangePosition60 *
        0.10,
    );

  const benchmarkCompleteness =
    (
      benchmarkReturn20 !==
        null &&
      benchmarkReturn60 !==
        null
    )
      ? 1
      : 0;

  const historyCoverage =
    clamp01(
      usable.length /
      85,
    );

  const confidence =
    clamp01(
      0.65 +
      historyCoverage *
        0.20 +
      benchmarkCompleteness *
        0.10,
    );

  return {
    score,
    confidence,

    availableAt:
      latest.availableAt,

    observedAt:
      latest.availableAt,

    source:
      "MARKET_DAILY_BARS_ALPHA_PRICE_VOLUME",

    sourceVersion:
      "alpha-daily-pv-v1",

    maxAgeMinutes:
      10 *
      24 *
      60,

    metadata: {
      stockCode,
      market:
        marketNormalized ||
        null,

      latestTradingDate:
        latest.tradingDate,

      usableBars:
        usable.length,

      return20,
      return60,

      benchmarkReturn20,
      benchmarkReturn60,

      relativeStrength20,
      relativeStrength60,

      recentFiveAverageVolume,
      baselineTwentyAverageVolume,
      volumeExpansion,

      rangeHigh60:
        rangeHigh,

      rangeLow60:
        rangeLow,

      rangePosition60,

      components: {
        return20Score,
        return60Score,
        relativeStrength20Score,
        relativeStrength60Score,
        volumeExpansionScore,
        rangePosition60,
      },

      separationContract:
        "ALPHA_DAILY_MULTI_DAY_NOT_ENTRY_TIMING_INTRADAY",
    },
  };
}

/**
 * Alpha V1 daily-liquidity evidence.
 *
 * Candidate ranking must not depend on intraday market_snapshots.
 * This adapter uses only completed market_daily_bars available by decisionAt.
 *
 * Score = cross-sectional percentile of the target stock's rolling
 * median trading-value proxy over the most recent completed bars.
 *
 * trading_value is preferred. When it is unavailable, close * volume is
 * used only as a fallback proxy and recorded in metadata.
 */
export function buildDailyLiquidityEvidence(
  input: {
    stockCode: string;
    decisionAt: string;
    rows: DailyAlphaBarLike[];
    lookbackRows?: number;
  },
): AlphaFeatureEvidence | undefined {
  const decisionAtMs =
    new Date(
      input.decisionAt,
    ).getTime();

  if (!Number.isFinite(decisionAtMs)) {
    throw new Error(
      `INVALID_DECISION_AT:${input.decisionAt}`,
    );
  }

  const lookbackRows =
    Math.max(
      5,
      Math.min(
        60,
        Math.floor(
          input.lookbackRows ?? 20,
        ),
      ),
    );

  const availableAtMs = (
    tradingDate: string,
  ) =>
    new Date(
      `${tradingDate}T15:00:00.000Z`,
    ).getTime();

  const numeric = (
    value:
      | number
      | string
      | null
      | undefined,
  ): number | null => {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const parsed =
      Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  };

  const grouped =
    new Map<
      string,
      Array<{
        tradingDate: string;
        tradingValueProxy: number;
        fallbackUsed: boolean;
      }>
    >();

  for (const row of input.rows) {
    const stockCode =
      String(
        row.stock_code ?? "",
      ).trim();

    const tradingDate =
      String(
        row.trading_date ?? "",
      ).slice(
        0,
        10,
      );

    if (
      !/^\d{6}$/.test(stockCode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        tradingDate,
      )
    ) {
      continue;
    }

    const rowAvailableAtMs =
      availableAtMs(
        tradingDate,
      );

    if (
      !Number.isFinite(
        rowAvailableAtMs,
      ) ||
      rowAvailableAtMs >
        decisionAtMs
    ) {
      continue;
    }

    const directTradingValue =
      numeric(
        row.trading_value,
      );

    const close =
      numeric(
        row.close_price,
      );

    const volume =
      numeric(
        row.volume,
      );

    const fallbackValue =
      close !== null &&
      close > 0 &&
      volume !== null &&
      volume > 0
        ? close * volume
        : null;

    const tradingValueProxy =
      directTradingValue !== null &&
      directTradingValue > 0
        ? directTradingValue
        : fallbackValue;

    if (
      tradingValueProxy === null ||
      !Number.isFinite(
        tradingValueProxy,
      ) ||
      tradingValueProxy <= 0
    ) {
      continue;
    }

    const current =
      grouped.get(
        stockCode,
      ) ?? [];

    current.push({
      tradingDate,
      tradingValueProxy,
      fallbackUsed:
        !(
          directTradingValue !== null &&
          directTradingValue > 0
        ),
    });

    grouped.set(
      stockCode,
      current,
    );
  }

  const median = (
    values: number[],
  ): number | null => {
    if (
      values.length === 0
    ) {
      return null;
    }

    const sorted =
      [...values].sort(
        (a, b) =>
          a - b,
      );

    const middle =
      Math.floor(
        sorted.length / 2,
      );

    return sorted.length % 2 === 1
      ? sorted[middle]
      : (
          sorted[
            middle - 1
          ] +
          sorted[middle]
        ) / 2;
  };

  const summaries:
    Array<{
      stockCode: string;
      medianTradingValue: number;
      latestTradingValue: number;
      latestTradingDate: string;
      sampleSize: number;
      fallbackRows: number;
    }> =
    [];

  for (
    const [
      stockCode,
      rawRows,
    ]
    of grouped
  ) {
    const rows =
      [...rawRows]
        .sort(
          (
            left,
            right,
          ) =>
            left.tradingDate
              .localeCompare(
                right.tradingDate,
              ),
        )
        .slice(
          -lookbackRows,
        );

    const medianTradingValue =
      median(
        rows.map(
          (row) =>
            row.tradingValueProxy,
        ),
      );

    const latest =
      rows.at(
        -1,
      );

    if (
      medianTradingValue ===
        null ||
      !latest
    ) {
      continue;
    }

    summaries.push({
      stockCode,
      medianTradingValue,
      latestTradingValue:
        latest.tradingValueProxy,
      latestTradingDate:
        latest.tradingDate,
      sampleSize:
        rows.length,
      fallbackRows:
        rows.filter(
          (row) =>
            row.fallbackUsed,
        ).length,
    });
  }

  const target =
    summaries.find(
      (row) =>
        row.stockCode ===
        input.stockCode,
    );

  if (!target) {
    return undefined;
  }

  const peers =
    summaries
      .filter(
        (row) =>
          Number.isFinite(
            row.medianTradingValue,
          ),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.medianTradingValue -
          right.medianTradingValue,
      );

  if (
    peers.length === 0
  ) {
    return undefined;
  }

  const less =
    peers.filter(
      (row) =>
        row.medianTradingValue <
        target.medianTradingValue,
    ).length;

  const equal =
    peers.filter(
      (row) =>
        row.medianTradingValue ===
        target.medianTradingValue,
    ).length;

  const percentile =
    peers.length === 1
      ? 0.5
      : (
          less +
          Math.max(
            0,
            equal - 1,
          ) / 2
        ) /
        (
          peers.length - 1
        );

  const score =
    Math.min(
      1,
      Math.max(
        0,
        percentile,
      ),
    );

  const coverage =
    Math.min(
      1,
      target.sampleSize /
        lookbackRows,
    );

  const peerCoverage =
    Math.min(
      1,
      peers.length / 5,
    );

  const fallbackRate =
    target.sampleSize > 0
      ? target.fallbackRows /
        target.sampleSize
      : 1;

  const confidence =
    Math.min(
      0.95,
      Math.max(
        0.35,
        0.50 +
          coverage * 0.25 +
          peerCoverage * 0.15 -
          fallbackRate * 0.10,
      ),
    );

  const availableAt =
    `${target.latestTradingDate}T15:00:00.000Z`;

  return {
    score,
    confidence,
    availableAt,
    observedAt:
      availableAt,
    source:
      "MARKET_DAILY_BARS_ALPHA_LIQUIDITY",
    sourceVersion:
      "alpha-daily-liquidity-v1",
    maxAgeMinutes:
      14 * 24 * 60,
    metadata: {
      lookbackRows,
      targetSampleSize:
        target.sampleSize,
      peerCount:
        peers.length,
      medianTradingValue:
        target.medianTradingValue,
      latestTradingValue:
        target.latestTradingValue,
      latestToMedianRatio:
        target.medianTradingValue >
        0
          ? target.latestTradingValue /
            target.medianTradingValue
          : null,
      percentile,
      fallbackRows:
        target.fallbackRows,
      fallbackRate,
      limitation:
        "CROSS_SECTIONAL_LIQUIDITY_RANK_WITHIN_AVAILABLE_ACTIVE_UNIVERSE",
    },
  };
}

