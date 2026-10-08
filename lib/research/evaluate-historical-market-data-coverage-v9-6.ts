import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type CompilationRow = {
  id:
    string;

  universe_code:
    string;

  provider:
    string;

  calendar_index_code:
    string;

  start_date:
    string;

  end_date:
    string;

  status:
    string;

  is_validation:
    boolean;
};

type CoverageRow = {
  stock_code:
    string;

  stock_name:
    string;

  market:
    string;

  first_expected_date:
    string | null;

  last_expected_date:
    string | null;

  first_available_date:
    string | null;

  last_available_date:
    string | null;

  expected_bars:
    number | string;

  available_bars:
    number | string;

  missing_bars:
    number | string;

  coverage_rate:
    number | string;
};

function requireDate(
  value:
    string,
  name:
    string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    throw new Error(
      `INVALID_${name}`,
    );
  }

  return value;
}

function clamp01(
  value:
    number,
) {
  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

async function resolveCompilation(
  input: {
    compilationRunId?:
      string;

    universeCode:
      string;

    startDate:
      string;

    endDate:
      string;

    isValidation:
      boolean;
  },
) {
  const supabase =
    createSupabaseServerClient();

  let query =
    supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .select(`
        id,
        universe_code,
        provider,
        calendar_index_code,
        start_date,
        end_date,
        status,
        is_validation
      `)
      .eq(
        "is_validation",
        input.isValidation,
      );

  if (
    input.compilationRunId
  ) {
    query =
      query.eq(
        "id",
        input.compilationRunId,
      );
  } else {
    query =
      query
        .eq(
          "universe_code",
          input.universeCode,
        )
        .lte(
          "start_date",
          input.startDate,
        )
        .gte(
          "end_date",
          input.endDate,
        );
  }

  const {
    data,
    error,
  } =
    await query
      .order(
        "started_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `v9.6 PIT compilation lookup failed: ${error.message}`,
    );
  }

  return (
    data ??
    null
  ) as CompilationRow | null;
}

export async function evaluateHistoricalMarketDataCoverageV96(
  input: {
    universeCode?:
      string;

    startDate?:
      string;

    endDate?:
      string;

    compilationRunId?:
      string;

    minimumOverallBarCoverageRate?:
      number;

    minimumPerMemberCoverageRate?:
      number;

    minimumReadyMemberRate?:
      number;

    isValidation?:
      boolean;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "KRX_ALL_LISTED";

  const startDate =
    requireDate(
      input.startDate ??
        "2023-01-02",
      "START_DATE",
    );

  const endDate =
    requireDate(
      input.endDate ??
        "2026-07-31",
      "END_DATE",
    );

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V9_6_START_DATE_AFTER_END_DATE",
    );
  }

  const minimumOverallBarCoverageRate =
    clamp01(
      input
        .minimumOverallBarCoverageRate ??
      0.95,
    );

  const minimumPerMemberCoverageRate =
    clamp01(
      input
        .minimumPerMemberCoverageRate ??
      0.80,
    );

  const minimumReadyMemberRate =
    clamp01(
      input
        .minimumReadyMemberRate ??
      0.80,
    );

  const isValidation =
    input.isValidation ===
    true;

  const compilation =
    await resolveCompilation({
      compilationRunId:
        input
          .compilationRunId
          ?.trim(),

      universeCode,

      startDate,
      endDate,

      isValidation,
    });

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "historical_market_data_coverage_runs",
      )
      .insert({
        version:
          "HISTORICAL_MARKET_DATA_COVERAGE_V9_6",

        universe_code:
          universeCode,

        compilation_run_id:
          compilation
            ?.id ??
          null,

        start_date:
          startDate,

        end_date:
          endDate,

        status:
          "RUNNING",

        minimum_overall_bar_coverage_rate:
          minimumOverallBarCoverageRate,

        minimum_per_member_coverage_rate:
          minimumPerMemberCoverageRate,

        minimum_ready_member_rate:
          minimumReadyMemberRate,

        is_validation:
          isValidation,

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    runError ||
    !run
  ) {
    throw new Error(
      `v9.6 coverage-run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const coverageRunId =
    String(
      run.id,
    );

  try {
    if (
      !compilation ||
      compilation.status !==
        "READY"
    ) {
      const summary = {
        pitCompilation:
          compilation ??
          null,

        reason:
          "Historical PIT compilation is missing or not READY.",

        currentUniverseSubstituted:
          false,

        productionApplied:
          false,
      };

      const {
        error,
      } =
        await supabase
          .rpc(
            "finish_historical_market_data_coverage_run_v9_6",
            {
              p_run_id:
                coverageRunId,

              p_status:
                "BLOCKED_PIT",

              p_observed_member_count:
                0,

              p_data_ready_member_count:
                0,

              p_expected_bar_count:
                0,

              p_available_bar_count:
                0,

              p_missing_bar_count:
                0,

              p_overall_bar_coverage_rate:
                0,

              p_ready_member_rate:
                0,

              p_summary:
                summary,

              p_error_message:
                null,
            },
          );

      if (
        error
      ) {
        throw new Error(
          `v9.6 blocked-run finish failed: ${error.message}`,
        );
      }

      return {
        version:
          "HISTORICAL_MARKET_DATA_COVERAGE_V9_6",

        coverageRunId,

        status:
          "BLOCKED_PIT",

        summary,

        safety: {
          currentUniverseSubstituted:
            false,

          coverageAssertionWritten:
            false,

          productionApplied:
            false,
        },
      };
    }

    const rows:
      CoverageRow[] = [];

    /*
     * v9.6.4:
     * Full Historical PIT now spans ~2.3M expected stock-days.
     * The original 500-security RPC page can exceed PostgreSQL
     * statement_timeout even at offset 0.
     *
     * Start conservatively at 50 securities per RPC and, only when
     * PostgreSQL reports statement timeout, retry the SAME offset with
     * progressively smaller pages down to 10.
     *
     * This changes computation granularity only:
     * - exact Historical PIT compilation is unchanged
     * - market_daily_bars is read-only
     * - current universe is never substituted
     * - thresholds and final COMPLETE criteria are unchanged
     */
    let offset =
      0;

    let pageSize =
      50;

    const minimumPageSize =
      10;

    while (
      true
    ) {
      let requestedPageSize =
        pageSize;

      let page:
        CoverageRow[] =
        [];

      while (
        true
      ) {
        const {
          data,
          error,
        } =
          await supabase
            .rpc(
              "compute_historical_market_data_coverage_v9_6",
              {
                p_compilation_run_id:
                  compilation.id,

                p_start_date:
                  startDate,

                p_end_date:
                  endDate,

                p_offset:
                  offset,

                p_limit:
                  requestedPageSize,
              },
            );

        if (
          !error
        ) {
          page =
            (
              data ??
              []
            ) as CoverageRow[];

          break;
        }

        const message =
          String(
            error.message ??
            "",
          );

        const timedOut =
          message
            .toLowerCase()
            .includes(
              "statement timeout",
            );

        if (
          !timedOut ||
          requestedPageSize <=
            minimumPageSize
        ) {
          throw new Error(
            `v9.6 coverage RPC failed at offset ${offset} ` +
            `pageSize=${requestedPageSize}: ${message}`,
          );
        }

        requestedPageSize =
          Math.max(
            minimumPageSize,
            Math.floor(
              requestedPageSize /
              2,
            ),
          );
      }

      pageSize =
        requestedPageSize;

      rows.push(
        ...page,
      );

      offset +=
        page.length;

      if (
        page.length <
          pageSize
      ) {
        break;
      }
    }

    const normalized =
      rows.map(
        (
          row,
        ) => {
          const expectedBars =
            Number(
              row.expected_bars ??
              0,
            );

          const availableBars =
            Number(
              row.available_bars ??
              0,
            );

          const missingBars =
            Number(
              row.missing_bars ??
              0,
            );

          const coverageRate =
            Number(
              row.coverage_rate ??
              0,
            );

          return {
            stockCode:
              row.stock_code,

            stockName:
              row.stock_name,

            market:
              row.market,

            firstExpectedDate:
              row
                .first_expected_date,

            lastExpectedDate:
              row
                .last_expected_date,

            firstAvailableDate:
              row
                .first_available_date,

            lastAvailableDate:
              row
                .last_available_date,

            expectedBars,
            availableBars,
            missingBars,

            coverageRate,

            dataReady:
              expectedBars >
                0 &&
              coverageRate >=
                minimumPerMemberCoverageRate,
          };
        },
      );

    const observedMemberCount =
      normalized.length;

    const dataReadyMemberCount =
      normalized.filter(
        (
          row,
        ) =>
          row.dataReady,
      ).length;

    const expectedBarCount =
      normalized.reduce(
        (
          sum,
          row,
        ) =>
          sum +
          row.expectedBars,
        0,
      );

    const availableBarCount =
      normalized.reduce(
        (
          sum,
          row,
        ) =>
          sum +
          row.availableBars,
        0,
      );

    const missingBarCount =
      normalized.reduce(
        (
          sum,
          row,
        ) =>
          sum +
          row.missingBars,
        0,
      );

    const overallBarCoverageRate =
      expectedBarCount >
        0
        ? availableBarCount /
          expectedBarCount
        : 0;

    const readyMemberRate =
      observedMemberCount >
        0
        ? dataReadyMemberCount /
          observedMemberCount
        : 0;

    const coverageComplete =
      observedMemberCount >
        0 &&
      overallBarCoverageRate >=
        minimumOverallBarCoverageRate &&
      readyMemberRate >=
        minimumReadyMemberRate;

    const status =
      coverageComplete
        ? "COMPLETE"
        : "INSUFFICIENT_DATA";

    const resultRows =
      normalized.map(
        (
          row,
        ) => ({
          coverage_run_id:
            coverageRunId,

          stock_code:
            row.stockCode,

          stock_name:
            row.stockName,

          market:
            row.market,

          first_expected_date:
            row.firstExpectedDate,

          last_expected_date:
            row.lastExpectedDate,

          first_available_date:
            row.firstAvailableDate,

          last_available_date:
            row.lastAvailableDate,

          expected_bars:
            row.expectedBars,

          available_bars:
            row.availableBars,

          missing_bars:
            row.missingBars,

          coverage_rate:
            row.coverageRate,

          data_ready:
            row.dataReady,

          is_validation:
            isValidation,

          production_applied:
            false,
        }),
      );

    for (
      let offset =
        0;
      offset <
        resultRows.length;
      offset +=
        500
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "historical_market_data_coverage_results",
          )
          .insert(
            resultRows.slice(
              offset,
              offset +
                500,
            ),
          );

      if (
        error
      ) {
        throw new Error(
          `v9.6 result insert failed at ${offset}: ${error.message}`,
        );
      }
    }

    const worstCoverage =
      [...normalized]
        .sort(
          (
            left,
            right,
          ) =>
            left.coverageRate -
            right.coverageRate,
        )
        .slice(
          0,
          20,
        )
        .map(
          (
            row,
          ) => ({
            stockCode:
              row.stockCode,

            stockName:
              row.stockName,

            market:
              row.market,

            expectedBars:
              row.expectedBars,

            availableBars:
              row.availableBars,

            missingBars:
              row.missingBars,

            coverageRate:
              row.coverageRate,
          }),
        );

    const summary = {
      pitCompilation: {
        id:
          compilation.id,

        provider:
          compilation.provider,

        startDate:
          compilation.start_date,

        endDate:
          compilation.end_date,
      },

      criteria: {
        minimumOverallBarCoverageRate,
        minimumPerMemberCoverageRate,
        minimumReadyMemberRate,

        availableBarRequires:
          "positive OHLC and non-null non-negative volume",
      },

      counts: {
        observedMemberCount,
        dataReadyMemberCount,
        expectedBarCount,
        availableBarCount,
        missingBarCount,
      },

      coverage: {
        overallBarCoverageRate,
        readyMemberRate,
      },

      worstCoverage,

      safety: {
        exactHistoricalPitUsed:
          true,

        currentUniverseSubstituted:
          false,

        rawBarsModified:
          false,

        productionApplied:
          false,
      },
    };

    const {
      error: finishError,
    } =
      await supabase
        .rpc(
          "finish_historical_market_data_coverage_run_v9_6",
          {
            p_run_id:
              coverageRunId,

            p_status:
              status,

            p_observed_member_count:
              observedMemberCount,

            p_data_ready_member_count:
              dataReadyMemberCount,

            p_expected_bar_count:
              expectedBarCount,

            p_available_bar_count:
              availableBarCount,

            p_missing_bar_count:
              missingBarCount,

            p_overall_bar_coverage_rate:
              overallBarCoverageRate,

            p_ready_member_rate:
              readyMemberRate,

            p_summary:
              summary,

            p_error_message:
              null,
          },
        );

    if (
      finishError
    ) {
      throw new Error(
        `v9.6 coverage-run finish failed: ${finishError.message}`,
      );
    }

    const {
      data: assertion,
      error: assertionError,
    } =
      await supabase
        .from(
          "historical_market_data_coverage_assertions",
        )
        .insert({
          universe_code:
            universeCode,

          start_date:
            startDate,

          end_date:
            endDate,

          provider:
            "MARKET_DAILY_BARS_V9_6",

          coverage_status:
            coverageComplete
              ? "COMPLETE"
              : "PARTIAL",

          observed_member_count:
            observedMemberCount,

          data_ready_member_count:
            dataReadyMemberCount,

          observed_coverage_rate:
            overallBarCoverageRate,

          minimum_required_rate:
            minimumOverallBarCoverageRate,

          evidence: {
            coverageRunId,

            compilationRunId:
              compilation.id,

            readyMemberRate,

            minimumReadyMemberRate,

            minimumPerMemberCoverageRate,

            exactHistoricalPitUsed:
              true,
          },

          is_validation:
            isValidation,

          production_applied:
            false,
        })
        .select(
          "id",
        )
        .single();

    if (
      assertionError ||
      !assertion
    ) {
      throw new Error(
        `v9.6 coverage assertion insert failed: ${
          assertionError?.message ??
          "NO_ASSERTION"
        }`,
      );
    }

    return {
      version:
        "HISTORICAL_MARKET_DATA_COVERAGE_V9_6",

      coverageRunId,

      assertionId:
        assertion.id,

      status,

      summary,

      safety: {
        exactHistoricalPitUsed:
          true,

        currentUniverseSubstituted:
          false,

        rawMarketDailyBarsModified:
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
        : "UNKNOWN_V9_6_COVERAGE_ERROR";

    await supabase
      .rpc(
        "finish_historical_market_data_coverage_run_v9_6",
        {
          p_run_id:
            coverageRunId,

          p_status:
            "FAILED",

          p_observed_member_count:
            0,

          p_data_ready_member_count:
            0,

          p_expected_bar_count:
            0,

          p_available_bar_count:
            0,

          p_missing_bar_count:
            0,

          p_overall_bar_coverage_rate:
            0,

          p_ready_member_rate:
            0,

          p_summary:
            {
              productionApplied:
                false,
            },

          p_error_message:
            message,
        },
      );

    throw error;
  }
}

