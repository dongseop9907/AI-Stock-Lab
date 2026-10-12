#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_INSTALLER';

const adapter =
  "\n\n/**\n * Alpha V1 daily-liquidity evidence.\n *\n * Candidate ranking must not depend on intraday market_snapshots.\n * This adapter uses only completed market_daily_bars available by decisionAt.\n *\n * Score = cross-sectional percentile of the target stock's rolling\n * median trading-value proxy over the most recent completed bars.\n *\n * trading_value is preferred. When it is unavailable, close * volume is\n * used only as a fallback proxy and recorded in metadata.\n */\nexport function buildDailyLiquidityEvidence(\n  input: {\n    stockCode: string;\n    decisionAt: string;\n    rows: DailyAlphaBarLike[];\n    lookbackRows?: number;\n  },\n): AlphaFeatureEvidence | undefined {\n  const decisionAtMs =\n    new Date(\n      input.decisionAt,\n    ).getTime();\n\n  if (!Number.isFinite(decisionAtMs)) {\n    throw new Error(\n      `INVALID_DECISION_AT:${input.decisionAt}`,\n    );\n  }\n\n  const lookbackRows =\n    Math.max(\n      5,\n      Math.min(\n        60,\n        Math.floor(\n          input.lookbackRows ?? 20,\n        ),\n      ),\n    );\n\n  const availableAtMs = (\n    tradingDate: string,\n  ) =>\n    new Date(\n      `${tradingDate}T15:00:00.000Z`,\n    ).getTime();\n\n  const numeric = (\n    value:\n      | number\n      | string\n      | null\n      | undefined,\n  ): number | null => {\n    if (\n      value === null ||\n      value === undefined ||\n      value === \"\"\n    ) {\n      return null;\n    }\n\n    const parsed =\n      Number(value);\n\n    return Number.isFinite(parsed)\n      ? parsed\n      : null;\n  };\n\n  const grouped =\n    new Map<\n      string,\n      Array<{\n        tradingDate: string;\n        tradingValueProxy: number;\n        fallbackUsed: boolean;\n      }>\n    >();\n\n  for (const row of input.rows) {\n    const stockCode =\n      String(\n        row.stock_code ?? \"\",\n      ).trim();\n\n    const tradingDate =\n      String(\n        row.trading_date ?? \"\",\n      ).slice(\n        0,\n        10,\n      );\n\n    if (\n      !/^\\d{6}$/.test(stockCode) ||\n      !/^\\d{4}-\\d{2}-\\d{2}$/.test(\n        tradingDate,\n      )\n    ) {\n      continue;\n    }\n\n    const rowAvailableAtMs =\n      availableAtMs(\n        tradingDate,\n      );\n\n    if (\n      !Number.isFinite(\n        rowAvailableAtMs,\n      ) ||\n      rowAvailableAtMs >\n        decisionAtMs\n    ) {\n      continue;\n    }\n\n    const directTradingValue =\n      numeric(\n        row.trading_value,\n      );\n\n    const close =\n      numeric(\n        row.close_price,\n      );\n\n    const volume =\n      numeric(\n        row.volume,\n      );\n\n    const fallbackValue =\n      close !== null &&\n      close > 0 &&\n      volume !== null &&\n      volume > 0\n        ? close * volume\n        : null;\n\n    const tradingValueProxy =\n      directTradingValue !== null &&\n      directTradingValue > 0\n        ? directTradingValue\n        : fallbackValue;\n\n    if (\n      tradingValueProxy === null ||\n      !Number.isFinite(\n        tradingValueProxy,\n      ) ||\n      tradingValueProxy <= 0\n    ) {\n      continue;\n    }\n\n    const current =\n      grouped.get(\n        stockCode,\n      ) ?? [];\n\n    current.push({\n      tradingDate,\n      tradingValueProxy,\n      fallbackUsed:\n        !(\n          directTradingValue !== null &&\n          directTradingValue > 0\n        ),\n    });\n\n    grouped.set(\n      stockCode,\n      current,\n    );\n  }\n\n  const median = (\n    values: number[],\n  ): number | null => {\n    if (\n      values.length === 0\n    ) {\n      return null;\n    }\n\n    const sorted =\n      [...values].sort(\n        (a, b) =>\n          a - b,\n      );\n\n    const middle =\n      Math.floor(\n        sorted.length / 2,\n      );\n\n    return sorted.length % 2 === 1\n      ? sorted[middle]\n      : (\n          sorted[\n            middle - 1\n          ] +\n          sorted[middle]\n        ) / 2;\n  };\n\n  const summaries:\n    Array<{\n      stockCode: string;\n      medianTradingValue: number;\n      latestTradingValue: number;\n      latestTradingDate: string;\n      sampleSize: number;\n      fallbackRows: number;\n    }> =\n    [];\n\n  for (\n    const [\n      stockCode,\n      rawRows,\n    ]\n    of grouped\n  ) {\n    const rows =\n      [...rawRows]\n        .sort(\n          (\n            left,\n            right,\n          ) =>\n            left.tradingDate\n              .localeCompare(\n                right.tradingDate,\n              ),\n        )\n        .slice(\n          -lookbackRows,\n        );\n\n    const medianTradingValue =\n      median(\n        rows.map(\n          (row) =>\n            row.tradingValueProxy,\n        ),\n      );\n\n    const latest =\n      rows.at(\n        -1,\n      );\n\n    if (\n      medianTradingValue ===\n        null ||\n      !latest\n    ) {\n      continue;\n    }\n\n    summaries.push({\n      stockCode,\n      medianTradingValue,\n      latestTradingValue:\n        latest.tradingValueProxy,\n      latestTradingDate:\n        latest.tradingDate,\n      sampleSize:\n        rows.length,\n      fallbackRows:\n        rows.filter(\n          (row) =>\n            row.fallbackUsed,\n        ).length,\n    });\n  }\n\n  const target =\n    summaries.find(\n      (row) =>\n        row.stockCode ===\n        input.stockCode,\n    );\n\n  if (!target) {\n    return undefined;\n  }\n\n  const peers =\n    summaries\n      .filter(\n        (row) =>\n          Number.isFinite(\n            row.medianTradingValue,\n          ),\n      )\n      .sort(\n        (\n          left,\n          right,\n        ) =>\n          left.medianTradingValue -\n          right.medianTradingValue,\n      );\n\n  if (\n    peers.length === 0\n  ) {\n    return undefined;\n  }\n\n  const less =\n    peers.filter(\n      (row) =>\n        row.medianTradingValue <\n        target.medianTradingValue,\n    ).length;\n\n  const equal =\n    peers.filter(\n      (row) =>\n        row.medianTradingValue ===\n        target.medianTradingValue,\n    ).length;\n\n  const percentile =\n    peers.length === 1\n      ? 0.5\n      : (\n          less +\n          Math.max(\n            0,\n            equal - 1,\n          ) / 2\n        ) /\n        (\n          peers.length - 1\n        );\n\n  const score =\n    Math.min(\n      1,\n      Math.max(\n        0,\n        percentile,\n      ),\n    );\n\n  const coverage =\n    Math.min(\n      1,\n      target.sampleSize /\n        lookbackRows,\n    );\n\n  const peerCoverage =\n    Math.min(\n      1,\n      peers.length / 5,\n    );\n\n  const fallbackRate =\n    target.sampleSize > 0\n      ? target.fallbackRows /\n        target.sampleSize\n      : 1;\n\n  const confidence =\n    Math.min(\n      0.95,\n      Math.max(\n        0.35,\n        0.50 +\n          coverage * 0.25 +\n          peerCoverage * 0.15 -\n          fallbackRate * 0.10,\n      ),\n    );\n\n  const availableAt =\n    `${target.latestTradingDate}T15:00:00.000Z`;\n\n  return {\n    score,\n    confidence,\n    availableAt,\n    observedAt:\n      availableAt,\n    source:\n      \"MARKET_DAILY_BARS_ALPHA_LIQUIDITY\",\n    sourceVersion:\n      \"alpha-daily-liquidity-v1\",\n    maxAgeMinutes:\n      14 * 24 * 60,\n    metadata: {\n      lookbackRows,\n      targetSampleSize:\n        target.sampleSize,\n      peerCount:\n        peers.length,\n      medianTradingValue:\n        target.medianTradingValue,\n      latestTradingValue:\n        target.latestTradingValue,\n      latestToMedianRatio:\n        target.medianTradingValue >\n        0\n          ? target.latestTradingValue /\n            target.medianTradingValue\n          : null,\n      percentile,\n      fallbackRows:\n        target.fallbackRows,\n      fallbackRate,\n      limitation:\n        \"CROSS_SECTIONAL_LIQUIDITY_RANK_WITHIN_AVAILABLE_ACTIVE_UNIVERSE\",\n    },\n  };\n}\n";

const smoke =
  "import {\n  buildDailyLiquidityEvidence,\n  type DailyAlphaBarLike,\n} from \"../lib/alpha/daily-market-adapters\";\n\nfunction makeRows(): DailyAlphaBarLike[] {\n  const rows: DailyAlphaBarLike[] = [];\n\n  for (let day = 1; day <= 20; day += 1) {\n    const d =\n      `2026-09-${String(day).padStart(2, \"0\")}`;\n\n    rows.push(\n      {\n        stock_code: \"005930\",\n        trading_date: d,\n        open_price: 100,\n        high_price: 101,\n        low_price: 99,\n        close_price: 100,\n        volume: 1_000_000,\n        trading_value: 100_000_000,\n        adjusted_price: true,\n      },\n      {\n        stock_code: \"035420\",\n        trading_date: d,\n        open_price: 100,\n        high_price: 101,\n        low_price: 99,\n        close_price: 100,\n        volume: 400_000,\n        trading_value: 40_000_000,\n        adjusted_price: true,\n      },\n      {\n        stock_code: \"035720\",\n        trading_date: d,\n        open_price: 100,\n        high_price: 101,\n        low_price: 99,\n        close_price: 100,\n        volume: 100_000,\n        trading_value: 10_000_000,\n        adjusted_price: true,\n      },\n    );\n  }\n\n  // Must be ignored as lookahead.\n  rows.push({\n    stock_code: \"035720\",\n    trading_date: \"2026-10-02\",\n    open_price: 100,\n    high_price: 101,\n    low_price: 99,\n    close_price: 100,\n    volume: 999_999_999,\n    trading_value: 999_999_999_999,\n    adjusted_price: true,\n  });\n\n  return rows;\n}\n\nconst decisionAt =\n  \"2026-10-01T00:00:00.000Z\";\n\nconst rows =\n  makeRows();\n\nconst high =\n  buildDailyLiquidityEvidence({\n    stockCode: \"005930\",\n    decisionAt,\n    rows,\n  });\n\nconst medium =\n  buildDailyLiquidityEvidence({\n    stockCode: \"035420\",\n    decisionAt,\n    rows,\n  });\n\nconst low =\n  buildDailyLiquidityEvidence({\n    stockCode: \"035720\",\n    decisionAt,\n    rows,\n  });\n\nconst pass =\n  Boolean(\n    high &&\n    medium &&\n    low &&\n    high.score >\n      medium.score &&\n    medium.score >\n      low.score &&\n    low.metadata?.latestTradingValue ===\n      10_000_000 &&\n    new Date(\n      high.availableAt,\n    ).getTime() <=\n      new Date(\n        decisionAt,\n      ).getTime(),\n  );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        pass\n          ? \"ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_SMOKE_PASS\"\n          : \"ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_SMOKE_FAIL\",\n      scores: {\n        high:\n          high?.score ?? null,\n        medium:\n          medium?.score ?? null,\n        low:\n          low?.score ?? null,\n      },\n      noLookahead:\n        low?.metadata?.latestTradingValue ===\n        10_000_000,\n      source:\n        high?.source ?? null,\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkRequests: 0,\n        ordersCreated: 0,\n      },\n      nextGate:\n        pass\n          ? \"BIND_DAILY_LIQUIDITY_TO_ALPHA_REPLAY\"\n          : \"REPAIR_DAILY_LIQUIDITY_ADAPTER\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (!pass) {\n  process.exitCode = 2;\n}\n";

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const adapterFile =
    path.join(
      root,
      'lib',
      'alpha',
      'daily-market-adapters.ts',
    );

  let source =
    fs.readFileSync(
      adapterFile,
      'utf8',
    );

  if (
    !source.includes(
      'export function buildDailyLiquidityEvidence(',
    )
  ) {
    source =
      source.trimEnd() +
      adapter +
      '\n';

    fs.writeFileSync(
      adapterFile,
      source,
      'utf8',
    );
  }

  const smokeFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-daily-liquidity-adapter-smoke.ts',
    );

  fs.writeFileSync(
    smokeFile,
    smoke,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_INSTALLED',
        version:
          VERSION,
        generatedOrPatched: [
          'lib/alpha/daily-market-adapters.ts',
          'scripts/alpha-v1-daily-liquidity-adapter-smoke.ts',
        ],
        safety: {
          databaseWrites: 0,
          ordersCreated: 0,
          productionDecisionApplied: false,
        },
        nextAction:
          'RUN_DAILY_LIQUIDITY_ADAPTER_SMOKE',
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
          'ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_INSTALL_FAILED',
        version:
          VERSION,
        error:
          String(
            error?.message ??
            error,
          ),
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
