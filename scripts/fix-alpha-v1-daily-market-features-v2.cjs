#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_DAILY_MARKET_FEATURES_FIX_V2';

function replaceStringOnce(
  text,
  needle,
  replacement,
  label,
) {
  const count =
    text.split(needle).length - 1;

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

function replaceRegexOnce(
  text,
  regex,
  replacement,
  label,
) {
  const matches =
    [...text.matchAll(
      new RegExp(
        regex.source,
        regex.flags.includes('g')
          ? regex.flags
          : regex.flags + 'g',
      ),
    )];

  if (matches.length !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${matches.length}`,
    );
  }

  return text.replace(
    regex,
    replacement,
  );
}

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
    },
  );

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

  const smokeFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-daily-market-adapters-smoke.ts',
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

  for (
    const file
    of [
      adapterFile,
      smokeFile,
      sourceRunner,
    ]
  ) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `REQUIRED_FILE_MISSING:${file}`,
      );
    }
  }

  /*
   * Fix the smoke fixture:
   * 85 weekdays from 2026-06-15 extended beyond decisionAt,
   * so the adapter correctly rejected it as look-ahead.
   *
   * 85 weekdays from 2026-06-01 ends at 2026-09-25.
   */
  let smoke =
    fs.readFileSync(
      smokeFile,
      'utf8',
    );

  smoke =
    replaceStringOnce(
      smoke,
      '"2026-06-15T00:00:00.000Z"',
      '"2026-06-01T00:00:00.000Z"',
      'SMOKE_FIXTURE_START_DATE',
    );

  atomicWrite(
    smokeFile,
    smoke,
  );

  /*
   * Rebuild the new runner from the untouched working KIS-flow runner.
   */
  let code =
    fs.readFileSync(
      sourceRunner,
      'utf8',
    );

  code =
    replaceRegexOnce(
      code,
      /const VERSION\s*=\s*"ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY";/,
      `const VERSION =
  "ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY";`,
      'RUNNER_VERSION',
    );

  code =
    replaceRegexOnce(
      code,
      /\}\s+from\s+"..\/lib\/kis\/client";/,
      `} from "../lib/kis/client";

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
      'DAILY_ALPHA_IMPORTS',
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
          ascending: true,
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
    replaceRegexOnce(
      code,
      /function printCompact\(\s*value:\s*unknown,\s*\)\s*\{/,
      `${helper}function printCompact(
  value: unknown,
) {`,
      'DAILY_BAR_HELPER',
    );

  /*
   * Keep the legacy snapshot regime for diagnostics only.
   * Add the real daily-bar Alpha sources immediately after it.
   */
  code =
    replaceRegexOnce(
      code,
      /(const regime\s*=\s*computeMarketRegimeProxy\(\s*snapshots,\s*stockCodes,\s*\);)/,
      `$1

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
    });`,
      'V7_SETUP',
    );

  /*
   * Build daily multi-day price/volume evidence before the existing
   * Alpha adapter call, while still letting the old adapter construct
   * catalyst / liquidity / event persistence scaffolding.
   */
  code =
    replaceRegexOnce(
      code,
      /const candidateInput\s*=\s*buildAlphaCandidateInputFromRealSources\(\{/,
      `const stockMetadata =
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
      'CANDIDATE_START',
    );

  /*
   * Close the legacy adapter call and override ONLY the two Alpha market
   * features. Liquidity stays on the existing snapshot turnover proxy.
   */
  code =
    replaceRegexOnce(
      code,
      /modelVersion:\s*"alpha-v1-real-runner-readonly",\s*\}\);/,
      `modelVersion:
            "alpha-v1-real-runner-daily-alpha-readonly",
        });

        const legacyMetadata =
          (
            legacyCandidateInput
              .metadata ??
            {}
          ) as Record<string, any>;

        const legacySourcePresence =
          (
            legacyMetadata
              .sourcePresence ??
            {}
          ) as Record<string, any>;

        const candidateInput =
          {
            ...legacyCandidateInput,

            features: {
              ...legacyCandidateInput
                .features,

              marketRegime:
                v7RegimeEvidence,

              priceVolume:
                dailyPriceVolumeEvidence,
            },

            metadata: {
              ...legacyMetadata,

              adapterVersion:
                "ALPHA_V1_DAILY_MARKET_FEATURE_ADAPTERS",

              sourcePresence: {
                ...legacySourcePresence,

                marketRegime:
                  Boolean(
                    v7RegimeEvidence,
                  ),

                priceVolume:
                  Boolean(
                    dailyPriceVolumeEvidence,
                  ),
              },
            },
          } as
            typeof legacyCandidateInput;`,
      'CANDIDATE_OVERRIDE',
    );

  code =
    replaceRegexOnce(
      code,
      /marketRegime:\s*regime\s*\?\s*"CONNECTED_READ_ONLY_SNAPSHOT_PROXY"\s*:\s*"UNAVAILABLE",/,
      `marketRegime:
        v7RegimeEvidence
          ? "CONNECTED_EXISTING_V7_DAILY_BAR_ENGINE"
          : "UNAVAILABLE",`,
      'SOURCE_STATUS_REGIME',
    );

  code =
    replaceStringOnce(
      code,
      `priceVolume:
        "CONNECTED_MARKET_SNAPSHOTS",`,
      `priceVolume:
        "CONNECTED_MARKET_DAILY_BARS_MULTI_DAY",`,
      'SOURCE_STATUS_PRICE_VOLUME',
    );

  /*
   * Replace the report-level regime field only; preserve the legacy
   * snapshot proxy inside the diagnostic object for comparison.
   */
  code =
    replaceRegexOnce(
      code,
      /\n\s{4}regime,\s*\n\s{4}counts:/,
      `
    regime: {
      evidence:
        v7RegimeEvidence,

      policy:
        v7RegimePolicy,

      features:
        v7RegimeFeatures,

      legacySnapshotProxy:
        regime,
    },

    counts:`,
      'REPORT_REGIME',
    );

  code =
    replaceRegexOnce(
      code,
      /(normalizedPredictions:\s*predictionResult\.normalized\.length,\s*)(\},)/,
      `$1
        marketDailyBars:
          dailyAlphaBars.length,

        v7LatestMarketDate:
          v7RegimeFeatures
            .latestMarketDate,
      $2`,
      'REPORT_DATABASE_READS',
    );

  code =
    replaceRegexOnce(
      code,
      /databaseReads:\s*3,/,
      `databaseReads:
        7,`,
      'SAFETY_DATABASE_READS',
    );

  code =
    replaceRegexOnce(
      code,
      /supabaseReadRequests:\s*3,/,
      `supabaseReadRequests:
        7,

      dailyAlphaBarReadRequests:
        1,

      v7RegimeReadRequests:
        3,`,
      'SAFETY_SUPABASE_READS',
    );

  code =
    replaceRegexOnce(
      code,
      /networkRequests:\s*(?:3\s*\+\s*1\s*\+\s*kisFlow\.attempted|9),/,
      `networkRequests:
        7 +
        1 +
        kisFlow.attempted,`,
      'SAFETY_NETWORK_REQUESTS',
    );

  code =
    code
      .split(
        'ALPHA_V1_REVIEW_FULL_FEATURE_RANKING_THEN_BIND_PRE_ENTRY_RISK',
      )
      .join(
        'ALPHA_V1_REVIEW_DAILY_ALPHA_RANKING_THEN_BIND_PRE_ENTRY_RISK',
      );

  code =
    code
      .split(
        'alpha-v1-real-runner-kis-flow-read-only.json',
      )
      .join(
        'alpha-v1-real-runner-daily-alpha-read-only.json',
      );

  code =
    code
      .split(
        'ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY_COMPLETE',
      )
      .join(
        'ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY_COMPLETE',
      );

  atomicWrite(
    targetRunner,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_FEATURES_FIX_COMPLETE',

        version:
          VERSION,

        fixed: {
          smokeFixture: {
            oldStart:
              '2026-06-15',

            newStart:
              '2026-06-01',

            expectedLastBar:
              '2026-09-25',

            decisionAt:
              '2026-10-06T06:30:00.000Z',

            lookaheadExpected:
              false,
          },

          runner: {
            source:
              'scripts/alpha-v1-real-runner-kis-flow-read-only.ts',

            target:
              'scripts/alpha-v1-real-runner-daily-alpha-read-only.ts',

            patchMode:
              'REGEX_NARROW_ANCHORS',

            originalRunnerPreserved:
              true,
          },
        },

        architecture: {
          alphaMarketRegime:
            'EXISTING_V7_DAILY_BAR_ENGINE',

          v7Policy:
            'BLOCK_BREADTH_OR_HIGH_VOL',

          alphaPriceVolume:
            'MARKET_DAILY_BARS_MULTI_DAY',

          liquidity:
            'EXISTING_MARKET_SNAPSHOT_TURNOVER_PROXY',

          entryTiming:
            'MARKET_SNAPSHOTS_INTRADAY_UNCHANGED',
        },

        unchanged: {
          thresholds:
            true,

          weights:
            true,

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
          'RERUN_DAILY_MARKET_ADAPTERS_SMOKE',
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_FEATURES_FIX_FAILED',

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
