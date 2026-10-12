import { runDailyBacktest } from "@/lib/backtest/run-daily-backtest";
import { createSupabaseServerClient } from "@/lib/supabase";

interface RunWalkForwardInput {
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
}

interface CandidateResult {
  threshold: number;

  backtestRunId: string;

  score: number;

  tradeCount: number;

  winRate: number | null;

  netReturn: number;

  benchmarkReturn: number | null;
  excessReturn: number | null;

  profitFactor: number | null;

  maxDrawdown: number;

  sharpeRatio: number | null;
}

interface FoldSummary {
  foldNumber: number;

  validationStart: string;
  validationEnd: string;

  testStart: string;
  testEnd: string;

  selectedThreshold: number;

  validationScore: number;

  validationMetrics: CandidateResult;

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

  candidateResults: CandidateResult[];
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

function endOfYear(
  year: number,
): string {
  return `${year}-12-31`;
}

function startOfYear(
  year: number,
): string {
  return `${year}-01-01`;
}

/*
 * validation에서만 파라미터를 고른다.
 *
 * 단순 수익률만 최대화하면
 * 과도한 위험을 택하기 쉬워서
 * drawdown을 강하게 패널티한다.
 *
 * test 결과는 이 점수 계산에 절대 사용하지 않는다.
 */
function calculateValidationScore(
  result: {
    tradeCount: number;

    netReturn: number;

    profitFactor: number | null;

    maxDrawdown: number;

    sharpeRatio: number | null;
  },
): number {
  const sharpe =
    result.sharpeRatio ??
    0;

  const profitFactor =
    result.profitFactor ??
    0;

  const profitFactorTerm =
    Math.log(
      Math.max(
        profitFactor,
        0.2,
      ),
    );

  let score =
    result.netReturn -
    result.maxDrawdown *
      1.25 +
    sharpe *
      0.05 +
    profitFactorTerm *
      0.03;

  /*
   * 거래가 너무 적으면
   * 우연한 몇 건에 의해 선택되는 것을 방지한다.
   */
  if (
    result.tradeCount <
    20
  ) {
    score -=
      0.25;
  }

  return round(
    score,
  );
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
      "WALK_FORWARD_DATASET_NOT_FOUND",
    );
  }

  return {
    earliest:
      String(earliest),

    latest:
      String(latest),
  };
}

function buildCandidateResult(
  threshold: number,
  result:
    Awaited<
      ReturnType<
        typeof runDailyBacktest
      >
    >,
): CandidateResult {
  const tradeCount =
    toNumber(
      result.tradeCount,
    );

  const netReturn =
    toNumber(
      result.netReturn,
    );

  const maxDrawdown =
    toNumber(
      result.maxDrawdown,
    );

  const profitFactor =
    toNullableNumber(
      result.profitFactor,
    );

  const sharpeRatio =
    toNullableNumber(
      result.sharpeRatio,
    );

  return {
    threshold,

    backtestRunId:
      String(
        result.runId,
      ),

    score:
      calculateValidationScore({
        tradeCount,

        netReturn,

        profitFactor,

        maxDrawdown,

        sharpeRatio,
      }),

    tradeCount,

    winRate:
      toNullableNumber(
        result.winRate,
      ),

    netReturn,

    benchmarkReturn:
      toNullableNumber(
        result.benchmarkReturn,
      ),

    excessReturn:
      toNullableNumber(
        result.excessReturn,
      ),

    profitFactor,

    maxDrawdown,

    sharpeRatio,
  };
}

export async function runWalkForwardValidation(
  input:
    RunWalkForwardInput = {},
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

  if (
    startYear >=
    latestYear
  ) {
    throw new Error(
      "Walk-Forward 검증을 위해 최소 2개 연도의 데이터가 필요합니다.",
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
          "ENTRY_THRESHOLD_WALK_FORWARD",

        strategy_version:
          "v3",

        status:
          "RUNNING",

        config: {
          stockCodes,

          datasetRange:
            range,

          startYear,

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
            "VALIDATION_ONLY",

          testUsedForSelection:
            false,

          validationScore:
            "netReturn - 1.25*maxDrawdown + 0.05*sharpe + 0.03*ln(profitFactor), tradeCount<20 penalty",
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
      `Walk-Forward 실행 생성 실패: ${
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
    FoldSummary[] = [];

  try {
    let foldNumber =
      0;

    for (
      let validationYear =
        startYear;
      validationYear <
      latestYear;
      validationYear += 1
    ) {
      const testYear =
        validationYear + 1;

      const validationStart =
        startOfYear(
          validationYear,
        );

      const validationEnd =
        endOfYear(
          validationYear,
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

      /*
       * ---------------------------------------------
       * VALIDATION
       *
       * 후보 threshold를 전부 이전 연도에서만 평가.
       * ---------------------------------------------
       */
      const candidateResults:
        CandidateResult[] =
        [];

      for (
        const threshold
        of thresholdCandidates
      ) {
        const validationResult =
          await runDailyBacktest({
            startDate:
              validationStart,

            endDate:
              validationEnd,

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

        candidateResults.push(
          buildCandidateResult(
            threshold,
            validationResult,
          ),
        );
      }

      candidateResults.sort(
        (
          left,
          right,
        ) => {
          if (
            right.score !==
            left.score
          ) {
            return (
              right.score -
              left.score
            );
          }

          if (
            right.netReturn !==
            left.netReturn
          ) {
            return (
              right.netReturn -
              left.netReturn
            );
          }

          return (
            left.maxDrawdown -
            right.maxDrawdown
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

      /*
       * ---------------------------------------------
       * TEST / OOS
       *
       * 선택된 threshold를 다음 연도에 딱 한 번 적용.
       *
       * test 결과는 threshold 선택에 사용하지 않는다.
       * ---------------------------------------------
       */
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

      const fold: FoldSummary = {
        foldNumber,

        validationStart,
        validationEnd,

        testStart,
        testEnd,

        selectedThreshold:
          selected.threshold,

        validationScore:
          selected.score,

        validationMetrics:
          selected,

        testMetrics,

        candidateResults,
      };

      folds.push(
        fold,
      );

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
              selected.score,

            validation_backtest_run_id:
              selected.backtestRunId,

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
        "생성된 Walk-Forward fold가 없습니다.",
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
            fold.testMetrics
              .winRate;

          if (
            winRate ===
            null
          ) {
            return sum;
          }

          return (
            sum +
            winRate *
              fold.testMetrics
                .tradeCount
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
        `Walk-Forward 결과 저장 실패: ${finishError.message}`,
      );
    }

    return {
      walkForwardRunId,

      strategy:
        "ENTRY_THRESHOLD_WALK_FORWARD",

      version:
        "v3",

      status:
        "SUCCESS",

      datasetRange:
        range,

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
        : "Walk-Forward 검증 중 오류";

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