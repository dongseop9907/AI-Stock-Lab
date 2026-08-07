import { runDailyBacktest } from "@/lib/backtest/run-daily-backtest";
import { createSupabaseServerClient } from "@/lib/supabase";

interface RunRobustWalkForwardInput {
  stockCodes?: string[];

  thresholdCandidates?: number[];

  initialCash?: number;

  stopDistanceRate?: number;

  feeRate?: number;
  taxRate?: number;
  slippageRate?: number;

  maxPositions?: number;
  maxPositionRate?: number;

  maxHoldingDays?: number;

  startYear?: number;
  validationYears?: number;
}

interface YearMetric {
  year: number;

  backtestRunId: string;

  tradeCount: number;
  winRate: number | null;

  netReturn: number;

  benchmarkReturn: number | null;
  excessReturn: number | null;

  profitFactor: number | null;

  maxDrawdown: number;

  sharpeRatio: number | null;

  score: number;
}

interface RobustCandidate {
  threshold: number;

  robustScore: number;
  averageScore: number;
  worstScore: number;

  positiveYearCount: number;

  yearlyMetrics: YearMetric[];
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function round(
  value: number,
  digits = 6,
): number {
  const multiplier =
    10 ** digits;

  return (
    Math.round(
      value * multiplier,
    ) / multiplier
  );
}

function toNullableNumber(
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

function toNumber(
  value: unknown,
  fallback = 0,
): number {
  return (
    toNullableNumber(value) ??
    fallback
  );
}

function normalizeStockCodes(
  values: string[] | undefined,
): string[] {
  if (!values) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) =>
          value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeThresholds(
  values:
    | number[]
    | undefined,
): number[] {
  const source =
    values &&
    values.length > 0
      ? values
      : [
          0.62,
          0.66,
          0.70,
          0.74,
          0.78,
        ];

  return [
    ...new Set(
      source
        .map((value) =>
          round(
            Number(value),
            4,
          ),
        )
        .filter(
          (value) =>
            Number.isFinite(value) &&
            value >= 0.5 &&
            value <= 0.95,
        ),
    ),
  ].sort(
    (left, right) =>
      left - right,
  );
}

function startOfYear(
  year: number,
): string {
  return `${year}-01-01`;
}

function endOfYear(
  year: number,
): string {
  return `${year}-12-31`;
}

function calculateYearScore(
  input: {
    tradeCount: number;

    netReturn: number;

    profitFactor: number | null;

    maxDrawdown: number;

    sharpeRatio: number | null;
  },
): number {
  const sharpe =
    input.sharpeRatio ??
    0;

  const profitFactor =
    input.profitFactor ??
    0;

  const profitFactorTerm =
    Math.log(
      Math.max(
        profitFactor,
        0.2,
      ),
    );

  let score =
    input.netReturn -
    input.maxDrawdown *
      1.25 +
    sharpe *
      0.05 +
    profitFactorTerm *
      0.03;

  if (
    input.tradeCount <
    20
  ) {
    score -=
      0.25;
  }

  return round(
    score,
  );
}

function calculateRobustScore(
  yearlyMetrics:
    YearMetric[],
): {
  robustScore: number;
  averageScore: number;
  worstScore: number;
  positiveYearCount: number;
} {
  if (
    yearlyMetrics.length ===
    0
  ) {
    return {
      robustScore:
        -999,

      averageScore:
        -999,

      worstScore:
        -999,

      positiveYearCount:
        0,
    };
  }

  const scores =
    yearlyMetrics.map(
      (metric) =>
        metric.score,
    );

  const averageScore =
    scores.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    scores.length;

  const worstScore =
    Math.min(
      ...scores,
    );

  const positiveYearCount =
    yearlyMetrics.filter(
      (metric) =>
        metric.netReturn >
        0,
    ).length;

  /*
   * 평균 성과 60%
   * 최악의 연도 40%
   *
   * 한 해만 크게 잘 나온 파라미터보다
   * 여러 시장에서 덜 무너지는 파라미터를 선호한다.
   */
  const robustScore =
    averageScore * 0.6 +
    worstScore * 0.4;

  return {
    robustScore:
      round(
        robustScore,
      ),

    averageScore:
      round(
        averageScore,
      ),

    worstScore:
      round(
        worstScore,
      ),

    positiveYearCount,
  };
}

async function getDatasetRange(
  stockCodes: string[],
) {
  const supabase =
    createSupabaseServerClient();

  let earliestQuery =
    supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "trading_date",
      )
      .order(
        "trading_date",
        {
          ascending: true,
        },
      )
      .limit(1);

  let latestQuery =
    supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "trading_date",
      )
      .order(
        "trading_date",
        {
          ascending: false,
        },
      )
      .limit(1);

  if (
    stockCodes.length > 0
  ) {
    earliestQuery =
      earliestQuery.in(
        "stock_code",
        stockCodes,
      );

    latestQuery =
      latestQuery.in(
        "stock_code",
        stockCodes,
      );
  }

  const [
    earliestResult,
    latestResult,
  ] =
    await Promise.all([
      earliestQuery.maybeSingle(),
      latestQuery.maybeSingle(),
    ]);

  if (
    earliestResult.error
  ) {
    throw new Error(
      `일봉 시작일 조회 실패: ${earliestResult.error.message}`,
    );
  }

  if (
    latestResult.error
  ) {
    throw new Error(
      `일봉 종료일 조회 실패: ${latestResult.error.message}`,
    );
  }

  const earliest =
    earliestResult.data
      ?.trading_date;

  const latest =
    latestResult.data
      ?.trading_date;

  if (
    !earliest ||
    !latest
  ) {
    throw new Error(
      "ROBUST_WALK_FORWARD_DATASET_NOT_FOUND",
    );
  }

  return {
    earliest:
      String(earliest),

    latest:
      String(latest),
  };
}

export async function runRobustWalkForwardValidation(
  input:
    RunRobustWalkForwardInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const stockCodes =
    normalizeStockCodes(
      input.stockCodes,
    );

  const thresholdCandidates =
    normalizeThresholds(
      input.thresholdCandidates,
    );

  if (
    thresholdCandidates.length ===
    0
  ) {
    throw new Error(
      "유효한 thresholdCandidates가 없습니다.",
    );
  }

  const initialCash =
    Math.max(
      100_000,
      toNumber(
        input.initialCash,
        10_000_000,
      ),
    );

  const stopDistanceRate =
    clamp(
      toNumber(
        input.stopDistanceRate,
        0.025,
      ),
      0.001,
      0.5,
    );

  const feeRate =
    clamp(
      toNumber(
        input.feeRate,
        0.00015,
      ),
      0,
      0.1,
    );

  const taxRate =
    clamp(
      toNumber(
        input.taxRate,
        0.0015,
      ),
      0,
      0.1,
    );

  const slippageRate =
    clamp(
      toNumber(
        input.slippageRate,
        0.0005,
      ),
      0,
      0.1,
    );

  const maxPositions =
    Math.min(
      20,
      Math.max(
        1,
        Math.floor(
          toNumber(
            input.maxPositions,
            3,
          ),
        ),
      ),
    );

  const maxPositionRate =
    clamp(
      toNumber(
        input.maxPositionRate,
        0.2,
      ),
      0.01,
      1,
    );

  const maxHoldingDays =
    Math.min(
      250,
      Math.max(
        1,
        Math.floor(
          toNumber(
            input.maxHoldingDays,
            10,
          ),
        ),
      ),
    );

  const validationYears =
    Math.min(
      5,
      Math.max(
        2,
        Math.floor(
          toNumber(
            input.validationYears,
            2,
          ),
        ),
      ),
    );

  const range =
    await getDatasetRange(
      stockCodes,
    );

  const earliestYear =
    Number(
      range.earliest.slice(
        0,
        4,
      ),
    );

  const latestYear =
    Number(
      range.latest.slice(
        0,
        4,
      ),
    );

  const requestedStartYear =
    Math.floor(
      toNumber(
        input.startYear,
        earliestYear,
      ),
    );

  const startYear =
    Math.max(
      earliestYear,
      requestedStartYear,
    );

  const firstTestYear =
    startYear +
    validationYears;

  if (
    firstTestYear >
    latestYear
  ) {
    throw new Error(
      "Robust Walk-Forward를 위한 데이터 연도가 부족합니다.",
    );
  }

  const {
    data: runData,
    error: runError,
  } =
    await supabase
      .from(
        "walk_forward_runs",
      )
      .insert({
        strategy_name:
          "ROBUST_THRESHOLD_WALK_FORWARD",

        strategy_version:
          "v4",

        status:
          "RUNNING",

        config: {
          stockCodes,

          datasetRange:
            range,

          startYear,

          validationYears,

          thresholdCandidates,

          initialCash,

          stopDistanceRate,

          feeRate,
          taxRate,
          slippageRate,

          maxPositions,
          maxPositionRate,

          maxHoldingDays,

          selectionRule:
            "ROLLING_MULTI_YEAR_ROBUST_VALIDATION",

          robustScore:
            "0.6 * mean(yearScore) + 0.4 * worst(yearScore)",

          testUsedForSelection:
            false,

          tunedParameters: [
            "entryThreshold",
          ],

          fixedParameters: {
            stopDistanceRate,
            maxHoldingDays,
          },
        },
      })
      .select(
        "id",
      )
      .single();

  if (
    runError ||
    !runData
  ) {
    throw new Error(
      `Robust Walk-Forward 실행 생성 실패: ${
        runError?.message ??
        "실행 ID 없음"
      }`,
    );
  }

  const walkForwardRunId =
    String(
      runData.id,
    );

  const folds:
    Array<{
      foldNumber: number;

      validationStart: string;
      validationEnd: string;

      testStart: string;
      testEnd: string;

      selectedThreshold: number;

      robustScore: number;

      validationMetrics:
        RobustCandidate;

      testMetrics: {
        backtestRunId: string;

        tradeCount: number;
        winRate: number | null;

        netReturn: number;

        benchmarkReturn: number | null;
        excessReturn: number | null;

        profitFactor: number | null;

        maxDrawdown: number;

        sharpeRatio: number | null;
      };

      candidateResults:
        RobustCandidate[];
    }> =
    [];

  try {
    let foldNumber =
      0;

    for (
      let testYear =
        firstTestYear;
      testYear <=
      latestYear;
      testYear += 1
    ) {
      const validationStartYear =
        testYear -
        validationYears;

      const validationEndYear =
        testYear - 1;

      const validationStart =
        startOfYear(
          validationStartYear,
        );

      const validationEnd =
        endOfYear(
          validationEndYear,
        );

      const testStart =
        startOfYear(
          testYear,
        );

      const testEnd =
        testYear ===
        latestYear
          ? range.latest
          : endOfYear(
              testYear,
            );

      if (
        testStart >
        range.latest
      ) {
        break;
      }

      foldNumber +=
        1;

      const candidateResults:
        RobustCandidate[] =
        [];

      for (
        const threshold
        of thresholdCandidates
      ) {
        const yearlyMetrics:
          YearMetric[] =
          [];

        for (
          let validationYear =
            validationStartYear;
          validationYear <=
          validationEndYear;
          validationYear += 1
        ) {
          const result =
            await runDailyBacktest({
              startDate:
                startOfYear(
                  validationYear,
                ),

              endDate:
                endOfYear(
                  validationYear,
                ),

              stockCodes,

              initialCash,

              entryThreshold:
                threshold,

              stopDistanceRate,

              feeRate,
              taxRate,
              slippageRate,

              maxPositions,
              maxPositionRate,

              maxHoldingDays,
            });

          const metric: YearMetric = {
            year:
              validationYear,

            backtestRunId:
              String(
                result.runId,
              ),

            tradeCount:
              toNumber(
                result.tradeCount,
              ),

            winRate:
              toNullableNumber(
                result.winRate,
              ),

            netReturn:
              toNumber(
                result.netReturn,
              ),

            benchmarkReturn:
              toNullableNumber(
                result.benchmarkReturn,
              ),

            excessReturn:
              toNullableNumber(
                result.excessReturn,
              ),

            profitFactor:
              toNullableNumber(
                result.profitFactor,
              ),

            maxDrawdown:
              toNumber(
                result.maxDrawdown,
              ),

            sharpeRatio:
              toNullableNumber(
                result.sharpeRatio,
              ),

            score:
              0,
          };

          metric.score =
            calculateYearScore(
              metric,
            );

          yearlyMetrics.push(
            metric,
          );
        }

        const robust =
          calculateRobustScore(
            yearlyMetrics,
          );

        candidateResults.push({
          threshold,

          robustScore:
            robust.robustScore,

          averageScore:
            robust.averageScore,

          worstScore:
            robust.worstScore,

          positiveYearCount:
            robust.positiveYearCount,

          yearlyMetrics,
        });
      }

      candidateResults.sort(
        (
          left,
          right,
        ) => {
          if (
            right.robustScore !==
            left.robustScore
          ) {
            return (
              right.robustScore -
              left.robustScore
            );
          }

          if (
            right.worstScore !==
            left.worstScore
          ) {
            return (
              right.worstScore -
              left.worstScore
            );
          }

          return (
            right.averageScore -
            left.averageScore
          );
        },
      );

      const selected =
        candidateResults[0];

      if (!selected) {
        throw new Error(
          `Fold ${foldNumber}: 선택 가능한 threshold가 없습니다.`,
        );
      }

      const testResult =
        await runDailyBacktest({
          startDate:
            testStart,

          endDate:
            testEnd,

          stockCodes,

          initialCash,

          entryThreshold:
            selected.threshold,

          stopDistanceRate,

          feeRate,
          taxRate,
          slippageRate,

          maxPositions,
          maxPositionRate,

          maxHoldingDays,
        });

      const testMetrics = {
        backtestRunId:
          String(
            testResult.runId,
          ),

        tradeCount:
          toNumber(
            testResult.tradeCount,
          ),

        winRate:
          toNullableNumber(
            testResult.winRate,
          ),

        netReturn:
          toNumber(
            testResult.netReturn,
          ),

        benchmarkReturn:
          toNullableNumber(
            testResult.benchmarkReturn,
          ),

        excessReturn:
          toNullableNumber(
            testResult.excessReturn,
          ),

        profitFactor:
          toNullableNumber(
            testResult.profitFactor,
          ),

        maxDrawdown:
          toNumber(
            testResult.maxDrawdown,
          ),

        sharpeRatio:
          toNullableNumber(
            testResult.sharpeRatio,
          ),
      };

      folds.push({
        foldNumber,

        validationStart,
        validationEnd,

        testStart,
        testEnd,

        selectedThreshold:
          selected.threshold,

        robustScore:
          selected.robustScore,

        validationMetrics:
          selected,

        testMetrics,

        candidateResults,
      });

      const {
        error: foldSaveError,
      } =
        await supabase
          .from(
            "walk_forward_folds",
          )
          .insert({
            run_id:
              walkForwardRunId,

            fold_number:
              foldNumber,

            validation_start:
              validationStart,

            validation_end:
              validationEnd,

            test_start:
              testStart,

            test_end:
              testEnd,

            selected_threshold:
              selected.threshold,

            validation_score:
              selected.robustScore,

            validation_backtest_run_id:
              null,

            test_backtest_run_id:
              testMetrics.backtestRunId,

            validation_metrics:
              selected,

            test_metrics:
              testMetrics,

            candidate_results:
              candidateResults,
          });

      if (
        foldSaveError
      ) {
        throw new Error(
          `Fold ${foldNumber} 저장 실패: ${foldSaveError.message}`,
        );
      }
    }

    if (
      folds.length ===
      0
    ) {
      throw new Error(
        "Robust Walk-Forward fold가 생성되지 않았습니다.",
      );
    }

    const oosReturns =
      folds.map(
        (fold) =>
          fold.testMetrics.netReturn,
      );

    const oosCompoundReturn =
      oosReturns.reduce(
        (
          compounded,
          value,
        ) =>
          compounded *
            (
              1 +
              value
            ),
        1,
      ) -
      1;

    const oosAverageReturn =
      oosReturns.reduce(
        (sum, value) =>
          sum + value,
        0,
      ) /
      oosReturns.length;

    const oosWorstDrawdown =
      Math.max(
        ...folds.map(
          (fold) =>
            fold.testMetrics.maxDrawdown,
        ),
      );

    const sharpeValues =
      folds
        .map(
          (fold) =>
            fold.testMetrics.sharpeRatio,
        )
        .filter(
          (
            value,
          ): value is number =>
            value !== null,
        );

    const oosAverageSharpe =
      sharpeValues.length >
      0
        ? sharpeValues.reduce(
            (sum, value) =>
              sum + value,
            0,
          ) /
          sharpeValues.length
        : null;

    const oosTotalTrades =
      folds.reduce(
        (
          sum,
          fold,
        ) =>
          sum +
          fold.testMetrics.tradeCount,
        0,
      );

    const weightedWins =
      folds.reduce(
        (
          sum,
          fold,
        ) => {
          const winRate =
            fold.testMetrics.winRate;

          if (
            winRate ===
            null
          ) {
            return sum;
          }

          return (
            sum +
            winRate *
              fold.testMetrics.tradeCount
          );
        },
        0,
      );

    const oosWeightedWinRate =
      oosTotalTrades >
      0
        ? weightedWins /
          oosTotalTrades
        : null;

    const selectedThresholds =
      folds.map(
        (fold) => ({
          foldNumber:
            fold.foldNumber,

          validation:
            `${fold.validationStart}~${fold.validationEnd}`,

          test:
            `${fold.testStart}~${fold.testEnd}`,

          threshold:
            fold.selectedThreshold,

          robustScore:
            fold.robustScore,
        }),
      );

    const {
      error: finishError,
    } =
      await supabase
        .from(
          "walk_forward_runs",
        )
        .update({
          status:
            "SUCCESS",

          finished_at:
            new Date()
              .toISOString(),

          fold_count:
            folds.length,

          oos_compound_return:
            round(
              oosCompoundReturn,
            ),

          oos_average_return:
            round(
              oosAverageReturn,
            ),

          oos_worst_drawdown:
            round(
              oosWorstDrawdown,
            ),

          oos_average_sharpe:
            oosAverageSharpe ===
            null
              ? null
              : round(
                  oosAverageSharpe,
                ),

          oos_total_trades:
            oosTotalTrades,

          oos_weighted_win_rate:
            oosWeightedWinRate ===
            null
              ? null
              : round(
                  oosWeightedWinRate,
                ),

          selected_thresholds:
            selectedThresholds,

          error_message:
            null,
        })
        .eq(
          "id",
          walkForwardRunId,
        );

    if (
      finishError
    ) {
      throw new Error(
        `Robust Walk-Forward 결과 저장 실패: ${finishError.message}`,
      );
    }

    return {
      walkForwardRunId,

      strategy:
        "ROBUST_THRESHOLD_WALK_FORWARD",

      version:
        "v4",

      status:
        "SUCCESS",

      datasetRange:
        range,

      validationYears,

      thresholdCandidates,

      foldCount:
        folds.length,

      oos: {
        compoundReturn:
          round(
            oosCompoundReturn,
          ),

        averageReturn:
          round(
            oosAverageReturn,
          ),

        worstDrawdown:
          round(
            oosWorstDrawdown,
          ),

        averageSharpe:
          oosAverageSharpe ===
          null
            ? null
            : round(
                oosAverageSharpe,
              ),

        totalTrades:
          oosTotalTrades,

        weightedWinRate:
          oosWeightedWinRate ===
          null
            ? null
            : round(
                oosWeightedWinRate,
              ),
      },

      selectedThresholds,

      folds,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Robust Walk-Forward 검증 중 오류";

    await supabase
      .from(
        "walk_forward_runs",
      )
      .update({
        status:
          "FAILED",

        finished_at:
          new Date()
            .toISOString(),

        error_message:
          message,
      })
      .eq(
        "id",
        walkForwardRunId,
      );

    throw error;
  }
}