import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type ImportRow = {
  id:
    string;

  as_of_date:
    string;
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

async function loadCalendar(
  indexCode:
    string,
  startDate:
    string,
  endDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const output:
    string[] = [];

  const pageSize =
    1000;

  for (
    let offset =
      0;
    ;
    offset +=
      pageSize
  ) {
    const {
      data,
      error,
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
          indexCode,
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
        .range(
          offset,
          offset +
            pageSize -
            1,
        );

    if (
      error
    ) {
      throw new Error(
        `v9.3B.3 calendar load failed: ${error.message}`,
      );
    }

    const page =
      (
        data ??
        []
      ).map(
        (
          row,
        ) =>
          String(
            row.trading_date,
          ),
      );

    output.push(
      ...page,
    );

    if (
      page.length <
        pageSize
    ) {
      break;
    }
  }

  return [
    ...new Set(
      output,
    ),
  ];
}

async function loadImports(
  universeCode:
    string,
  provider:
    string,
  startDate:
    string,
  endDate:
    string,
  isValidation:
    boolean,
) {
  const supabase =
    createSupabaseServerClient();

  const output:
    ImportRow[] = [];

  const pageSize =
    1000;

  for (
    let offset =
      0;
    ;
    offset +=
      pageSize
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "historical_universe_snapshot_imports",
        )
        .select(
          "id,as_of_date",
        )
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "provider",
          provider,
        )
        .eq(
          "coverage_status",
          "COMPLETE",
        )
        .eq(
          "status",
          "IMPORTED",
        )
        .eq(
          "is_validation",
          isValidation,
        )
        .gte(
          "as_of_date",
          startDate,
        )
        .lte(
          "as_of_date",
          endDate,
        )
        .order(
          "as_of_date",
          {
            ascending:
              true,
          },
        )
        .range(
          offset,
          offset +
            pageSize -
            1,
        );

    if (
      error
    ) {
      throw new Error(
        `v9.3B.3 import load failed: ${error.message}`,
      );
    }

    const page =
      (
        data ??
        []
      ) as ImportRow[];

    output.push(
      ...page,
    );

    if (
      page.length <
        pageSize
    ) {
      break;
    }
  }

  return output;
}

export async function createHistoricalPitChunkedCompilationV93B3(
  input: {
    universeCode:
      string;

    provider:
      string;

    startDate:
      string;

    endDate:
      string;

    calendarIndexCode?:
      string;

    chunkTradingDays?:
      number;

    maxAttempts?:
      number;

    isValidation?:
      boolean;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      .trim();

  const provider =
    input
      .provider
      .trim();

  const startDate =
    requireDate(
      input.startDate,
      "START_DATE",
    );

  const endDate =
    requireDate(
      input.endDate,
      "END_DATE",
    );

  const calendarIndexCode =
    input
      .calendarIndexCode
      ?.trim() ||
    "0001";

  const chunkTradingDays =
    Math.max(
      2,
      Math.min(
        20,
        Math.floor(
          input.chunkTradingDays ??
            10,
        ),
      ),
    );

  const maxAttempts =
    Math.max(
      1,
      Math.min(
        10,
        Math.floor(
          input.maxAttempts ??
            3,
        ),
      ),
    );

  const isValidation =
    input.isValidation ===
    true;

  if (
    !universeCode ||
    !provider
  ) {
    throw new Error(
      "V9_3B_3_REQUIRED_METADATA_MISSING",
    );
  }

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V9_3B_3_START_DATE_AFTER_END_DATE",
    );
  }

  const [
    calendar,
    imports,
  ] =
    await Promise.all([
      loadCalendar(
        calendarIndexCode,
        startDate,
        endDate,
      ),

      loadImports(
        universeCode,
        provider,
        startDate,
        endDate,
        isValidation,
      ),
    ]);

  const importsByDate =
    new Map<
      string,
      ImportRow[]
    >();

  for (
    const item
    of imports
  ) {
    const bucket =
      importsByDate.get(
        item.as_of_date,
      ) ??
      [];

    bucket.push(
      item,
    );

    importsByDate.set(
      item.as_of_date,
      bucket,
    );
  }

  const missingDates =
    calendar.filter(
      (
        date,
      ) =>
        (
          importsByDate.get(
            date,
          ) ??
          []
        ).length ===
        0,
    );

  const duplicateDates =
    calendar.filter(
      (
        date,
      ) =>
        (
          importsByDate.get(
            date,
          ) ??
          []
        ).length >
        1,
    );

  const importedCompleteDates =
    calendar.filter(
      (
        date,
      ) =>
        (
          importsByDate.get(
            date,
          ) ??
          []
        ).length ===
        1,
    ).length;

  if (
    calendar.length ===
      0 ||
    missingDates.length >
      0 ||
    duplicateDates.length >
      0
  ) {
    return {
      version:
        "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3",

      status:
        "BLOCKED_SNAPSHOT_COVERAGE",

      compilationRunId:
        null,

      coverage: {
        expectedTradingDates:
          calendar.length,

        importedCompleteDates,

        missingTradingDates:
          missingDates.length,

        duplicateCompleteDates:
          duplicateDates.length,

        missingDates:
          missingDates.slice(
            0,
            100,
          ),

        duplicateDates:
          duplicateDates.slice(
            0,
            100,
          ),
      },

      productionApplied:
        false,
    };
  }

  const chunks:
    Array<{
      chunkNo:
        number;

      startDate:
        string;

      endDate:
        string;

      tradingDateCount:
        number;
    }> =
    [];

  for (
    let offset =
      0,
      chunkNo =
        0;
    offset <
      calendar.length;
    offset +=
      chunkTradingDays,
      chunkNo +=
        1
  ) {
    const dates =
      calendar.slice(
        offset,
        offset +
          chunkTradingDays,
      );

    chunks.push({
      chunkNo,

      startDate:
        dates[0],

      endDate:
        dates[
          dates.length -
            1
        ],

      tradingDateCount:
        dates.length,
    });
  }

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .insert({
        universe_code:
          universeCode,

        provider,

        calendar_index_code:
          calendarIndexCode,

        start_date:
          startDate,

        end_date:
          endDate,

        status:
          "RUNNING",

        expected_trading_dates:
          calendar.length,

        imported_complete_dates:
          importedCompleteDates,

        missing_trading_dates:
          0,

        duplicate_complete_dates:
          0,

        compiled_interval_count:
          0,

        metadata: {
          version:
            "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3",

          executionMode:
            "CHUNKED_DB",

          chunkTradingDays,

          chunkCount:
            chunks.length,

          maxAttempts,

          sourceImportIdPolicy:
            "FIRST_LAST_ONLY",

          dailyRawSnapshotsRetained:
            true,

          canonicalPromotion:
            false,
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
    runError ||
    !run
  ) {
    throw new Error(
      `v9.3B.3 compilation-run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const compilationRunId =
    String(
      run.id,
    );

  try {
    for (
      let offset =
        0;
      offset <
        chunks.length;
      offset +=
        200
    ) {
      const rows =
        chunks
          .slice(
            offset,
            offset +
              200,
          )
          .map(
            (
              chunk,
            ) => ({
              compilation_run_id:
                compilationRunId,

              chunk_no:
                chunk.chunkNo,

              start_date:
                chunk.startDate,

              end_date:
                chunk.endDate,

              status:
                "PENDING",

              max_attempts:
                maxAttempts,

              metadata: {
                tradingDateCount:
                  chunk.tradingDateCount,
              },
            }),
          );

      const {
        error,
      } =
        await supabase
          .from(
            "historical_universe_compilation_chunks",
          )
          .insert(
            rows,
          );

      if (
        error
      ) {
        throw new Error(
          `v9.3B.3 chunk insert failed: ${error.message}`,
        );
      }
    }

    const {
      data: progressData,
      error: progressError,
    } =
      await supabase
        .rpc(
          "refresh_historical_universe_compilation_v9_3b_3",
          {
            p_compilation_run_id:
              compilationRunId,
          },
        );

    if (
      progressError
    ) {
      throw new Error(
        `v9.3B.3 initial progress failed: ${progressError.message}`,
      );
    }

    return {
      version:
        "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_3",

      compilationRunId,

      status:
        "RUNNING",

      coverage: {
        expectedTradingDates:
          calendar.length,

        importedCompleteDates,

        missingTradingDates:
          0,

        duplicateCompleteDates:
          0,
      },

      chunking: {
        chunkTradingDays,

        chunkCount:
          chunks.length,

        firstChunk:
          chunks[0],

        lastChunk:
          chunks[
            chunks.length -
              1
          ],
      },

      progress:
        Array.isArray(
          progressData,
        )
          ? progressData[0] ??
            null
          : progressData,

      safety: {
        intervalSemantics:
          "[valid_from,valid_to)",

        canonicalMembershipsModified:
          false,

        currentUniverseBackfilledIntoPast:
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
        : "UNKNOWN_V9_3B_3_CREATE_ERROR";

    await supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .update({
        status:
          "FAILED",

        error_message:
          message,

        finished_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        compilationRunId,
      );

    throw error;
  }
}
