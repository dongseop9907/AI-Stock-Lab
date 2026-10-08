import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateHistoricalMarketDataCoverageV96,
} from "@/lib/research/evaluate-historical-market-data-coverage-v9-6";

export async function validateHistoricalMarketDataCoverageV96() {
  const supabase =
    createSupabaseServerClient();

  let compilationRunId:
    string | null =
    null;

  let coverageRunId:
    string | null =
    null;

  let assertionId:
    string | null =
    null;

  let cleanupSucceeded =
    false;

  try {
    const {
      data: calendarData,
      error: calendarError,
    } =
      await supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "index_code",
          "0001",
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(10);

    if (
      calendarError
    ) {
      throw new Error(
        `v9.6 validation calendar load failed: ${calendarError.message}`,
      );
    }

    const dates =
      (
        calendarData ??
        []
      )
        .map(
          (
            row,
          ) =>
            String(
              row.trading_date,
            ),
        )
        .sort();

    if (
      dates.length <
      4
    ) {
      throw new Error(
        "V9_6_VALIDATION_NEEDS_4_MARKET_DATES",
      );
    }

    const selectedDates =
      dates.slice(
        -4,
      );

    const {
      data: barData,
      error: barError,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(
          "stock_code,trading_date,open_price,high_price,low_price,close_price,volume",
        )
        .in(
          "trading_date",
          selectedDates,
        )
        .gt(
          "open_price",
          0,
        )
        .gt(
          "high_price",
          0,
        )
        .gt(
          "low_price",
          0,
        )
        .gt(
          "close_price",
          0,
        )
        .gte(
          "volume",
          0,
        );

    if (
      barError
    ) {
      throw new Error(
        `v9.6 validation bar load failed: ${barError.message}`,
      );
    }

    const byStock =
      new Map<
        string,
        Set<string>
      >();

    for (
      const row
      of barData ??
      []
    ) {
      const code =
        String(
          row.stock_code,
        );

      const set =
        byStock.get(
          code,
        ) ??
        new Set<string>();

      set.add(
        String(
          row.trading_date,
        ),
      );

      byStock.set(
        code,
        set,
      );
    }

    const candidate =
      [
        ...byStock.entries(),
      ].find(
        (
          [
            ,
            observedDates,
          ],
        ) =>
          selectedDates.every(
            (
              date,
            ) =>
              observedDates.has(
                date,
              ),
          ),
      );

    if (
      !candidate
    ) {
      throw new Error(
        "V9_6_VALIDATION_NO_FULLY_COVERED_STOCK",
      );
    }

    const stockCode =
      candidate[0];

    const {
      data: security,
      error: securityError,
    } =
      await supabase
        .from(
          "stock_universe_securities",
        )
        .select(
          "stock_code,stock_name,market",
        )
        .eq(
          "stock_code",
          stockCode,
        )
        .maybeSingle();

    if (
      securityError
    ) {
      throw new Error(
        `v9.6 validation security lookup failed: ${securityError.message}`,
      );
    }

    if (
      !security
    ) {
      throw new Error(
        "V9_6_VALIDATION_SECURITY_NOT_IN_MASTER",
      );
    }

    const startDate =
      selectedDates[0];

    const endDate =
      selectedDates[
        selectedDates.length -
        1
      ];

    const {
      data: compilation,
      error: compilationError,
    } =
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .insert({
          universe_code:
            "KRX_ALL_LISTED",

          provider:
            "SYNTHETIC_MARKET_DATA_COVERAGE_V9_6",

          calendar_index_code:
            "0001",

          start_date:
            startDate,

          end_date:
            endDate,

          status:
            "READY",

          expected_trading_dates:
            selectedDates.length,

          imported_complete_dates:
            selectedDates.length,

          missing_trading_dates:
            0,

          duplicate_complete_dates:
            0,

          compiled_interval_count:
            1,

          metadata: {
            synthetic:
              true,
          },

          is_validation:
            true,

          production_applied:
            false,

          finished_at:
            new Date()
              .toISOString(),
        })
        .select(
          "id",
        )
        .single();

    if (
      compilationError ||
      !compilation
    ) {
      throw new Error(
        `v9.6 validation compilation create failed: ${
          compilationError?.message ??
          "NO_COMPILATION"
        }`,
      );
    }

    compilationRunId =
      String(
        compilation.id,
      );

    const nextDate =
      (
        await supabase
          .from(
            "market_index_daily_bars",
          )
          .select(
            "trading_date",
          )
          .eq(
            "index_code",
            "0001",
          )
          .gt(
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
          .limit(1)
          .maybeSingle()
      ).data
        ?.trading_date;

    const validTo =
      nextDate
        ? String(
            nextDate,
          )
        : (() => {
            const date =
              new Date(
                `${endDate}T00:00:00.000Z`,
              );

            date.setUTCDate(
              date.getUTCDate() +
                1,
            );

            return date
              .toISOString()
              .slice(
                0,
                10,
              );
          })();

    const {
      error: membershipError,
    } =
      await supabase
        .from(
          "historical_universe_compiled_memberships",
        )
        .insert({
          compilation_run_id:
            compilationRunId,

          universe_code:
            "KRX_ALL_LISTED",

          stock_code:
            stockCode,

          stock_name:
            security.stock_name,

          market:
            security.market,

          sector:
            null,

          security_type:
            "COMMON",

          listed:
            true,

          tradable:
            true,

          valid_from:
            startDate,

          valid_to:
            validTo,

          evidence_type:
            "SYNTHETIC_VALIDATION",

          source_provider:
            "SYNTHETIC_MARKET_DATA_COVERAGE_V9_6",

          source_import_ids:
            [],

          metadata: {
            synthetic:
              true,
          },

          is_validation:
            true,

          production_applied:
            false,
        });

    if (
      membershipError
    ) {
      throw new Error(
        `v9.6 validation membership insert failed: ${membershipError.message}`,
      );
    }

    const result =
      await evaluateHistoricalMarketDataCoverageV96({
        universeCode:
          "KRX_ALL_LISTED",

        startDate,
        endDate,

        compilationRunId,

        minimumOverallBarCoverageRate:
          1,

        minimumPerMemberCoverageRate:
          1,

        minimumReadyMemberRate:
          1,

        isValidation:
          true,
      });

    coverageRunId =
      result.coverageRunId;

    assertionId =
      "assertionId" in
        result
        ? String(
            result.assertionId,
          )
        : null;

    // v9.6.1:
    // The evaluator can also return BLOCKED_PIT, whose summary intentionally
    // has no counts/coverage fields. This validation path supplies a READY
    // validation-only PIT compilation, so BLOCKED_PIT is a validation failure.
    // Narrow the union before reading success-summary fields.
    if (
      !(
        "counts" in
        result.summary
      ) ||
      !(
        "coverage" in
        result.summary
      )
    ) {
      throw new Error(
        `V9_6_VALIDATION_UNEXPECTED_STATUS_${result.status}`,
      );
    }

    const completeSummary =
      result.summary;

    const assertions = {
      coverageComplete:
        result.status ===
        "COMPLETE",

      oneObservedMember:
        completeSummary
          .counts
          ?.observedMemberCount ===
        1,

      oneReadyMember:
        completeSummary
          .counts
          ?.dataReadyMemberCount ===
        1,

      allExpectedBarsAvailable:
        completeSummary
          .counts
          ?.expectedBarCount ===
          selectedDates.length &&
        completeSummary
          .counts
          ?.availableBarCount ===
          selectedDates.length &&
        completeSummary
          .counts
          ?.missingBarCount ===
          0,

      overallCoverageExactlyOne:
        completeSummary
          .coverage
          ?.overallBarCoverageRate ===
        1,

      readyMemberRateExactlyOne:
        completeSummary
          .coverage
          ?.readyMemberRate ===
        1,

      exactHistoricalPitUsed:
        result
          .safety
          ?.exactHistoricalPitUsed ===
        true,

      currentUniverseNotSubstituted:
        result
          .safety
          ?.currentUniverseSubstituted ===
        false,

      rawBarsPreserved:
        result
          .safety
          ?.rawMarketDailyBarsModified ===
        false,

      productionNotApplied:
        result
          .safety
          ?.productionApplied ===
        false,
    };

    const passed =
      Object.values(
        assertions,
      ).every(
        (
          value,
        ) =>
          value ===
          true,
      );

    if (
      assertionId
    ) {
      await supabase
        .from(
          "historical_market_data_coverage_assertions",
        )
        .delete()
        .eq(
          "id",
          assertionId,
        );
    }

    if (
      coverageRunId
    ) {
      await supabase
        .from(
          "historical_market_data_coverage_runs",
        )
        .delete()
        .eq(
          "id",
          coverageRunId,
        );
    }

    if (
      compilationRunId
    ) {
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .delete()
        .eq(
          "id",
          compilationRunId,
        );
    }

    cleanupSucceeded =
      true;

    const {
      data: audit,
      error: auditError,
    } =
      await supabase
        .from(
          "historical_market_data_coverage_validation_runs",
        )
        .insert({
          validation_version:
            "HISTORICAL_MARKET_DATA_COVERAGE_VALIDATION_V9_6",

          status:
            passed
              ? "PASS"
              : "FAIL",

          assertions,

          cleanup_succeeded:
            cleanupSucceeded,

          production_applied:
            false,
        })
        .select(
          "id",
        )
        .single();

    if (
      auditError ||
      !audit
    ) {
      throw new Error(
        `v9.6 validation audit failed: ${
          auditError?.message ??
          "NO_AUDIT"
        }`,
      );
    }

    return {
      version:
        "HISTORICAL_MARKET_DATA_COVERAGE_VALIDATION_V9_6",

      validationRunId:
        audit.id,

      status:
        passed
          ? "PASS"
          : "FAIL",

      stockCode,

      dates:
        selectedDates,

      assertions,

      cleanup: {
        succeeded:
          cleanupSucceeded,
      },

      safety: {
        realMarketBarsModified:
          false,

        canonicalPitModified:
          false,

        productionApplied:
          false,
      },
    };
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V9_6_VALIDATION_ERROR";

    if (
      assertionId
    ) {
      await supabase
        .from(
          "historical_market_data_coverage_assertions",
        )
        .delete()
        .eq(
          "id",
          assertionId,
        );
    }

    if (
      coverageRunId
    ) {
      await supabase
        .from(
          "historical_market_data_coverage_runs",
        )
        .delete()
        .eq(
          "id",
          coverageRunId,
        );
    }

    if (
      compilationRunId
    ) {
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .delete()
        .eq(
          "id",
          compilationRunId,
        );
    }

    cleanupSucceeded =
      true;

    await supabase
      .from(
        "historical_market_data_coverage_validation_runs",
      )
      .insert({
        validation_version:
          "HISTORICAL_MARKET_DATA_COVERAGE_VALIDATION_V9_6",

        status:
          "FAIL",

        assertions: {
          runtimeError:
            message,

          productionNotApplied:
            true,
        },

        cleanup_succeeded:
          cleanupSucceeded,

        error_message:
          message,

        production_applied:
          false,
      });

    throw error;
  }
}
