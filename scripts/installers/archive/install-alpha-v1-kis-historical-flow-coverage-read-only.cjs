#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_INSTALLER';

const source =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  getDomesticInvestorTradeDaily,\n  getKisAccessToken,\n} from \"../lib/kis/client\";\n\nconst VERSION =\n  \"ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY\";\n\nconst RANGE_START =\n  \"20260730\";\n\nconst RANGE_END =\n  \"20261002\";\n\nconst ANCHORS = [\n  \"20260730\",\n  \"20260831\",\n  \"20261002\",\n] as const;\n\nconst REQUEST_DELAY_MS =\n  800;\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-kis-historical-flow-coverage-read-only.json\",\n  );\n\ntype JsonRecord =\n  Record<string, unknown>;\n\nfunction sleep(\n  milliseconds: number,\n) {\n  return new Promise(\n    (\n      resolve,\n    ) => {\n      setTimeout(\n        resolve,\n        milliseconds,\n      );\n    },\n  );\n}\n\nfunction compactDate(\n  value: string,\n) {\n  return value\n    .replace(\n      /-/g,\n      \"\",\n    )\n    .trim();\n}\n\nfunction isoDate(\n  value: string,\n) {\n  const normalized =\n    compactDate(\n      value,\n    );\n\n  if (\n    !/^\\d{8}$/.test(\n      normalized,\n    )\n  ) {\n    return value;\n  }\n\n  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;\n}\n\nfunction asString(\n  value: unknown,\n) {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  return String(\n    value,\n  );\n}\n\nfunction asNumber(\n  value: unknown,\n) {\n  if (\n    value === null ||\n    value === undefined ||\n    value === \"\"\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(\n    parsed,\n  )\n    ? parsed\n    : null;\n}\n\nfunction normalizeFlowRow(\n  stockCode: string,\n  row: JsonRecord,\n) {\n  return {\n    stockCode,\n\n    tradingDate:\n      asString(\n        row.stck_bsop_date,\n      ),\n\n    closePrice:\n      asNumber(\n        row.stck_clpr,\n      ),\n\n    accumulatedVolume:\n      asNumber(\n        row.acml_vol,\n      ),\n\n    accumulatedTradingValue:\n      asNumber(\n        row.acml_tr_pbmn,\n      ),\n\n    individualNetBuyQuantity:\n      asNumber(\n        row.prsn_ntby_qty,\n      ),\n\n    foreignNetBuyQuantity:\n      asNumber(\n        row.frgn_ntby_qty,\n      ),\n\n    institutionNetBuyQuantity:\n      asNumber(\n        row.orgn_ntby_qty,\n      ),\n\n    individualNetBuyAmount:\n      asNumber(\n        row.prsn_ntby_tr_pbmn,\n      ),\n\n    foreignNetBuyAmount:\n      asNumber(\n        row.frgn_ntby_tr_pbmn,\n      ),\n\n    institutionNetBuyAmount:\n      asNumber(\n        row.orgn_ntby_tr_pbmn,\n      ),\n\n    source:\n      \"KIS_INVESTOR_TRADE_BY_STOCK_DAILY\",\n\n    sourceVersion:\n      \"FHPTJ04160001\",\n  };\n}\n\nasync function readActiveStocks() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const result =\n    await supabase\n      .from(\n        \"stocks\",\n      )\n      .select(\n        \"stock_code, stock_name, market\",\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .order(\n        \"stock_code\",\n        {\n          ascending:\n            true,\n        },\n      );\n\n  if (\n    result.error\n  ) {\n    throw new Error(\n      `ACTIVE_STOCK_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  ).map(\n    (\n      row,\n    ) => ({\n      stockCode:\n        String(\n          row.stock_code,\n        ),\n\n      stockName:\n        row.stock_name == null\n          ? null\n          : String(\n              row.stock_name,\n            ),\n\n      market:\n        row.market == null\n          ? null\n          : String(\n              row.market,\n            ),\n    }),\n  );\n}\n\nasync function readExpectedTradingDates() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const result =\n    await supabase\n      .from(\n        \"market_index_daily_bars\",\n      )\n      .select(\n        \"trading_date\",\n      )\n      .eq(\n        \"market_code\",\n        \"KOSPI\",\n      )\n      .gte(\n        \"trading_date\",\n        isoDate(\n          RANGE_START,\n        ),\n      )\n      .lte(\n        \"trading_date\",\n        isoDate(\n          RANGE_END,\n        ),\n      )\n      .order(\n        \"trading_date\",\n        {\n          ascending:\n            true,\n        },\n      );\n\n  if (\n    result.error\n  ) {\n    throw new Error(\n      `EXPECTED_TRADING_DATE_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return [\n    ...new Set(\n      (\n        result.data ??\n        []\n      )\n        .map(\n          (\n            row,\n          ) =>\n            compactDate(\n              String(\n                row.trading_date,\n              ),\n            ),\n        )\n        .filter(\n          (\n            value,\n          ) =>\n            /^\\d{8}$/.test(\n              value,\n            ),\n        ),\n    ),\n  ].sort();\n}\n\nasync function main() {\n  const startedAt =\n    new Date()\n      .toISOString();\n\n  const [\n    stocks,\n    expectedTradingDates,\n  ] =\n    await Promise.all([\n      readActiveStocks(),\n      readExpectedTradingDates(),\n    ]);\n\n  const accessToken =\n    await getKisAccessToken();\n\n  const requestResults:\n    Array<\n      Record<string, unknown>\n    > =\n    [];\n\n  const rowsByStock =\n    new Map<\n      string,\n      Map<\n        string,\n        ReturnType<\n          typeof normalizeFlowRow\n        >\n      >\n    >();\n\n  for (\n    const stock\n    of stocks\n  ) {\n    rowsByStock.set(\n      stock.stockCode,\n      new Map(),\n    );\n\n    for (\n      const anchor\n      of ANCHORS\n    ) {\n      try {\n        const result =\n          await getDomesticInvestorTradeDaily(\n            stock.stockCode,\n            anchor,\n            accessToken,\n          );\n\n        const output2 =\n          Array.isArray(\n            result.body.output2,\n          )\n            ? result.body.output2\n            : result.body.output2\n            ? [\n                result.body.output2,\n              ]\n            : [];\n\n        const normalizedRows =\n          (\n            output2 as\n              JsonRecord[]\n          )\n            .map(\n              (\n                row,\n              ) =>\n                normalizeFlowRow(\n                  stock.stockCode,\n                  row,\n                ),\n            )\n            .filter(\n              (\n                row,\n              ) =>\n                Boolean(\n                  row.tradingDate,\n                ),\n            );\n\n        const stockMap =\n          rowsByStock.get(\n            stock.stockCode,\n          )!;\n\n        for (\n          const row\n          of normalizedRows\n        ) {\n          if (\n            row.tradingDate\n          ) {\n            stockMap.set(\n              row.tradingDate,\n              row,\n            );\n          }\n        }\n\n        const dates =\n          normalizedRows\n            .map(\n              (\n                row,\n              ) =>\n                row.tradingDate,\n            )\n            .filter(\n              (\n                value,\n              ): value is string =>\n                Boolean(\n                  value,\n                ),\n            )\n            .sort();\n\n        requestResults.push({\n          stockCode:\n            stock.stockCode,\n\n          stockName:\n            stock.stockName,\n\n          anchor,\n\n          status:\n            \"OK\",\n\n          rtCd:\n            result.body.rt_cd ??\n            null,\n\n          msgCd:\n            result.body.msg_cd ??\n            null,\n\n          rowCount:\n            normalizedRows.length,\n\n          earliestReturnedDate:\n            dates[0] ??\n            null,\n\n          latestReturnedDate:\n            dates.at(-1) ??\n            null,\n\n          anchorDatePresent:\n            dates.includes(\n              anchor,\n            ),\n\n          trCont:\n            result.trCont,\n        });\n      } catch (\n        error\n      ) {\n        requestResults.push({\n          stockCode:\n            stock.stockCode,\n\n          stockName:\n            stock.stockName,\n\n          anchor,\n\n          status:\n            \"FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n        });\n      }\n\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  const coverageByStock =\n    stocks.map(\n      (\n        stock,\n      ) => {\n        const stockRows =\n          [\n            ...(\n              rowsByStock\n                .get(\n                  stock.stockCode,\n                )\n                ?.values() ??\n              []\n            ),\n          ];\n\n        const collectedDates =\n          stockRows\n            .map(\n              (\n                row,\n              ) =>\n                row.tradingDate,\n            )\n            .filter(\n              (\n                value,\n              ): value is string =>\n                Boolean(\n                  value,\n                ),\n            )\n            .sort();\n\n        const rangeDates =\n          collectedDates\n            .filter(\n              (\n                date,\n              ) =>\n                date >=\n                  RANGE_START &&\n                date <=\n                  RANGE_END,\n            );\n\n        const rangeSet =\n          new Set(\n            rangeDates,\n          );\n\n        const missingTradingDates =\n          expectedTradingDates\n            .filter(\n              (\n                date,\n              ) =>\n                !rangeSet.has(\n                  date,\n                ),\n            );\n\n        const duplicatesRemoved =\n          requestResults\n            .filter(\n              (\n                request,\n              ) =>\n                request.stockCode ===\n                stock.stockCode &&\n                request.status ===\n                  \"OK\",\n            )\n            .reduce(\n              (\n                total,\n                request,\n              ) =>\n                total +\n                Number(\n                  request.rowCount ??\n                  0,\n                ),\n              0,\n            ) -\n          collectedDates.length;\n\n        return {\n          stockCode:\n            stock.stockCode,\n\n          stockName:\n            stock.stockName,\n\n          market:\n            stock.market,\n\n          uniqueCollectedRows:\n            collectedDates.length,\n\n          rowsInsideReplayWindow:\n            rangeDates.length,\n\n          earliestCollectedDate:\n            collectedDates[0] ??\n            null,\n\n          latestCollectedDate:\n            collectedDates.at(-1) ??\n            null,\n\n          expectedTradingDates:\n            expectedTradingDates.length,\n\n          missingTradingDateCount:\n            missingTradingDates.length,\n\n          missingTradingDates,\n\n          duplicatesRemoved,\n\n          gapFree:\n            missingTradingDates.length ===\n            0,\n        };\n      },\n    );\n\n  const failedRequests =\n    requestResults\n      .filter(\n        (\n          row,\n        ) =>\n          row.status ===\n          \"FAILED\",\n      );\n\n  const allStocksGapFree =\n    coverageByStock.every(\n      (\n        row,\n      ) =>\n        row.gapFree,\n    );\n\n  const rawRows =\n    stocks.flatMap(\n      (\n        stock,\n      ) =>\n        [\n          ...(\n            rowsByStock\n              .get(\n                stock.stockCode,\n              )\n              ?.values() ??\n            []\n          ),\n        ],\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_COMPLETE\",\n\n    version:\n      VERSION,\n\n    startedAt,\n\n    finishedAt:\n      new Date()\n        .toISOString(),\n\n    target: {\n      replayStartDate:\n        RANGE_START,\n\n      replayEndDate:\n        RANGE_END,\n\n      anchors:\n        ANCHORS,\n\n      activeStockCount:\n        stocks.length,\n\n      expectedTradingDateCount:\n        expectedTradingDates.length,\n    },\n\n    source: {\n      endpoint:\n        \"/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily\",\n\n      trId:\n        \"FHPTJ04160001\",\n\n      dateParameter:\n        \"FID_INPUT_DATE_1\",\n\n      rowsPerRequestObserved:\n        30,\n\n      continuationRequired:\n        false,\n\n      collectionStrategy:\n        \"OVERLAPPING_ANCHOR_DATES_THEN_DEDUPLICATE_BY_STOCK_CODE_AND_TRADING_DATE\",\n    },\n\n    requests: {\n      attempted:\n        requestResults.length,\n\n      successful:\n        requestResults.length -\n        failedRequests.length,\n\n      failed:\n        failedRequests.length,\n\n      results:\n        requestResults,\n    },\n\n    coverage: {\n      expectedTradingDates,\n\n      byStock:\n        coverageByStock,\n\n      allStocksGapFree,\n\n      totalUniqueRows:\n        rawRows.length,\n    },\n\n    backfillDecision: {\n      historicalFlowCoverageProven:\n        allStocksGapFree &&\n        failedRequests.length ===\n          0,\n\n      databaseWritePerformed:\n        false,\n\n      recommendedKey:\n        [\n          \"stock_code\",\n          \"trading_date\",\n        ],\n\n      recommendedNextGate:\n        allStocksGapFree &&\n        failedRequests.length ===\n          0\n          ? \"ALPHA_V1_DEFINE_HISTORICAL_FLOW_STORAGE_AND_CONTROLLED_BACKFILL\"\n          : \"ALPHA_V1_ADJUST_ANCHORS_OR_RETRY_MISSING_HISTORICAL_FLOW\",\n    },\n\n    normalizedRows:\n      rawRows\n        .sort(\n          (\n            left,\n            right,\n          ) => {\n            const stockCompare =\n              left.stockCode\n                .localeCompare(\n                  right.stockCode,\n                );\n\n            if (\n              stockCompare !==\n              0\n            ) {\n              return stockCompare;\n            }\n\n            return String(\n              left.tradingDate,\n            ).localeCompare(\n              String(\n                right.tradingDate,\n              ),\n            );\n          },\n        ),\n\n    safety: {\n      databaseReads:\n        2,\n\n      databaseWrites:\n        0,\n\n      kisTokenRequests:\n        1,\n\n      kisHistoricalFlowRequests:\n        requestResults.length,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    outputFile:\n      \"logs/alpha-v1-kis-historical-flow-coverage-read-only.json\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
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

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const target =
    path.join(
      root,
      'scripts',
      'alpha-v1-kis-historical-flow-coverage-read-only.ts',
    );

  atomicWrite(
    target,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_INSTALLED',

        version:
          VERSION,

        generatedFile:
          'scripts/alpha-v1-kis-historical-flow-coverage-read-only.ts',

        coveragePlan: {
          replayStartDate:
            '20260730',

          replayEndDate:
            '20261002',

          anchors: [
            '20260730',
            '20260831',
            '20261002',
          ],

          activeStocks:
            'READ_FROM_STOCKS_TABLE',

          expectedTradingCalendar:
            'KOSPI_MARKET_INDEX_DAILY_BARS',

          dedupeKey: [
            'stockCode',
            'tradingDate',
          ],
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          productionDecisionApplied:
            false,
        },

        nextAction:
          'RUN_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY',
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
          'ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_INSTALL_FAILED',

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
