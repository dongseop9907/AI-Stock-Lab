export type MarketRegimeFeatureMarket =
  | "KOSPI"
  | "KOSDAQ";

export interface MarketRegimeIndexBar {
  marketCode:
    MarketRegimeFeatureMarket;

  tradingDate: string;
  close: number;
}

export interface MarketRegimeStockBar {
  stockCode: string;
  tradingDate: string;
  close: number;
}

export interface IndexFeatureVector {
  marketCode:
    MarketRegimeFeatureMarket;

  latestDate: string;
  latestClose: number;

  return5: number | null;
  return20: number | null;
  return60: number | null;

  sma20: number | null;
  sma60: number | null;

  distanceFromSma20:
    number | null;

  distanceFromSma60:
    number | null;

  realizedVolatility20:
    number | null;

  drawdown60:
    number | null;

  aboveSma20:
    boolean | null;

  aboveSma60:
    boolean | null;

  sampleSize: number;
}

export interface BreadthFeatureVector {
  latestDate: string | null;

  breadth20: number | null;
  breadth60: number | null;

  sampleSize20: number;
  sampleSize60: number;

  stockCount: number;
}

export interface MarketRegimeFeatureVectorV7 {
  version:
    "MARKET_REGIME_FEATURES_V7";

  latestMarketDate:
    string | null;

  kospi:
    IndexFeatureVector | null;

  kosdaq:
    IndexFeatureVector | null;

  breadth:
    BreadthFeatureVector;

  /*
   * These are raw features only.
   * No production regime/blocking decision is made here.
   */
  productionDecisionApplied:
    false;

  generatedAt: string;
}

function average(
  values: number[],
): number | null {
  if (
    values.length === 0
  ) {
    return null;
  }

  return (
    values.reduce(
      (
        sum,
        value,
      ) => sum + value,
      0,
    ) /
    values.length
  );
}

function sampleStandardDeviation(
  values: number[],
): number | null {
  if (
    values.length < 2
  ) {
    return null;
  }

  const mean =
    average(values);

  if (
    mean === null
  ) {
    return null;
  }

  const variance =
    values.reduce(
      (
        sum,
        value,
      ) =>
        sum +
        (
          value -
          mean
        ) ** 2,
      0,
    ) /
    (
      values.length -
      1
    );

  return Math.sqrt(
    variance,
  );
}

function calculateReturn(
  closes: number[],
  periods: number,
): number | null {
  if (
    closes.length <
    periods + 1
  ) {
    return null;
  }

  const latest =
    closes[
      closes.length - 1
    ];

  const previous =
    closes[
      closes.length -
      1 -
      periods
    ];

  if (
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

function calculateSma(
  closes: number[],
  periods: number,
): number | null {
  if (
    closes.length <
    periods
  ) {
    return null;
  }

  return average(
    closes.slice(
      -periods,
    ),
  );
}

function calculateDistance(
  close: number,
  reference: number | null,
): number | null {
  if (
    reference === null ||
    reference <= 0
  ) {
    return null;
  }

  return (
    close /
    reference -
    1
  );
}

function calculateAnnualizedVolatility(
  closes: number[],
  periods: number,
): number | null {
  if (
    closes.length <
    periods + 1
  ) {
    return null;
  }

  const sample =
    closes.slice(
      -(periods + 1),
    );

  const returns: number[] =
    [];

  for (
    let i = 1;
    i < sample.length;
    i += 1
  ) {
    const previous =
      sample[i - 1];

    const current =
      sample[i];

    if (
      previous <= 0 ||
      current <= 0
    ) {
      continue;
    }

    returns.push(
      current /
        previous -
        1,
    );
  }

  const standardDeviation =
    sampleStandardDeviation(
      returns,
    );

  if (
    standardDeviation === null
  ) {
    return null;
  }

  return (
    standardDeviation *
    Math.sqrt(252)
  );
}

function calculateDrawdown(
  closes: number[],
  periods: number,
): number | null {
  if (
    closes.length === 0
  ) {
    return null;
  }

  const sample =
    closes.slice(
      -Math.min(
        periods,
        closes.length,
      ),
    );

  if (
    sample.length === 0
  ) {
    return null;
  }

  const peak =
    Math.max(
      ...sample,
    );

  const latest =
    sample[
      sample.length - 1
    ];

  if (
    peak <= 0
  ) {
    return null;
  }

  return (
    latest /
    peak -
    1
  );
}

function normalizeIndexBars(
  bars:
    MarketRegimeIndexBar[],
): MarketRegimeIndexBar[] {
  return [
    ...bars,
  ]
    .filter(
      (bar) =>
        Boolean(
          bar.tradingDate,
        ) &&
        Number.isFinite(
          bar.close,
        ) &&
        bar.close > 0,
    )
    .sort(
      (
        left,
        right,
      ) =>
        left.tradingDate.localeCompare(
          right.tradingDate,
        ),
    );
}

export function calculateIndexFeatureVector(
  marketCode:
    MarketRegimeFeatureMarket,
  bars:
    MarketRegimeIndexBar[],
): IndexFeatureVector | null {
  const normalized =
    normalizeIndexBars(
      bars.filter(
        (bar) =>
          bar.marketCode ===
          marketCode,
      ),
    );

  if (
    normalized.length === 0
  ) {
    return null;
  }

  const closes =
    normalized.map(
      (bar) =>
        bar.close,
    );

  const latest =
    normalized[
      normalized.length - 1
    ];

  const latestClose =
    latest.close;

  const sma20 =
    calculateSma(
      closes,
      20,
    );

  const sma60 =
    calculateSma(
      closes,
      60,
    );

  return {
    marketCode,

    latestDate:
      latest.tradingDate,

    latestClose,

    return5:
      calculateReturn(
        closes,
        5,
      ),

    return20:
      calculateReturn(
        closes,
        20,
      ),

    return60:
      calculateReturn(
        closes,
        60,
      ),

    sma20,
    sma60,

    distanceFromSma20:
      calculateDistance(
        latestClose,
        sma20,
      ),

    distanceFromSma60:
      calculateDistance(
        latestClose,
        sma60,
      ),

    realizedVolatility20:
      calculateAnnualizedVolatility(
        closes,
        20,
      ),

    drawdown60:
      calculateDrawdown(
        closes,
        60,
      ),

    aboveSma20:
      sma20 === null
        ? null
        : latestClose >
          sma20,

    aboveSma60:
      sma60 === null
        ? null
        : latestClose >
          sma60,

    sampleSize:
      normalized.length,
  };
}

function groupStockBars(
  bars:
    MarketRegimeStockBar[],
) {
  const grouped =
    new Map<
      string,
      MarketRegimeStockBar[]
    >();

  for (
    const bar
    of bars
  ) {
    if (
      !bar.stockCode ||
      !bar.tradingDate ||
      !Number.isFinite(
        bar.close,
      ) ||
      bar.close <= 0
    ) {
      continue;
    }

    const current =
      grouped.get(
        bar.stockCode,
      ) ??
      [];

    current.push(
      bar,
    );

    grouped.set(
      bar.stockCode,
      current,
    );
  }

  for (
    const [
      stockCode,
      stockBars,
    ]
    of grouped
  ) {
    grouped.set(
      stockCode,
      stockBars.sort(
        (
          left,
          right,
        ) =>
          left.tradingDate.localeCompare(
            right.tradingDate,
          ),
      ),
    );
  }

  return grouped;
}

export function calculateBreadthFeatureVector(
  bars:
    MarketRegimeStockBar[],
): BreadthFeatureVector {
  const grouped =
    groupStockBars(
      bars,
    );

  let above20 = 0;
  let above60 = 0;

  let sampleSize20 = 0;
  let sampleSize60 = 0;

  let latestDate:
    string | null =
      null;

  for (
    const stockBars
    of grouped.values()
  ) {
    if (
      stockBars.length === 0
    ) {
      continue;
    }

    const latest =
      stockBars[
        stockBars.length - 1
      ];

    if (
      latestDate === null ||
      latest.tradingDate >
        latestDate
    ) {
      latestDate =
        latest.tradingDate;
    }

    const closes =
      stockBars.map(
        (bar) =>
          bar.close,
      );

    const sma20 =
      calculateSma(
        closes,
        20,
      );

    if (
      sma20 !== null
    ) {
      sampleSize20 += 1;

      if (
        latest.close >
        sma20
      ) {
        above20 += 1;
      }
    }

    const sma60 =
      calculateSma(
        closes,
        60,
      );

    if (
      sma60 !== null
    ) {
      sampleSize60 += 1;

      if (
        latest.close >
        sma60
      ) {
        above60 += 1;
      }
    }
  }

  return {
    latestDate,

    breadth20:
      sampleSize20 > 0
        ? above20 /
          sampleSize20
        : null,

    breadth60:
      sampleSize60 > 0
        ? above60 /
          sampleSize60
        : null,

    sampleSize20,
    sampleSize60,

    stockCount:
      grouped.size,
  };
}

export function calculateMarketRegimeFeatureVectorV7(
  input: {
    indexBars:
      MarketRegimeIndexBar[];

    stockBars:
      MarketRegimeStockBar[];
  },
): MarketRegimeFeatureVectorV7 {
  const kospi =
    calculateIndexFeatureVector(
      "KOSPI",
      input.indexBars,
    );

  const kosdaq =
    calculateIndexFeatureVector(
      "KOSDAQ",
      input.indexBars,
    );

  const breadth =
    calculateBreadthFeatureVector(
      input.stockBars,
    );

  const latestMarketDate =
    [
      kospi?.latestDate,
      kosdaq?.latestDate,
      breadth.latestDate,
    ]
      .filter(
        (
          value,
        ): value is string =>
          Boolean(value),
      )
      .sort()
      .at(-1) ??
    null;

  return {
    version:
      "MARKET_REGIME_FEATURES_V7",

    latestMarketDate,

    kospi,
    kosdaq,
    breadth,

    productionDecisionApplied:
      false,

    generatedAt:
      new Date()
        .toISOString(),
  };
}