import {
  getMarketDataFreshnessV77,
} from "@/lib/market/get-market-data-freshness-v7-7";

import {
  syncDailyBars,
} from "@/lib/market/sync-daily-bars";

import {
  syncIndexDailyBars,
} from "@/lib/market/sync-index-daily-bars";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export type MarketEodSyncStatusV78 =
  | "SKIPPED_ALREADY_FRESH"
  | "SUCCESS"
  | "PARTIAL_FAILURE"
  | "STALE_AFTER_SYNC"
  | "FAILED";

export interface RunMarketEodSyncV78Input {
  lookbackCalendarDays?: number;

  skipIfAlreadyFresh?: boolean;

  /*
   * Test hook only. Production callers should omit it.
   */
  now?: string;
}

function sqlToCompact(
  sqlDate: string,
) {
  return sqlDate.replaceAll(
    "-",
    "",
  );
}

function addCalendarDays(
  sqlDate: string,
  days: number,
) {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_SQL_DATE: ${sqlDate}`,
    );
  }

  date.setUTCDate(
    date.getUTCDate() +
      days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function clampLookback(
  value:
    number | undefined,
) {
  const parsed =
    Number(
      value ??
      10,
    );

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return 10;
  }

  return Math.min(
    45,
    Math.max(
      7,
      Math.floor(
        parsed,
      ),
    ),
  );
}

function numericField(
  value: unknown,
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}

function elapsedMilliseconds(
  startedAt: string,
  finishedAt: string,
) {
  const start =
    Date.parse(
      startedAt,
    );

  const end =
    Date.parse(
      finishedAt,
    );

  if (
    !Number.isFinite(
      start,
    ) ||
    !Number.isFinite(
      end,
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    end -
      start,
  );
}

/*
 * v7.8.1 Market Data EOD Sync Orchestrator
 *
 * v7.8.1 fixes a small audit-timestamp issue from v7.8:
 * started_at and finished_at now both come from the application clock.
 * Previously started_at used Supabase/Postgres now() while finished_at
 * used Node's clock, so sub-second clock skew could make finishedAt
 * appear slightly earlier than startedAt.
 *
 * Trading/data behavior is unchanged.
 */
export async function runMarketEodSyncV78(
  input:
    RunMarketEodSyncV78Input = {},
) {
  const supabase =
    createSupabaseServerClient();

  const lookbackCalendarDays =
    clampLookback(
      input
        .lookbackCalendarDays,
    );

  const skipIfAlreadyFresh =
    input
      .skipIfAlreadyFresh !==
    false;

  const freshnessBefore =
    await getMarketDataFreshnessV77({
      now:
        input.now,
    });

  const expectedMarketDate =
    freshnessBefore
      .expectedMarketDate;

  const syncEndDate =
    expectedMarketDate;

  const syncStartDate =
    addCalendarDays(
      syncEndDate,
      -(
        lookbackCalendarDays -
        1
      ),
    );

  /*
   * IMPORTANT:
   * Use one clock domain for audit timestamps.
   */
  const startedAt =
    new Date()
      .toISOString();

  const {
    data: runData,
    error: runCreateError,
  } =
    await supabase
      .from(
        "market_eod_sync_runs",
      )
      .insert({
        started_at:
          startedAt,

        status:
          "RUNNING",

        expected_market_date:
          expectedMarketDate,

        sync_start_date:
          syncStartDate,

        sync_end_date:
          syncEndDate,

        freshness_before:
          freshnessBefore,

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    runCreateError ||
    !runData
  ) {
    throw new Error(
      `EOD sync run creation failed: ${
        runCreateError
          ?.message ??
        "NO_RUN_ID"
      }`,
    );
  }

  const runId =
    String(
      runData.id,
    );

  try {
    if (
      skipIfAlreadyFresh &&
      freshnessBefore
        .status ===
        "FRESH" &&
      freshnessBefore
        .usableForShadowComparison &&
      freshnessBefore
        .dates
        .latestCommonDate ===
        expectedMarketDate
    ) {
      const finishedAt =
        new Date()
          .toISOString();

      const result = {
        version:
          "MARKET_EOD_SYNC_V7_8_1",

        runId,

        status:
          "SKIPPED_ALREADY_FRESH" as const,

        skipped:
          true,

        skipReason:
          "MARKET_DATA_ALREADY_FRESH",

        startedAt,
        finishedAt,

        durationMs:
          elapsedMilliseconds(
            startedAt,
            finishedAt,
          ),

        expectedMarketDate,

        syncRange: {
          startDate:
            syncStartDate,

          endDate:
            syncEndDate,

          lookbackCalendarDays,
        },

        freshnessBefore,
        freshnessAfter:
          freshnessBefore,

        productionApplied:
          false,
      };

      const {
        error: updateError,
      } =
        await supabase
          .from(
            "market_eod_sync_runs",
          )
          .update({
            finished_at:
              finishedAt,

            status:
              result.status,

            skipped:
              true,

            skip_reason:
              result
                .skipReason,

            freshness_after:
              freshnessBefore,

            result,

            production_applied:
              false,
          })
          .eq(
            "id",
            runId,
          );

      if (
        updateError
      ) {
        throw new Error(
          `EOD sync skipped-run save failed: ${updateError.message}`,
        );
      }

      return result;
    }

    const compactStartDate =
      sqlToCompact(
        syncStartDate,
      );

    const compactEndDate =
      sqlToCompact(
        syncEndDate,
      );

    const indexResult =
      await syncIndexDailyBars({
        markets: [
          "KOSPI",
          "KOSDAQ",
        ],

        startDate:
          compactStartDate,

        endDate:
          compactEndDate,

        chunkDays:
          lookbackCalendarDays,
      });

    const stockResult =
      await syncDailyBars({
        startDate:
          compactStartDate,

        endDate:
          compactEndDate,

        adjustedPrice:
          true,

        chunkDays:
          lookbackCalendarDays,
      });

    const freshnessAfter =
      await getMarketDataFreshnessV77({
        now:
          input.now,
      });

    const indexFailureCount =
      numericField(
        indexResult
          .failureCount,
      );

    const stockFailureCount =
      numericField(
        stockResult
          .failureCount,
      );

    let status:
      MarketEodSyncStatusV78;

    if (
      freshnessAfter
        .status ===
        "FRESH" &&
      freshnessAfter
        .usableForShadowComparison
    ) {
      status =
        indexFailureCount ===
          0 &&
        stockFailureCount ===
          0
          ? "SUCCESS"
          : "PARTIAL_FAILURE";
    } else if (
      indexFailureCount >
        0 ||
      stockFailureCount >
        0
    ) {
      status =
        "PARTIAL_FAILURE";
    } else {
      status =
        "STALE_AFTER_SYNC";
    }

    const finishedAt =
      new Date()
        .toISOString();

    const result = {
      version:
        "MARKET_EOD_SYNC_V7_8_1",

      runId,

      status,

      skipped:
        false,

      startedAt,
      finishedAt,

      durationMs:
        elapsedMilliseconds(
          startedAt,
          finishedAt,
        ),

      expectedMarketDate,

      syncRange: {
        startDate:
          syncStartDate,

        endDate:
          syncEndDate,

        lookbackCalendarDays,
      },

      index: {
        requestedMarkets:
          numericField(
            indexResult
              .requestedMarkets,
          ),

        requestedRanges:
          numericField(
            indexResult
              .requestedRanges,
          ),

        receivedRows:
          numericField(
            indexResult
              .receivedRows,
          ),

        savedRows:
          numericField(
            indexResult
              .savedRows,
          ),

        failureCount:
          indexFailureCount,

        failures:
          indexResult
            .failures,
      },

      stocks: {
        requestedStocks:
          numericField(
            stockResult
              .requestedStocks,
          ),

        requestedRanges:
          numericField(
            stockResult
              .requestedRanges,
          ),

        receivedRows:
          numericField(
            stockResult
              .receivedRows,
          ),

        savedRows:
          numericField(
            stockResult
              .savedRows,
          ),

        failureCount:
          stockFailureCount,

        failures:
          stockResult
            .failures,
      },

      freshnessBefore,
      freshnessAfter,

      productionApplied:
        false,
    };

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "market_eod_sync_runs",
        )
        .update({
          finished_at:
            finishedAt,

          status,

          skipped:
            false,

          index_requested_markets:
            result
              .index
              .requestedMarkets,

          index_received_rows:
            result
              .index
              .receivedRows,

          index_saved_rows:
            result
              .index
              .savedRows,

          index_failure_count:
            result
              .index
              .failureCount,

          stock_requested_stocks:
            result
              .stocks
              .requestedStocks,

          stock_received_rows:
            result
              .stocks
              .receivedRows,

          stock_saved_rows:
            result
              .stocks
              .savedRows,

          stock_failure_count:
            result
              .stocks
              .failureCount,

          freshness_after:
            freshnessAfter,

          result,

          production_applied:
            false,
        })
        .eq(
          "id",
          runId,
        );

    if (
      updateError
    ) {
      throw new Error(
        `EOD sync result save failed: ${updateError.message}`,
      );
    }

    return result;
  } catch (
    error
  ) {
    const finishedAt =
      new Date()
        .toISOString();

    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_EOD_SYNC_ERROR";

    await supabase
      .from(
        "market_eod_sync_runs",
      )
      .update({
        finished_at:
          finishedAt,

        status:
          "FAILED",

        error_message:
          message,

        result: {
          version:
            "MARKET_EOD_SYNC_V7_8_1",

          runId,

          status:
            "FAILED",

          startedAt,
          finishedAt,

          durationMs:
            elapsedMilliseconds(
              startedAt,
              finishedAt,
            ),

          expectedMarketDate,

          syncRange: {
            startDate:
              syncStartDate,

            endDate:
              syncEndDate,

            lookbackCalendarDays,
          },

          error:
            message,

          productionApplied:
            false,
        },

        production_applied:
          false,
      })
      .eq(
        "id",
        runId,
      );

    throw error;
  }
}