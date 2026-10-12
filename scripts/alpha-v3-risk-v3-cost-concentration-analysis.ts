import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_RISK_V3_COST_CONCENTRATION_ANALYSIS_V1";

const INPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-portfolio-replay.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-cost-concentration-analysis.json",
  );

const COST_SCENARIOS = [
  {
    id: "ZERO",
    sellTaxRate: 0,
    brokerFeeEachSideRate: 0,
    frictionEachSideRate: 0,
  },
  {
    id: "LEGAL_TAX_ONLY_2026",
    sellTaxRate: 0.002,
    brokerFeeEachSideRate: 0,
    frictionEachSideRate: 0,
  },
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

function quarter(
  date: string,
): string {
  const year =
    date.slice(0, 4);

  const month =
    Number(
      date.slice(5, 7),
    );

  const q =
    Math.max(
      1,
      Math.min(
        4,
        Math.ceil(
          month / 3,
        ),
      ),
    );

  return year + "-Q" + q;
}

function tradeCost(
  trade: any,
  scenario:
    (typeof COST_SCENARIOS)[number],
): number {
  const buyNotional =
    n(trade.entryPrice) *
    n(trade.quantity);

  const sellNotional =
    n(trade.exitPrice) *
    n(trade.quantity);

  const broker =
    (
      buyNotional +
      sellNotional
    ) *
    scenario
      .brokerFeeEachSideRate;

  const tax =
    sellNotional *
    scenario.sellTaxRate;

  const friction =
    (
      buyNotional +
      sellNotional
    ) *
    scenario
      .frictionEachSideRate;

  return (
    broker +
    tax +
    friction
  );
}

function openPositionLiquidationCost(
  row: any,
  scenario:
    (typeof COST_SCENARIOS)[number],
): number {
  const buyNotional =
    n(row.entryPrice) *
    n(row.quantity);

  const markNotional =
    n(row.markPrice) *
    n(row.quantity);

  const broker =
    (
      buyNotional +
      markNotional
    ) *
    scenario
      .brokerFeeEachSideRate;

  const tax =
    markNotional *
    scenario.sellTaxRate;

  const friction =
    (
      buyNotional +
      markNotional
    ) *
    scenario
      .frictionEachSideRate;

  return (
    broker +
    tax +
    friction
  );
}

function topSum(
  values: number[],
  count: number,
): number {
  return [
    ...values,
  ]
    .sort(
      (a, b) =>
        b - a,
    )
    .slice(
      0,
      count,
    )
    .reduce(
      (sum, value) =>
        sum + value,
      0,
    );
}

function main() {
  if (
    !fs.existsSync(
      INPUT_FILE,
    )
  ) {
    throw new Error(
      "PORTFOLIO_REPLAY_LOG_NOT_FOUND",
    );
  }

  const replay =
    JSON.parse(
      fs.readFileSync(
        INPUT_FILE,
        "utf8",
      ),
    );

  const policies =
    Array.isArray(
      replay?.policies,
    )
      ? replay.policies
      : [];

  if (
    policies.length ===
    0
  ) {
    throw new Error(
      "PORTFOLIO_REPLAY_POLICIES_MISSING",
    );
  }

  const analyzed =
    policies.map(
      (policyRow: any) => {
        const id =
          String(
            policyRow
              ?.policy
              ?.id ??
              "",
          );

        const trades =
          Array.isArray(
            policyRow
              ?.allClosedTrades,
          )
            ? policyRow
                .allClosedTrades
            : [];

        if (
          trades.length ===
          0
        ) {
          throw new Error(
            "FULL_CLOSED_TRADES_MISSING:" +
            id,
          );
        }

        const openAtEnd =
          Array.isArray(
            policyRow
              ?.openAtEnd,
          )
            ? policyRow
                .openAtEnd
            : [];

        const initialCapital =
          n(
            policyRow
              ?.capital
              ?.initialCapital,
          );

        const grossFinalEquity =
          n(
            policyRow
              ?.capital
              ?.finalEquity,
          );

        const grossTotalReturn =
          n(
            policyRow
              ?.capital
              ?.totalReturn,
          );

        const realizedPnl =
          trades.reduce(
            (
              sum: number,
              trade: any,
            ) =>
              sum +
              n(
                trade.pnlAmount,
              ),
            0,
          );

        const positiveTrades =
          trades.filter(
            (trade: any) =>
              n(
                trade.pnlAmount,
              ) >
              0,
          );

        const positivePnl =
          positiveTrades.map(
            (trade: any) =>
              n(
                trade.pnlAmount,
              ),
          );

        const grossProfit =
          positivePnl.reduce(
            (
              sum: number,
              value: number,
            ) =>
              sum + value,
            0,
          );

        const byStockMap =
          new Map<
            string,
            {
              trades: number;
              pnl: number;
              wins: number;
              losses: number;
            }
          >();

        const byQuarterMap =
          new Map<
            string,
            {
              trades: number;
              pnl: number;
              wins: number;
              losses: number;
            }
          >();

        for (
          const trade
          of trades
        ) {
          const stock =
            String(
              trade.stockCode ??
              "UNKNOWN",
            );

          const q =
            quarter(
              String(
                trade.exitDate ??
                trade.entryDate ??
                "0000-01-01",
              ),
            );

          const pnl =
            n(
              trade.pnlAmount,
            );

          const stockRow =
            byStockMap.get(
              stock,
            ) ?? {
              trades: 0,
              pnl: 0,
              wins: 0,
              losses: 0,
            };

          stockRow.trades +=
            1;

          stockRow.pnl +=
            pnl;

          if (
            pnl >
            0
          ) {
            stockRow.wins +=
              1;
          } else if (
            pnl <
            0
          ) {
            stockRow.losses +=
              1;
          }

          byStockMap.set(
            stock,
            stockRow,
          );

          const quarterRow =
            byQuarterMap.get(
              q,
            ) ?? {
              trades: 0,
              pnl: 0,
              wins: 0,
              losses: 0,
            };

          quarterRow.trades +=
            1;

          quarterRow.pnl +=
            pnl;

          if (
            pnl >
            0
          ) {
            quarterRow.wins +=
              1;
          } else if (
            pnl <
            0
          ) {
            quarterRow.losses +=
              1;
          }

          byQuarterMap.set(
            q,
            quarterRow,
          );
        }

        const byStock =
          [
            ...byStockMap
              .entries(),
          ]
            .map(
              ([
                stockCode,
                row,
              ]) => ({
                stockCode,
                trades:
                  row.trades,
                pnlAmount:
                  round(
                    row.pnl,
                  ),
                contributionVsInitialCapital:
                  initialCapital >
                    0
                    ? round(
                        row.pnl /
                        initialCapital,
                      )
                    : null,
                realizedPnlShare:
                  realizedPnl !==
                    0
                    ? round(
                        row.pnl /
                        realizedPnl,
                      )
                    : null,
                wins:
                  row.wins,
                losses:
                  row.losses,
              }),
            )
            .sort(
              (
                a,
                b,
              ) =>
                b.pnlAmount -
                a.pnlAmount,
            );

        const byQuarter =
          [
            ...byQuarterMap
              .entries(),
          ]
            .map(
              ([
                period,
                row,
              ]) => ({
                period,
                trades:
                  row.trades,
                pnlAmount:
                  round(
                    row.pnl,
                  ),
                contributionVsInitialCapital:
                  initialCapital >
                    0
                    ? round(
                        row.pnl /
                        initialCapital,
                      )
                    : null,
                wins:
                  row.wins,
                losses:
                  row.losses,
              }),
            )
            .sort(
              (
                a,
                b,
              ) =>
                a.period.localeCompare(
                  b.period,
                ),
            );

        const sortedTrades =
          [
            ...trades,
          ].sort(
            (
              a: any,
              b: any,
            ) =>
              n(
                b.pnlAmount,
              ) -
              n(
                a.pnlAmount,
              ),
          );

        const top1Pnl =
          topSum(
            positivePnl,
            1,
          );

        const top3Pnl =
          topSum(
            positivePnl,
            3,
          );

        const top5Pnl =
          topSum(
            positivePnl,
            5,
          );

        const positiveShares =
          grossProfit >
            0
            ? positivePnl.map(
                (
                  pnl: number,
                ) =>
                  pnl /
                  grossProfit,
              )
            : [];

        const positivePnlHhi =
          positiveShares.reduce(
            (
              sum: number,
              share: number,
            ) =>
              sum +
              share *
                share,
            0,
          );

        const concentration = {
          realizedPnl:
            round(
              realizedPnl,
            ),

          grossProfit:
            round(
              grossProfit,
            ),

          top1WinningTradePnl:
            round(
              top1Pnl,
            ),

          top3WinningTradesPnl:
            round(
              top3Pnl,
            ),

          top5WinningTradesPnl:
            round(
              top5Pnl,
            ),

          top1ShareOfGrossProfit:
            grossProfit >
              0
              ? round(
                  top1Pnl /
                  grossProfit,
                )
              : null,

          top3ShareOfGrossProfit:
            grossProfit >
              0
              ? round(
                  top3Pnl /
                  grossProfit,
                )
              : null,

          top5ShareOfGrossProfit:
            grossProfit >
              0
              ? round(
                  top5Pnl /
                  grossProfit,
                )
              : null,

          positivePnlHHI:
            round(
              positivePnlHhi,
            ),

          grossReturnExTop1Winner:
            initialCapital >
              0
              ? round(
                  (
                    grossFinalEquity -
                    top1Pnl -
                    initialCapital
                  ) /
                  initialCapital,
                )
              : null,

          grossReturnExTop3Winners:
            initialCapital >
              0
              ? round(
                  (
                    grossFinalEquity -
                    top3Pnl -
                    initialCapital
                  ) /
                  initialCapital,
                )
              : null,

          top5Trades:
            sortedTrades
              .slice(
                0,
                5,
              )
              .map(
                (trade: any) => ({
                  stockCode:
                    trade.stockCode,
                  entryDate:
                    trade.entryDate,
                  exitDate:
                    trade.exitDate,
                  pnlAmount:
                    round(
                      n(
                        trade.pnlAmount,
                      ),
                    ),
                  returnOnPosition:
                    n(
                      trade.returnOnPosition,
                    ),
                  holdingDays:
                    trade.holdingDays,
                  exitReason:
                    trade.exitReason,
                }),
              ),
        };

        const costScenarios =
          COST_SCENARIOS.map(
            (
              scenario,
            ) => {
              const closedCosts =
                trades.reduce(
                  (
                    sum: number,
                    trade: any,
                  ) =>
                    sum +
                    tradeCost(
                      trade,
                      scenario,
                    ),
                  0,
                );

              const openLiquidationCosts =
                openAtEnd.reduce(
                  (
                    sum: number,
                    row: any,
                  ) =>
                    sum +
                    openPositionLiquidationCost(
                      row,
                      scenario,
                    ),
                  0,
                );

              const totalCosts =
                closedCosts +
                openLiquidationCosts;

              const liquidationEquivalentFinalEquity =
                grossFinalEquity -
                totalCosts;

              const netReturn =
                initialCapital >
                  0
                  ? (
                      liquidationEquivalentFinalEquity -
                      initialCapital
                    ) /
                    initialCapital
                  : 0;

              return {
                id:
                  scenario.id,

                assumptions: {
                  sellTaxRate:
                    scenario
                      .sellTaxRate,

                  brokerFeeEachSideRate:
                    scenario
                      .brokerFeeEachSideRate,

                  frictionEachSideRate:
                    scenario
                      .frictionEachSideRate,

                  pathRecomputed:
                    false,

                  note:
                    "Fixed-path diagnostic: quantities and admissions are held at gross replay values.",
                },

                closedTradeCosts:
                  round(
                    closedCosts,
                  ),

                hypotheticalOpenLiquidationCosts:
                  round(
                    openLiquidationCosts,
                  ),

                totalCostDragAmount:
                  round(
                    totalCosts,
                  ),

                liquidationEquivalentFinalEquity:
                  round(
                    liquidationEquivalentFinalEquity,
                  ),

                netReturn:
                  round(
                    netReturn,
                  ),

                returnDragVsGross:
                  round(
                    grossTotalReturn -
                    netReturn,
                  ),
              };
            },
          );

        return {
          id,

          gross: {
            initialCapital,
            finalEquity:
              grossFinalEquity,
            totalReturn:
              grossTotalReturn,
            maxDrawdown:
              n(
                policyRow
                  ?.capital
                  ?.maxDrawdown,
              ),
            closedTrades:
              trades.length,
            openPositionsAtEnd:
              openAtEnd.length,
          },

          concentration,

          byStock,

          byQuarter,

          costScenarios,
        };
      },
    );

  const scenarioRankings =
    COST_SCENARIOS.map(
      (
        scenario,
      ) => ({
        scenario:
          scenario.id,

        ranking:
          analyzed
            .map(
              (
                row,
              ) => {
                const cost =
                  row
                    .costScenarios
                    .find(
                      (
                        item,
                      ) =>
                        item.id ===
                        scenario.id,
                    );

                return {
                  id:
                    row.id,

                  netReturn:
                    cost
                      ?.netReturn ??
                    null,

                  finalEquity:
                    cost
                      ?.liquidationEquivalentFinalEquity ??
                    null,
                };
              },
            )
            .sort(
              (
                a,
                b,
              ) =>
                n(
                  b.finalEquity,
                ) -
                n(
                  a.finalEquity,
                ),
            )
            .map(
              (
                row,
                index,
              ) => ({
                rank:
                  index + 1,
                ...row,
              }),
            ),
      }),
    );

  const fixed =
    analyzed.find(
      (
        row,
      ) =>
        row.id ===
        "FIXED_STOP_4PCT",
    );

  const trend =
    analyzed.find(
      (
        row,
      ) =>
        row.id ===
        "TREND_FOLLOW",
    );

  const severeFixed =
    fixed
      ?.costScenarios
      .find(
        (
          row,
        ) =>
          row.id ===
          "SEVERE",
      );

  const baseFixed =
    fixed
      ?.costScenarios
      .find(
        (
          row,
        ) =>
          row.id ===
          "BASE_REALISTIC",
      );

  const top3Share =
    fixed
      ?.concentration
      .top3ShareOfGrossProfit;

  const decision = {
    fixedStillPositiveUnderBaseCosts:
      n(
        baseFixed
          ?.netReturn,
      ) >
      0,

    fixedStillPositiveUnderSevereCosts:
      n(
        severeFixed
          ?.netReturn,
      ) >
      0,

    fixedGrossLeader:
      replay
        ?.ranking?.[0]?.id ===
      "FIXED_STOP_4PCT",

    fixedTop3WinnerConcentrationHigh:
      typeof top3Share ===
        "number"
        ? top3Share >=
          0.5
        : null,

    fixedReturnWithoutTop3Winners:
      fixed
        ?.concentration
        .grossReturnExTop3Winners ??
      null,

    fixedVsTrendGrossReturnGap:
      fixed &&
      trend
        ? round(
            fixed
              .gross
              .totalReturn -
            trend
              .gross
              .totalReturn,
          )
        : null,

    productionPolicyLocked:
      false,

    nextUse:
      "BUILD_EXACT_COST_AWARE_PORTFOLIO_REPLAY_AND_STOCK_CONCENTRATION_STRESS",
  };

  const report = {
    status:
      "ALPHA_V3_RISK_V3_COST_CONCENTRATION_ANALYSIS_COMPLETE",

    version:
      VERSION,

    validationClass:
      "HISTORICAL_SAME_SAMPLE_FIXED_PATH_COST_AND_CONCENTRATION_DIAGNOSTIC",

    taxModel2026: {
      kospiSellTotalRate:
        0.002,

      kosdaqSellTotalRate:
        0.002,

      kospiBreakdown: {
        securitiesTransactionTax:
          0.0005,
        agriculturalSpecialTax:
          0.0015,
      },

      kosdaqBreakdown: {
        securitiesTransactionTax:
          0.002,
        agriculturalSpecialTax:
          0,
      },

      note:
        "Tax rates are encoded for 2026 Korean listed-equity sell-side stress. Broker fees and friction are scenario assumptions, not legal rates.",
    },

    costScenarios:
      COST_SCENARIOS,

    policies:
      analyzed,

    scenarioRankings,

    decision,

    caveats: [
      "Same-sample historical analysis, not forward OOS.",
      "Cost analysis is fixed-path: it subtracts costs from the gross replay but does not yet recompute future quantities/admissions after cost drag.",
      "Generic execution friction is a stress assumption, not an observed fill model.",
      "Partial fills and queue position are not modeled.",
      "Concentration exclusions are attribution diagnostics and do not rerun the capital path after removing winners.",
    ],

    safety: {
      databaseReads:
        0,
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
      "BUILD_EXACT_COST_AWARE_PORTFOLIO_REPLAY_AND_STOCK_CONCENTRATION_STRESS",

    outputFile:
      "logs/alpha-v3-risk-v3-cost-concentration-analysis.json",
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

try {
  main();
} catch (
  error
) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_RISK_V3_COST_CONCENTRATION_ANALYSIS_FAILED",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        nextGate:
          "REVIEW_COST_CONCENTRATION_ANALYSIS_FAILURE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}
