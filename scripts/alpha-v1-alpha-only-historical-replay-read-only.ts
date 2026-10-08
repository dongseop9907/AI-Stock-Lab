import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  rankAlphaCandidates,
  type AlphaCandidateInput,
} from "../lib/alpha/candidate-scoring";

import {
  buildAlphaCandidateInputFromRealSources,
  type DisclosurePredictionGate,
} from "../lib/alpha/feature-adapters";

import {
  buildEventPersistenceEvidence,
  type PredictionHistoryLike,
} from "../lib/alpha/confirmed-source-adapters";

import {
  buildKisInvestorFlowEvidence,
} from "../lib/alpha/kis-flow-adapter";

import {
  buildDailyPriceVolumeEvidence,
  buildDailyLiquidityEvidence,
  buildV7MarketRegimeEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeFeatureMarket,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "../lib/market/market-regime-feature-engine";

import {
  evaluateMarketRegimeV7Policy,
} from "../lib/market/market-regime-v7-policy";

const VERSION =
  "ALPHA_V1_ALPHA_ONLY_HISTORICAL_REPLAY_READ_ONLY";

const START =
  "2026-07-30";

const END =
  "2026-10-02";

const FLOW_LOOKBACK =
  7;

type JsonRecord =
  Record<string, unknown>;

interface ActiveStock {
  stock_code: string;
  stock_name: string | null;
  market: string | null;
  sector: string | null;
}

interface PredictionRow {
  id: string;
  stock_code: string;
  prediction_date: string;
  generated_at: string;
  model_name: string;
  model_version: string;
  score: number | string;
  confidence: number | string;
  direction: string | null;
  is_candidate: boolean | null;
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function subtractCalendarDays(
  sqlDate: string,
  days: number,
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
    .slice(0, 10);
}

function toHistory(
  row: PredictionRow,
): PredictionHistoryLike {
  return {
    stock_code:
      row.stock_code,
    score:
      row.score,
    direction:
      row.direction,
    confidence:
      row.confidence,
    is_candidate:
      row.is_candidate,
    generated_at:
      row.generated_at,
    prediction_date:
      row.prediction_date,
    model_name:
      row.model_name,
    model_version:
      row.model_version,
  };
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: stockData,
    error: stockError,
  } =
    await supabase
      .from("stocks")
      .select(
        "stock_code,stock_name,market,sector",
      )
      .eq("is_active", true)
      .order("stock_code");

  if (stockError) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${stockError.message}`,
    );
  }

  const stocks =
    (stockData ?? []) as ActiveStock[];

  const stockCodes =
    stocks.map(
      (row) =>
        row.stock_code,
    );

  const {
    data: predictionData,
    error: predictionError,
  } =
    await supabase
      .from("ai_stock_predictions")
      .select(
        "id,stock_code,prediction_date,generated_at,model_name,model_version,score,confidence,direction,is_candidate",
      )
      .gte("prediction_date", START)
      .lte("prediction_date", END)
      .order("generated_at", {
        ascending: true,
      })
      .limit(5000);

  if (predictionError) {
    throw new Error(
      `PREDICTION_READ_FAILED:${predictionError.message}`,
    );
  }

  const predictions =
    (predictionData ?? []) as PredictionRow[];

  const dates =
    [
      ...new Set(
        predictions.map(
          (row) =>
            row.prediction_date,
        ),
      ),
    ].sort();

  const replay:
    JsonRecord[] =
    [];

  let totalEligible =
    0;

  let totalLookaheadViolations =
    0;

  let totalFlowBlockedDates =
    0;

  for (const date of dates) {
    const datePredictions =
      predictions.filter(
        (row) =>
          row.prediction_date ===
          date,
      );

    const decisionAt =
      datePredictions
        .map(
          (row) =>
            row.generated_at,
        )
        .sort()
        .at(-1);

    if (!decisionAt) {
      continue;
    }

    const historyStart =
      subtractCalendarDays(
        date,
        160,
      );

    const [
      dailyBarResult,
      indexBarResult,
      flowResult,
    ] =
      await Promise.all([
        supabase
          .from("market_daily_bars")
          .select(
            "stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,adjusted_price,source,updated_at",
          )
          .in(
            "stock_code",
            stockCodes,
          )
          .eq(
            "adjusted_price",
            true,
          )
          .gte(
            "trading_date",
            historyStart,
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending: true,
            },
          )
          .limit(5000),

        supabase
          .from(
            "market_index_daily_bars",
          )
          .select(
            "market_code,trading_date,close_value",
          )
          .in(
            "market_code",
            [
              "KOSPI",
              "KOSDAQ",
            ],
          )
          .gte(
            "trading_date",
            historyStart,
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending: true,
            },
          )
          .limit(1000),

        supabase
          .from(
            "kis_investor_flow_daily",
          )
          .select(
            "stock_code,trading_date,close_price,accumulated_volume,accumulated_trading_value,individual_net_buy_quantity,foreign_net_buy_quantity,institution_net_buy_quantity,individual_net_buy_amount,foreign_net_buy_amount,institution_net_buy_amount",
          )
          .in(
            "stock_code",
            stockCodes,
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending: true,
            },
          )
          .limit(5000),
      ]);

    if (dailyBarResult.error) {
      throw new Error(
        `DAILY_BAR_READ_FAILED:${date}:${dailyBarResult.error.message}`,
      );
    }

    if (indexBarResult.error) {
      throw new Error(
        `INDEX_BAR_READ_FAILED:${date}:${indexBarResult.error.message}`,
      );
    }

    if (flowResult.error) {
      throw new Error(
        `FLOW_READ_FAILED:${date}:${flowResult.error.message}`,
      );
    }

    const dailyBars =
      (dailyBarResult.data ?? []) as DailyAlphaBarLike[];

    const indexBars:
      MarketRegimeIndexBar[] =
      (indexBarResult.data ?? [])
        .map((row) => {
          const close =
            toNumber(
              row.close_value,
            );

          const marketCode =
            String(
              row.market_code,
            );

          if (
            close === null ||
            (
              marketCode !== "KOSPI" &&
              marketCode !== "KOSDAQ"
            )
          ) {
            return null;
          }

          return {
            marketCode:
              marketCode as
                MarketRegimeFeatureMarket,
            tradingDate:
              String(
                row.trading_date,
              ),
            close,
          };
        })
        .filter(
          (
            row,
          ): row is MarketRegimeIndexBar =>
            row !== null,
        );

    const stockBars:
      MarketRegimeStockBar[] =
      dailyBars
        .map((row) => {
          const close =
            toNumber(
              row.close_price,
            );

          if (close === null) {
            return null;
          }

          return {
            stockCode:
              row.stock_code,
            tradingDate:
              row.trading_date,
            close,
          };
        })
        .filter(
          (
            row,
          ): row is MarketRegimeStockBar =>
            row !== null,
        );

    const v7Features =
      calculateMarketRegimeFeatureVectorV7({
        indexBars,
        stockBars,
      });

    const v7Policy =
      evaluateMarketRegimeV7Policy(
        "BLOCK_BREADTH_OR_HIGH_VOL",
        v7Features,
      );

    const regimeEvidence =
      buildV7MarketRegimeEvidence({
        decisionAt,
        features:
          v7Features,
        policy:
          v7Policy,
      });

    const latestGeneratedAt =
      datePredictions
        .map(
          (row) =>
            row.generated_at,
        )
        .sort()
        .at(-1)!;

    const latestCohort =
      datePredictions.filter(
        (row) =>
          row.generated_at ===
          latestGeneratedAt,
      );

    const history =
      predictions
        .filter(
          (row) =>
            new Date(
              row.generated_at,
            ).getTime() <=
            new Date(
              decisionAt,
            ).getTime(),
        )
        .map(
          toHistory,
        );

    const flowRows =
      (flowResult.data ?? []) as JsonRecord[];

    const flowCounts =
      new Map<string, number>();

    for (const row of flowRows) {
      const code =
        String(
          row.stock_code,
        );

      flowCounts.set(
        code,
        (
          flowCounts.get(code) ??
          0
        ) +
          1,
      );
    }

    const flowMin =
      stockCodes.length > 0
        ? Math.min(
            ...stockCodes.map(
              (code) =>
                flowCounts.get(code) ??
                0,
            ),
          )
        : 0;

    const inputs:
      AlphaCandidateInput[] =
      [];

    const diagnostics:
      JsonRecord[] =
      [];

    for (const stock of stocks) {
      const stockCohort =
        latestCohort.filter(
          (row) =>
            row.stock_code ===
            stock.stock_code,
        );

      const gate:
        DisclosurePredictionGate = {
        available:
          latestCohort.length > 0,
        fresh:
          latestCohort.length > 0,
        predictionDate:
          date,
        generatedAt:
          latestGeneratedAt,
        modelName:
          latestCohort[0]
            ?.model_name ??
          null,
        modelVersion:
          latestCohort[0]
            ?.model_version ??
          null,
        ageMinutes:
          0,
        maximumAgeMinutes:
          180,
        candidateCount:
          latestCohort.length,
        stockCodes:
          latestCohort.map(
            (row) =>
              row.stock_code,
          ),
        candidates:
          stockCohort.map(
            (row) => ({
              stock_code:
                row.stock_code,
              score:
                toNumber(
                  row.score,
                ) ??
                0,
              direction:
                row.direction,
              confidence:
                toNumber(
                  row.confidence,
                ) ??
                0,
              is_candidate:
                row.is_candidate,
            }),
          ),
        reason:
          "OK",
      };

      const eventPersistence =
        buildEventPersistenceEvidence({
          stockCode:
            stock.stock_code,
          decisionAt,
          predictions:
            history,
          lookbackHours:
            72,
        });

      const stockFlowRows =
        flowRows
          .filter(
            (row) =>
              String(
                row.stock_code,
              ) ===
              stock.stock_code,
          )
          .map((row) => ({
            stck_bsop_date:
              String(
                row.trading_date,
              ).replace(
                /-/g,
                "",
              ),
            stck_clpr:
              row.close_price,
            acml_vol:
              row.accumulated_volume,
            acml_tr_pbmn:
              row.accumulated_trading_value,
            prsn_ntby_qty:
              row.individual_net_buy_quantity,
            frgn_ntby_qty:
              row.foreign_net_buy_quantity,
            orgn_ntby_qty:
              row.institution_net_buy_quantity,
            prsn_ntby_tr_pbmn:
              row.individual_net_buy_amount,
            frgn_ntby_tr_pbmn:
              row.foreign_net_buy_amount,
            orgn_ntby_tr_pbmn:
              row.institution_net_buy_amount,
          }));

      const flowEvidence =
        buildKisInvestorFlowEvidence({
          decisionAt,
          rows:
            stockFlowRows,
          lookbackRows:
            FLOW_LOOKBACK,
        });

      const input =
        buildAlphaCandidateInputFromRealSources({
          stockCode:
            stock.stock_code,
          decisionAt,
          disclosurePredictionGate:
            gate,
          marketRegimeShadow:
            null,
          marketSnapshots:
            [],
          eventPersistenceEvidence:
            eventPersistence,
          flowEvidence,
          riskEvidence:
            undefined,
          modelVersion:
            "alpha-v1-alpha-only-historical-replay",
        });

      const priceVolume =
        buildDailyPriceVolumeEvidence({
          stockCode:
            stock.stock_code,
          market:
            stock.market,
          decisionAt,
          rows:
            dailyBars.filter(
              (row) =>
                row.stock_code ===
                stock.stock_code,
            ),
          v7Features,
        });

      const liquidity =
        buildDailyLiquidityEvidence({
          stockCode:
            stock.stock_code,
          decisionAt,
          rows:
            dailyBars,
          lookbackRows:
            20,
        });

      input.riskPolicy =
        "DEFER_TO_PREFLIGHT";

      input.features.marketRegime =
        regimeEvidence;

      input.features.priceVolume =
        priceVolume;

      input.features.liquidity =
        liquidity;

      const lookahead =
        Object.entries(
          input.features,
        )
          .filter(
            (
              [
                ,
                evidence,
              ],
            ) => {
              if (
                !evidence ||
                typeof evidence !==
                  "object"
              ) {
                return false;
              }

              const availableAt =
                (
                  evidence as
                    {
                      availableAt?:
                        string | null;
                    }
                )
                  .availableAt;

              return Boolean(
                availableAt &&
                new Date(
                  availableAt,
                ).getTime() >
                  new Date(
                    decisionAt,
                  ).getTime(),
              );
            },
          )
          .map(
            ([key]) =>
              key,
          );

      totalLookaheadViolations +=
        lookahead.length;

      diagnostics.push({
        stockCode:
          stock.stock_code,
        lookahead,
        liquiditySource:
          liquidity?.source ??
          null,
        liquidityScore:
          liquidity?.score ??
          null,
      });

      inputs.push(
        input,
      );
    }

    const ranking =
      rankAlphaCandidates(
        inputs,
        "STABLE",
      );

    const eligible =
      ranking.filter(
        (row) =>
          row.eligibleForEntryTiming,
      );

    totalEligible +=
      eligible.length;

    const flowReady =
      flowMin >=
      FLOW_LOOKBACK;

    if (!flowReady) {
      totalFlowBlockedDates +=
        1;
    }

    replay.push({
      date,
      decisionAt,
      flowReady,
      priorFlowRowsMinimum:
        flowMin,
      counts: {
        analyzed:
          ranking.length,
        eligible:
          eligible.length,
      },
      topRanking:
        ranking
          .slice(0, 5)
          .map((row) => ({
            rank:
              row.rank,
            stockCode:
              row.stockCode,
            score:
              row.score,
            quality:
              row.quality,
            coverage:
              row.coverage,
            eligible:
              row.eligibleForEntryTiming,
            blockers:
              row.blockingIssues,
          })),
      rawRanking:
        ranking,
      diagnostics,
    });
  }

  const report = {
    status:
      "ALPHA_V1_ALPHA_ONLY_HISTORICAL_REPLAY_READ_ONLY_COMPLETE",
    version:
      VERSION,
    replayWindow: {
      start:
        START,
      end:
        END,
      predictionDateCount:
        dates.length,
      replayedDateCount:
        replay.length,
    },
    validation: {
      noLookahead:
        totalLookaheadViolations ===
        0,
      lookaheadViolations:
        totalLookaheadViolations,
      snapshotDependencyRemoved:
        true,
      liquiditySource:
        "MARKET_DAILY_BARS_ALPHA_LIQUIDITY",
      flowBlockedDates:
        totalFlowBlockedDates,
    },
    totals: {
      alphaEligible:
        totalEligible,
    },
    replay,
    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      productionDecisionApplied:
        false,
    },
    nextGate:
      totalLookaheadViolations > 0
        ? "REPAIR_ALPHA_HISTORICAL_LOOKAHEAD"
        : "REVIEW_ALPHA_ELIGIBILITY_DISTRIBUTION",
  };

  const out =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-alpha-only-historical-replay-read-only.json",
    );

  fs.mkdirSync(
    path.dirname(out),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    out,
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
        predictionDateCount:
          report.replayWindow
            .predictionDateCount,
        replayedDateCount:
          report.replayWindow
            .replayedDateCount,
        noLookahead:
          report.validation
            .noLookahead,
        lookaheadViolations:
          report.validation
            .lookaheadViolations,
        snapshotDependencyRemoved:
          report.validation
            .snapshotDependencyRemoved,
        flowBlockedDates:
          report.validation
            .flowBlockedDates,
        alphaEligible:
          report.totals
            .alphaEligible,
        nextGate:
          report.nextGate,
        outputFile:
          "logs/alpha-v1-alpha-only-historical-replay-read-only.json",
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
            "ALPHA_V1_ALPHA_ONLY_HISTORICAL_REPLAY_READ_ONLY_FAILED",
          version:
            VERSION,
          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),
          databaseWrites:
            0,
          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
