import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

import type {
  BuyRiskInput,
  BuyRiskResult,
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_V1";

const CHECKPOINT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-portfolio-replay.json",
  );

const INITIAL_CAPITAL =
  10_000_000;

const ENTRY_PREMIUM_CAP =
  0.01;

const POLICIES = [
  {
    id:
      "BASELINE",
    initialStop:
      0.025,
    activation:
      0.03,
    trailing:
      0.02,
    maxHoldingDays:
      20,
  },
  {
    id:
      "TREND_FOLLOW",
    initialStop:
      0.05,
    activation:
      0.08,
    trailing:
      0.05,
    maxHoldingDays:
      20,
  },
  {
    id:
      "FIXED_STOP_4PCT",
    initialStop:
      0.04,
    activation:
      99,
    trailing:
      0,
    maxHoldingDays:
      20,
  },
] as const;

type Policy =
  (typeof POLICIES)[number];

interface EntryCandidate {
  sourceTradingDate:
    string;

  entryDate:
    string;

  stockCode:
    string;

  entryPrice:
    number;

  observedAt:
    string | null;

  score:
    number | null;
}

interface DailyBar {
  stock_code:
    string;

  trading_date:
    string;

  open_price:
    number | string | null;

  high_price:
    number | string | null;

  low_price:
    number | string | null;

  close_price:
    number | string | null;
}

interface StockRecord {
  stock_code:
    string;

  sector:
    string | null;
}

interface Position {
  stockCode:
    string;

  sector:
    string | null;

  entryDate:
    string;

  entryPrice:
    number;

  quantity:
    number;

  initialStopPrice:
    number;

  currentStopPrice:
    number;

  activationPrice:
    number;

  highestPrice:
    number;

  holdingDays:
    number;

  entryEquity:
    number;

  entryRiskAmount:
    number;

  entryPositionAmount:
    number;
}

interface ClosedTrade {
  stockCode:
    string;

  sector:
    string | null;

  entryDate:
    string;

  exitDate:
    string;

  entryPrice:
    number;

  exitPrice:
    number;

  quantity:
    number;

  holdingDays:
    number;

  exitReason:
    string;

  pnlAmount:
    number;

  returnOnPosition:
    number;

  returnOnEntryEquity:
    number;

  entryRiskAmount:
    number;
}

function n(
  value:
    unknown,
): number {
  const parsed =
    Number(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}

function round(
  value:
    number,
  digits =
    8,
): number {
  const factor =
    10 **
    digits;

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

function mean(
  values:
    number[],
): number | null {
  if (
    values.length ===
    0
  ) {
    return null;
  }

  return (
    values.reduce(
      (
        sum,
        value,
      ) =>
        sum +
        value,
      0,
    ) /
    values.length
  );
}

function median(
  values:
    number[],
): number | null {
  if (
    values.length ===
    0
  ) {
    return null;
  }

  const sorted =
    [
      ...values,
    ].sort(
      (
        a,
        b,
      ) =>
        a -
        b,
    );

  const middle =
    Math.floor(
      sorted.length /
      2,
    );

  if (
    sorted.length %
      2 ===
    1
  ) {
    return sorted[
      middle
    ];
  }

  return (
    (
      sorted[
        middle -
        1
      ] +
      sorted[
        middle
      ]
    ) /
    2
  );
}

function summarize(
  values:
    number[],
) {
  return {
    count:
      values.length,

    mean:
      mean(
        values,
      ),

    median:
      median(
        values,
      ),

    positiveRate:
      values.length >
        0
        ? values.filter(
            (
              value,
            ) =>
              value >
              0,
          ).length /
          values.length
        : null,

    min:
      values.length >
        0
        ? Math.min(
            ...values,
          )
        : null,

    max:
      values.length >
        0
        ? Math.max(
            ...values,
          )
        : null,
  };
}

function loadEntries():
  EntryCandidate[] {
  if (
    !fs.existsSync(
      CHECKPOINT_FILE,
    )
  ) {
    throw new Error(
      "ENTRY_CHECKPOINT_NOT_FOUND",
    );
  }

  const checkpoint =
    JSON.parse(
      fs.readFileSync(
        CHECKPOINT_FILE,
        "utf8",
      ),
    );

  const rows =
    Array.isArray(
      checkpoint?.results,
    )
      ? checkpoint.results
      : [];

  return rows
    .filter(
      (
        row:
          any,
      ) =>
        row
          ?.correctedEntry
          ?.qualified ===
        true,
    )
    .map(
      (
        row:
          any,
      ) => {
        const policy =
          Array.isArray(
            row
              ?.limitPolicies,
          )
            ? row.limitPolicies.find(
                (
                  candidate:
                    any,
                ) =>
                  Math.abs(
                    Number(
                      candidate
                        ?.maxPremium,
                    ) -
                    ENTRY_PREMIUM_CAP,
                  ) <
                  1e-12,
              )
            : null;

        return {
          sourceTradingDate:
            String(
              row
                ?.sourceTradingDate ??
                "",
            ),

          entryDate:
            String(
              row
                ?.targetSessionDate ??
                "",
            ),

          stockCode:
            String(
              row
                ?.stockCode ??
                "",
            ),

          entryPrice:
            n(
              policy
                ?.fillPrice,
            ),

          observedAt:
            policy
              ?.observedAt
              ? String(
                  policy
                    .observedAt,
                )
              : null,

          score:
            Number.isFinite(
              Number(
                row
                  ?.correctedEntry
                  ?.score,
              ),
            )
              ? Number(
                  row
                    .correctedEntry
                    .score,
                )
              : null,

          filled:
            policy
              ?.filled ===
            true,
        };
      },
    )
    .filter(
      (
        row:
          any,
      ) =>
        row.filled ===
          true &&
        row.entryDate &&
        row.stockCode &&
        row.entryPrice >
          0,
    )
    .map(
      (
        row:
          any,
      ) => ({
        sourceTradingDate:
          row.sourceTradingDate,

        entryDate:
          row.entryDate,

        stockCode:
          row.stockCode,

        entryPrice:
          row.entryPrice,

        observedAt:
          row.observedAt,

        score:
          row.score,
      }),
    )
    .sort(
      (
        left,
        right,
      ) =>
        left.entryDate ===
        right.entryDate
          ? left.stockCode.localeCompare(
              right.stockCode,
            )
          : left.entryDate.localeCompare(
              right.entryDate,
            ),
    );
}

function barPrice(
  bar:
    DailyBar | undefined,
  field:
    "open_price" |
    "high_price" |
    "low_price" |
    "close_price",
  fallback:
    number,
): number {
  const value =
    n(
      bar?.[
        field
      ],
    );

  return value >
    0
    ? value
    : fallback;
}

function findLatestBarOnOrBefore(
  bars:
    DailyBar[],
  date:
    string,
): DailyBar | undefined {
  let result:
    DailyBar | undefined;

  for (
    const bar
    of bars
  ) {
    if (
      bar.trading_date >
      date
    ) {
      break;
    }

    result =
      bar;
  }

  return result;
}

function hasIssue(
  result:
    BuyRiskResult,
  code:
    string,
): boolean {
  return result.issues.some(
    (
      issue,
    ) =>
      issue.code ===
      code,
  );
}

async function main() {
  const entries =
    loadEntries();

  if (
    entries.length ===
    0
  ) {
    throw new Error(
      "NO_FILLED_ENTRY_V3_ROWS",
    );
  }

  const stockCodes =
    [
      ...new Set(
        entries.map(
          (
            row,
          ) =>
            row.stockCode,
        ),
      ),
    ];

  const minDate =
    entries[
      0
    ].entryDate;

  const supabase =
    createSupabaseServerClient();

  let databaseReads =
    0;

  const sectorResult =
    await supabase
      .from(
        "stocks",
      )
      .select(
        "stock_code,sector",
      )
      .in(
        "stock_code",
        stockCodes,
      );

  databaseReads +=
    1;

  if (
    sectorResult.error
  ) {
    throw new Error(
      "STOCK_SECTOR_READ_FAILED:" +
      sectorResult
        .error
        .message,
    );
  }

  const sectorByStock =
    new Map<
      string,
      string | null
    >(
      (
        sectorResult.data ??
        []
      )
        .map(
          (
            row:
              StockRecord,
          ) => [
            String(
              row.stock_code,
            ),
            row.sector ??
              null,
          ],
        ),
    );

  const barsByStock =
    new Map<
      string,
      DailyBar[]
    >();

  const tradingDates =
    new Set<
      string
    >();

  for (
    const stockCode
    of stockCodes
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(
          "stock_code,trading_date,open_price,high_price,low_price,close_price,adjusted_price",
        )
        .eq(
          "stock_code",
          stockCode,
        )
        .eq(
          "adjusted_price",
          true,
        )
        .gte(
          "trading_date",
          minDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        )
        .limit(
          1500,
        );

    databaseReads +=
      1;

    if (
      error
    ) {
      throw new Error(
        "DAILY_BAR_READ_FAILED:" +
        stockCode +
        ":" +
        error.message,
      );
    }

    const bars =
      (
        data ??
        []
      ) as
        DailyBar[];

    barsByStock.set(
      stockCode,
      bars,
    );

    for (
      const bar
      of bars
    ) {
      tradingDates.add(
        String(
          bar.trading_date,
        ),
      );
    }
  }

  const dates =
    [
      ...tradingDates,
    ]
      .filter(
        (
          date,
        ) =>
          date >=
          minDate,
      )
      .sort();

  const entriesByDate =
    new Map<
      string,
      EntryCandidate[]
    >();

  for (
    const entry
    of entries
  ) {
    const current =
      entriesByDate.get(
        entry.entryDate,
      ) ??
      [];

    current.push(
      entry,
    );

    entriesByDate.set(
      entry.entryDate,
      current,
    );
  }

  const policyResults =
    [];

  for (
    const policy
    of POLICIES
  ) {
    let cash =
      INITIAL_CAPITAL;

    const openPositions =
      new Map<
        string,
        Position
      >();

    const closedTrades:
      ClosedTrade[] =
      [];

    const rejectedEntries:
      Array<{
        entryDate:
          string;
        stockCode:
          string;
        entryPrice:
          number;
        reasons:
          string[];
        maxAllowedQuantity:
          number | null;
      }> =
      [];

    const equityCurve:
      Array<{
        date:
          string;
        equity:
          number;
        cash:
          number;
        openPositions:
          number;
        investedAmount:
          number;
        aggregateOpenRiskAmount:
          number;
      }> =
      [];

    let peakEquity =
      INITIAL_CAPITAL;

    let maxDrawdown =
      0;

    let peakGrossExposureRate =
      0;

    let peakAggregateRiskRate =
      0;

    let peakAggregateUtilization =
      0;

    let peakOpenPositions =
      0;

    const rejectionCounts =
      new Map<
        string,
        number
      >();

    let acceptedEntries =
      0;

    let dailyRealizedPnl =
      0;

    let currentProcessingDate =
      "";

    for (
      const date
      of dates
    ) {
      if (
        date !==
        currentProcessingDate
      ) {
        currentProcessingDate =
          date;

        dailyRealizedPnl =
          0;
      }

      /*
       * 1) Existing position exits happen before new entries.
       * Entry-day exit evaluation is disabled.
       */
      for (
        const [
          stockCode,
          position,
        ]
        of [
          ...openPositions.entries(),
        ]
      ) {
        if (
          date <=
          position.entryDate
        ) {
          continue;
        }

        const bar =
          barsByStock
            .get(
              stockCode,
            )
            ?.find(
              (
                row,
              ) =>
                row.trading_date ===
                date,
            );

        if (
          !bar
        ) {
          continue;
        }

        const open =
          barPrice(
            bar,
            "open_price",
            position.entryPrice,
          );

        const high =
          barPrice(
            bar,
            "high_price",
            open,
          );

        const low =
          barPrice(
            bar,
            "low_price",
            open,
          );

        const close =
          barPrice(
            bar,
            "close_price",
            open,
          );

        position.holdingDays +=
          1;

        let exitPrice:
          number | null =
          null;

        let exitReason:
          string | null =
          null;

        if (
          open <=
          position
            .currentStopPrice
        ) {
          exitPrice =
            open;

          exitReason =
            "STOP_GAP";
        } else if (
          low <=
          position
            .currentStopPrice
        ) {
          exitPrice =
            position
              .currentStopPrice;

          exitReason =
            "STOP_TOUCH";
        } else if (
          position.holdingDays >=
          policy.maxHoldingDays
        ) {
          exitPrice =
            close;

          exitReason =
            "MAX_HOLD_CLOSE";
        }

        if (
          exitPrice !==
          null &&
          exitReason !==
          null
        ) {
          const proceeds =
            exitPrice *
            position.quantity;

          const cost =
            position
              .entryPrice *
            position.quantity;

          const pnl =
            proceeds -
            cost;

          cash +=
            proceeds;

          dailyRealizedPnl +=
            pnl;

          closedTrades.push({
            stockCode,

            sector:
              position.sector,

            entryDate:
              position.entryDate,

            exitDate:
              date,

            entryPrice:
              position
                .entryPrice,

            exitPrice,

            quantity:
              position.quantity,

            holdingDays:
              position.holdingDays,

            exitReason,

            pnlAmount:
              pnl,

            returnOnPosition:
              (
                exitPrice -
                position
                  .entryPrice
              ) /
              position
                .entryPrice,

            returnOnEntryEquity:
              position
                .entryEquity >
                0
                ? pnl /
                  position
                    .entryEquity
                : 0,

            entryRiskAmount:
              position
                .entryRiskAmount,
          });

          openPositions.delete(
            stockCode,
          );

          continue;
        }

        /*
         * Trailing update is end-of-day and only affects next session.
         */
        position.highestPrice =
          Math.max(
            position
              .highestPrice,
            high,
          );

        if (
          policy.trailing >
            0 &&
          position
            .highestPrice >=
            position
              .activationPrice
        ) {
          const candidateStop =
            position
              .highestPrice *
            (
              1 -
              policy.trailing
            );

          if (
            candidateStop >
            position
              .currentStopPrice
          ) {
            position.currentStopPrice =
              candidateStop;
          }
        }
      }

      /*
       * 2) New Entry V3 fills for this trading day.
       */
      const todayEntries =
        entriesByDate.get(
          date,
        ) ??
        [];

      for (
        const entry
        of todayEntries
      ) {
        if (
          openPositions.has(
            entry.stockCode,
          )
        ) {
          const reason =
            "ACTIVE_POSITION_EXISTS";

          rejectedEntries.push({
            entryDate:
              date,

            stockCode:
              entry.stockCode,

            entryPrice:
              entry.entryPrice,

            reasons: [
              reason,
            ],

            maxAllowedQuantity:
              0,
          });

          rejectionCounts.set(
            reason,
            (
              rejectionCounts.get(
                reason,
              ) ??
              0
            ) +
              1,
          );

          continue;
        }

        let investedAmount =
          0;

        let currentStockExposureAmount =
          0;

        let currentSectorExposureAmount =
          0;

        let currentAggregateOpenRiskAmount =
          0;

        const targetSector =
          sectorByStock.get(
            entry.stockCode,
          ) ??
          null;

        let markedOpenValue =
          0;

        for (
          const position
          of openPositions.values()
        ) {
          const bars =
            barsByStock.get(
              position.stockCode,
            ) ??
            [];

          const currentBar =
            bars.find(
              (
                row,
              ) =>
                row.trading_date ===
                date,
            );

          const previousBar =
            findLatestBarOnOrBefore(
              bars,
              date,
            );

          const markPrice =
            currentBar
              ? barPrice(
                  currentBar,
                  "open_price",
                  position
                    .entryPrice,
                )
              : previousBar
                ? barPrice(
                    previousBar,
                    "close_price",
                    position
                      .entryPrice,
                  )
                : position
                    .entryPrice;

          const value =
            markPrice *
            position.quantity;

          investedAmount +=
            value;

          markedOpenValue +=
            value;

          if (
            position.stockCode ===
            entry.stockCode
          ) {
            currentStockExposureAmount +=
              value;
          }

          if (
            (
              targetSector ??
              "UNKNOWN"
            ) ===
            (
              position.sector ??
              "UNKNOWN"
            )
          ) {
            currentSectorExposureAmount +=
              value;
          }

          currentAggregateOpenRiskAmount +=
            Math.max(
              0,
              position
                .entryPrice -
              position
                .currentStopPrice,
            ) *
            position.quantity;
        }

        const accountEquity =
          cash +
          markedOpenValue;

        const proposedStopPrice =
          entry.entryPrice *
          (
            1 -
            policy.initialStop
          );

        const requestedQuantity =
          Math.max(
            1,
            Math.floor(
              cash /
              entry.entryPrice,
            ),
          );

        const riskInput:
          BuyRiskInput =
          {
            stockCode:
              entry.stockCode,

            entryPrice:
              entry.entryPrice,

            proposedStopPrice,

            requestedQuantity,

            accountEquity,

            availableCash:
              cash,

            currentInvestedAmount:
              investedAmount,

            currentStockExposureAmount,

            currentSectorExposureAmount,

            currentAggregateOpenRiskAmount,

            openPositionsMissingValidStopCount:
              0,

            dailyRealizedPnl,

            openPositionCount:
              openPositions.size,

            isNewPosition:
              true,

            tradingMode:
              "PAPER",

            modelStatus:
              "CANDIDATE",
          };

        const firstPass =
          validateBuyRisk(
            riskInput,
          );

        const quantity =
          Math.max(
            0,
            firstPass
              .maxAllowedQuantity,
          );

        if (
          quantity <=
          0
        ) {
          const reasons =
            firstPass
              .issues
              .map(
                (
                  issue,
                ) =>
                  issue.code,
              );

          const normalizedReasons =
            reasons.length >
              0
              ? reasons
              : [
                  "ZERO_ALLOWED_QUANTITY",
                ];

          rejectedEntries.push({
            entryDate:
              date,

            stockCode:
              entry.stockCode,

            entryPrice:
              entry.entryPrice,

            reasons:
              normalizedReasons,

            maxAllowedQuantity:
              firstPass
                .maxAllowedQuantity,
          });

          for (
            const reason
            of normalizedReasons
          ) {
            rejectionCounts.set(
              reason,
              (
                rejectionCounts.get(
                  reason,
                ) ??
                0
              ) +
                1,
            );
          }

          continue;
        }

        const finalRisk =
          validateBuyRisk({
            ...riskInput,
            requestedQuantity:
              quantity,
          });

        if (
          !finalRisk.approved
        ) {
          const reasons =
            finalRisk
              .issues
              .map(
                (
                  issue,
                ) =>
                  issue.code,
              );

          rejectedEntries.push({
            entryDate:
              date,

            stockCode:
              entry.stockCode,

            entryPrice:
              entry.entryPrice,

            reasons,

            maxAllowedQuantity:
              quantity,
          });

          for (
            const reason
            of reasons
          ) {
            rejectionCounts.set(
              reason,
              (
                rejectionCounts.get(
                  reason,
                ) ??
                0
              ) +
                1,
            );
          }

          continue;
        }

        const cost =
          entry.entryPrice *
          quantity;

        const entryRiskAmount =
          (
            entry.entryPrice -
            proposedStopPrice
          ) *
          quantity;

        cash -=
          cost;

        acceptedEntries +=
          1;

        openPositions.set(
          entry.stockCode,
          {
            stockCode:
              entry.stockCode,

            sector:
              targetSector,

            entryDate:
              date,

            entryPrice:
              entry.entryPrice,

            quantity,

            initialStopPrice:
              proposedStopPrice,

            currentStopPrice:
              proposedStopPrice,

            activationPrice:
              entry.entryPrice *
              (
                1 +
                policy.activation
              ),

            highestPrice:
              entry.entryPrice,

            holdingDays:
              0,

            entryEquity:
              accountEquity,

            entryRiskAmount,

            entryPositionAmount:
              cost,
          },
        );
      }

      /*
       * 3) End-of-day mark-to-market for diagnostics only.
       * It never feeds same-day entry sizing.
       */
      let endInvested =
        0;

      let endAggregateRisk =
        0;

      for (
        const position
        of openPositions.values()
      ) {
        const bars =
          barsByStock.get(
            position.stockCode,
          ) ??
          [];

        const todayBar =
          bars.find(
            (
              row,
            ) =>
              row.trading_date ===
              date,
          );

        const prior =
          findLatestBarOnOrBefore(
            bars,
            date,
          );

        const mark =
          todayBar
            ? barPrice(
                todayBar,
                "close_price",
                position
                  .entryPrice,
              )
            : prior
              ? barPrice(
                  prior,
                  "close_price",
                  position
                    .entryPrice,
                )
              : position
                  .entryPrice;

        endInvested +=
          mark *
          position.quantity;

        endAggregateRisk +=
          Math.max(
            0,
            position
              .entryPrice -
            position
              .currentStopPrice,
          ) *
          position.quantity;
      }

      const endEquity =
        cash +
        endInvested;

      peakEquity =
        Math.max(
          peakEquity,
          endEquity,
        );

      if (
        peakEquity >
        0
      ) {
        const drawdown =
          (
            peakEquity -
            endEquity
          ) /
          peakEquity;

        maxDrawdown =
          Math.max(
            maxDrawdown,
            drawdown,
          );
      }

      const grossExposureRate =
        endEquity >
          0
          ? endInvested /
            endEquity
          : 0;

      const aggregateRiskRate =
        endEquity >
          0
          ? endAggregateRisk /
            endEquity
          : 0;

      const aggregateUtilization =
        endEquity >
          0
          ? endAggregateRisk /
            (
              endEquity *
              0.02
            )
          : 0;

      peakGrossExposureRate =
        Math.max(
          peakGrossExposureRate,
          grossExposureRate,
        );

      peakAggregateRiskRate =
        Math.max(
          peakAggregateRiskRate,
          aggregateRiskRate,
        );

      peakAggregateUtilization =
        Math.max(
          peakAggregateUtilization,
          aggregateUtilization,
        );

      peakOpenPositions =
        Math.max(
          peakOpenPositions,
          openPositions.size,
        );

      equityCurve.push({
        date,

        equity:
          round(
            endEquity,
          ),

        cash:
          round(
            cash,
          ),

        openPositions:
          openPositions.size,

        investedAmount:
          round(
            endInvested,
          ),

        aggregateOpenRiskAmount:
          round(
            endAggregateRisk,
          ),
      });
    }

    const finalDate =
      dates[
        dates.length -
          1
      ];

    let finalMarkedValue =
      0;

    const openAtEnd =
      [];

    for (
      const position
      of openPositions.values()
    ) {
      const bars =
        barsByStock.get(
          position.stockCode,
        ) ??
        [];

      const lastBar =
        findLatestBarOnOrBefore(
          bars,
          finalDate,
        );

      const mark =
        lastBar
          ? barPrice(
              lastBar,
              "close_price",
              position.entryPrice,
            )
          : position.entryPrice;

      const marketValue =
        mark *
        position.quantity;

      const unrealizedPnl =
        (
          mark -
          position.entryPrice
        ) *
        position.quantity;

      finalMarkedValue +=
        marketValue;

      openAtEnd.push({
        stockCode:
          position.stockCode,

        sector:
          position.sector,

        entryDate:
          position.entryDate,

        entryPrice:
          position.entryPrice,

        markPrice:
          mark,

        quantity:
          position.quantity,

        currentStopPrice:
          position.currentStopPrice,

        holdingDays:
          position.holdingDays,

        marketValue:
          round(
            marketValue,
          ),

        unrealizedPnl:
          round(
            unrealizedPnl,
          ),
      });
    }

    const finalEquity =
      cash +
      finalMarkedValue;

    const totalReturn =
      (
        finalEquity -
        INITIAL_CAPITAL
      ) /
      INITIAL_CAPITAL;

    const realizedPnl =
      closedTrades.reduce(
        (
          sum,
          trade,
        ) =>
          sum +
          trade.pnlAmount,
        0,
      );

    const tradeReturns =
      closedTrades.map(
        (
          trade,
        ) =>
          trade.returnOnPosition,
      );

    const entryEquityReturns =
      closedTrades.map(
        (
          trade,
        ) =>
          trade.returnOnEntryEquity,
      );

    const grossProfit =
      closedTrades
        .filter(
          (
            trade,
          ) =>
            trade.pnlAmount >
            0,
        )
        .reduce(
          (
            sum,
            trade,
          ) =>
            sum +
            trade.pnlAmount,
          0,
        );

    const grossLoss =
      Math.abs(
        closedTrades
          .filter(
            (
              trade,
            ) =>
              trade.pnlAmount <
              0,
          )
          .reduce(
            (
              sum,
              trade,
            ) =>
              sum +
              trade.pnlAmount,
            0,
          ),
      );

    policyResults.push({
      policy,

      counts: {
        entryCandidates:
          entries.length,

        acceptedEntries,

        rejectedEntries:
          rejectedEntries.length,

        closedTrades:
          closedTrades.length,

        openPositionsAtEnd:
          openPositions.size,
      },

      capital: {
        initialCapital:
          INITIAL_CAPITAL,

        endingCash:
          round(
            cash,
          ),

        finalMarkedValue:
          round(
            finalMarkedValue,
          ),

        finalEquity:
          round(
            finalEquity,
          ),

        realizedPnl:
          round(
            realizedPnl,
          ),

        totalReturn:
          round(
            totalReturn,
          ),

        maxDrawdown:
          round(
            maxDrawdown,
          ),
      },

      utilization: {
        peakGrossExposureRate:
          round(
            peakGrossExposureRate,
          ),

        peakAggregateOpenRiskRate:
          round(
            peakAggregateRiskRate,
          ),

        peakAggregateRiskUtilization:
          round(
            peakAggregateUtilization,
          ),

        peakOpenPositions,
      },

      closedTradeReturn:
        summarize(
          tradeReturns,
        ),

      closedTradeReturnOnEntryEquity:
        summarize(
          entryEquityReturns,
        ),

      profitFactor:
        grossLoss >
          0
          ? round(
              grossProfit /
              grossLoss,
            )
          : grossProfit >
              0
            ? null
            : 0,

      exitReasons:
        Object.fromEntries(
          [
            ...new Set(
              closedTrades.map(
                (
                  trade,
                ) =>
                  trade.exitReason,
              ),
            ),
          ].map(
            (
              reason,
            ) => [
              reason,
              closedTrades.filter(
                (
                  trade,
                ) =>
                  trade.exitReason ===
                  reason,
              ).length,
            ],
          ),
        ),

      rejectionCounts:
        Object.fromEntries(
          [
            ...rejectionCounts
              .entries(),
          ].sort(
            (
              left,
              right,
            ) =>
              right[
                1
              ] -
              left[
                1
              ],
          ),
        ),

      allClosedTrades:
        closedTrades,

      allRejectedEntries:
        rejectedEntries,

      sampleClosedTrades:
        closedTrades.slice(
          0,
          10,
        ),

      openAtEnd,

      equityCurveSample: [
        ...equityCurve.slice(
          0,
          5,
        ),

        ...equityCurve.slice(
          -5,
        ),
      ],
    });
  }

  const ranking =
    [
      ...policyResults,
    ]
      .sort(
        (
          left:
            any,
          right:
            any,
        ) =>
          right
            .capital
            .finalEquity -
          left
            .capital
            .finalEquity,
      )
      .map(
        (
          row:
            any,
          index:
            number,
        ) => ({
          rank:
            index +
            1,

          id:
            row
              .policy
              .id,

          finalEquity:
            row
              .capital
              .finalEquity,

          totalReturn:
            row
              .capital
              .totalReturn,

          maxDrawdown:
            row
              .capital
              .maxDrawdown,

          acceptedEntries:
            row
              .counts
              .acceptedEntries,

          closedTrades:
            row
              .counts
              .closedTrades,

          peakGrossExposureRate:
            row
              .utilization
              .peakGrossExposureRate,

          peakAggregateOpenRiskRate:
            row
              .utilization
              .peakAggregateOpenRiskRate,
        }),
      );

  const report = {
    status:
      "ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_COMPLETE",

    version:
      VERSION,

    validationClass:
      "HISTORICAL_SAME_SAMPLE_PORTFOLIO_STRESS_TEST_NOT_TRUE_OOS",

    contract: {
      initialCapital:
        INITIAL_CAPITAL,

      entryLayer:
        "ENTRY_V3_CORRECTED_GATE_PLUS_1PCT_ANTI_CHASE_FILL",

      entryPremiumCap:
        ENTRY_PREMIUM_CAP,

      exitPolicies:
        POLICIES,

      entryDayExitEvaluation:
        "DISABLED",

      trailingUpdateTiming:
        "END_OF_DAY_EFFECTIVE_NEXT_SESSION",

      sizingMarkForExistingPositions:
        "SAME_DAY_OPEN_OR_PRIOR_CLOSE_FALLBACK_NO_CLOSE_LOOKAHEAD_FOR_ENTRY_SIZING",

      endOfDayEquity:
        "CLOSE_MARK_TO_MARKET_DIAGNOSTIC_ONLY",

      costsIncluded:
        false,

      slippageIncluded:
        "STOP_GAP_OPEN_PRICE_ONLY_NO_ADDITIONAL_EXECUTION_SLIPPAGE",

      productionPolicyLocked:
        false,

      sameSampleWarning:
        true,
    },

    source: {
      checkpointFile:
        "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",

      filledEntryCandidates:
        entries.length,

      stockCount:
        stockCodes.length,

      firstEntryDate:
        entries[
          0
        ].entryDate,

      lastEntryDate:
        entries[
          entries.length -
            1
        ].entryDate,

      tradingDateCount:
        dates.length,

      databaseReads,
    },

    portfolioConstraints: {
      maxRiskPerTradeRate:
        0.005,

      maxPositionRate:
        0.1,

      maxPortfolioExposureRate:
        0.6,

      maxSectorExposureRate:
        0.25,

      maxOpenPositions:
        8,

      maxAggregateOpenRiskRate:
        0.02,

      maxDailyLossRate:
        0.02,

      duplicateStockEntry:
        "REJECT_WHILE_POSITION_OPEN",
    },

    ranking,

    policies:
      policyResults,

    interpretation: {
      comparePortfolioNotPerTradeAverage:
        true,

      capitalCompetitionIncluded:
        true,

      overlappingHoldingsIncluded:
        true,

      aggregateOpenRiskIncluded:
        true,

      dailyLossGateIncluded:
        true,

      sectorLimitIncluded:
        true,

      caveats: [
        "Historical same-sample replay; not forward OOS.",
        "Only the current Entry V3 historical universe is represented.",
        "No commissions, taxes, generic slippage, or partial-fill model yet.",
        "Daily OHLC cannot reconstruct exact intraday path ordering.",
        "Same-day existing-position marks use daily open to avoid close lookahead in entry sizing.",
      ],
    },

    decision: {
      portfolioReplayBuilt:
        true,

      productionPolicyLocked:
        false,

      nextUse:
        "ANALYZE_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_AND_ADD_COST_SLIPPAGE_STRESS",
    },

    safety: {
      databaseReadsOnly:
        true,

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
      "ANALYZE_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_AND_ADD_COST_SLIPPAGE_STRESS",

    outputFile:
      "logs/alpha-v3-risk-v3-portfolio-replay.json",
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
            "ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_FAILED",

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
            "REVIEW_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
