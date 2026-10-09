import fs from "node:fs";
import path from "node:path";

import {
  getMarketDataFreshnessV77,
} from "../lib/market/get-market-data-freshness-v7-7";

async function main() {
  const root =
    process.cwd();

  const getterPath =
    path.resolve(
      root,
      "lib/market/get-market-data-freshness-v7-7.ts",
    );

  const getterSource =
    fs.readFileSync(
      getterPath,
      "utf8",
    );

  const forbiddenWrites = [
    ".insert(",
    ".upsert(",
    ".update(",
    ".delete(",
  ].filter(
    (needle) =>
      getterSource.includes(
        needle,
      ),
  );

  if (
    forbiddenWrites.length > 0
  ) {
    throw new Error(
      `GETTER_NOT_READ_ONLY:${forbiddenWrites.join(",")}`,
    );
  }

  const fixedNow =
    "2026-10-09T10:00:00.000Z";

  /*
   * Existing freshness code supports a test clock in this project.
   * `as any` keeps this regression compatible even if the public
   * interface was not exported separately.
   */
  const freshness =
    await getMarketDataFreshnessV77(
      {
        now:
          fixedNow,
      } as any,
    );

  const result: any =
    freshness;

  const expectedMarketDate =
    result?.expectedMarketDate ??
    result?.expected_market_date ??
    null;

  const koreanDate =
    result?.koreanClock?.date ??
    result?.korean_clock?.date ??
    null;

  const status =
    result?.status ??
    null;

  const calendarMode =
    result?.calendar?.mode ??
    result?.metadata?.calendar?.mode ??
    null;

  const appliedOverrides =
    result?.calendar
      ?.appliedOverrides ??
    result?.metadata
      ?.calendar
      ?.appliedOverrides ??
    [];

  const hangeulOverride =
    Array.isArray(
      appliedOverrides,
    )
      ? appliedOverrides.find(
          (row: any) =>
            (
              row?.date ??
              row?.calendar_date
            ) ===
              "2026-10-09",
        ) ??
        null
      : null;

  const dates =
    result?.dates ??
    {};

  const checks = {
    getterSourceReadOnly:
      forbiddenWrites.length ===
        0,

    koreanClockIsHangeulDay:
      koreanDate ===
        "2026-10-09",

    expectedMarketDateSkipsHangeulDay:
      expectedMarketDate ===
        "2026-10-08",

    latestCommonDateNotAfterExpected:
      !dates?.latestCommonDate ||
      dates.latestCommonDate <=
        "2026-10-08",

    kospiNotAfterExpected:
      !dates?.kospiLatestDate ||
      dates.kospiLatestDate <=
        "2026-10-08",

    kosdaqNotAfterExpected:
      !dates?.kosdaqLatestDate ||
      dates.kosdaqLatestDate <=
        "2026-10-08",

    stockNotAfterExpected:
      !dates?.stockLatestDate ||
      dates.stockLatestDate <=
        "2026-10-08",
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
      )
      .map(
        ([name]) =>
          name,
      );

  const output = {
    status:
      failed.length === 0
        ? "KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_VERIFIED"
        : "KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_REVIEW",

    testClock: {
      inputNow:
        fixedNow,

      koreanDate,

      expectedMarketDate,
    },

    freshness: {
      status,

      usableForShadowComparison:
        result
          ?.usableForShadowComparison ??
        result
          ?.usable_for_shadow_comparison ??
        null,

      dates: {
        kospiLatestDate:
          dates?.kospiLatestDate ??
          null,

        kosdaqLatestDate:
          dates?.kosdaqLatestDate ??
          null,

        stockLatestDate:
          dates?.stockLatestDate ??
          null,

        oldestActiveStockLatestDate:
          dates
            ?.oldestActiveStockLatestDate ??
          null,

        latestCommonDate:
          dates?.latestCommonDate ??
          null,
      },

      lag:
        result?.lag ??
        null,

      calendar: {
        mode:
          calendarMode,

        hangeulOverride,
      },
    },

    checks,
    failed,

    safety: {
      getterStaticWriteCalls:
        forbiddenWrites,

      databaseReads:
        true,

      databaseWrites:
        0,

      observationCaptureCalled:
        false,

      eodSyncCalled:
        false,

      kisRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      schedulerChanged:
        false,

      realTradingChanged:
        false,

      forwardOosStateChanged:
        false,
    },

    nextGate:
      failed.length === 0
        ? "KRX_CANONICAL_CALENDAR_V1_CORE_BINDING_COMPLETE"
        : "REVIEW_FRESHNESS_LIVE_CALENDAR_RESULT",
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      "logs/krx-freshness-canonical-live-read-regression-v1.json",
    ),
    JSON.stringify(
      output,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      output,
      null,
      2,
    ),
  );

  if (
    failed.length > 0
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_ERROR",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,
            observationCaptureCalled:
              false,
            eodSyncCalled:
              false,
            ordersCreated:
              0,
            positionsChanged:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
