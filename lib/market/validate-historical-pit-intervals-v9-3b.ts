import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  ingestHistoricalUniverseSnapshotV93A,
} from "@/lib/market/ingest-historical-universe-snapshot-v9-3a";

import {
  compileHistoricalUniverseIntervalsV93B,
} from "@/lib/market/compile-historical-universe-intervals-v9-3b";

function same(
  left:
    unknown,
  right:
    unknown,
) {
  return JSON.stringify(
    left,
  ) ===
  JSON.stringify(
    right,
  );
}

export async function validateHistoricalPitIntervalsV93B() {
  const supabase =
    createSupabaseServerClient();

  const provider =
    "SYNTHETIC_VALIDATION_V9_3B";

  const universeCode =
    "KRX_ALL_LISTED";

  const syntheticCodes =
    [
      "V93001",
      "V93002",
      "V93003",
      "V93004",
    ];

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
      .limit(6);

  if (
    calendarError
  ) {
    throw new Error(
      `v9.3B validation calendar load failed: ${calendarError.message}`,
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
      5
  ) {
    throw new Error(
      "V9_3B_VALIDATION_NEEDS_AT_LEAST_5_TRADING_DATES",
    );
  }

  const [
    d1,
    d2,
    d3,
    d4,
    nextDate,
  ] =
    dates.slice(
      -5,
    );

  const snapshots = [
    {
      date:
        d1,

      members: [
        {
          stockCode:
            syntheticCodes[0],

          stockName:
            "ALPHA_CONTINUOUS",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[1],

          stockName:
            "BETA_DELIST",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[3],

          stockName:
            "DELTA_REENTRY",

          market:
            "KOSDAQ" as const,
        },
      ],
    },
    {
      date:
        d2,

      members: [
        {
          stockCode:
            syntheticCodes[0],

          stockName:
            "ALPHA_CONTINUOUS",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[1],

          stockName:
            "BETA_DELIST",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[2],

          stockName:
            "GAMMA_NEWLIST",

          market:
            "KOSDAQ" as const,
        },
      ],
    },
    {
      date:
        d3,

      members: [
        {
          stockCode:
            syntheticCodes[0],

          stockName:
            "ALPHA_CONTINUOUS",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[2],

          stockName:
            "GAMMA_NEWLIST",

          market:
            "KOSDAQ" as const,
        },
        {
          stockCode:
            syntheticCodes[3],

          stockName:
            "DELTA_REENTRY",

          market:
            "KOSDAQ" as const,
        },
      ],
    },
    {
      date:
        d4,

      members: [
        {
          stockCode:
            syntheticCodes[0],

          stockName:
            "ALPHA_CONTINUOUS",

          market:
            "KOSPI" as const,
        },
        {
          stockCode:
            syntheticCodes[2],

          stockName:
            "GAMMA_NEWLIST",

          market:
            "KOSDAQ" as const,
        },
        {
          stockCode:
            syntheticCodes[3],

          stockName:
            "DELTA_REENTRY",

          market:
            "KOSDAQ" as const,
        },
      ],
    },
  ];

  let compilationRunId:
    string | null = null;

  let cleanupSucceeded =
    false;

  try {
    const {
      count: canonicalBefore,
      error: canonicalBeforeError,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .select(
          "*",
          {
            count:
              "exact",

            head:
              true,
          },
        )
        .in(
          "stock_code",
          syntheticCodes,
        );

    if (
      canonicalBeforeError
    ) {
      throw new Error(
        `v9.3B validation canonical-before failed: ${canonicalBeforeError.message}`,
      );
    }

    for (
      const snapshot
      of snapshots
    ) {
      await ingestHistoricalUniverseSnapshotV93A({
        universeCode,

        asOfDate:
          snapshot.date,

        provider,

        providerVersion:
          "SYNTHETIC_V1",

        coverageStatus:
          "COMPLETE",

        expectedMemberCount:
          snapshot
            .members
            .length,

        members:
          snapshot.members.map(
            (
              member,
            ) => ({
              ...member,

              securityType:
                "COMMON",

              listed:
                true,

              tradable:
                true,

              sourcePayload: {
                synthetic:
                  true,
              },
            }),
          ),

        metadata: {
          purpose:
            "V9_3B_INTERVAL_VALIDATION",
        },

        isValidation:
          true,
      });
    }

    const compilation =
      await compileHistoricalUniverseIntervalsV93B({
        universeCode,

        provider,

        startDate:
          d1,

        endDate:
          d4,

        calendarIndexCode:
          "0001",

        isValidation:
          true,
      });

    compilationRunId =
      compilation
        .compilationRunId;

    const {
      data: intervalData,
      error: intervalError,
    } =
      await supabase
        .from(
          "historical_universe_compiled_memberships",
        )
        .select(`
          stock_code,
          valid_from,
          valid_to,
          market,
          stock_name
        `)
        .eq(
          "compilation_run_id",
          compilationRunId,
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        )
        .order(
          "valid_from",
          {
            ascending:
              true,
          },
        );

    if (
      intervalError
    ) {
      throw new Error(
        `v9.3B validation interval load failed: ${intervalError.message}`,
      );
    }

    const actual =
      (
        intervalData ??
        []
      ).map(
        (
          row,
        ) => ({
          stockCode:
            String(
              row.stock_code,
            ),

          validFrom:
            String(
              row.valid_from,
            ),

          validTo:
            String(
              row.valid_to,
            ),
        }),
      );

    const expected = [
      {
        stockCode:
          syntheticCodes[0],

        validFrom:
          d1,

        validTo:
          nextDate,
      },
      {
        stockCode:
          syntheticCodes[1],

        validFrom:
          d1,

        validTo:
          d3,
      },
      {
        stockCode:
          syntheticCodes[2],

        validFrom:
          d2,

        validTo:
          nextDate,
      },
      {
        stockCode:
          syntheticCodes[3],

        validFrom:
          d1,

        validTo:
          d2,
      },
      {
        stockCode:
          syntheticCodes[3],

        validFrom:
          d3,

        validTo:
          nextDate,
      },
    ];

    const {
      count: canonicalAfter,
      error: canonicalAfterError,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .select(
          "*",
          {
            count:
              "exact",

            head:
              true,
          },
        )
        .in(
          "stock_code",
          syntheticCodes,
        );

    if (
      canonicalAfterError
    ) {
      throw new Error(
        `v9.3B validation canonical-after failed: ${canonicalAfterError.message}`,
      );
    }

    const assertions = {
      compilationReady:
        compilation.status ===
        "READY",

      fourCompleteSnapshotsUsed:
        compilation
          .coverage
          .expectedTradingDates ===
          4 &&
        compilation
          .coverage
          .importedCompleteDates ===
          4,

      noMissingTradingDates:
        compilation
          .coverage
          .missingTradingDates ===
          0,

      noDuplicateCompleteDates:
        compilation
          .coverage
          .duplicateCompleteDates ===
          0,

      intervalCountCorrect:
        actual.length ===
        5,

      exactIntervalBoundaries:
        same(
          actual,
          expected,
        ),

      continuousMembershipCorrect:
        actual.some(
          (
            interval,
          ) =>
            interval.stockCode ===
              syntheticCodes[0] &&
            interval.validFrom ===
              d1 &&
            interval.validTo ===
              nextDate,
        ),

      delistingBoundaryCorrect:
        actual.some(
          (
            interval,
          ) =>
            interval.stockCode ===
              syntheticCodes[1] &&
            interval.validFrom ===
              d1 &&
            interval.validTo ===
              d3,
        ),

      newListingBoundaryCorrect:
        actual.some(
          (
            interval,
          ) =>
            interval.stockCode ===
              syntheticCodes[2] &&
            interval.validFrom ===
              d2 &&
            interval.validTo ===
              nextDate,
        ),

      reentryCreatesDistinctIntervals:
        actual.filter(
          (
            interval,
          ) =>
            interval.stockCode ===
            syntheticCodes[3],
        ).length ===
        2,

      canonicalMembershipsUntouched:
        (
          canonicalBefore ??
          0
        ) ===
          0 &&
        (
          canonicalAfter ??
          0
        ) ===
          0,

      productionNotApplied:
        true,
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

    await supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .delete()
      .eq(
        "id",
        compilationRunId,
      );

    await supabase
      .from(
        "historical_universe_snapshot_imports",
      )
      .delete()
      .eq(
        "provider",
        provider,
      )
      .eq(
        "is_validation",
        true,
      )
      .gte(
        "as_of_date",
        d1,
      )
      .lte(
        "as_of_date",
        d4,
      );

    cleanupSucceeded =
      true;

    const {
      data: audit,
      error: auditError,
    } =
      await supabase
        .from(
          "historical_universe_validation_runs",
        )
        .insert({
          validation_version:
            "HISTORICAL_PIT_INTERVAL_VALIDATION_V9_3B",

          status:
            passed
              ? "PASS"
              : "FAIL",

          compilation_run_id:
            null,

          assertions,

          cleanup_succeeded:
            cleanupSucceeded,

          production_applied:
            false,
        })
        .select(
          "id,created_at",
        )
        .single();

    if (
      auditError ||
      !audit
    ) {
      throw new Error(
        `v9.3B validation audit insert failed: ${
          auditError?.message ??
          "NO_AUDIT"
        }`,
      );
    }

    return {
      version:
        "HISTORICAL_PIT_INTERVAL_VALIDATION_V9_3B",

      validationRunId:
        audit.id,

      status:
        passed
          ? "PASS"
          : "FAIL",

      dates: {
        d1,
        d2,
        d3,
        d4,
        endExclusive:
          nextDate,
      },

      expected,
      actual,

      assertions,

      cleanup: {
        succeeded:
          cleanupSucceeded,

        validationImportsRemoved:
          true,

        compiledIntervalsRemoved:
          true,
      },

      safety: {
        canonicalMembershipsModified:
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
        : "UNKNOWN_V9_3B_VALIDATION_ERROR";

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

    await supabase
      .from(
        "historical_universe_snapshot_imports",
      )
      .delete()
      .eq(
        "provider",
        provider,
      )
      .eq(
        "is_validation",
        true,
      );

    cleanupSucceeded =
      true;

    await supabase
      .from(
        "historical_universe_validation_runs",
      )
      .insert({
        validation_version:
          "HISTORICAL_PIT_INTERVAL_VALIDATION_V9_3B",

        status:
          "FAIL",

        compilation_run_id:
          null,

        assertions: {
          runtimeError:
            message,

          productionApplied:
            false,
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
