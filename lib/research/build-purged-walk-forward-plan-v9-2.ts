import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type CalendarRow = {
  trading_date:
    string;
};

type PitCheckRow = {
  member_count:
    number | string;

  complete_member_count:
    number | string;

  incomplete_member_count:
    number | string;

  coverage_ready:
    boolean;

  coverage_status:
    "READY" |
    "NO_MEMBERS" |
    "TOO_FEW_MEMBERS" |
    "INCOMPLETE_COVERAGE";
};

type BuildInput = {
  universeCode?:
    string;

  startDate?:
    string;

  endDate?:
    string;

  calendarIndexCode?:
    string;

  trainingWindowDays?:
    number;

  purgeDays?:
    number;

  testWindowDays?:
    number;

  embargoDays?:
    number;

  labelHorizonDays?:
    number;

  minimumPitMembers?:
    number;
};

function requireSqlDate(
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

async function getCalendarBoundary(
  indexCode:
    string,

  ascending:
    boolean,
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
      .order(
        "trading_date",
        {
          ascending,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `v9.2 calendar boundary lookup failed: ${error.message}`,
    );
  }

  if (
    !data?.trading_date
  ) {
    throw new Error(
      `V9_2_NO_CALENDAR_FOR_INDEX_${indexCode}`,
    );
  }

  return String(
    data.trading_date,
  );
}

async function loadTradingCalendar(
  indexCode:
    string,

  startDate:
    string,

  endDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const rows:
    CalendarRow[] = [];

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
        `v9.2 trading-calendar load failed at offset ${offset}: ${error.message}`,
      );
    }

    const page =
      (
        data ??
        []
      ) as CalendarRow[];

    rows.push(
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
      rows.map(
        (
          row,
        ) =>
          row.trading_date,
      ),
    ),
  ];
}

async function checkPitCoverage(
  universeCode:
    string,

  asOfDate:
    string,

  minimumMembers:
    number,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .rpc(
        "check_pit_universe_coverage_v9_2",
        {
          p_universe_code:
            universeCode,

          p_as_of_date:
            asOfDate,

          p_minimum_members:
            minimumMembers,
        },
      );

  if (
    error
  ) {
    throw new Error(
      `v9.2 PIT coverage check failed for ${asOfDate}: ${error.message}`,
    );
  }

  const row =
    (
      data?.[0] ??
      null
    ) as PitCheckRow | null;

  if (
    !row
  ) {
    throw new Error(
      `V9_2_EMPTY_PIT_COVERAGE_RESULT_${asOfDate}`,
    );
  }

  return {
    memberCount:
      Number(
        row.member_count,
      ),

    completeMemberCount:
      Number(
        row
          .complete_member_count,
      ),

    incompleteMemberCount:
      Number(
        row
          .incomplete_member_count,
      ),

    ready:
      row.coverage_ready,

    status:
      row.coverage_status,
  };
}

export async function buildPurgedWalkForwardPlanV92(
  input:
    BuildInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "KRX_ALL_LISTED";

  const calendarIndexCode =
    input
      .calendarIndexCode
      ?.trim() ||
    "0001";

  const earliestCalendarDate =
    await getCalendarBoundary(
      calendarIndexCode,
      true,
    );

  const latestCalendarDate =
    await getCalendarBoundary(
      calendarIndexCode,
      false,
    );

  const startDate =
    input.startDate
      ? requireSqlDate(
          input.startDate,
          "START_DATE",
        )
      : earliestCalendarDate;

  const endDate =
    input.endDate
      ? requireSqlDate(
          input.endDate,
          "END_DATE",
        )
      : latestCalendarDate;

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V9_2_START_DATE_AFTER_END_DATE",
    );
  }

  const trainingWindowDays =
    Math.max(
      20,
      Math.floor(
        input
          .trainingWindowDays ??
        252,
      ),
    );

  const labelHorizonDays =
    Math.max(
      1,
      Math.floor(
        input
          .labelHorizonDays ??
        20,
      ),
    );

  const purgeDays =
    Math.max(
      labelHorizonDays,
      Math.floor(
        input
          .purgeDays ??
        20,
      ),
    );

  const testWindowDays =
    Math.max(
      1,
      Math.floor(
        input
          .testWindowDays ??
        63,
      ),
    );

  const embargoDays =
    Math.max(
      0,
      Math.floor(
        input
          .embargoDays ??
        5,
      ),
    );

  const minimumPitMembers =
    Math.max(
      1,
      Math.floor(
        input
          .minimumPitMembers ??
        500,
      ),
    );

  const calendar =
    await loadTradingCalendar(
      calendarIndexCode,
      startDate,
      endDate,
    );

  const minimumRequiredDays =
    trainingWindowDays +
    purgeDays +
    testWindowDays;

  const {
    data: plan,
    error: planError,
  } =
    await supabase
      .from(
        "alpha_validation_plans",
      )
      .insert({
        protocol_name:
          "PURGED_EMBARGOED_ROLLING_WALK_FORWARD",

        protocol_version:
          "v9.2",

        universe_code:
          universeCode,

        calendar_index_code:
          calendarIndexCode,

        requested_start_date:
          startDate,

        requested_end_date:
          endDate,

        training_window_days:
          trainingWindowDays,

        purge_days:
          purgeDays,

        test_window_days:
          testWindowDays,

        embargo_days:
          embargoDays,

        label_horizon_days:
          labelHorizonDays,

        minimum_pit_members:
          minimumPitMembers,

        status:
          "BUILDING",

        config: {
          calendarTradingDays:
            calendar.length,

          minimumRequiredDays,

          foldStepDays:
            testWindowDays +
            embargoDays,

          rollingTrainingWindow:
            true,

          expandingWindow:
            false,

          futureTestDataUsedInTraining:
            false,
        },

        safety: {
          purgeAtLeastLabelHorizon:
            purgeDays >=
            labelHorizonDays,

          currentUniverseBackfilledIntoPast:
            false,

          missingPitCoverageFailsClosed:
            true,

          productionApplied:
            false,
        },

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    planError ||
    !plan
  ) {
    throw new Error(
      `v9.2 validation-plan create failed: ${
        planError?.message ??
        "NO_PLAN"
      }`,
    );
  }

  const planId =
    String(
      plan.id,
    );

  try {
    if (
      calendar.length <
      minimumRequiredDays
    ) {
      await supabase
        .from(
          "alpha_validation_plans",
        )
        .update({
          status:
            "INSUFFICIENT_CALENDAR_HISTORY",

          finished_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          planId,
        );

      return {
        version:
          "PURGED_EMBARGO_VALIDATION_FOUNDATION_V9_2",

        planId,

        status:
          "INSUFFICIENT_CALENDAR_HISTORY",

        calendarTradingDays:
          calendar.length,

        minimumRequiredDays,

        productionApplied:
          false,
      };
    }

    const folds:
      Array<{
        foldIndex:
          number;

        trainStartDate:
          string;

        trainEndDate:
          string;

        purgeStartDate:
          string | null;

        purgeEndDate:
          string | null;

        testStartDate:
          string;

        testEndDate:
          string;

        embargoStartDate:
          string | null;

        embargoEndDate:
          string | null;

        pit:
          Awaited<
            ReturnType<
              typeof checkPitCoverage
            >
          >;
      }> = [];

    let testStartIndex =
      trainingWindowDays +
      purgeDays;

    let foldIndex =
      1;

    while (
      testStartIndex +
        testWindowDays -
        1 <
      calendar.length
    ) {
      const trainEndIndex =
        testStartIndex -
        purgeDays -
        1;

      const trainStartIndex =
        trainEndIndex -
        trainingWindowDays +
        1;

      if (
        trainStartIndex <
        0
      ) {
        break;
      }

      const testEndIndex =
        testStartIndex +
        testWindowDays -
        1;

      const purgeStartIndex =
        trainEndIndex +
        1;

      const purgeEndIndex =
        testStartIndex -
        1;

      const embargoStartIndex =
        testEndIndex +
        1;

      const embargoEndIndex =
        Math.min(
          calendar.length -
            1,
          testEndIndex +
            embargoDays,
        );

      const pit =
        await checkPitCoverage(
          universeCode,
          calendar[
            testStartIndex
          ],
          minimumPitMembers,
        );

      folds.push({
        foldIndex,

        trainStartDate:
          calendar[
            trainStartIndex
          ],

        trainEndDate:
          calendar[
            trainEndIndex
          ],

        purgeStartDate:
          purgeDays >
            0
            ? calendar[
                purgeStartIndex
              ]
            : null,

        purgeEndDate:
          purgeDays >
            0
            ? calendar[
                purgeEndIndex
              ]
            : null,

        testStartDate:
          calendar[
            testStartIndex
          ],

        testEndDate:
          calendar[
            testEndIndex
          ],

        embargoStartDate:
          embargoDays >
            0 &&
          embargoStartIndex <
            calendar.length
            ? calendar[
                embargoStartIndex
              ]
            : null,

        embargoEndDate:
          embargoDays >
            0 &&
          embargoStartIndex <
            calendar.length
            ? calendar[
                embargoEndIndex
              ]
            : null,

        pit,
      });

      foldIndex +=
        1;

      testStartIndex +=
        testWindowDays +
        embargoDays;
    }

    const insertRows =
      folds.map(
        (
          fold,
        ) => ({
          plan_id:
            planId,

          fold_index:
            fold.foldIndex,

          train_start_date:
            fold.trainStartDate,

          train_end_date:
            fold.trainEndDate,

          purge_start_date:
            fold.purgeStartDate,

          purge_end_date:
            fold.purgeEndDate,

          test_start_date:
            fold.testStartDate,

          test_end_date:
            fold.testEndDate,

          embargo_start_date:
            fold.embargoStartDate,

          embargo_end_date:
            fold.embargoEndDate,

          training_trading_days:
            trainingWindowDays,

          purge_trading_days:
            purgeDays,

          test_trading_days:
            testWindowDays,

          embargo_trading_days:
            embargoDays,

          pit_member_count:
            fold.pit
              .memberCount,

          pit_complete_member_count:
            fold.pit
              .completeMemberCount,

          pit_coverage_ready:
            fold.pit.ready,

          pit_coverage_status:
            fold.pit.status,

          metadata: {
            labelHorizonDays,

            purgeAtLeastLabelHorizon:
              purgeDays >=
              labelHorizonDays,
          },

          production_applied:
            false,
        }),
      );

    const chunkSize =
      500;

    for (
      let offset =
        0;
      offset <
        insertRows.length;
      offset +=
        chunkSize
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "alpha_validation_folds",
          )
          .insert(
            insertRows.slice(
              offset,
              offset +
                chunkSize,
            ),
          );

      if (
        error
      ) {
        throw new Error(
          `v9.2 fold insert failed at offset ${offset}: ${error.message}`,
        );
      }
    }

    const pitReadyFoldCount =
      folds.filter(
        (
          fold,
        ) =>
          fold.pit.ready,
      ).length;

    const pitBlockedFoldCount =
      folds.length -
      pitReadyFoldCount;

    const status =
      folds.length >
        0 &&
      pitBlockedFoldCount ===
        0
        ? "READY"
        : "BLOCKED_PIT_COVERAGE";

    const {
      error: finishError,
    } =
      await supabase
        .from(
          "alpha_validation_plans",
        )
        .update({
          status,

          fold_count:
            folds.length,

          pit_ready_fold_count:
            pitReadyFoldCount,

          pit_blocked_fold_count:
            pitBlockedFoldCount,

          finished_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          planId,
        );

    if (
      finishError
    ) {
      throw new Error(
        `v9.2 validation-plan finish failed: ${finishError.message}`,
      );
    }

    return {
      version:
        "PURGED_EMBARGO_VALIDATION_FOUNDATION_V9_2",

      planId,

      status,

      universeCode,

      calendar: {
        indexCode:
          calendarIndexCode,

        startDate,
        endDate,

        tradingDays:
          calendar.length,
      },

      protocol: {
        trainingWindowDays,
        purgeDays,
        testWindowDays,
        embargoDays,
        labelHorizonDays,

        foldStepDays:
          testWindowDays +
          embargoDays,
      },

      counts: {
        folds:
          folds.length,

        pitReady:
          pitReadyFoldCount,

        pitBlocked:
          pitBlockedFoldCount,
      },

      folds:
        folds.map(
          (
            fold,
          ) => ({
            foldIndex:
              fold.foldIndex,

            train: [
              fold.trainStartDate,
              fold.trainEndDate,
            ],

            purge: [
              fold.purgeStartDate,
              fold.purgeEndDate,
            ],

            test: [
              fold.testStartDate,
              fold.testEndDate,
            ],

            embargo: [
              fold.embargoStartDate,
              fold.embargoEndDate,
            ],

            pitCoverage:
              fold.pit,
          }),
        ),

      interpretation:
        status ===
          "READY"
          ? "The time-series validation protocol and historical point-in-time universe coverage are both ready for research execution."
          : "The validation folds are defined, but historical point-in-time universe coverage is not sufficient. Do not execute historical Alpha validation yet.",

      safety: {
        purgeAtLeastLabelHorizon:
          purgeDays >=
          labelHorizonDays,

        currentUniverseBackfilledIntoPast:
          false,

        missingPitCoverageFailsClosed:
          true,

        validationExecuted:
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
        : "UNKNOWN_V9_2_VALIDATION_PLAN_ERROR";

    await supabase
      .from(
        "alpha_validation_plans",
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
        planId,
      );

    throw error;
  }
}
