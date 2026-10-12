#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_DAILY_MARKET_FEATURES_INSTALLER';

const adapter =
  "import type {\n  AlphaFeatureEvidence,\n} from \"./candidate-scoring\";\n\nexport interface DailyAlphaBarLike {\n  stock_code: string;\n  trading_date: string;\n  open_price: number | string | null;\n  high_price: number | string | null;\n  low_price: number | string | null;\n  close_price: number | string | null;\n  volume: number | string | null;\n  trading_value?: number | string | null;\n  adjusted_price?: boolean | null;\n  source?: string | null;\n  updated_at?: string | null;\n}\n\nexport interface V7MarketIndexFeatureLike {\n  return20?: number | null;\n  return60?: number | null;\n  realizedVolatility20?: number | null;\n  drawdown60?: number | null;\n}\n\nexport interface V7MarketRegimeFeatureVectorLike {\n  latestMarketDate: string;\n\n  breadth: {\n    breadth20: number | null;\n    breadth60: number | null;\n  };\n\n  kospi?: V7MarketIndexFeatureLike | null;\n  kosdaq?: V7MarketIndexFeatureLike | null;\n\n  dataSource?: {\n    index?: string;\n    breadth?: string;\n    activeStockCount?: number;\n    historyStartDate?: string;\n  };\n}\n\nexport interface V7PolicyEvaluationLike {\n  version?: string;\n  policy?: string;\n  blocked: boolean;\n  inputsComplete: boolean;\n  reasons?: string[];\n\n  features?: {\n    latestMarketDate?: string | null;\n    breadth20?: number | null;\n    breadth60?: number | null;\n    kospiReturn20?: number | null;\n    kospiReturn60?: number | null;\n    kosdaqReturn20?: number | null;\n    kosdaqReturn60?: number | null;\n    averageVolatility20?: number | null;\n    kospiDrawdown60?: number | null;\n    kosdaqDrawdown60?: number | null;\n  };\n}\n\nfunction clamp01(\n  value: number,\n): number {\n  return Math.min(\n    1,\n    Math.max(\n      0,\n      value,\n    ),\n  );\n}\n\nfunction scale(\n  value: number | null,\n  low: number,\n  high: number,\n): number {\n  if (\n    value === null ||\n    !Number.isFinite(value)\n  ) {\n    return 0.5;\n  }\n\n  if (high <= low) {\n    return 0.5;\n  }\n\n  return clamp01(\n    (value - low) /\n    (high - low),\n  );\n}\n\nfunction averageNullable(\n  values: Array<number | null>,\n): number | null {\n  const usable =\n    values.filter(\n      (\n        value,\n      ): value is number =>\n        value !== null &&\n        Number.isFinite(value),\n    );\n\n  if (usable.length === 0) {\n    return null;\n  }\n\n  return (\n    usable.reduce(\n      (sum, value) =>\n        sum + value,\n      0,\n    ) /\n    usable.length\n  );\n}\n\nfunction toNumber(\n  value:\n    | number\n    | string\n    | null\n    | undefined,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\n/**\n * Conservative completed-daily-bar availability:\n * the final value for a Korean trading date becomes Alpha-usable\n * at 00:00 KST on the following calendar day.\n *\n * 00:00 KST next day = 15:00 UTC on trading date.\n */\nfunction completedTradingDateAvailableAt(\n  sqlDate: string,\n): string | null {\n  if (\n    !/^\\d{4}-\\d{2}-\\d{2}$/.test(\n      sqlDate,\n    )\n  ) {\n    return null;\n  }\n\n  const [\n    year,\n    month,\n    day,\n  ] =\n    sqlDate\n      .split(\"-\")\n      .map(Number);\n\n  const milliseconds =\n    Date.UTC(\n      year,\n      month - 1,\n      day,\n      15,\n      0,\n      0,\n      0,\n    );\n\n  const result =\n    new Date(\n      milliseconds,\n    );\n\n  return Number.isFinite(\n    result.getTime(),\n  )\n    ? result.toISOString()\n    : null;\n}\n\nfunction returnOverBars(\n  rows: Array<{\n    close: number;\n  }>,\n  periods: number,\n): number | null {\n  if (\n    rows.length <=\n    periods\n  ) {\n    return null;\n  }\n\n  const latest =\n    rows.at(-1)\n      ?.close;\n\n  const previous =\n    rows[\n      rows.length -\n      1 -\n      periods\n    ]?.close;\n\n  if (\n    latest === undefined ||\n    previous === undefined ||\n    previous <= 0\n  ) {\n    return null;\n  }\n\n  return (\n    latest /\n    previous -\n    1\n  );\n}\n\nexport function buildV7MarketRegimeEvidence(\n  input: {\n    decisionAt: string;\n    features: V7MarketRegimeFeatureVectorLike;\n    policy: V7PolicyEvaluationLike;\n  },\n): AlphaFeatureEvidence | undefined {\n  const availableAt =\n    completedTradingDateAvailableAt(\n      input.features\n        .latestMarketDate,\n    );\n\n  if (!availableAt) {\n    return undefined;\n  }\n\n  const decisionAtMs =\n    new Date(\n      input.decisionAt,\n    ).getTime();\n\n  const availableAtMs =\n    new Date(\n      availableAt,\n    ).getTime();\n\n  if (\n    !Number.isFinite(\n      decisionAtMs,\n    ) ||\n    !Number.isFinite(\n      availableAtMs,\n    ) ||\n    availableAtMs >\n      decisionAtMs\n  ) {\n    return undefined;\n  }\n\n  const breadth20 =\n    input.features\n      .breadth\n      .breadth20;\n\n  const breadth60 =\n    input.features\n      .breadth\n      .breadth60;\n\n  const averageReturn20 =\n    averageNullable([\n      input.features\n        .kospi\n        ?.return20 ??\n        null,\n\n      input.features\n        .kosdaq\n        ?.return20 ??\n        null,\n    ]);\n\n  const averageReturn60 =\n    averageNullable([\n      input.features\n        .kospi\n        ?.return60 ??\n        null,\n\n      input.features\n        .kosdaq\n        ?.return60 ??\n        null,\n    ]);\n\n  const averageVolatility20 =\n    averageNullable([\n      input.features\n        .kospi\n        ?.realizedVolatility20 ??\n        null,\n\n      input.features\n        .kosdaq\n        ?.realizedVolatility20 ??\n        null,\n    ]);\n\n  const averageDrawdown60 =\n    averageNullable([\n      input.features\n        .kospi\n        ?.drawdown60 ??\n        null,\n\n      input.features\n        .kosdaq\n        ?.drawdown60 ??\n        null,\n    ]);\n\n  const breadth20Score =\n    scale(\n      breadth20,\n      0.25,\n      0.75,\n    );\n\n  const breadth60Score =\n    scale(\n      breadth60,\n      0.20,\n      0.75,\n    );\n\n  const return20Score =\n    scale(\n      averageReturn20,\n      -0.10,\n      0.15,\n    );\n\n  const return60Score =\n    scale(\n      averageReturn60,\n      -0.20,\n      0.30,\n    );\n\n  /**\n   * Lower realized volatility is better for candidate selection.\n   */\n  const volatilityScore =\n    averageVolatility20 ===\n      null\n      ? 0.5\n      : clamp01(\n          1 -\n          scale(\n            averageVolatility20,\n            0.05,\n            0.40,\n          ),\n        );\n\n  /**\n   * 0 drawdown is strongest; -30% or worse maps to 0.\n   */\n  const drawdownScore =\n    scale(\n      averageDrawdown60,\n      -0.30,\n      0,\n    );\n\n  let score =\n    clamp01(\n      breadth20Score *\n        0.30 +\n      breadth60Score *\n        0.10 +\n      return20Score *\n        0.20 +\n      return60Score *\n        0.10 +\n      volatilityScore *\n        0.15 +\n      drawdownScore *\n        0.15,\n    );\n\n  /**\n   * Reuse the existing V7 policy as a guardrail without duplicating\n   * its blocking logic. A blocked regime cannot become a strongly\n   * positive Alpha regime feature.\n   */\n  if (\n    input.policy.blocked\n  ) {\n    score =\n      Math.min(\n        score,\n        0.45,\n      );\n  }\n\n  const rawCompleteness = [\n    breadth20,\n    breadth60,\n    averageReturn20,\n    averageReturn60,\n    averageVolatility20,\n    averageDrawdown60,\n  ].filter(\n    (value) =>\n      value !== null &&\n      Number.isFinite(value),\n  ).length /\n  6;\n\n  const confidence =\n    clamp01(\n      0.60 +\n      rawCompleteness *\n        0.30 +\n      (\n        input.policy\n          .inputsComplete\n          ? 0.05\n          : 0\n      ),\n    );\n\n  return {\n    score,\n    confidence,\n\n    availableAt,\n    observedAt:\n      availableAt,\n\n    source:\n      \"MARKET_REGIME_V7_DAILY_BARS\",\n\n    sourceVersion:\n      input.policy\n        .version ??\n      \"MARKET_REGIME_POLICY_V7_1\",\n\n    maxAgeMinutes:\n      10 *\n      24 *\n      60,\n\n    metadata: {\n      latestMarketDate:\n        input.features\n          .latestMarketDate,\n\n      policy:\n        input.policy\n          .policy ??\n        null,\n\n      blocked:\n        input.policy\n          .blocked,\n\n      inputsComplete:\n        input.policy\n          .inputsComplete,\n\n      reasons:\n        input.policy\n          .reasons ??\n        [],\n\n      breadth20,\n      breadth60,\n      averageReturn20,\n      averageReturn60,\n      averageVolatility20,\n      averageDrawdown60,\n\n      components: {\n        breadth20Score,\n        breadth60Score,\n        return20Score,\n        return60Score,\n        volatilityScore,\n        drawdownScore,\n      },\n\n      dataSource:\n        input.features\n          .dataSource ??\n        null,\n    },\n  };\n}\n\nexport function buildDailyPriceVolumeEvidence(\n  input: {\n    stockCode: string;\n    market: string | null | undefined;\n    decisionAt: string;\n    rows: DailyAlphaBarLike[];\n    v7Features: V7MarketRegimeFeatureVectorLike;\n  },\n): AlphaFeatureEvidence | undefined {\n  const decisionAtMs =\n    new Date(\n      input.decisionAt,\n    ).getTime();\n\n  if (\n    !Number.isFinite(\n      decisionAtMs,\n    )\n  ) {\n    throw new Error(\n      `INVALID_DECISION_AT:${input.decisionAt}`,\n    );\n  }\n\n  const stockCode =\n    String(\n      input.stockCode,\n    )\n      .trim()\n      .padStart(\n        6,\n        \"0\",\n      );\n\n  const usable =\n    input.rows\n      .filter(\n        (row) =>\n          String(\n            row.stock_code,\n          )\n            .trim()\n            .padStart(\n              6,\n              \"0\",\n            ) ===\n          stockCode,\n      )\n      .map(\n        (row) => {\n          const open =\n            toNumber(\n              row.open_price,\n            );\n\n          const high =\n            toNumber(\n              row.high_price,\n            );\n\n          const low =\n            toNumber(\n              row.low_price,\n            );\n\n          const close =\n            toNumber(\n              row.close_price,\n            );\n\n          const volume =\n            toNumber(\n              row.volume,\n            );\n\n          const availableAt =\n            completedTradingDateAvailableAt(\n              String(\n                row.trading_date,\n              ),\n            );\n\n          return {\n            tradingDate:\n              String(\n                row.trading_date,\n              ),\n\n            availableAt,\n\n            open,\n            high,\n            low,\n            close,\n            volume,\n\n            adjusted:\n              row.adjusted_price ===\n              true,\n\n            source:\n              row.source ??\n              null,\n          };\n        },\n      )\n      .filter(\n        (\n          row,\n        ): row is {\n          tradingDate: string;\n          availableAt: string;\n          open: number;\n          high: number;\n          low: number;\n          close: number;\n          volume: number;\n          adjusted: boolean;\n          source: string | null;\n        } => {\n          if (\n            row.availableAt ===\n              null ||\n            row.open ===\n              null ||\n            row.high ===\n              null ||\n            row.low ===\n              null ||\n            row.close ===\n              null ||\n            row.volume ===\n              null ||\n            !row.adjusted\n          ) {\n            return false;\n          }\n\n          const availableMs =\n            new Date(\n              row.availableAt,\n            ).getTime();\n\n          return (\n            Number.isFinite(\n              availableMs,\n            ) &&\n            availableMs <=\n              decisionAtMs &&\n            row.open >\n              0 &&\n            row.high >\n              0 &&\n            row.low >\n              0 &&\n            row.close >\n              0 &&\n            row.volume >=\n              0\n          );\n        },\n      )\n      .sort(\n        (a, b) =>\n          a.tradingDate\n            .localeCompare(\n              b.tradingDate,\n            ),\n      );\n\n  if (\n    usable.length <\n    61\n  ) {\n    return undefined;\n  }\n\n  const latest =\n    usable.at(-1);\n\n  if (!latest) {\n    return undefined;\n  }\n\n  const return20 =\n    returnOverBars(\n      usable,\n      20,\n    );\n\n  const return60 =\n    returnOverBars(\n      usable,\n      60,\n    );\n\n  if (\n    return20 === null ||\n    return60 === null\n  ) {\n    return undefined;\n  }\n\n  const marketNormalized =\n    String(\n      input.market ??\n      \"\",\n    )\n      .trim()\n      .toUpperCase();\n\n  const benchmark =\n    marketNormalized.includes(\n      \"KOSDAQ\",\n    )\n      ? input\n          .v7Features\n          .kosdaq\n      : input\n          .v7Features\n          .kospi;\n\n  const benchmarkReturn20 =\n    benchmark\n      ?.return20 ??\n    null;\n\n  const benchmarkReturn60 =\n    benchmark\n      ?.return60 ??\n    null;\n\n  const relativeStrength20 =\n    benchmarkReturn20 ===\n      null\n      ? null\n      : return20 -\n        benchmarkReturn20;\n\n  const relativeStrength60 =\n    benchmarkReturn60 ===\n      null\n      ? null\n      : return60 -\n        benchmarkReturn60;\n\n  const recentFive =\n    usable.slice(\n      -5,\n    );\n\n  const baselineTwenty =\n    usable.slice(\n      -25,\n      -5,\n    );\n\n  const recentFiveAverageVolume =\n    recentFive.reduce(\n      (sum, row) =>\n        sum + row.volume,\n      0,\n    ) /\n    recentFive.length;\n\n  const baselineTwentyAverageVolume =\n    baselineTwenty.length >\n      0\n      ? (\n          baselineTwenty.reduce(\n            (sum, row) =>\n              sum + row.volume,\n            0,\n          ) /\n          baselineTwenty.length\n        )\n      : 0;\n\n  const volumeExpansion =\n    baselineTwentyAverageVolume >\n      0\n      ? recentFiveAverageVolume /\n        baselineTwentyAverageVolume\n      : 1;\n\n  const rangeRows =\n    usable.slice(\n      -61,\n    );\n\n  const rangeHigh =\n    Math.max(\n      ...rangeRows.map(\n        (row) =>\n          row.high,\n      ),\n    );\n\n  const rangeLow =\n    Math.min(\n      ...rangeRows.map(\n        (row) =>\n          row.low,\n      ),\n    );\n\n  const rangePosition60 =\n    rangeHigh >\n      rangeLow\n      ? clamp01(\n          (\n            latest.close -\n            rangeLow\n          ) /\n          (\n            rangeHigh -\n            rangeLow\n          ),\n        )\n      : 0.5;\n\n  const return20Score =\n    scale(\n      return20,\n      -0.12,\n      0.18,\n    );\n\n  const return60Score =\n    scale(\n      return60,\n      -0.20,\n      0.35,\n    );\n\n  const relativeStrength20Score =\n    scale(\n      relativeStrength20,\n      -0.08,\n      0.12,\n    );\n\n  const relativeStrength60Score =\n    scale(\n      relativeStrength60,\n      -0.12,\n      0.20,\n    );\n\n  const volumeExpansionScore =\n    scale(\n      volumeExpansion,\n      0.70,\n      1.60,\n    );\n\n  const score =\n    clamp01(\n      return20Score *\n        0.15 +\n      return60Score *\n        0.15 +\n      relativeStrength20Score *\n        0.25 +\n      relativeStrength60Score *\n        0.20 +\n      volumeExpansionScore *\n        0.15 +\n      rangePosition60 *\n        0.10,\n    );\n\n  const benchmarkCompleteness =\n    (\n      benchmarkReturn20 !==\n        null &&\n      benchmarkReturn60 !==\n        null\n    )\n      ? 1\n      : 0;\n\n  const historyCoverage =\n    clamp01(\n      usable.length /\n      85,\n    );\n\n  const confidence =\n    clamp01(\n      0.65 +\n      historyCoverage *\n        0.20 +\n      benchmarkCompleteness *\n        0.10,\n    );\n\n  return {\n    score,\n    confidence,\n\n    availableAt:\n      latest.availableAt,\n\n    observedAt:\n      latest.availableAt,\n\n    source:\n      \"MARKET_DAILY_BARS_ALPHA_PRICE_VOLUME\",\n\n    sourceVersion:\n      \"alpha-daily-pv-v1\",\n\n    maxAgeMinutes:\n      10 *\n      24 *\n      60,\n\n    metadata: {\n      stockCode,\n      market:\n        marketNormalized ||\n        null,\n\n      latestTradingDate:\n        latest.tradingDate,\n\n      usableBars:\n        usable.length,\n\n      return20,\n      return60,\n\n      benchmarkReturn20,\n      benchmarkReturn60,\n\n      relativeStrength20,\n      relativeStrength60,\n\n      recentFiveAverageVolume,\n      baselineTwentyAverageVolume,\n      volumeExpansion,\n\n      rangeHigh60:\n        rangeHigh,\n\n      rangeLow60:\n        rangeLow,\n\n      rangePosition60,\n\n      components: {\n        return20Score,\n        return60Score,\n        relativeStrength20Score,\n        relativeStrength60Score,\n        volumeExpansionScore,\n        rangePosition60,\n      },\n\n      separationContract:\n        \"ALPHA_DAILY_MULTI_DAY_NOT_ENTRY_TIMING_INTRADAY\",\n    },\n  };\n}\n";

const smoke =
  "import assert from \"node:assert/strict\";\n\nimport {\n  buildDailyPriceVolumeEvidence,\n  buildV7MarketRegimeEvidence,\n  type DailyAlphaBarLike,\n} from \"../lib/alpha/daily-market-adapters\";\n\nconst decisionAt =\n  \"2026-10-06T06:30:00.000Z\";\n\nconst bars:\n  DailyAlphaBarLike[] =\n  [];\n\nconst start =\n  new Date(\n    \"2026-06-15T00:00:00.000Z\",\n  );\n\nlet generated = 0;\nlet cursor =\n  new Date(start);\n\nwhile (\n  generated <\n  85\n) {\n  const day =\n    cursor.getUTCDay();\n\n  if (\n    day !== 0 &&\n    day !== 6\n  ) {\n    const base =\n      100000 +\n      generated *\n        700;\n\n    bars.push({\n      stock_code:\n        \"005930\",\n\n      trading_date:\n        cursor\n          .toISOString()\n          .slice(\n            0,\n            10,\n          ),\n\n      open_price:\n        base - 300,\n\n      high_price:\n        base + 700,\n\n      low_price:\n        base - 800,\n\n      close_price:\n        base,\n\n      volume:\n        1000000 +\n        Math.max(\n          0,\n          generated - 60,\n        ) *\n          35000,\n\n      trading_value:\n        base *\n        1000000,\n\n      adjusted_price:\n        true,\n\n      source:\n        \"KIS_DAILY_V8_3\",\n    });\n\n    generated += 1;\n  }\n\n  cursor.setUTCDate(\n    cursor.getUTCDate() +\n    1,\n  );\n}\n\nconst v7Features = {\n  latestMarketDate:\n    bars.at(-1)!\n      .trading_date,\n\n  breadth: {\n    breadth20:\n      0.68,\n\n    breadth60:\n      0.62,\n  },\n\n  kospi: {\n    return20:\n      0.045,\n\n    return60:\n      0.09,\n\n    realizedVolatility20:\n      0.16,\n\n    drawdown60:\n      -0.06,\n  },\n\n  kosdaq: {\n    return20:\n      0.02,\n\n    return60:\n      0.04,\n\n    realizedVolatility20:\n      0.20,\n\n    drawdown60:\n      -0.09,\n  },\n\n  dataSource: {\n    index:\n      \"market_index_daily_bars\",\n\n    breadth:\n      \"market_daily_bars\",\n\n    activeStockCount:\n      5,\n\n    historyStartDate:\n      \"2026-05-01\",\n  },\n};\n\nconst policy = {\n  version:\n    \"MARKET_REGIME_POLICY_V7_1\",\n\n  policy:\n    \"BLOCK_BREADTH_OR_HIGH_VOL\",\n\n  blocked:\n    false,\n\n  inputsComplete:\n    true,\n\n  reasons:\n    [],\n};\n\nconst regime =\n  buildV7MarketRegimeEvidence({\n    decisionAt,\n    features:\n      v7Features,\n    policy,\n  });\n\nassert(\n  regime,\n  \"V7 regime evidence missing\",\n);\n\nassert.equal(\n  regime.source,\n  \"MARKET_REGIME_V7_DAILY_BARS\",\n);\n\nassert(\n  regime.score >\n    0.5,\n  \"bullish V7 fixture should score above neutral\",\n);\n\nconst priceVolume =\n  buildDailyPriceVolumeEvidence({\n    stockCode:\n      \"005930\",\n\n    market:\n      \"KOSPI\",\n\n    decisionAt,\n\n    rows:\n      bars,\n\n    v7Features,\n  });\n\nassert(\n  priceVolume,\n  \"daily price-volume evidence missing\",\n);\n\nassert.equal(\n  priceVolume.source,\n  \"MARKET_DAILY_BARS_ALPHA_PRICE_VOLUME\",\n);\n\nassert(\n  Number(\n    priceVolume.metadata\n      ?.usableBars,\n  ) >=\n    61,\n);\n\nassert(\n  Number(\n    priceVolume.metadata\n      ?.relativeStrength20,\n  ) >\n    0,\n  \"rising stock should outperform benchmark in fixture\",\n);\n\nassert(\n  priceVolume.score >\n    0.55,\n  \"positive multi-day fixture should score above neutral\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"ALPHA_V1_DAILY_MARKET_ADAPTERS_SMOKE_PASS\",\n\n      marketRegime: {\n        score:\n          regime.score,\n\n        confidence:\n          regime.confidence,\n\n        source:\n          regime.source,\n\n        metadata:\n          regime.metadata,\n      },\n\n      priceVolume: {\n        score:\n          priceVolume.score,\n\n        confidence:\n          priceVolume.confidence,\n\n        source:\n          priceVolume.source,\n\n        metadata:\n          priceVolume.metadata,\n      },\n\n      separation: {\n        alpha:\n          \"MARKET_DAILY_BARS_MULTI_DAY\",\n\n        marketRegime:\n          \"EXISTING_V7_DAILY_BAR_ENGINE\",\n\n        entryTiming:\n          \"MARKET_SNAPSHOTS_INTRADAY_UNCHANGED\",\n      },\n\n      safety: {\n        databaseReads:\n          0,\n\n        databaseWrites:\n          0,\n\n        networkRequests:\n          0,\n\n        ordersCreated:\n          0,\n      },\n\n      nextGate:\n        \"ALPHA_V1_REAL_DAILY_ALPHA_RUNNER\",\n    },\n    null,\n    2,\n  ),\n);\n";

function writeAtomic(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const temp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    content,
    'utf8',
  );

  fs.renameSync(
    temp,
    file,
  );
}

function replaceOnce(
  text,
  needle,
  replacement,
  label,
) {
  const count =
    text.split(needle).length -
    1;

  if (count !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return text.replace(
    needle,
    replacement,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  writeAtomic(
    path.join(
      root,
      'lib',
      'alpha',
      'daily-market-adapters.ts',
    ),
    adapter,
  );

  writeAtomic(
    path.join(
      root,
      'scripts',
      'alpha-v1-daily-market-adapters-smoke.ts',
    ),
    smoke,
  );

  const sourceRunner =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-kis-flow-read-only.ts',
    );

  const targetRunner =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-daily-alpha-read-only.ts',
    );

  let code =
    fs.readFileSync(
      sourceRunner,
      'utf8',
    );

  code =
    replaceOnce(
      code,
      `const VERSION =
  "ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY";`,
      `const VERSION =
  "ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY";`,
      'VERSION',
    );

  code =
    replaceOnce(
      code,
      `import {
  getDomesticInvestorTrend,
  getKisAccessToken,
  type KisDomesticInvestorTrendOutput,
} from "../lib/kis/client";`,
      `import {
  getDomesticInvestorTrend,
  getKisAccessToken,
  type KisDomesticInvestorTrendOutput,
} from "../lib/kis/client";

import {
  buildDailyPriceVolumeEvidence,
  buildV7MarketRegimeEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

import {
  getCurrentMarketRegimeFeaturesV7,
} from "../lib/market/get-current-market-regime-features-v7";

import {
  evaluateMarketRegimeV7Policy,
} from "../lib/market/market-regime-v7-policy";`,
      'IMPORTS',
    );

  const helper = `
function subtractCalendarDaysForAlpha(
  isoDateTime: string,
  days: number,
): string {
  const date =
    new Date(
      isoDateTime,
    );

  date.setUTCDate(
    date.getUTCDate() -
    days,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

async function readDailyAlphaBars(
  supabase: SupabaseClient,
  stockCodes: string[],
  decisionAt: string,
): Promise<DailyAlphaBarLike[]> {
  const startDate =
    subtractCalendarDaysForAlpha(
      decisionAt,
      180,
    );

  const endDate =
    new Date(
      decisionAt,
    )
      .toISOString()
      .slice(
        0,
        10,
      );

  const result =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(\`
        stock_code,
        trading_date,
        open_price,
        high_price,
        low_price,
        close_price,
        volume,
        trading_value,
        adjusted_price,
        source,
        updated_at
      \`)
      .in(
        "stock_code",
        stockCodes,
      )
      .gte(
        "trading_date",
        startDate,
      )
      .lte(
        "trading_date",
        endDate,
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      )
      .limit(
        5000,
      );

  if (result.error) {
    throw new Error(
      \`MARKET_DAILY_BARS_ALPHA_READ_FAILED:\${result.error.message}\`,
    );
  }

  return (
    result.data ??
    []
  ) as DailyAlphaBarLike[];
}

`;

  code =
    replaceOnce(
      code,
      `function printCompact(
  value: unknown,
) {`,
      `${helper}function printCompact(
  value: unknown,
) {`,
      'DAILY_BAR_HELPER',
    );

  code =
    replaceOnce(
      code,
      `  const regime =
    computeMarketRegimeProxy(
      snapshots,
      stockCodes,
    );

  const kisFlow =`,
      `  const legacyRegimeProxy =
    computeMarketRegimeProxy(
      snapshots,
      stockCodes,
    );

  const dailyAlphaBars =
    await readDailyAlphaBars(
      supabase,
      stockCodes,
      config.decisionAt,
    );

  const v7RegimeFeatures =
    await getCurrentMarketRegimeFeaturesV7();

  const v7RegimePolicy =
    evaluateMarketRegimeV7Policy(
      "BLOCK_BREADTH_OR_HIGH_VOL",
      v7RegimeFeatures,
    );

  const v7RegimeEvidence =
    buildV7MarketRegimeEvidence({
      decisionAt:
        config.decisionAt,

      features:
        v7RegimeFeatures,

      policy:
        v7RegimePolicy,
    });

  const kisFlow =`,
      'MAIN_V7_SETUP',
    );

  code =
    replaceOnce(
      code,
      `        const candidateInput =
          buildAlphaCandidateInputFromRealSources({`,
      `        const stockMetadata =
          stockResult.stocks.find(
            (stock) =>
              stock.stock_code ===
              stockCode,
          );

        const dailyPriceVolumeEvidence =
          buildDailyPriceVolumeEvidence({
            stockCode,

            market:
              stockMetadata
                ?.market ??
              null,

            decisionAt:
              config.decisionAt,

            rows:
              dailyAlphaBars,

            v7Features:
              v7RegimeFeatures,
          });

        const legacyCandidateInput =
          buildAlphaCandidateInputFromRealSources({`,
      'CANDIDATE_PREP',
    );

  code =
    replaceOnce(
      code,
      `          marketRegimeShadow:
            regime,`,
      `          marketRegimeShadow:
            legacyRegimeProxy,`,
      'LEGACY_REGIME_PASS',
    );

  code =
    replaceOnce(
      code,
      `          modelVersion:
            "alpha-v1-real-runner-readonly",
        });`,
      `          modelVersion:
            "alpha-v1-real-runner-daily-alpha-readonly",
        });

        const candidateInput =
          {
            ...legacyCandidateInput,

            features: {
              ...legacyCandidateInput.features,

              marketRegime:
                v7RegimeEvidence,

              priceVolume:
                dailyPriceVolumeEvidence,
            },
          } as
            typeof legacyCandidateInput;

        const sourcePresence =
          (
            candidateInput
              .metadata as
              Record<string, any>
          )
            ?.sourcePresence;

        if (
          sourcePresence &&
          typeof sourcePresence ===
            "object"
        ) {
          sourcePresence.marketRegime =
            Boolean(
              v7RegimeEvidence,
            );

          sourcePresence.priceVolume =
            Boolean(
              dailyPriceVolumeEvidence,
            );
        }`,
      'CANDIDATE_OVERRIDE',
    );

  code =
    replaceOnce(
      code,
      `      marketRegime:
        regime
          ? "CONNECTED_READ_ONLY_SNAPSHOT_PROXY"
          : "UNAVAILABLE",

      priceVolume:
        "CONNECTED_MARKET_SNAPSHOTS",`,
      `      marketRegime:
        v7RegimeEvidence
          ? "CONNECTED_EXISTING_V7_DAILY_BAR_ENGINE"
          : "UNAVAILABLE",

      priceVolume:
        "CONNECTED_MARKET_DAILY_BARS_MULTI_DAY",`,
      'SOURCE_STATUS',
    );

  code =
    replaceOnce(
      code,
      `    regime,`,
      `    regime: {
      evidence:
        v7RegimeEvidence,

      policy:
        v7RegimePolicy,

      features:
        v7RegimeFeatures,

      legacySnapshotProxy:
        legacyRegimeProxy,
    },`,
      'REPORT_REGIME',
    );

  code =
    replaceOnce(
      code,
      `        normalizedPredictions:
          predictionResult.normalized.length,
      },`,
      `        normalizedPredictions:
          predictionResult.normalized.length,

        marketDailyBars:
          dailyAlphaBars.length,

        v7LatestMarketDate:
          v7RegimeFeatures
            .latestMarketDate,
      },`,
      'DATABASE_COUNTS',
    );

  code =
    replaceOnce(
      code,
      `      databaseReads:
        3,`,
      `      databaseReads:
        7,`,
      'SAFETY_DB_READS',
    );

  code =
    replaceOnce(
      code,
      `      networkRequests:
        9,`,
      `      networkRequests:
        13,`,
      'SAFETY_NETWORK',
    );

  code =
    replaceOnce(
      code,
      `      supabaseReadRequests:
        3,`,
      `      supabaseReadRequests:
        7,`,
      'SAFETY_SUPABASE',
    );

  code =
    replaceOnce(
      code,
      `    nextGate:
      "ALPHA_V1_REVIEW_FULL_FEATURE_RANKING_THEN_BIND_PRE_ENTRY_RISK",`,
      `    nextGate:
      "ALPHA_V1_REVIEW_DAILY_ALPHA_RANKING_THEN_BIND_PRE_ENTRY_RISK",`,
      'NEXT_GATE',
    );

  code =
    replaceOnce(
      code,
      `"alpha-v1-real-runner-kis-flow-read-only.json",`,
      `"alpha-v1-real-runner-daily-alpha-read-only.json",`,
      'OUTPUT_FILE_INTERNAL',
    );

  code =
    replaceOnce(
      code,
      `"logs/alpha-v1-real-runner-kis-flow-read-only.json",`,
      `"logs/alpha-v1-real-runner-daily-alpha-read-only.json",`,
      'OUTPUT_FILE_DISPLAY',
    );

  code =
    replaceOnce(
      code,
      `status:
      "ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY_COMPLETE",`,
      `status:
      "ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY_COMPLETE",`,
      'STATUS',
    );

  writeAtomic(
    targetRunner,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_FEATURES_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/alpha/daily-market-adapters.ts',
          'scripts/alpha-v1-daily-market-adapters-smoke.ts',
          'scripts/alpha-v1-real-runner-daily-alpha-read-only.ts',
        ],

        architecture: {
          alphaMarketRegime:
            'EXISTING_V7_DAILY_BAR_ENGINE',

          v7Policy:
            'BLOCK_BREADTH_OR_HIGH_VOL',

          alphaPriceVolume:
            'MARKET_DAILY_BARS_20_60_DAY_MULTI_DAY',

          priceVolumeComponents: [
            'return20',
            'return60',
            'relativeStrength20',
            'relativeStrength60',
            'volumeExpansion5_vs_prior20',
            'rangePosition60',
          ],

          entryTiming:
            'MARKET_SNAPSHOTS_INTRADAY_UNCHANGED',

          liquidity:
            'EXISTING_MARKET_SNAPSHOT_TURNOVER_PROXY_FOR_NOW',
        },

        unchanged: {
          alphaWeights:
            true,

          stableThreshold:
            0.68,

          aggressiveThreshold:
            0.60,

          riskPolicy:
            'DEFER_TO_PREFLIGHT',

          executionEligible:
            false,
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RUN_DAILY_MARKET_ADAPTERS_SMOKE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_FEATURES_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
