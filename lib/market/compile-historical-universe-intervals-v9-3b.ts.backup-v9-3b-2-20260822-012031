import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type ImportRow = {
  id:
    string;

  as_of_date:
    string;
};

type SnapshotRow = {
  stock_code:
    string;

  stock_name:
    string;

  market:
    "KOSPI" |
    "KOSDAQ" |
    "KONEX" |
    "UNKNOWN";

  sector:
    string | null;

  security_type:
    string;

  listed:
    boolean;

  tradable:
    boolean;
};

type OpenInterval = {
  stockCode:
    string;

  stockName:
    string;

  market:
    SnapshotRow["market"];

  sector:
    string | null;

  securityType:
    string;

  listed:
    boolean;

  tradable:
    boolean;

  validFrom:
    string;

  sourceImportIds:
    string[];
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

function addCalendarDay(
  sqlDate:
    string,
) {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
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
}

function signature(
  row:
    SnapshotRow |
    OpenInterval,
) {
  if (
    "stock_code" in
    row
  ) {
    return JSON.stringify({
      stockName:
        row.stock_name,

      market:
        row.market,

      sector:
        row.sector,

      securityType:
        row.security_type,

      listed:
        row.listed,

      tradable:
        row.tradable,
    });
  }

  return JSON.stringify({
    stockName:
      row.stockName,

    market:
      row.market,

    sector:
      row.sector,

    securityType:
      row.securityType,

    listed:
      row.listed,

    tradable:
      row.tradable,
  });
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
        `v9.3B calendar load failed: ${error.message}`,
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
        `v9.3B import load failed: ${error.message}`,
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

async function loadSnapshotRows(
  importId:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const output:
    SnapshotRow[] = [];

  const pageSize =
    500;

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
          "historical_universe_snapshot_rows",
        )
        .select(`
          stock_code,
          stock_name,
          market,
          sector,
          security_type,
          listed,
          tradable
        `)
        .eq(
          "import_id",
          importId,
        )
        .order(
          "stock_code",
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
        `v9.3B snapshot-row load failed: ${error.message}`,
      );
    }

    const page =
      (
        data ??
        []
      ) as SnapshotRow[];

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

async function resolveEndExclusive(
  indexCode:
    string,
  endDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

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
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `v9.3B next-market-date lookup failed: ${error.message}`,
    );
  }

  return data
    ?.trading_date
    ? String(
        data.trading_date,
      )
    : addCalendarDay(
        endDate,
      );
}

export async function compileHistoricalUniverseIntervalsV93B(
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

  const isValidation =
    input.isValidation ===
    true;

  if (
    !universeCode ||
    !provider
  ) {
    throw new Error(
      "V9_3B_REQUIRED_METADATA_MISSING",
    );
  }

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V9_3B_START_DATE_AFTER_END_DATE",
    );
  }

  const calendar =
    await loadCalendar(
      calendarIndexCode,
      startDate,
      endDate,
    );

  const imports =
    await loadImports(
      universeCode,
      provider,
      startDate,
      endDate,
      isValidation,
    );

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
          missingDates.length,

        duplicate_complete_dates:
          duplicateDates.length,

        metadata: {
          version:
            "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B",

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
      `v9.3B compilation-run create failed: ${
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
    if (
      calendar.length ===
        0 ||
      missingDates.length >
        0 ||
      duplicateDates.length >
        0
    ) {
      const {
        error,
      } =
        await supabase
          .rpc(
            "finish_historical_universe_compilation_v9_3b",
            {
              p_compilation_run_id:
                compilationRunId,

              p_status:
                "BLOCKED_SNAPSHOT_COVERAGE",

              p_compiled_interval_count:
                0,

              p_error_message:
                null,
            },
          );

      if (
        error
      ) {
        throw new Error(
          `v9.3B blocked-run finish failed: ${error.message}`,
        );
      }

      return {
        version:
          "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B",

        compilationRunId,

        status:
          "BLOCKED_SNAPSHOT_COVERAGE",

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

        safety: {
          canonicalMembershipsModified:
            false,

          incompleteSnapshotsPromoted:
            false,

          currentUniverseBackfilledIntoPast:
            false,

          productionApplied:
            false,
        },
      };
    }

    const snapshots =
      new Map<
        string,
        {
          importId:
            string;

          rows:
            SnapshotRow[];
        }
      >();

    for (
      const date
      of calendar
    ) {
      const importRow =
        importsByDate.get(
          date,
        )![0];

      snapshots.set(
        date,
        {
          importId:
            importRow.id,

          rows:
            await loadSnapshotRows(
              importRow.id,
            ),
        },
      );
    }

    const open =
      new Map<
        string,
        OpenInterval
      >();

    const compiled:
      Array<
        OpenInterval & {
          validTo:
            string;
        }
      > = [];

    for (
      const date
      of calendar
    ) {
      const snapshot =
        snapshots.get(
          date,
        )!;

      const current =
        new Map(
          snapshot.rows.map(
            (
              row,
            ) => [
              row.stock_code,
              row,
            ],
          ),
        );

      for (
        const [
          stockCode,
          interval,
        ]
        of [
          ...open.entries(),
        ]
      ) {
        const currentRow =
          current.get(
            stockCode,
          );

        if (
          !currentRow
        ) {
          compiled.push({
            ...interval,

            validTo:
              date,
          });

          open.delete(
            stockCode,
          );

          continue;
        }

        if (
          signature(
            interval,
          ) !==
          signature(
            currentRow,
          )
        ) {
          compiled.push({
            ...interval,

            validTo:
              date,
          });

          open.set(
            stockCode,
            {
              stockCode:
                currentRow
                  .stock_code,

              stockName:
                currentRow
                  .stock_name,

              market:
                currentRow.market,

              sector:
                currentRow.sector,

              securityType:
                currentRow
                  .security_type,

              listed:
                currentRow.listed,

              tradable:
                currentRow.tradable,

              validFrom:
                date,

              sourceImportIds: [
                snapshot.importId,
              ],
            },
          );

          continue;
        }

        interval
          .sourceImportIds
          .push(
            snapshot.importId,
          );
      }

      for (
        const row
        of snapshot.rows
      ) {
        if (
          open.has(
            row.stock_code,
          )
        ) {
          continue;
        }

        open.set(
          row.stock_code,
          {
            stockCode:
              row.stock_code,

            stockName:
              row.stock_name,

            market:
              row.market,

            sector:
              row.sector,

            securityType:
              row
                .security_type,

            listed:
              row.listed,

            tradable:
              row.tradable,

            validFrom:
              date,

            sourceImportIds: [
              snapshot.importId,
            ],
          },
        );
      }
    }

    const endExclusive =
      await resolveEndExclusive(
        calendarIndexCode,
        calendar[
          calendar.length -
          1
        ],
      );

    for (
      const interval
      of open.values()
    ) {
      compiled.push({
        ...interval,

        validTo:
          endExclusive,
      });
    }

    const insertRows =
      compiled.map(
        (
          interval,
        ) => ({
          compilation_run_id:
            compilationRunId,

          universe_code:
            universeCode,

          stock_code:
            interval.stockCode,

          stock_name:
            interval.stockName,

          market:
            interval.market,

          sector:
            interval.sector,

          security_type:
            interval.securityType,

          listed:
            interval.listed,

          tradable:
            interval.tradable,

          valid_from:
            interval.validFrom,

          valid_to:
            interval.validTo,

          evidence_type:
            "DAILY_COMPLETE_SNAPSHOT",

          source_provider:
            provider,

          source_import_ids:
            [
              ...new Set(
                interval
                  .sourceImportIds,
              ),
            ],

          metadata: {
            intervalSemantics:
              "[valid_from,valid_to)",

            canonicalPromotion:
              false,
          },

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
        insertRows.length;
      offset +=
        500
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "historical_universe_compiled_memberships",
          )
          .insert(
            insertRows.slice(
              offset,
              offset +
                500,
            ),
          );

      if (
        error
      ) {
        throw new Error(
          `v9.3B interval insert failed at ${offset}: ${error.message}`,
        );
      }
    }

    const {
      error: finishError,
    } =
      await supabase
        .rpc(
          "finish_historical_universe_compilation_v9_3b",
          {
            p_compilation_run_id:
              compilationRunId,

            p_status:
              "READY",

            p_compiled_interval_count:
              insertRows.length,

            p_error_message:
              null,
          },
        );

    if (
      finishError
    ) {
      throw new Error(
        `v9.3B compilation finish failed: ${finishError.message}`,
      );
    }

    return {
      version:
        "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B",

      compilationRunId,

      status:
        "READY",

      coverage: {
        expectedTradingDates:
          calendar.length,

        importedCompleteDates,

        missingTradingDates:
          0,

        duplicateCompleteDates:
          0,
      },

      compiledIntervalCount:
        insertRows.length,

      endExclusive,

      safety: {
        intervalSemantics:
          "[valid_from,valid_to)",

        canonicalMembershipsModified:
          false,

        requiresCompleteDailySnapshots:
          true,

        duplicateCompleteSnapshotsFailClosed:
          true,

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
        : "UNKNOWN_V9_3B_COMPILATION_ERROR";

    await supabase
      .rpc(
        "finish_historical_universe_compilation_v9_3b",
        {
          p_compilation_run_id:
            compilationRunId,

          p_status:
            "FAILED",

          p_compiled_interval_count:
            0,

          p_error_message:
            message,
        },
      );

    throw error;
  }
}
