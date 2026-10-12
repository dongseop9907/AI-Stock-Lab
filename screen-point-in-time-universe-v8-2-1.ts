import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface MetricRow {
  stock_code:
    string;

  stock_name:
    string;

  market:
    string | null;

  sector:
    string | null;

  security_type:
    string;

  listed:
    boolean;

  tradable:
    boolean;

  membership_metadata:
    Record<
      string,
      unknown
    > | null;

  latest_bar_date:
    string | null;

  latest_close:
    number | string | null;

  recent_bar_count:
    number | string;

  average_volume:
    number | string | null;

  average_trading_value:
    number | string | null;
}

interface ScreenInput {
  universeCode?:
    string;

  asOfDate?:
    string;

  lookbackCalendarDays?:
    number;

  minimumBars?:
    number;

  minimumPrice?:
    number;

  minimumAverageTradingValue?:
    number;

  minimumCoverageRate?:
    number;

  allowedSecurityTypes?:
    string[];

  excludeManagement?:
    boolean;

  excludeLowLiquidityFlag?:
    boolean;
}

function clamp(
  value:
    number,

  minimum:
    number,

  maximum:
    number,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function toNullableNumber(
  value:
    number |
    string |
    null |
    undefined,
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function normalizeDate(
  value:
    string | undefined,
) {
  const fallback =
    new Intl.DateTimeFormat(
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

  const result =
    value ??
    fallback;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      result,
    )
  ) {
    throw new Error(
      "INVALID_SCREEN_AS_OF_DATE",
    );
  }

  return result;
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
  return value ===
    true ||
    value ===
      "true" ||
    value ===
      "Y" ||
    value ===
      1;
}

async function resolveLatestMarketDate(
  asOfDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const [
    kospiResponse,
    kosdaqResponse,
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
    kospiResponse.error
  ) {
    throw new Error(
      `v8.2.1 KOSPI market-date lookup failed: ${kospiResponse.error.message}`,
    );
  }

  if (
    kosdaqResponse.error
  ) {
    throw new Error(
      `v8.2.1 KOSDAQ market-date lookup failed: ${kosdaqResponse.error.message}`,
    );
  }

  const kospiDate =
    kospiResponse
      .data
      ?.trading_date
      ? String(
          kospiResponse
            .data
            .trading_date,
        )
      : null;

  const kosdaqDate =
    kosdaqResponse
      .data
      ?.trading_date
      ? String(
          kosdaqResponse
            .data
            .trading_date,
        )
      : null;

  if (
    !kospiDate ||
    !kosdaqDate
  ) {
    throw new Error(
      "V8_2_INDEX_MARKET_DATE_NOT_AVAILABLE",
    );
  }

  /*
   * Use the older of the two latest index dates.
   * This is fail-closed if one market is lagging.
   */
  return {
    marketDate:
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

export async function screenPointInTimeUniverseV82(
  input:
    ScreenInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "KRX_ALL_LISTED";

  const asOfDate =
    normalizeDate(
      input.asOfDate,
    );

  const lookbackCalendarDays =
    Math.min(
      180,
      Math.max(
        30,
        Math.floor(
          input
            .lookbackCalendarDays ??
          60,
        ),
      ),
    );

  const minimumBars =
    Math.min(
      120,
      Math.max(
        5,
        Math.floor(
          input
            .minimumBars ??
          20,
        ),
      ),
    );

  const minimumPrice =
    Math.max(
      0,
      Number(
        input
          .minimumPrice ??
        1000,
      ),
    );

  const minimumAverageTradingValue =
    Math.max(
      0,
      Number(
        input
          .minimumAverageTradingValue ??
        1_000_000_000,
      ),
    );

  const minimumCoverageRate =
    clamp(
      Number(
        input
          .minimumCoverageRate ??
        0.8,
      ),
      0,
      1,
    );

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

  const {
    data: definition,
    error: definitionError,
  } =
    await supabase
      .from(
        "stock_universe_definitions",
      )
      .select(`
        universe_code,
        is_ready,
        requires_complete_coverage,
        metadata
      `)
      .eq(
        "universe_code",
        universeCode,
      )
      .maybeSingle();

  if (
    definitionError
  ) {
    throw new Error(
      `v8.2.1 universe definition load failed: ${definitionError.message}`,
    );
  }

  if (
    !definition
  ) {
    throw new Error(
      `UNIVERSE_DEFINITION_NOT_FOUND: ${universeCode}`,
    );
  }

  if (
    definition.is_ready !==
      true
  ) {
    throw new Error(
      `UNIVERSE_NOT_READY: ${universeCode}`,
    );
  }

  const marketClock =
    await resolveLatestMarketDate(
      asOfDate,
    );

  const lookbackStartDate =
    subtractCalendarDays(
      marketClock
        .marketDate,
      lookbackCalendarDays,
    );

  const criteria = {
    version:
      "UNIVERSE_ELIGIBILITY_LIQUIDITY_SCREEN_V8_2_1",

    allowedSecurityTypes,

    excludeManagement,
    excludeLowLiquidityFlag,

    minimumBars,
    minimumPrice,
    minimumAverageTradingValue,

    minimumCoverageRate,

    lookbackCalendarDays,
    lookbackStartDate,

    liquidityApproximation:
      "AVERAGE_CLOSE_X_VOLUME",

    productionApplied:
      false,
  };

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "stock_universe_screening_runs",
      )
      .insert({
        universe_code:
          universeCode,

        as_of_date:
          asOfDate,

        market_date:
          marketClock
            .marketDate,

        status:
          "RUNNING",

        criteria,

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
      `v8.2.1 screening run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const runId =
    String(
      run.id,
    );

  try {
    /*
     * v8.2.1:
     * Supabase/PostgREST can cap RPC responses at 1000 rows.
     * KRX_ALL_LISTED currently exceeds that, so fetch deterministic
     * pages until the final short page instead of accepting a silent
     * 1000-row truncation.
     */
    const rows:
      MetricRow[] = [];

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
        data: metricPage,
        error: metricError,
      } =
        await supabase
          .rpc(
            "compute_stock_universe_liquidity_metrics_v8_2_1",
            {
              p_universe_code:
                universeCode,

              p_as_of_date:
                asOfDate,

              p_market_date:
                marketClock
                  .marketDate,

              p_lookback_start_date:
                lookbackStartDate,

              p_offset:
                offset,

              p_limit:
                pageSize,
            },
          );

      if (
        metricError
      ) {
        throw new Error(
          `v8.2.1 liquidity metric RPC failed at offset ${offset}: ${metricError.message}`,
        );
      }

      const page =
        (
          metricPage ??
          []
        ) as MetricRow[];

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

    const screened =
      rows.map(
        (
          row,
        ) => {
          const metadata =
            objectOrEmpty(
              row
                .membership_metadata,
            );

          const flags =
            objectOrEmpty(
              metadata.flags,
            );

          const management =
            booleanFlag(
              flags.management,
            );

          const lowLiquidity =
            booleanFlag(
              flags.lowLiquidity,
            );

          const recentBarCount =
            Math.max(
              0,
              Number(
                row
                  .recent_bar_count ??
                0,
              ),
            );

          const latestClose =
            toNullableNumber(
              row
                .latest_close,
            );

          const averageVolume =
            toNullableNumber(
              row
                .average_volume,
            );

          const averageTradingValue =
            toNullableNumber(
              row
                .average_trading_value,
            );

          const masterReasons:
            string[] = [];

          if (
            !row.listed
          ) {
            masterReasons.push(
              "NOT_LISTED",
            );
          }

          if (
            !row.tradable
          ) {
            masterReasons.push(
              "MASTER_NOT_TRADABLE",
            );
          }

          if (
            !allowedSecurityTypes.includes(
              row
                .security_type
                .toUpperCase(),
            )
          ) {
            masterReasons.push(
              "SECURITY_TYPE_EXCLUDED",
            );
          }

          if (
            excludeManagement &&
            management
          ) {
            masterReasons.push(
              "MANAGEMENT_FLAG",
            );
          }

          if (
            excludeLowLiquidityFlag &&
            lowLiquidity
          ) {
            masterReasons.push(
              "MASTER_LOW_LIQUIDITY_FLAG",
            );
          }

          const masterEligible =
            masterReasons.length ===
            0;

          const dataReasons:
            string[] = [];

          if (
            row
              .latest_bar_date !==
            marketClock
              .marketDate
          ) {
            dataReasons.push(
              row
                .latest_bar_date
                ? "LATEST_BAR_NOT_CURRENT"
                : "NO_DAILY_BARS",
            );
          }

          if (
            recentBarCount <
            minimumBars
          ) {
            dataReasons.push(
              "INSUFFICIENT_DAILY_BARS",
            );
          }

          const dataReady =
            dataReasons.length ===
            0;

          const liquidityReasons:
            string[] = [];

          if (
            dataReady
          ) {
            if (
              latestClose ===
                null ||
              latestClose <
                minimumPrice
            ) {
              liquidityReasons.push(
                "PRICE_BELOW_MINIMUM",
              );
            }

            if (
              averageTradingValue ===
                null ||
              averageTradingValue <
                minimumAverageTradingValue
            ) {
              liquidityReasons.push(
                "AVERAGE_TRADING_VALUE_BELOW_MINIMUM",
              );
            }
          }

          const liquidityEligible =
            dataReady &&
            liquidityReasons.length ===
              0;

          const eligible =
            masterEligible &&
            liquidityEligible;

          return {
            stockCode:
              row.stock_code,

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

            masterEligible,

            dataReady,

            liquidityEligible,

            eligible,

            latestBarDate:
              row
                .latest_bar_date,

            latestClose,

            recentBarCount,

            averageVolume,

            averageTradingValue,

            management,
            lowLiquidity,

            reasons: [
              ...masterReasons,
              ...dataReasons,
              ...liquidityReasons,
            ],
          };
        },
      );

    const liquidityRanked =
      screened
        .filter(
          (
            row,
          ) =>
            row
              .averageTradingValue !==
            null,
        )
        .sort(
          (
            left,
            right,
          ) =>
            (
              right
                .averageTradingValue ??
              0
            ) -
            (
              left
                .averageTradingValue ??
              0
            ),
        );

    const rankByStock =
      new Map<
        string,
        number
      >();

    liquidityRanked.forEach(
      (
        row,
        index,
      ) => {
        rankByStock.set(
          row.stockCode,
          index +
            1,
        );
      },
    );

    const resultRows =
      screened.map(
        (
          row,
        ) => ({
          run_id:
            runId,

          stock_code:
            row.stockCode,

          stock_name:
            row.stockName,

          market:
            row.market,

          sector:
            row.sector,

          security_type:
            row.securityType,

          listed:
            row.listed,

          tradable:
            row.tradable,

          master_eligible:
            row.masterEligible,

          data_ready:
            row.dataReady,

          liquidity_eligible:
            row.liquidityEligible,

          eligible:
            row.eligible,

          latest_bar_date:
            row.latestBarDate,

          latest_close:
            row.latestClose,

          recent_bar_count:
            row.recentBarCount,

          average_volume:
            row.averageVolume,

          average_trading_value:
            row.averageTradingValue,

          liquidity_rank:
            rankByStock.get(
              row.stockCode,
            ) ??
            null,

          reasons:
            row.reasons,

          metrics: {
            management:
              row.management,

            lowLiquidity:
              row.lowLiquidity,

            marketDate:
              marketClock
                .marketDate,

            lookbackStartDate,

            minimumBars,
            minimumPrice,
            minimumAverageTradingValue,
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
        resultRows.length;
      offset +=
        chunkSize
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "stock_universe_screening_results",
          )
          .insert(
            resultRows.slice(
              offset,
              offset +
                chunkSize,
            ),
          );

      if (
        error
      ) {
        throw new Error(
          `v8.2.1 screening result insert failed: ${error.message}`,
        );
      }
    }

    const totalMembers =
      screened.length;

    const masterEligibleCount =
      screened.filter(
        (
          row,
        ) =>
          row
            .masterEligible,
      ).length;

    const dataReadyCount =
      screened.filter(
        (
          row,
        ) =>
          row
            .dataReady,
      ).length;

    const liquidityEligibleCount =
      screened.filter(
        (
          row,
        ) =>
          row
            .liquidityEligible,
      ).length;

    const finalEligible =
      screened.filter(
        (
          row,
        ) =>
          row.eligible,
      );

    const dataCoverageRate =
      masterEligibleCount >
        0
        ? dataReadyCount /
          masterEligibleCount
        : 0;

    const status =
      dataCoverageRate >=
        minimumCoverageRate
        ? "SUCCESS"
        : "INSUFFICIENT_MARKET_DATA";

    const topEligible =
      finalEligible
        .sort(
          (
            left,
            right,
          ) =>
            (
              right
                .averageTradingValue ??
              0
            ) -
            (
              left
                .averageTradingValue ??
              0
            ),
        )
        .slice(
          0,
          50,
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

            latestClose:
              row.latestClose,

            averageTradingValue:
              row
                .averageTradingValue,

            liquidityRank:
              rankByStock.get(
                row.stockCode,
              ) ??
              null,
          }),
        );

    const result = {
      version:
        "UNIVERSE_ELIGIBILITY_LIQUIDITY_SCREEN_V8_2_1",

      runId,

      status,

      universeCode,
      asOfDate,

      marketClock,

      lookback: {
        calendarDays:
          lookbackCalendarDays,

        startDate:
          lookbackStartDate,

        minimumBars,
      },

      criteria,

      counts: {
        totalMembers,

        masterEligible:
          masterEligibleCount,

        dataReady:
          dataReadyCount,

        missingOrInsufficientData:
          Math.max(
            0,
            masterEligibleCount -
            dataReadyCount,
          ),

        liquidityEligible:
          liquidityEligibleCount,

        finalEligible:
          finalEligible.length,
      },

      coverage: {
        dataCoverageRate,

        minimumRequired:
          minimumCoverageRate,

        sufficient:
          dataCoverageRate >=
          minimumCoverageRate,
      },

      topEligible,

      interpretation:
        status ===
          "SUCCESS"
          ? "Market-data coverage is sufficient for the configured liquidity screen."
          : "The point-in-time universe exists, but market_daily_bars coverage is too low. Missing bars are not treated as illiquidity; expand market-data collection before using this screen for research selection.",

      safety: {
        productionApplied:
          false,

        stocksTableModified:
          false,

        ordersChanged:
          false,

        missingDataClassifiedAsIlliquid:
          false,

        pointInTimeUniverseUsed:
          true,
      },
    };

    const {
      error: runUpdateError,
    } =
      await supabase
        .from(
          "stock_universe_screening_runs",
        )
        .update({
          finished_at:
            new Date()
              .toISOString(),

          status,

          total_members:
            totalMembers,

          master_eligible_count:
            masterEligibleCount,

          data_ready_count:
            dataReadyCount,

          liquidity_eligible_count:
            liquidityEligibleCount,

          final_eligible_count:
            finalEligible.length,

          data_coverage_rate:
            dataCoverageRate,

          result,

          production_applied:
            false,
        })
        .eq(
          "id",
          runId,
        );

    if (
      runUpdateError
    ) {
      throw new Error(
        `v8.2.1 screening run update failed: ${runUpdateError.message}`,
      );
    }

    return result;
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V8_2_1_SCREEN_ERROR";

    await supabase
      .from(
        "stock_universe_screening_runs",
      )
      .update({
        finished_at:
          new Date()
            .toISOString(),

        status:
          "FAILED",

        error_message:
          message,

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
