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
  type MarketSnapshotLike,
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

import {
  calculateEntrySignal,
  type SnapshotRecord,
} from "../lib/trading/generate-entry-signals";

import type {
  PredictionCandidate,
} from "../lib/trading/get-latest-prediction-candidates";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

const VERSION =
  "ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY";

const RANGE_START =
  "2026-07-30";

const RANGE_END =
  "2026-10-02";

const TARGET_DATE_COUNT =
  44;

const ENTRY_THRESHOLD =
  0.66;

const FLOW_LOOKBACK =
  7;

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-full-window-historical-replay-read-only.json",
  );

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
  disclosure_score: number | string | null;
  price_momentum: number | string | null;
  intraday_return: number | string | null;
  volume_ratio: number | string | null;
  reasons: unknown;
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

function toReasons(
  value: unknown,
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (
          item,
        ): item is string =>
          typeof item === "string",
      )
    : [];
}

function dateOnly(
  value: string,
) {
  return value.slice(
    0,
    10,
  );
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
    .slice(
      0,
      10,
    );
}

function nextCalendarDate(
  sqlDate: string,
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

function evenlyPick<T>(
  rows: T[],
  count: number,
): T[] {
  if (
    rows.length <=
    count
  ) {
    return rows;
  }

  const picked:
    T[] =
    [];

  const used =
    new Set<number>();

  for (
    let i =
      0;
    i <
      count;
    i +=
      1
  ) {
    const index =
      Math.round(
        i *
          (
            rows.length -
            1
          ) /
          (
            count -
            1
          ),
      );

    if (
      !used.has(
        index,
      )
    ) {
      used.add(
        index,
      );

      picked.push(
        rows[index],
      );
    }
  }

  return picked;
}

function toPredictionHistory(
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

function toEntryPrediction(
  row: PredictionRow,
): PredictionCandidate {
  return {
    predictionId:
      row.id,

    stockCode:
      row.stock_code,

    predictionDate:
      row.prediction_date,

    generatedAt:
      row.generated_at,

    modelName:
      row.model_name,

    modelVersion:
      row.model_version,

    score:
      toNumber(
        row.score,
      ) ?? 0,

    confidence:
      toNumber(
        row.confidence,
      ) ?? 0,

    disclosureScore:
      toNumber(
        row.disclosure_score,
      ),

    priceMomentum:
      toNumber(
        row.price_momentum,
      ),

    intradayReturn:
      toNumber(
        row.intraday_return,
      ),

    volumeRatio:
      toNumber(
        row.volume_ratio,
      ),

    reasons:
      toReasons(
        row.reasons,
      ),
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
      .from(
        "stocks",
      )
      .select(
        "stock_code,stock_name,market,sector",
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
      );

  if (
    stockError
  ) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${stockError.message}`,
    );
  }

  const stocks =
    (
      stockData ??
      []
    ) as ActiveStock[];

  const stockCodes =
    stocks.map(
      (
        row,
      ) =>
        row.stock_code,
    );

  const {
    data: predictionData,
    error: predictionError,
  } =
    await supabase
      .from(
        "ai_stock_predictions",
      )
      .select(
        "id,stock_code,prediction_date,generated_at,model_name,model_version,score,confidence,direction,is_candidate,disclosure_score,price_momentum,intraday_return,volume_ratio,reasons",
      )
      .gte(
        "prediction_date",
        RANGE_START,
      )
      .lte(
        "prediction_date",
        RANGE_END,
      )
      .order(
        "generated_at",
        {
          ascending:
            true,
        },
      )
      .limit(
        5000,
      );

  if (
    predictionError
  ) {
    throw new Error(
      `PREDICTION_READ_FAILED:${predictionError.message}`,
    );
  }

  const predictions =
    (
      predictionData ??
      []
    ) as PredictionRow[];

  const predictionDates =
    [
      ...new Set(
        predictions.map(
          (
            row,
          ) =>
            row.prediction_date,
        ),
      ),
    ].sort();

  const candidateDates:
    Array<{
      date: string;
      decisionAt: string;
      predictionRows: number;
      snapshotRows: number;
      priorFlowRowsMinimum: number;
    }> =
    [];

  for (
    const date
    of predictionDates
  ) {
    const datePredictions =
      predictions.filter(
        (
          row,
        ) =>
          row.prediction_date ===
          date,
      );

    const decisionAt =
      datePredictions
        .map(
          (
            row,
          ) =>
            row.generated_at,
        )
        .sort()
        .at(-1);

    if (
      !decisionAt
    ) {
      continue;
    }

    const nextDate =
      nextCalendarDate(
        date,
      );

    const [
      snapshotProbe,
      flowProbe,
    ] =
      await Promise.all([
        supabase
          .from(
            "market_snapshots",
          )
          .select(
            "stock_code,observed_at",
            {
              count:
                "exact",
              head:
                true,
            },
          )
          .gte(
            "observed_at",
            `${date}T00:00:00.000Z`,
          )
          .lte(
            "observed_at",
            decisionAt,
          ),

        supabase
          .from(
            "kis_investor_flow_daily",
          )
          .select(
            "stock_code,trading_date",
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending:
                false,
            },
          )
          .limit(
            stockCodes.length *
              FLOW_LOOKBACK,
          ),
      ]);

    if (
      snapshotProbe.error
    ) {
      throw new Error(
        `SNAPSHOT_DATE_PROBE_FAILED:${date}:${snapshotProbe.error.message}`,
      );
    }

    if (
      flowProbe.error
    ) {
      throw new Error(
        `FLOW_DATE_PROBE_FAILED:${date}:${flowProbe.error.message}`,
      );
    }

    const flowCounts =
      new Map<
        string,
        number
      >();

    for (
      const row
      of (
        flowProbe.data ??
        []
      )
    ) {
      const code =
        String(
          row.stock_code,
        );

      flowCounts.set(
        code,
        (
          flowCounts.get(
            code,
          ) ??
          0
        ) +
          1,
      );
    }

    const priorFlowRowsMinimum =
      stockCodes.length > 0
        ? Math.min(
            ...stockCodes.map(
              (
                code,
              ) =>
                flowCounts.get(
                  code,
                ) ??
                0,
            ),
          )
        : 0;

    if (
      (
        snapshotProbe.count ??
        0
      ) >
        0 &&
      priorFlowRowsMinimum >=
        FLOW_LOOKBACK
    ) {
      candidateDates.push({
        date,
        decisionAt,
        predictionRows:
          datePredictions.length,
        snapshotRows:
          snapshotProbe.count ??
          0,
        priorFlowRowsMinimum,
      });
    }
  }

  const selectedDates =
    evenlyPick(
      candidateDates,
      TARGET_DATE_COUNT,
    );

  const replayRows:
    JsonRecord[] =
    [];

  let totalLookaheadViolations =
    0;

  for (
    const selected
    of selectedDates
  ) {
    const date =
      selected.date;

    const decisionAt =
      selected.decisionAt;

    const historyStartDate =
      subtractCalendarDays(
        date,
        160,
      );

    const nextDate =
      nextCalendarDate(
        date,
      );

    const [
      snapshotResult,
      dailyBarResult,
      indexBarResult,
      flowResult,
    ] =
      await Promise.all([
        supabase
          .from(
            "market_snapshots",
          )
          .select(
            "stock_code,observed_at,open_price,high_price,low_price,close_price,volume",
          )
          .gte(
            "observed_at",
            `${date}T00:00:00.000Z`,
          )
          .lte(
            "observed_at",
            decisionAt,
          )
          .in(
            "stock_code",
            stockCodes,
          )
          .order(
            "observed_at",
            {
              ascending:
                true,
            },
          )
          .limit(
            5000,
          ),

        supabase
          .from(
            "market_daily_bars",
          )
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
            historyStartDate,
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending:
                true,
            },
          )
          .limit(
            5000,
          ),

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
            historyStartDate,
          )
          .lt(
            "trading_date",
            date,
          )
          .order(
            "trading_date",
            {
              ascending:
                true,
            },
          )
          .limit(
            1000,
          ),

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
              ascending:
                true,
            },
          )
          .limit(
            5000,
          ),
      ]);

    for (
      const [
        label,
        result,
      ]
      of [
        [
          "SNAPSHOT",
          snapshotResult,
        ],
        [
          "DAILY_BAR",
          dailyBarResult,
        ],
        [
          "INDEX_BAR",
          indexBarResult,
        ],
        [
          "FLOW",
          flowResult,
        ],
      ] as const
    ) {
      if (
        result.error
      ) {
        throw new Error(
          `${label}_READ_FAILED:${date}:${result.error.message}`,
        );
      }
    }

    const snapshots =
      (
        snapshotResult.data ??
        []
      ) as MarketSnapshotLike[];

    const dailyBars =
      (
        dailyBarResult.data ??
        []
      ) as DailyAlphaBarLike[];

    const indexBars:
      MarketRegimeIndexBar[] =
      (
        indexBarResult.data ??
        []
      )
        .map(
          (
            row,
          ) => {
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
                marketCode !==
                  "KOSPI" &&
                marketCode !==
                  "KOSDAQ"
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
          },
        )
        .filter(
          (
            row,
          ): row is MarketRegimeIndexBar =>
            row !== null,
        );

    const stockBars:
      MarketRegimeStockBar[] =
      dailyBars
        .map(
          (
            row,
          ) => {
            const close =
              toNumber(
                row.close_price,
              );

            if (
              close === null
            ) {
              return null;
            }

            return {
              stockCode:
                row.stock_code,

              tradingDate:
                row.trading_date,

              close,
            };
          },
        )
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

    const datePredictions =
      predictions.filter(
        (
          row,
        ) =>
          row.prediction_date ===
            date &&
          new Date(
            row.generated_at,
          ).getTime() <=
            new Date(
              decisionAt,
            ).getTime(),
      );

    const latestGeneratedAt =
      datePredictions
        .map(
          (
            row,
          ) =>
            row.generated_at,
        )
        .sort()
        .at(-1);

    const latestCohort =
      latestGeneratedAt
        ? datePredictions.filter(
            (
              row,
            ) =>
              row.generated_at ===
              latestGeneratedAt,
          )
        : [];

    const cohortModelName =
      latestCohort[0]
        ?.model_name ??
      null;

    const cohortModelVersion =
      latestCohort[0]
        ?.model_version ??
      null;

    const allHistory =
      predictions
        .filter(
          (
            row,
          ) =>
            new Date(
              row.generated_at,
            ).getTime() <=
            new Date(
              decisionAt,
            ).getTime(),
        )
        .map(
          toPredictionHistory,
        );

    const flowRows =
      (
        flowResult.data ??
        []
      ) as JsonRecord[];

    const inputs:
      AlphaCandidateInput[] =
      [];

    const alphaDiagnostics:
      JsonRecord[] =
      [];

    for (
      const stock
      of stocks
    ) {
      const stockCohort =
        latestCohort.filter(
          (
            row,
          ) =>
            row.stock_code ===
            stock.stock_code,
        );

      const gate:
        DisclosurePredictionGate = {
        available:
          latestCohort.length >
          0,

        fresh:
          latestCohort.length >
          0,

        predictionDate:
          date,

        generatedAt:
          latestGeneratedAt ??
          null,

        modelName:
          cohortModelName,

        modelVersion:
          cohortModelVersion,

        ageMinutes:
          latestGeneratedAt
            ? Math.max(
                0,
                (
                  new Date(
                    decisionAt,
                  ).getTime() -
                  new Date(
                    latestGeneratedAt,
                  ).getTime()
                ) /
                  60000,
              )
            : null,

        maximumAgeMinutes:
          180,

        candidateCount:
          latestCohort.length,

        stockCodes:
          latestCohort.map(
            (
              row,
            ) =>
              row.stock_code,
          ),

        candidates:
          stockCohort.map(
            (
              row,
            ) => ({
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
          latestCohort.length >
          0
            ? "OK"
            : "NO_PREDICTION",
      };

      const eventPersistence =
        buildEventPersistenceEvidence({
          stockCode:
            stock.stock_code,

          decisionAt,

          predictions:
            allHistory,

          lookbackHours:
            72,
        });

      const stockFlow =
        flowRows
          .filter(
            (
              row,
            ) =>
              String(
                row.stock_code,
              ) ===
              stock.stock_code,
          )
          .map(
            (
              row,
            ) => ({
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
            }),
          );

      const flowEvidence =
        buildKisInvestorFlowEvidence({
          decisionAt,

          rows:
            stockFlow,

          lookbackRows:
            FLOW_LOOKBACK,
        });

      const stockSnapshots =
        snapshots.filter(
          (
            row,
          ) =>
            row.stock_code ===
            stock.stock_code,
        );

      const baseInput =
        buildAlphaCandidateInputFromRealSources({
          stockCode:
            stock.stock_code,

          decisionAt,

          disclosurePredictionGate:
            gate,

          marketRegimeShadow:
            null,

          marketSnapshots:
            stockSnapshots,

          eventPersistenceEvidence:
            eventPersistence,

          flowEvidence,

          riskEvidence:
            undefined,

          modelVersion:
            "alpha-v1-historical-contract-replay",
        });

      const dailyPv =
        buildDailyPriceVolumeEvidence({
          stockCode:
            stock.stock_code,

          market:
            stock.market,

          decisionAt,

          rows:
            dailyBars.filter(
              (
                row,
              ) =>
                row.stock_code ===
                stock.stock_code,
            ),

          v7Features,
        });

      baseInput.riskPolicy =
        "DEFER_TO_PREFLIGHT";

      baseInput.features.marketRegime =
        regimeEvidence;

      baseInput.features.priceVolume =
        dailyPv;

      const lookaheadFields =
        Object.entries(
          baseInput.features,
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
            (
              [
                key,
              ],
            ) =>
              key,
          );

      totalLookaheadViolations +=
        lookaheadFields.length;

      alphaDiagnostics.push({
        stockCode:
          stock.stock_code,

        lookaheadFields,

        sourcePresence:
          Object.fromEntries(
            Object.entries(
              baseInput.features,
            ).map(
              (
                [
                  key,
                  value,
                ],
              ) => [
                key,
                Boolean(
                  value,
                ),
              ],
            ),
          ),
      });

      inputs.push(
        baseInput,
      );
    }

    const ranking =
      rankAlphaCandidates(
        inputs,
        "STABLE",
      );

    const alphaEligible =
      ranking.filter(
        (
          row,
        ) =>
          row.eligibleForEntryTiming,
      );

    const productionEntryPredictions =
      latestCohort
        .filter(
          (
            row,
          ) =>
            row.is_candidate ===
              true &&
            row.direction ===
              "UP",
        )
        .map(
          toEntryPrediction,
        );

    const entryResults:
      JsonRecord[] =
      [];

    let entryQualifies =
      0;

    let riskApproved =
      0;

    for (
      const alphaRow
      of alphaEligible
    ) {
      const prediction =
        productionEntryPredictions.find(
          (
            row,
          ) =>
            row.stockCode ===
            alphaRow.stockCode,
        );

      if (
        !prediction
      ) {
        entryResults.push({
          stockCode:
            alphaRow.stockCode,

          alphaEligible:
            true,

          predictionGate:
            "NO_UP_CANDIDATE_IN_AS_OF_COHORT",

          entryInvoked:
            false,

          riskInvoked:
            false,
        });

        continue;
      }

      const stockSnapshots =
        snapshots
          .filter(
            (
              row,
            ) =>
              row.stock_code ===
              alphaRow.stockCode,
          ) as SnapshotRecord[];

      const signal =
        calculateEntrySignal(
          stockSnapshots,
          prediction,
          ENTRY_THRESHOLD,
        );

      if (
        !signal
      ) {
        entryResults.push({
          stockCode:
            alphaRow.stockCode,

          alphaEligible:
            true,

          predictionGate:
            "PASS",

          entryInvoked:
            true,

          entrySignal:
            null,

          riskInvoked:
            false,
        });

        continue;
      }

      if (
        signal.qualifies
      ) {
        entryQualifies +=
          1;
      }

      const risk =
        signal.qualifies
          ? validateBuyRisk({
              stockCode:
                signal.stockCode,

              entryPrice:
                signal.entryPrice,

              proposedStopPrice:
                signal.stopPrice,

              requestedQuantity:
                signal.quantity,

              accountEquity:
                10_000_000,

              availableCash:
                10_000_000,

              currentInvestedAmount:
                0,

              currentStockExposureAmount:
                0,

              currentSectorExposureAmount:
                0,

              openPositionCount:
                0,

              isNewPosition:
                true,

              dailyRealizedPnl:
                0,

              tradingMode:
                "PAPER",

              modelStatus:
                "CANDIDATE",
            })
          : null;

      if (
        risk?.approved
      ) {
        riskApproved +=
          1;
      }

      entryResults.push({
        stockCode:
          alphaRow.stockCode,

        alphaEligible:
          true,

        predictionGate:
          "PASS",

        entryInvoked:
          true,

        entryScore:
          signal.score,

        entryQualifies:
          signal.qualifies,

        entryPrice:
          signal.entryPrice,

        stopPrice:
          signal.stopPrice,

        riskInvoked:
          Boolean(
            risk,
          ),

        riskApproved:
          risk?.approved ??
          null,

        riskIssues:
          risk?.issues ??
          [],
      });
    }

    replayRows.push({
      date,
      decisionAt,

      safeDailyDataThrough:
        v7Features.latestMarketDate,

      counts: {
        snapshots:
          snapshots.length,

        latestPredictionCohort:
          latestCohort.length,

        productionUpCandidates:
          productionEntryPredictions.length,

        alphaAnalyzed:
          ranking.length,

        alphaEligible:
          alphaEligible.length,

        entryQualifies,

        riskApproved,
      },

      topAlpha:
        ranking
          .slice(
            0,
            5,
          )
          .map(
            (
              row,
            ) => ({
              rank:
                row.rank,

              stockCode:
                row.stockCode,

              score:
                row.finalScore,

              quality:
                row.quality,

              coverage:
                row.coverage,

              eligible:
                row.eligibleForEntryTiming,

              blockers:
                row.blockingIssues,
            }),
          ),

      regime: {
        latestMarketDate:
          v7Features.latestMarketDate,

        blocked:
          v7Policy.blocked,

        reasons:
          v7Policy.reasons,
      },

      alphaDiagnostics,
      entryResults,
    });
  }

  const fullFiveDateReplay =
    selectedDates.length ===
    TARGET_DATE_COUNT;

  const report = {
    status:
      "ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY_COMPLETE",

    version:
      VERSION,

    purpose:
      "NO_LOOKAHEAD_CONTRACT_AND_PIPELINE_REPLAY_NOT_PERFORMANCE_BACKTEST",

    replayWindow: {
      requestedStart:
        RANGE_START,

      requestedEnd:
        RANGE_END,

      candidateDateCount:
        candidateDates.length,

      selectedDateCount:
        selectedDates.length,

      selectedDates,
    },

    policy: {
      alphaTrack:
        "STABLE",

      entryThreshold:
        ENTRY_THRESHOLD,

      flowLookbackRows:
        FLOW_LOOKBACK,

      riskContext:
        "SIMULATED_EMPTY_PAPER_PORTFOLIO_10M_FOR_CONTRACT_VALIDATION_ONLY",

      sameDayDailyBarsAllowed:
        false,

      sameDayFlowAllowed:
        false,
    },

    validation: {
      fullFiveDateReplay,

      noLookahead:
        totalLookaheadViolations ===
        0,

      totalLookaheadViolations,

      historicalFlowSource:
        "kis_investor_flow_daily",

      currentKisFallbackUsed:
        false,

      productionWrites:
        0,

      performanceClaimAllowed:
        false,
    },

    replay:
      replayRows,

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      aiEntrySignalWrites:
        0,

      riskDecisionWrites:
        0,

      paperOrderWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      !fullFiveDateReplay
        ? "HISTORICAL_ENTRY_SNAPSHOT_DENSITY_BLOCKER"
        : totalLookaheadViolations >
          0
        ? "REPAIR_NO_LOOKAHEAD_VIOLATIONS"
        : "ALPHA_V1_HISTORICAL_REPLAY_CONTRACT_VALIDATED",
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
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        selectedDateCount:
          report.replayWindow
            .selectedDateCount,

        noLookahead:
          report.validation
            .noLookahead,

        lookaheadViolations:
          report.validation
            .totalLookaheadViolations,

        totals: {
          alphaEligible:
            replayRows.reduce(
              (
                sum,
                row,
              ) =>
                sum +
                Number(
                  (
                    row.counts as
                      JsonRecord
                  )
                    .alphaEligible ??
                    0,
                ),
              0,
            ),

          entryQualifies:
            replayRows.reduce(
              (
                sum,
                row,
              ) =>
                sum +
                Number(
                  (
                    row.counts as
                      JsonRecord
                  )
                    .entryQualifies ??
                    0,
                ),
              0,
            ),

          riskApproved:
            replayRows.reduce(
              (
                sum,
                row,
              ) =>
                sum +
                Number(
                  (
                    row.counts as
                      JsonRecord
                  )
                    .riskApproved ??
                    0,
                ),
              0,
            ),
        },

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v1-5-date-full-historical-replay-read-only.json",
      },
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
            "ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY_FAILED",

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
