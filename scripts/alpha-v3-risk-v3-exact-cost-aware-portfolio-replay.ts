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
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_V1";

const CHECKPOINT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-exact-cost-aware-portfolio-replay.json",
  );

const INITIAL_CAPITAL =
  10_000_000;

const ENTRY_PREMIUM_CAP =
  0.01;

const POLICIES = [
  {
    id: "BASELINE",
    initialStop: 0.025,
    activation: 0.03,
    trailing: 0.02,
    maxHoldingDays: 20,
  },
  {
    id: "TREND_FOLLOW",
    initialStop: 0.05,
    activation: 0.08,
    trailing: 0.05,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_4PCT",
    initialStop: 0.04,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
] as const;

const COST_SCENARIOS = [
  {
    id: "BASE_REALISTIC",
    sellTaxRate: 0.002,
    brokerFeeEachSideRate: 0.00015,
    frictionEachSideRate: 0.0005,
  },
  {
    id: "STRESS",
    sellTaxRate: 0.002,
    brokerFeeEachSideRate: 0.0002,
    frictionEachSideRate: 0.001,
  },
  {
    id: "SEVERE",
    sellTaxRate: 0.002,
    brokerFeeEachSideRate: 0.0003,
    frictionEachSideRate: 0.002,
  },
] as const;

type Policy =
  (typeof POLICIES)[number];

type CostScenario =
  (typeof COST_SCENARIOS)[number];

interface EntryCandidate {
  entryDate: string;
  stockCode: string;
  rawFillPrice: number;
}

interface DailyBar {
  stock_code: string;
  trading_date: string;
  open_price: number | string | null;
  high_price: number | string | null;
  low_price: number | string | null;
  close_price: number | string | null;
}

interface StockRecord {
  stock_code: string;
  sector: string | null;
}

interface Position {
  stockCode: string;
  sector: string | null;
  entryDate: string;
  rawSignalFillPrice: number;
  executionEntryPrice: number;
  quantity: number;
  buyNotional: number;
  buyBrokerFee: number;
  cashCostBasis: number;
  initialStopPrice: number;
  currentStopPrice: number;
  activationPrice: number;
  highestPrice: number;
  holdingDays: number;
  entryEquity: number;
  entryRiskAmount: number;
}

interface ClosedTrade {
  stockCode: string;
  sector: string | null;
  entryDate: string;
  exitDate: string;
  quantity: number;
  rawSignalFillPrice: number;
  executionEntryPrice: number;
  rawExitPrice: number;
  executionExitPrice: number;
  buyBrokerFee: number;
  sellBrokerFee: number;
  sellTax: number;
  grossMarketPnl: number;
  netPnl: number;
  holdingDays: number;
  exitReason: string;
  returnOnCashCost: number;
}

function n(
  value: unknown,
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
      (value + Number.EPSILON) *
        factor,
    ) / factor
  );
}

function median(
  values: number[],
): number | null {
  if (
    values.length === 0
  ) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b,
    );

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  return sorted.length % 2
    ? sorted[middle]
    : (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2;
}

function summarize(
  values: number[],
) {
  if (
    values.length === 0
  ) {
    return {
      count: 0,
      mean: null,
      median: null,
      positiveRate: null,
      min: null,
      max: null,
    };
  }

  return {
    count:
      values.length,

    mean:
      values.reduce(
        (sum, value) =>
          sum + value,
        0,
      ) / values.length,

    median:
      median(values),

    positiveRate:
      values.filter(
        (value) =>
          value > 0,
      ).length /
      values.length,

    min:
      Math.min(...values),

    max:
      Math.max(...values),
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
      (row: any) =>
        row
          ?.correctedEntry
          ?.qualified === true,
    )
    .map(
      (row: any) => {
        const policy =
          Array.isArray(
            row?.limitPolicies,
          )
            ? row.limitPolicies.find(
                (candidate: any) =>
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

          rawFillPrice:
            n(
              policy?.fillPrice,
            ),

          filled:
            policy?.filled === true,
        };
      },
    )
    .filter(
      (row: any) =>
        row.filled === true &&
        row.entryDate &&
        row.stockCode &&
        row.rawFillPrice > 0,
    )
    .map(
      (row: any) => ({
        entryDate:
          row.entryDate,

        stockCode:
          row.stockCode,

        rawFillPrice:
          row.rawFillPrice,
      }),
    )
    .sort(
      (left, right) =>
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

function price(
  bar: DailyBar | undefined,
  key:
    | "open_price"
    | "high_price"
    | "low_price"
    | "close_price",
  fallback: number,
): number {
  const value =
    n(bar?.[key]);

  return value > 0
    ? value
    : fallback;
}

function latestBar(
  bars: DailyBar[],
  date: string,
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

    result = bar;
  }

  return result;
}

function byStockPnl(
  trades: ClosedTrade[],
) {
  const map =
    new Map<
      string,
      {
        trades: number;
        netPnl: number;
        wins: number;
        losses: number;
      }
    >();

  for (
    const trade
    of trades
  ) {
    const current =
      map.get(
        trade.stockCode,
      ) ?? {
        trades: 0,
        netPnl: 0,
        wins: 0,
        losses: 0,
      };

    current.trades += 1;
    current.netPnl +=
      trade.netPnl;

    if (
      trade.netPnl > 0
    ) {
      current.wins += 1;
    } else if (
      trade.netPnl < 0
    ) {
      current.losses += 1;
    }

    map.set(
      trade.stockCode,
      current,
    );
  }

  return [
    ...map.entries(),
  ]
    .map(
      ([stockCode, row]) => ({
        stockCode,
        trades:
          row.trades,
        netPnl:
          round(
            row.netPnl,
          ),
        wins:
          row.wins,
        losses:
          row.losses,
      }),
    )
    .sort(
      (a, b) =>
        b.netPnl -
        a.netPnl,
    );
}

function topTrades(
  trades: ClosedTrade[],
) {
  return [
    ...trades,
  ]
    .sort(
      (a, b) =>
        b.netPnl -
        a.netPnl,
    )
    .slice(
      0,
      5,
    )
    .map(
      (trade) => ({
        stockCode:
          trade.stockCode,
        entryDate:
          trade.entryDate,
        exitDate:
          trade.exitDate,
        quantity:
          trade.quantity,
        netPnl:
          round(
            trade.netPnl,
          ),
        returnOnCashCost:
          round(
            trade.returnOnCashCost,
          ),
        holdingDays:
          trade.holdingDays,
        exitReason:
          trade.exitReason,
      }),
    );
}

async function main() {
  const entries =
    loadEntries();

  if (
    entries.length === 0
  ) {
    throw new Error(
      "NO_FILLED_ENTRY_V3_ROWS",
    );
  }

  const stockCodes =
    [
      ...new Set(
        entries.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ];

  const supabase =
    createSupabaseServerClient();

  let databaseReads =
    0;

  const {
    data: stockData,
    error: stockError,
  } =
    await supabase
      .from("stocks")
      .select(
        "stock_code,sector",
      )
      .in(
        "stock_code",
        stockCodes,
      );

  databaseReads += 1;

  if (
    stockError
  ) {
    throw new Error(
      "STOCK_READ_FAILED:" +
      stockError.message,
    );
  }

  const sectorByStock =
    new Map<
      string,
      string | null
    >(
      (
        stockData ??
        []
      ).map(
        (row: StockRecord) => [
          String(
            row.stock_code,
          ),
          row.sector ?? null,
        ],
      ),
    );

  const barsByStock =
    new Map<
      string,
      DailyBar[]
    >();

  const dateSet =
    new Set<string>();

  const minDate =
    entries[0].entryDate;

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
            ascending: true,
          },
        )
        .limit(
          1500,
        );

    databaseReads += 1;

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
      (data ?? []) as
        DailyBar[];

    barsByStock.set(
      stockCode,
      bars,
    );

    for (
      const bar
      of bars
    ) {
      dateSet.add(
        String(
          bar.trading_date,
        ),
      );
    }
  }

  const dates =
    [...dateSet]
      .filter(
        (date) =>
          date >= minDate,
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
    const list =
      entriesByDate.get(
        entry.entryDate,
      ) ?? [];

    list.push(entry);

    entriesByDate.set(
      entry.entryDate,
      list,
    );
  }

  function runReplay(
    policy: Policy,
    cost: CostScenario,
    excludedStocks:
      Set<string>,
  ) {
    let cash =
      INITIAL_CAPITAL;

    let cumulativeCosts =
      0;

    const openPositions =
      new Map<
        string,
        Position
      >();

    const closedTrades:
      ClosedTrade[] =
      [];

    const rejectionCounts =
      new Map<
        string,
        number
      >();

    let excludedSignals =
      0;

    let acceptedEntries =
      0;

    let peakEquity =
      INITIAL_CAPITAL;

    let maxDrawdown =
      0;

    let peakGrossExposureRate =
      0;

    let peakAggregateRiskRate =
      0;

    let peakOpenPositions =
      0;

    let dailyRealizedPnl =
      0;

    let activeDate =
      "";

    const reject = (
      reasons: string[],
    ) => {
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
          ) + 1,
        );
      }
    };

    for (
      const date
      of dates
    ) {
      if (
        date !== activeDate
      ) {
        activeDate =
          date;

        dailyRealizedPnl =
          0;
      }

      /*
       * Existing exits before new entries.
       * Entry-day exit evaluation disabled.
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
            .get(stockCode)
            ?.find(
              (row) =>
                row.trading_date ===
                date,
            );

        if (
          !bar
        ) {
          continue;
        }

        const open =
          price(
            bar,
            "open_price",
            position
              .executionEntryPrice,
          );

        const high =
          price(
            bar,
            "high_price",
            open,
          );

        const low =
          price(
            bar,
            "low_price",
            open,
          );

        const close =
          price(
            bar,
            "close_price",
            open,
          );

        position.holdingDays += 1;

        let rawExit:
          number | null =
          null;

        let exitReason:
          string | null =
          null;

        if (
          open <=
          position.currentStopPrice
        ) {
          rawExit =
            open;

          exitReason =
            "STOP_GAP";
        } else if (
          low <=
          position.currentStopPrice
        ) {
          rawExit =
            position.currentStopPrice;

          exitReason =
            "STOP_TOUCH";
        } else if (
          position.holdingDays >=
          policy.maxHoldingDays
        ) {
          rawExit =
            close;

          exitReason =
            "MAX_HOLD_CLOSE";
        }

        if (
          rawExit !== null &&
          exitReason !== null
        ) {
          const executionExitPrice =
            rawExit *
            (
              1 -
              cost
                .frictionEachSideRate
            );

          const sellNotional =
            executionExitPrice *
            position.quantity;

          const sellBrokerFee =
            sellNotional *
            cost
              .brokerFeeEachSideRate;

          const sellTax =
            sellNotional *
            cost.sellTaxRate;

          const netProceeds =
            sellNotional -
            sellBrokerFee -
            sellTax;

          const netPnl =
            netProceeds -
            position.cashCostBasis;

          const grossMarketPnl =
            (
              rawExit -
              position
                .rawSignalFillPrice
            ) *
            position.quantity;

          cash +=
            netProceeds;

          cumulativeCosts +=
            position.buyBrokerFee +
            sellBrokerFee +
            sellTax +
            (
              position
                .executionEntryPrice -
              position
                .rawSignalFillPrice
            ) *
              position.quantity +
            (
              rawExit -
              executionExitPrice
            ) *
              position.quantity;

          dailyRealizedPnl +=
            netPnl;

          closedTrades.push({
            stockCode,
            sector:
              position.sector,
            entryDate:
              position.entryDate,
            exitDate:
              date,
            quantity:
              position.quantity,
            rawSignalFillPrice:
              position
                .rawSignalFillPrice,
            executionEntryPrice:
              position
                .executionEntryPrice,
            rawExitPrice:
              rawExit,
            executionExitPrice,
            buyBrokerFee:
              position.buyBrokerFee,
            sellBrokerFee,
            sellTax,
            grossMarketPnl,
            netPnl,
            holdingDays:
              position.holdingDays,
            exitReason,
            returnOnCashCost:
              position.cashCostBasis >
                0
                ? netPnl /
                  position
                    .cashCostBasis
                : 0,
          });

          openPositions.delete(
            stockCode,
          );

          continue;
        }

        position.highestPrice =
          Math.max(
            position.highestPrice,
            high,
          );

        if (
          policy.trailing > 0 &&
          position.highestPrice >=
            position.activationPrice
        ) {
          const candidateStop =
            position.highestPrice *
            (
              1 -
              policy.trailing
            );

          if (
            candidateStop >
            position.currentStopPrice
          ) {
            position.currentStopPrice =
              candidateStop;
          }
        }
      }

      const todayEntries =
        entriesByDate.get(
          date,
        ) ?? [];

      for (
        const entry
        of todayEntries
      ) {
        if (
          excludedStocks.has(
            entry.stockCode,
          )
        ) {
          excludedSignals += 1;
          continue;
        }

        if (
          openPositions.has(
            entry.stockCode,
          )
        ) {
          reject([
            "ACTIVE_POSITION_EXISTS",
          ]);
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

        let markedOpenValue =
          0;

        const targetSector =
          sectorByStock.get(
            entry.stockCode,
          ) ?? null;

        for (
          const position
          of openPositions.values()
        ) {
          const bars =
            barsByStock.get(
              position.stockCode,
            ) ?? [];

          const todayBar =
            bars.find(
              (row) =>
                row.trading_date ===
                date,
            );

          const prior =
            latestBar(
              bars,
              date,
            );

          const mark =
            todayBar
              ? price(
                  todayBar,
                  "open_price",
                  position
                    .executionEntryPrice,
                )
              : prior
                ? price(
                    prior,
                    "close_price",
                    position
                      .executionEntryPrice,
                  )
                : position
                    .executionEntryPrice;

          const value =
            mark *
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
              position.sector ??
              "UNKNOWN"
            ) ===
            (
              targetSector ??
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
                .executionEntryPrice -
              position
                .currentStopPrice,
            ) *
            position.quantity;
        }

        const accountEquity =
          cash +
          markedOpenValue;

        const executionEntryPrice =
          entry.rawFillPrice *
          (
            1 +
            cost
              .frictionEachSideRate
          );

        const proposedStopPrice =
          executionEntryPrice *
          (
            1 -
            policy.initialStop
          );

        const requestedQuantity =
          Math.max(
            1,
            Math.floor(
              cash /
              Math.max(
                executionEntryPrice,
                1,
              ),
            ),
          );

        const riskInput:
          BuyRiskInput =
          {
            stockCode:
              entry.stockCode,

            entryPrice:
              executionEntryPrice,

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

        const pre =
          validateBuyRisk(
            riskInput,
          );

        let quantity =
          Math.max(
            0,
            pre.maxAllowedQuantity,
          );

        const cashQuantity =
          Math.floor(
            cash /
            (
              executionEntryPrice *
              (
                1 +
                cost
                  .brokerFeeEachSideRate
              )
            ),
          );

        quantity =
          Math.min(
            quantity,
            cashQuantity,
          );

        if (
          quantity <= 0
        ) {
          const reasons =
            pre.issues.length >
              0
              ? pre.issues.map(
                  (issue) =>
                    issue.code,
                )
              : [
                  "ZERO_ALLOWED_QUANTITY_AFTER_COST",
                ];

          reject(reasons);
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
          reject(
            finalRisk.issues.map(
              (issue) =>
                issue.code,
            ),
          );
          continue;
        }

        const buyNotional =
          executionEntryPrice *
          quantity;

        const buyBrokerFee =
          buyNotional *
          cost
            .brokerFeeEachSideRate;

        const cashCostBasis =
          buyNotional +
          buyBrokerFee;

        if (
          cashCostBasis >
          cash +
            1e-8
        ) {
          reject([
            "INSUFFICIENT_CASH_AFTER_COST",
          ]);
          continue;
        }

        cash -=
          cashCostBasis;

        cumulativeCosts +=
          buyBrokerFee +
          (
            executionEntryPrice -
            entry.rawFillPrice
          ) *
            quantity;

        acceptedEntries += 1;

        openPositions.set(
          entry.stockCode,
          {
            stockCode:
              entry.stockCode,

            sector:
              targetSector,

            entryDate:
              date,

            rawSignalFillPrice:
              entry.rawFillPrice,

            executionEntryPrice,

            quantity,

            buyNotional,

            buyBrokerFee,

            cashCostBasis,

            initialStopPrice:
              proposedStopPrice,

            currentStopPrice:
              proposedStopPrice,

            activationPrice:
              executionEntryPrice *
              (
                1 +
                policy.activation
              ),

            highestPrice:
              executionEntryPrice,

            holdingDays:
              0,

            entryEquity:
              accountEquity,

            entryRiskAmount:
              (
                executionEntryPrice -
                proposedStopPrice
              ) *
              quantity,
          },
        );
      }

      let grossMarkedValue =
        0;

      let liquidationValue =
        0;

      let aggregateRisk =
        0;

      for (
        const position
        of openPositions.values()
      ) {
        const bars =
          barsByStock.get(
            position.stockCode,
          ) ?? [];

        const bar =
          bars.find(
            (row) =>
              row.trading_date ===
              date,
          ) ??
          latestBar(
            bars,
            date,
          );

        const rawMark =
          bar
            ? price(
                bar,
                "close_price",
                position
                  .executionEntryPrice,
              )
            : position
                .executionEntryPrice;

        const rawValue =
          rawMark *
          position.quantity;

        grossMarkedValue +=
          rawValue;

        const liquidationPrice =
          rawMark *
          (
            1 -
            cost
              .frictionEachSideRate
          );

        const sellNotional =
          liquidationPrice *
          position.quantity;

        liquidationValue +=
          sellNotional -
          sellNotional *
            cost
              .brokerFeeEachSideRate -
          sellNotional *
            cost.sellTaxRate;

        aggregateRisk +=
          Math.max(
            0,
            position
              .executionEntryPrice -
            position
              .currentStopPrice,
          ) *
          position.quantity;
      }

      const grossEquity =
        cash +
        grossMarkedValue;

      const liquidationEquity =
        cash +
        liquidationValue;

      peakEquity =
        Math.max(
          peakEquity,
          liquidationEquity,
        );

      if (
        peakEquity > 0
      ) {
        maxDrawdown =
          Math.max(
            maxDrawdown,
            (
              peakEquity -
              liquidationEquity
            ) /
            peakEquity,
          );
      }

      peakGrossExposureRate =
        Math.max(
          peakGrossExposureRate,
          grossEquity > 0
            ? grossMarkedValue /
              grossEquity
            : 0,
        );

      peakAggregateRiskRate =
        Math.max(
          peakAggregateRiskRate,
          grossEquity > 0
            ? aggregateRisk /
              grossEquity
            : 0,
        );

      peakOpenPositions =
        Math.max(
          peakOpenPositions,
          openPositions.size,
        );
    }

    const finalDate =
      dates[dates.length - 1];

    let finalGrossMarketValue =
      0;

    let finalLiquidationValue =
      0;

    const openAtEnd =
      [];

    for (
      const position
      of openPositions.values()
    ) {
      const bar =
        latestBar(
          barsByStock.get(
            position.stockCode,
          ) ?? [],
          finalDate,
        );

      const rawMark =
        bar
          ? price(
              bar,
              "close_price",
              position
                .executionEntryPrice,
            )
          : position
              .executionEntryPrice;

      const grossValue =
        rawMark *
        position.quantity;

      const executionExitPrice =
        rawMark *
        (
          1 -
          cost
            .frictionEachSideRate
        );

      const sellNotional =
        executionExitPrice *
        position.quantity;

      const sellBrokerFee =
        sellNotional *
        cost
          .brokerFeeEachSideRate;

      const sellTax =
        sellNotional *
        cost.sellTaxRate;

      const netLiquidation =
        sellNotional -
        sellBrokerFee -
        sellTax;

      finalGrossMarketValue +=
        grossValue;

      finalLiquidationValue +=
        netLiquidation;

      openAtEnd.push({
        stockCode:
          position.stockCode,
        quantity:
          position.quantity,
        entryDate:
          position.entryDate,
        rawMarkPrice:
          rawMark,
        executionEntryPrice:
          round(
            position
              .executionEntryPrice,
          ),
        hypotheticalExecutionExitPrice:
          round(
            executionExitPrice,
          ),
        netLiquidationValue:
          round(
            netLiquidation,
          ),
      });
    }

    const finalGrossEquity =
      cash +
      finalGrossMarketValue;

    const finalLiquidationEquity =
      cash +
      finalLiquidationValue;

    const netReturn =
      (
        finalLiquidationEquity -
        INITIAL_CAPITAL
      ) /
      INITIAL_CAPITAL;

    const tradeReturns =
      closedTrades.map(
        (trade) =>
          trade.returnOnCashCost,
      );

    const grossProfit =
      closedTrades
        .filter(
          (trade) =>
            trade.netPnl > 0,
        )
        .reduce(
          (sum, trade) =>
            sum + trade.netPnl,
          0,
        );

    const grossLoss =
      Math.abs(
        closedTrades
          .filter(
            (trade) =>
              trade.netPnl < 0,
          )
          .reduce(
            (sum, trade) =>
              sum + trade.netPnl,
            0,
          ),
      );

    return {
      policy:
        policy.id,

      costScenario:
        cost.id,

      excludedStocks:
        [...excludedStocks],

      counts: {
        candidateEntries:
          entries.length,
        excludedSignals,
        acceptedEntries,
        rejectedEntries:
          [...rejectionCounts.values()]
            .reduce(
              (sum, value) =>
                sum + value,
              0,
            ),
        closedTrades:
          closedTrades.length,
        openPositionsAtEnd:
          openPositions.size,
      },

      capital: {
        initialCapital:
          INITIAL_CAPITAL,
        endingCash:
          round(cash),
        finalGrossMarketValue:
          round(
            finalGrossMarketValue,
          ),
        finalGrossEquity:
          round(
            finalGrossEquity,
          ),
        finalLiquidationValue:
          round(
            finalLiquidationValue,
          ),
        finalLiquidationEquity:
          round(
            finalLiquidationEquity,
          ),
        netReturn:
          round(
            netReturn,
          ),
        maxDrawdown:
          round(
            maxDrawdown,
          ),
        cumulativeCostDragPaidOnClosedAndBuys:
          round(
            cumulativeCosts,
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
        peakOpenPositions,
      },

      tradeReturn:
        summarize(
          tradeReturns,
        ),

      profitFactor:
        grossLoss > 0
          ? round(
              grossProfit /
              grossLoss,
            )
          : grossProfit > 0
            ? null
            : 0,

      byStock:
        byStockPnl(
          closedTrades,
        ),

      topTrades:
        topTrades(
          closedTrades,
        ),

      rejectionCounts:
        Object.fromEntries(
          [
            ...rejectionCounts.entries(),
          ].sort(
            (a, b) =>
              b[1] - a[1],
          ),
        ),

      openAtEnd,
    };
  }

  const exactRuns =
    [];

  for (
    const cost
    of COST_SCENARIOS
  ) {
    for (
      const policy
      of POLICIES
    ) {
      exactRuns.push(
        runReplay(
          policy,
          cost,
          new Set<string>(),
        ),
      );
    }
  }

  const fixedBase =
    exactRuns.find(
      (row) =>
        row.policy ===
          "FIXED_STOP_4PCT" &&
        row.costScenario ===
          "BASE_REALISTIC",
    );

  const exclusionSets =
    [
      ...stockCodes.map(
        (stockCode) => ({
          id:
            "EXCLUDE_" +
            stockCode,
          stocks:
            [stockCode],
        }),
      ),

      {
        id:
          "EXCLUDE_005930_000660",
        stocks:
          [
            "005930",
            "000660",
          ],
      },
    ];

  const stockConcentrationStress =
    exclusionSets.map(
      (scenario) => ({
        id:
          scenario.id,

        ...runReplay(
          POLICIES.find(
            (row) =>
              row.id ===
              "FIXED_STOP_4PCT",
          )!,
          COST_SCENARIOS.find(
            (row) =>
              row.id ===
              "BASE_REALISTIC",
          )!,
          new Set(
            scenario.stocks,
          ),
        ),
      }),
    );

  const scenarioRankings =
    COST_SCENARIOS.map(
      (cost) => ({
        costScenario:
          cost.id,

        ranking:
          exactRuns
            .filter(
              (row) =>
                row.costScenario ===
                cost.id,
            )
            .sort(
              (a, b) =>
                b.capital
                  .finalLiquidationEquity -
                a.capital
                  .finalLiquidationEquity,
            )
            .map(
              (row, index) => ({
                rank:
                  index + 1,
                policy:
                  row.policy,
                netReturn:
                  row.capital
                    .netReturn,
                finalLiquidationEquity:
                  row.capital
                    .finalLiquidationEquity,
                maxDrawdown:
                  row.capital
                    .maxDrawdown,
                acceptedEntries:
                  row.counts
                    .acceptedEntries,
              }),
            ),
      }),
    );

  const fixedBaseReturn =
    fixedBase
      ?.capital
      .netReturn ??
    null;

  const exclusionSummary =
    stockConcentrationStress.map(
      (row) => ({
        id:
          row.id,
        excludedStocks:
          row.excludedStocks,
        netReturn:
          row.capital
            .netReturn,
        deltaVsFullFixedBase:
          typeof fixedBaseReturn ===
            "number"
            ? round(
                row.capital
                  .netReturn -
                fixedBaseReturn,
              )
            : null,
        finalLiquidationEquity:
          row.capital
            .finalLiquidationEquity,
        maxDrawdown:
          row.capital
            .maxDrawdown,
        acceptedEntries:
          row.counts
            .acceptedEntries,
      }),
    );

  const severeFixed =
    exactRuns.find(
      (row) =>
        row.policy ===
          "FIXED_STOP_4PCT" &&
        row.costScenario ===
          "SEVERE",
    );

  const baseTrend =
    exactRuns.find(
      (row) =>
        row.policy ===
          "TREND_FOLLOW" &&
        row.costScenario ===
          "BASE_REALISTIC",
    );

  const report = {
    status:
      "ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_COMPLETE",

    version:
      VERSION,

    validationClass:
      "HISTORICAL_SAME_SAMPLE_EXACT_COST_AWARE_PORTFOLIO_STRESS_NOT_TRUE_OOS",

    contract: {
      initialCapital:
        INITIAL_CAPITAL,

      entryPremiumCap:
        ENTRY_PREMIUM_CAP,

      costApplication:
        "COSTS_AND_EXECUTION_FRICTION_ARE_APPLIED_INSIDE_THE_PATH_BEFORE_FUTURE_SIZING",

      buyExecution:
        "rawEntryFill * (1 + friction)",

      sellExecution:
        "rawExit * (1 - friction)",

      buyBrokerFee:
        "charged_immediately",

      sellBrokerFee:
        "charged_on_exit",

      sellTax:
        "charged_on_exit",

      positionSizing:
        "recomputed_after_cost_drag",

      riskStopBasis:
        "execution_entry_price",

      finalEquity:
        "net_liquidation_equivalent",

      productionPolicyLocked:
        false,
    },

    costs:
      COST_SCENARIOS,

    source: {
      filledEntryCandidates:
        entries.length,
      stockCodes,
      databaseReads,
    },

    exactRuns,

    scenarioRankings,

    stockConcentrationStress:
      exclusionSummary,

    decision: {
      fixedBaseRealisticNetReturn:
        fixedBaseReturn,

      fixedSevereNetReturn:
        severeFixed
          ?.capital
          .netReturn ??
        null,

      trendBaseRealisticNetReturn:
        baseTrend
          ?.capital
          .netReturn ??
        null,

      fixedStillPositiveUnderSevereExactPath:
        (
          severeFixed
            ?.capital
            .netReturn ??
          -Infinity
        ) >
        0,

      fixedBeatsTrendUnderBaseExactPath:
        (
          fixedBase
            ?.capital
            .netReturn ??
          -Infinity
        ) >
        (
          baseTrend
            ?.capital
            .netReturn ??
          Infinity
        ),

      survivesWithout005930:
        (
          stockConcentrationStress
            .find(
              (row) =>
                row.id ===
                "EXCLUDE_005930",
            )
            ?.capital
            .netReturn ??
          -Infinity
        ) >
        0,

      survivesWithout000660:
        (
          stockConcentrationStress
            .find(
              (row) =>
                row.id ===
                "EXCLUDE_000660",
            )
            ?.capital
            .netReturn ??
          -Infinity
        ) >
        0,

      survivesWithoutBothSemiconductorLeaders:
        (
          stockConcentrationStress
            .find(
              (row) =>
                row.id ===
                "EXCLUDE_005930_000660",
            )
            ?.capital
            .netReturn ??
          -Infinity
        ) >
        0,

      productionPolicyLocked:
        false,

      nextUse:
        "RUN_PARAMETER_NEIGHBORHOOD_AND_TRUE_FORWARD_OOS_READINESS_CHECK",
    },

    caveats: [
      "Historical same-sample replay; not forward OOS.",
      "Daily OHLC cannot reconstruct exact intraday path ordering.",
      "Execution friction is a stress assumption rather than observed queue/fill slippage.",
      "Partial fills are not modeled.",
      "Current historical Entry V3 universe contains only four stocks.",
      "Exclusion tests change the portfolio path and are stronger than simple attribution removal.",
    ],

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
      "RUN_PARAMETER_NEIGHBORHOOD_AND_TRUE_FORWARD_OOS_READINESS_CHECK",

    outputFile:
      "logs/alpha-v3-risk-v3-exact-cost-aware-portfolio-replay.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          report.version,

        validationClass:
          report.validationClass,

        scenarioRankings:
          report.scenarioRankings,

        stockConcentrationStress:
          report.stockConcentrationStress,

        decision:
          report.decision,

        safety:
          report.safety,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_FAILED",

          version:
            VERSION,

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites: 0,
            ordersCreated: 0,
            positionsChanged: 0,
            productionChanged: false,
          },

          nextGate:
            "REVIEW_EXACT_COST_AWARE_PORTFOLIO_REPLAY_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
