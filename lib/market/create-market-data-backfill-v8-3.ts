import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface MembershipRow {
  stock_code:
    string;

  stock_name:
    string;

  market:
    string | null;

  security_type:
    string;

  listed:
    boolean;

  tradable:
    boolean;

  metadata:
    Record<
      string,
      unknown
    > | null;
}

interface CreateInput {
  universeCode?:
    string;

  universeAsOfDate?:
    string;

  startDate?:
    string;

  endDate?:
    string;

  lookbackCalendarDays?:
    number;

  adjustedPrice?:
    boolean;

  allowedSecurityTypes?:
    string[];

  excludeManagement?:
    boolean;

  excludeLowLiquidityFlag?:
    boolean;

  maxAttempts?:
    number;

  requestDelayMs?:
    number;
}

function getKoreanDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Seoul",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",
    },
  )
    .format(
      new Date(),
    );
}

function normalizeSqlDate(
  value:
    string | undefined,

  name:
    string,
) {
  if (
    !value
  ) {
    return null;
  }

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

function subtractCalendarDays(
  sqlDate:
    string,

  days:
    number,
) {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
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

function objectOrEmpty(
  value:
    unknown,
): Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  )
    ? value as Record<
        string,
        unknown
      >
    : {};
}

function booleanFlag(
  value:
    unknown,
) {
  return (
    value ===
      true ||
    value ===
      "true" ||
    value ===
      "Y" ||
    value ===
      1
  );
}

async function resolveLatestCommonMarketDate(
  asOfDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const [
    kospi,
    kosdaq,
  ] =
    await Promise.all([
      supabase
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
        .lte(
          "trading_date",
          asOfDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "index_code",
          "1001",
        )
        .lte(
          "trading_date",
          asOfDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),
    ]);

  if (
    kospi.error
  ) {
    throw new Error(
      `v8.3 KOSPI market-date lookup failed: ${kospi.error.message}`,
    );
  }

  if (
    kosdaq.error
  ) {
    throw new Error(
      `v8.3 KOSDAQ market-date lookup failed: ${kosdaq.error.message}`,
    );
  }

  const kospiDate =
    kospi.data
      ?.trading_date
      ? String(
          kospi
            .data
            .trading_date,
        )
      : null;

  const kosdaqDate =
    kosdaq.data
      ?.trading_date
      ? String(
          kosdaq
            .data
            .trading_date,
        )
      : null;

  if (
    !kospiDate ||
    !kosdaqDate
  ) {
    throw new Error(
      "V8_3_INDEX_MARKET_DATE_NOT_AVAILABLE",
    );
  }

  return {
    endDate:
      kospiDate <=
        kosdaqDate
        ? kospiDate
        : kosdaqDate,

    kospiDate,
    kosdaqDate,

    aligned:
      kospiDate ===
      kosdaqDate,
  };
}

async function loadMemberships(
  universeCode:
    string,

  asOfDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const result:
    MembershipRow[] = [];

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
          "stock_universe_memberships",
        )
        .select(`
          stock_code,
          stock_name,
          market,
          security_type,
          listed,
          tradable,
          metadata
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .lte(
          "valid_from",
          asOfDate,
        )
        .or(
          `valid_to.is.null,valid_to.gt.${asOfDate}`,
        )
        .eq(
          "pit_eligible",
          true,
        )
        .order(
          "market",
          {
            ascending:
              true,

            nullsFirst:
              false,
          },
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
        `v8.3 membership load failed: ${error.message}`,
      );
    }

    const page =
      (
        data ??
        []
      ) as MembershipRow[];

    result.push(
      ...page,
    );

    if (
      page.length <
        pageSize
    ) {
      break;
    }
  }

  return result;
}

export async function createMarketDataBackfillV83(
  input:
    CreateInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "KRX_ALL_LISTED";

  const universeAsOfDate =
    normalizeSqlDate(
      input
        .universeAsOfDate,
      "UNIVERSE_AS_OF_DATE",
    ) ??
    getKoreanDate();

  const marketClock =
    await resolveLatestCommonMarketDate(
      universeAsOfDate,
    );

  const explicitEndDate =
    normalizeSqlDate(
      input.endDate,
      "END_DATE",
    );

  const endDate =
    explicitEndDate ??
    marketClock.endDate;

  const lookbackCalendarDays =
    Math.min(
      180,
      Math.max(
        30,
        Math.floor(
          input
            .lookbackCalendarDays ??
          90,
        ),
      ),
    );

  const explicitStartDate =
    normalizeSqlDate(
      input.startDate,
      "START_DATE",
    );

  const startDate =
    explicitStartDate ??
    subtractCalendarDays(
      endDate,
      lookbackCalendarDays,
    );

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V8_3_START_DATE_AFTER_END_DATE",
    );
  }

  const allowedSecurityTypes =
    [
      ...new Set(
        (
          input
            .allowedSecurityTypes ??
          [
            "COMMON",
          ]
        )
          .map(
            (
              value,
            ) =>
              value
                .trim()
                .toUpperCase(),
          )
          .filter(Boolean),
      ),
    ];

  const excludeManagement =
    input
      .excludeManagement !==
    false;

  const excludeLowLiquidityFlag =
    input
      .excludeLowLiquidityFlag !==
    false;

  const adjustedPrice =
    input
      .adjustedPrice !==
    false;

  const maxAttempts =
    Math.min(
      10,
      Math.max(
        1,
        Math.floor(
          input
            .maxAttempts ??
          3,
        ),
      ),
    );

  const requestDelayMs =
    Math.min(
      10000,
      Math.max(
        0,
        Math.floor(
          input
            .requestDelayMs ??
          1500,
        ),
      ),
    );

  const {
    data: definition,
    error: definitionError,
  } =
    await supabase
      .from(
        "stock_universe_definitions",
      )
      .select(
        "universe_code,is_ready,requires_complete_coverage,metadata",
      )
      .eq(
        "universe_code",
        universeCode,
      )
      .maybeSingle();

  if (
    definitionError
  ) {
    throw new Error(
      `v8.3 universe definition load failed: ${definitionError.message}`,
    );
  }

  if (
    !definition ||
    definition.is_ready !==
      true
  ) {
    throw new Error(
      `V8_3_UNIVERSE_NOT_READY: ${universeCode}`,
    );
  }

  const memberships =
    await loadMemberships(
      universeCode,
      universeAsOfDate,
    );

  const eligible =
    memberships.filter(
      (
        row,
      ) => {
        if (
          !row.listed ||
          !row.tradable
        ) {
          return false;
        }

        if (
          !allowedSecurityTypes.includes(
            row
              .security_type
              .toUpperCase(),
          )
        ) {
          return false;
        }

        const metadata =
          objectOrEmpty(
            row.metadata,
          );

        const flags =
          objectOrEmpty(
            metadata.flags,
          );

        if (
          excludeManagement &&
          booleanFlag(
            flags.management,
          )
        ) {
          return false;
        }

        if (
          excludeLowLiquidityFlag &&
          booleanFlag(
            flags.lowLiquidity,
          )
        ) {
          return false;
        }

        return true;
      },
    );

  if (
    eligible.length ===
      0
  ) {
    throw new Error(
      "V8_3_NO_ELIGIBLE_UNIVERSE_MEMBERS",
    );
  }

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "market_data_backfill_runs",
      )
      .insert({
        universe_code:
          universeCode,

        universe_as_of_date:
          universeAsOfDate,

        start_date:
          startDate,

        end_date:
          endDate,

        adjusted_price:
          adjustedPrice,

        allowed_security_types:
          allowedSecurityTypes,

        exclude_management:
          excludeManagement,

        exclude_low_liquidity_flag:
          excludeLowLiquidityFlag,

        max_attempts:
          maxAttempts,

        request_delay_ms:
          requestDelayMs,

        status:
          "RUNNING",

        task_count:
          eligible.length,

        pending_count:
          eligible.length,

        metadata: {
          version:
            "SCALABLE_MARKET_DATA_BACKFILL_V8_3",

          source:
            "KIS_DOMESTIC_DAILY",

          universeMemberCount:
            memberships.length,

          structurallyEligibleCount:
            eligible.length,

          marketClock,

          purpose:
            "RECENT_DAILY_BAR_COVERAGE_FOR_UNIVERSE_SCREENING",

          historicalUniverseMembershipBackfilled:
            false,
        },

        production_applied:
          false,
      })
      .select(
        "id,started_at",
      )
      .single();

  if (
    runError ||
    !run
  ) {
    throw new Error(
      `v8.3 backfill run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const runId =
    String(
      run.id,
    );

  const tasks =
    eligible.map(
      (
        row,
      ) => ({
        run_id:
          runId,

        stock_code:
          row.stock_code,

        stock_name:
          row.stock_name,

        market:
          row.market,

        start_date:
          startDate,

        end_date:
          endDate,

        status:
          "PENDING",

        metadata: {
          universeCode,
          universeAsOfDate,

          securityType:
            row.security_type,
        },

        production_applied:
          false,
      }),
    );

  const chunkSize =
    500;

  try {
    for (
      let offset =
        0;
      offset <
        tasks.length;
      offset +=
        chunkSize
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "market_data_backfill_tasks",
          )
          .insert(
            tasks.slice(
              offset,
              offset +
                chunkSize,
            ),
          );

      if (
        error
      ) {
        throw new Error(
          `v8.3 task insert failed at offset ${offset}: ${error.message}`,
        );
      }
    }
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V8_3_TASK_CREATE_ERROR";

    await supabase
      .from(
        "market_data_backfill_runs",
      )
      .update({
        status:
          "FAILED",

        finished_at:
          new Date()
            .toISOString(),

        error_message:
          message,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        runId,
      );

    throw error;
  }

  return {
    version:
      "SCALABLE_MARKET_DATA_BACKFILL_V8_3",

    runId,

    status:
      "RUNNING",

    universeCode,
    universeAsOfDate,

    range: {
      startDate,
      endDate,

      lookbackCalendarDays:
        explicitStartDate
          ? null
          : lookbackCalendarDays,
    },

    marketClock,

    selection: {
      universeMembers:
        memberships.length,

      structurallyEligible:
        eligible.length,

      allowedSecurityTypes,
      excludeManagement,
      excludeLowLiquidityFlag,
    },

    workerPolicy: {
      maxAttempts,
      requestDelayMs,

      persistentTasks:
        true,

      leaseRecovery:
        true,

      safeForResume:
        true,
    },

    productionApplied:
      false,
  };
}
