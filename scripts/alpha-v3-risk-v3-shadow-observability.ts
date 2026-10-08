import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

const VERSION =
  "ALPHA_V3_RISK_V3_SHADOW_OBSERVABILITY_V1";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-shadow-observability.json",
  );

const SNAPSHOT_STALE_MINUTES =
  60;

interface AccountRecord {
  id: string;
  cash_balance: number | string;
  daily_realized_pnl: number | string;
  trading_mode: "PAPER" | "LIVE";
}

interface PositionRecord {
  stock_code: string;
  sector: string | null;
  quantity: number;
  average_price: number | string;
  current_stop_price: number | string;
}

interface SnapshotRecord {
  stock_code: string;
  close_price: number | string | null;
  observed_at: string;
}

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function round(
  value: number,
  digits = 8,
): number {
  const factor =
    10 ** digits;

  return (
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
        factor,
    ) /
    factor
  );
}

function minutesSince(
  iso:
    string | null,
): number | null {
  if (!iso) {
    return null;
  }

  const ms =
    Date.now() -
    new Date(
      iso,
    ).getTime();

  if (
    !Number.isFinite(
      ms,
    )
  ) {
    return null;
  }

  return (
    ms /
    60_000
  );
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  let databaseReads =
    0;

  const {
    data: accountData,
    error: accountError,
  } =
    await supabase
      .from(
        "paper_accounts",
      )
      .select(
        "id,cash_balance,daily_realized_pnl,trading_mode",
      )
      .eq(
        "account_name",
        "default-paper",
      )
      .single();

  databaseReads +=
    1;

  if (
    accountError ||
    !accountData
  ) {
    throw new Error(
      "PAPER_ACCOUNT_READ_FAILED:" +
      (
        accountError?.message ??
        "NOT_FOUND"
      ),
    );
  }

  const account =
    accountData as
      AccountRecord;

  const {
    data: positionData,
    error: positionError,
  } =
    await supabase
      .from(
        "paper_positions",
      )
      .select(
        "stock_code,sector,quantity,average_price,current_stop_price",
      )
      .eq(
        "account_id",
        account.id,
      );

  databaseReads +=
    1;

  if (
    positionError
  ) {
    throw new Error(
      "PAPER_POSITIONS_READ_FAILED:" +
      positionError.message,
    );
  }

  const positions =
    (
      positionData ??
      []
    ) as
      PositionRecord[];

  const stockCodes =
    [
      ...new Set(
        positions.map(
          (position) =>
            position.stock_code,
        ),
      ),
    ];

  let snapshotRows:
    SnapshotRecord[] =
    [];

  if (
    stockCodes.length >
    0
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,close_price,observed_at",
        )
        .in(
          "stock_code",
          stockCodes,
        )
        .order(
          "observed_at",
          {
            ascending:
              false,
          },
        )
        .limit(
          Math.max(
            100,
            stockCodes.length *
              100,
          ),
        );

    databaseReads +=
      1;

    if (
      error
    ) {
      throw new Error(
        "MARKET_SNAPSHOT_READ_FAILED:" +
        error.message,
      );
    }

    snapshotRows =
      (
        data ??
        []
      ) as
        SnapshotRecord[];
  }

  const latestByStock =
    new Map<
      string,
      SnapshotRecord
    >();

  for (
    const row
    of snapshotRows
  ) {
    if (
      latestByStock.has(
        row.stock_code,
      )
    ) {
      continue;
    }

    latestByStock.set(
      row.stock_code,
      row,
    );
  }

  let currentInvestedAmount =
    0;

  let initialOpenRiskAmount =
    0;

  let markToStopRiskAmount =
    0;

  let lockedProfitAtStopAmount =
    0;

  let missingValidStopCount =
    0;

  let staleSnapshotCount =
    0;

  const sectorRiskMap =
    new Map<
      string,
      {
        exposureAmount: number;
        initialOpenRiskAmount: number;
        markToStopRiskAmount: number;
        positionCount: number;
      }
    >();

  const positionObservations =
    positions.map(
      (
        position,
      ) => {
        const quantity =
          Math.max(
            0,
            Math.floor(
              toNumber(
                position.quantity,
              ),
            ),
          );

        const averagePrice =
          toNumber(
            position.average_price,
          );

        const stopPrice =
          toNumber(
            position.current_stop_price,
          );

        const snapshot =
          latestByStock.get(
            position.stock_code,
          );

        const currentPrice =
          toNumber(
            snapshot
              ?.close_price,
          ) ||
          averagePrice;

        const observedAt =
          snapshot
            ?.observed_at ??
          null;

        const ageMinutes =
          minutesSince(
            observedAt,
          );

        const snapshotStale =
          ageMinutes !==
            null &&
          ageMinutes >
            SNAPSHOT_STALE_MINUTES;

        if (
          snapshotStale
        ) {
          staleSnapshotCount +=
            1;
        }

        const marketValue =
          currentPrice *
          quantity;

        const costValue =
          averagePrice *
          quantity;

        const validStop =
          quantity ===
            0 ||
          (
            averagePrice >
              0 &&
            stopPrice >
              0
          );

        if (
          quantity >
            0 &&
          !validStop
        ) {
          missingValidStopCount +=
            1;
        }

        const initialRisk =
          validStop
            ? Math.max(
                0,
                averagePrice -
                  stopPrice,
              ) *
              quantity
            : 0;

        const markRisk =
          validStop
            ? Math.max(
                0,
                currentPrice -
                  stopPrice,
              ) *
              quantity
            : 0;

        const lockedProfit =
          validStop
            ? Math.max(
                0,
                stopPrice -
                  averagePrice,
              ) *
              quantity
            : 0;

        currentInvestedAmount +=
          marketValue;

        initialOpenRiskAmount +=
          initialRisk;

        markToStopRiskAmount +=
          markRisk;

        lockedProfitAtStopAmount +=
          lockedProfit;

        const sector =
          position.sector ??
          "UNKNOWN";

        const sectorCurrent =
          sectorRiskMap.get(
            sector,
          ) ?? {
            exposureAmount:
              0,

            initialOpenRiskAmount:
              0,

            markToStopRiskAmount:
              0,

            positionCount:
              0,
          };

        sectorCurrent
          .exposureAmount +=
          marketValue;

        sectorCurrent
          .initialOpenRiskAmount +=
          initialRisk;

        sectorCurrent
          .markToStopRiskAmount +=
          markRisk;

        sectorCurrent
          .positionCount +=
          1;

        sectorRiskMap.set(
          sector,
          sectorCurrent,
        );

        return {
          stockCode:
            position.stock_code,

          sector:
            position.sector,

          quantity,

          averagePrice,

          currentPrice,

          currentStopPrice:
            stopPrice,

          latestObservedAt:
            observedAt,

          snapshotAgeMinutes:
            ageMinutes ===
              null
              ? null
              : round(
                  ageMinutes,
                  2,
                ),

          snapshotStale,

          marketValue:
            round(
              marketValue,
            ),

          costValue:
            round(
              costValue,
            ),

          unrealizedPnlAmount:
            round(
              marketValue -
                costValue,
            ),

          initialOpenRiskAmount:
            round(
              initialRisk,
            ),

          markToStopRiskAmount:
            round(
              markRisk,
            ),

          lockedProfitAtStopAmount:
            round(
              lockedProfit,
            ),

          stopDistanceFromAverageRate:
            averagePrice >
              0
              ? round(
                  (
                    averagePrice -
                    stopPrice
                  ) /
                    averagePrice,
                )
              : null,

          stopDistanceFromMarketRate:
            currentPrice >
              0
              ? round(
                  (
                    currentPrice -
                    stopPrice
                  ) /
                    currentPrice,
                )
              : null,

          validStop,
        };
      },
    );

  const cashBalance =
    toNumber(
      account.cash_balance,
    );

  const accountEquity =
    cashBalance +
    currentInvestedAmount;

  const aggregateRate =
    DEFAULT_RISK_POLICY
      .maxAggregateOpenRiskRate ??
    0.02;

  const aggregateBudgetAmount =
    accountEquity *
    aggregateRate;

  const aggregateRemainingAmount =
    Math.max(
      0,
      aggregateBudgetAmount -
        initialOpenRiskAmount,
    );

  const grossExposureRate =
    accountEquity >
      0
      ? currentInvestedAmount /
        accountEquity
      : 0;

  const aggregateInitialRiskRate =
    accountEquity >
      0
      ? initialOpenRiskAmount /
        accountEquity
      : 0;

  const markToStopRiskRate =
    accountEquity >
      0
      ? markToStopRiskAmount /
        accountEquity
      : 0;

  const aggregateUtilizationRate =
    aggregateBudgetAmount >
      0
      ? initialOpenRiskAmount /
        aggregateBudgetAmount
      : 0;

  const fullPositionAmount =
    accountEquity *
    DEFAULT_RISK_POLICY
      .maxPositionRate;

  const capacityByStop =
    [
      0.025,
      0.04,
      0.05,
    ].map(
      (
        stopDistanceRate,
      ) => {
        const fullTradeRiskAmount =
          fullPositionAmount *
          stopDistanceRate;

        const byAggregate =
          fullTradeRiskAmount >
            0
            ? Math.floor(
                (
                  aggregateRemainingAmount /
                  fullTradeRiskAmount
                ) +
                  1e-12,
              )
            : 0;

        const portfolioRemainingAmount =
          Math.max(
            0,
            (
              accountEquity *
              DEFAULT_RISK_POLICY
                .maxPortfolioExposureRate
            ) -
              currentInvestedAmount,
          );

        const byPortfolio =
          fullPositionAmount >
            0
            ? Math.floor(
                (
                  portfolioRemainingAmount /
                  fullPositionAmount
                ) +
                  1e-12,
              )
            : 0;

        const byPositionCount =
          Math.max(
            0,
            DEFAULT_RISK_POLICY
              .maxOpenPositions -
              positions.length,
          );

        return {
          stopDistanceRate,

          fullPositionAmount:
            round(
              fullPositionAmount,
            ),

          fullTradeRiskAmount:
            round(
              fullTradeRiskAmount,
            ),

          remainingCapacityByAggregate:
            byAggregate,

          remainingCapacityByPortfolio:
            byPortfolio,

          remainingCapacityByPositionCount:
            byPositionCount,

          effectiveAdditionalFullPositions:
            Math.max(
              0,
              Math.min(
                byAggregate,
                byPortfolio,
                byPositionCount,
              ),
            ),
        };
      },
    );

  const topRiskPositions =
    [
      ...positionObservations,
    ]
      .sort(
        (
          left,
          right,
        ) =>
          right
            .initialOpenRiskAmount -
          left
            .initialOpenRiskAmount,
      )
      .slice(
        0,
        5,
      );

  const sectorRisk =
    [
      ...sectorRiskMap.entries(),
    ]
      .map(
        (
          [
            sector,
            row,
          ],
        ) => ({
          sector,

          positionCount:
            row.positionCount,

          exposureAmount:
            round(
              row.exposureAmount,
            ),

          exposureRate:
            accountEquity >
              0
              ? round(
                  row.exposureAmount /
                    accountEquity,
                )
              : 0,

          initialOpenRiskAmount:
            round(
              row.initialOpenRiskAmount,
            ),

          initialOpenRiskRate:
            accountEquity >
              0
              ? round(
                  row
                    .initialOpenRiskAmount /
                    accountEquity,
                )
              : 0,

          markToStopRiskAmount:
            round(
              row.markToStopRiskAmount,
            ),
        }),
      )
      .sort(
        (
          left,
          right,
        ) =>
          right
            .initialOpenRiskAmount -
          left
            .initialOpenRiskAmount,
      );

  const alerts:
    string[] =
    [];

  if (
    missingValidStopCount >
    0
  ) {
    alerts.push(
      "OPEN_POSITION_STOP_MISSING",
    );
  }

  if (
    initialOpenRiskAmount >
    aggregateBudgetAmount +
      1e-8
  ) {
    alerts.push(
      "AGGREGATE_OPEN_RISK_BUDGET_EXCEEDED",
    );
  }

  if (
    grossExposureRate >
    DEFAULT_RISK_POLICY
      .maxPortfolioExposureRate +
      1e-8
  ) {
    alerts.push(
      "PORTFOLIO_EXPOSURE_LIMIT_EXCEEDED",
    );
  }

  if (
    positions.length >
    DEFAULT_RISK_POLICY
      .maxOpenPositions
  ) {
    alerts.push(
      "MAX_OPEN_POSITIONS_EXCEEDED",
    );
  }

  if (
    staleSnapshotCount >
    0
  ) {
    alerts.push(
      "STALE_MARKET_SNAPSHOT_PRESENT",
    );
  }

  const maxDailyLossAmount =
    accountEquity *
    DEFAULT_RISK_POLICY
      .maxDailyLossRate;

  const dailyLossReached =
    toNumber(
      account.daily_realized_pnl,
    ) <=
    -maxDailyLossAmount;

  if (
    dailyLossReached
  ) {
    alerts.push(
      "DAILY_LOSS_LIMIT_REACHED",
    );
  }

  const shadowHealthy =
    missingValidStopCount ===
      0 &&
    initialOpenRiskAmount <=
      aggregateBudgetAmount +
        1e-8 &&
    grossExposureRate <=
      DEFAULT_RISK_POLICY
        .maxPortfolioExposureRate +
        1e-8 &&
    positions.length <=
      DEFAULT_RISK_POLICY
        .maxOpenPositions &&
    !dailyLossReached;

  const report = {
    status:
      "ALPHA_V3_RISK_V3_SHADOW_OBSERVABILITY_COMPLETE",

    version:
      VERSION,

    observedAt:
      new Date()
        .toISOString(),

    account: {
      id:
        account.id,

      tradingMode:
        account.trading_mode,

      cashBalance:
        round(
          cashBalance,
        ),

      currentInvestedAmount:
        round(
          currentInvestedAmount,
        ),

      accountEquity:
        round(
          accountEquity,
        ),

      grossExposureRate:
        round(
          grossExposureRate,
        ),

      dailyRealizedPnl:
        round(
          toNumber(
            account.daily_realized_pnl,
          ),
        ),

      maxDailyLossAmount:
        round(
          maxDailyLossAmount,
        ),

      dailyLossReached,
    },

    policy: {
      maxRiskPerTradeRate:
        DEFAULT_RISK_POLICY
          .maxRiskPerTradeRate,

      maxPositionRate:
        DEFAULT_RISK_POLICY
          .maxPositionRate,

      maxPortfolioExposureRate:
        DEFAULT_RISK_POLICY
          .maxPortfolioExposureRate,

      maxSectorExposureRate:
        DEFAULT_RISK_POLICY
          .maxSectorExposureRate,

      maxOpenPositions:
        DEFAULT_RISK_POLICY
          .maxOpenPositions,

      maxDailyLossRate:
        DEFAULT_RISK_POLICY
          .maxDailyLossRate,

      maxAggregateOpenRiskRate:
        aggregateRate,
    },

    aggregateOpenRisk: {
      initialRiskMethod:
        "sum(max(0, averagePrice - currentStopPrice) * quantity)",

      markToStopMethod:
        "sum(max(0, currentPrice - currentStopPrice) * quantity)",

      budgetAmount:
        round(
          aggregateBudgetAmount,
        ),

      initialOpenRiskAmount:
        round(
          initialOpenRiskAmount,
        ),

      initialOpenRiskRate:
        round(
          aggregateInitialRiskRate,
        ),

      utilizationRate:
        round(
          aggregateUtilizationRate,
        ),

      remainingAmount:
        round(
          aggregateRemainingAmount,
        ),

      markToStopRiskAmount:
        round(
          markToStopRiskAmount,
        ),

      markToStopRiskRate:
        round(
          markToStopRiskRate,
        ),

      lockedProfitAtStopAmount:
        round(
          lockedProfitAtStopAmount,
        ),
    },

    positions: {
      count:
        positions.length,

      missingValidStopCount,

      staleSnapshotCount,

      topRiskPositions,

      all:
        positionObservations,
    },

    sectorRisk,

    additionalFullPositionCapacity:
      capacityByStop,

    alerts,

    decision: {
      shadowHealthy,

      admissionShouldFailClosed:
        missingValidStopCount >
        0,

      aggregateBudgetExceeded:
        initialOpenRiskAmount >
        aggregateBudgetAmount +
          1e-8,

      dailyLossReached,

      productionChanged:
        false,

      nextUse:
        shadowHealthy
          ? "BUILD_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY"
          : "REVIEW_RISK_V3_SHADOW_ALERTS",
    },

    safety: {
      databaseReads,

      databaseWrites:
        0,

      kisRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      shadowHealthy
        ? "BUILD_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY"
        : "REVIEW_RISK_V3_SHADOW_ALERTS",

    outputFile:
      "logs/alpha-v3-risk-v3-shadow-observability.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2,
    ) +
      "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_RISK_V3_SHADOW_OBSERVABILITY_FAILED",

          version:
            VERSION,

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),

          safety: {
            databaseWrites:
              0,

            kisRequests:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,

            productionChanged:
              false,
          },

          nextGate:
            "REVIEW_RISK_V3_SHADOW_OBSERVABILITY_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
