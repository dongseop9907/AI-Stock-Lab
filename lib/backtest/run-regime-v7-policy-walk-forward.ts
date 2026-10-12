import {
  runDailyRegimeV7Backtest,
} from "@/lib/backtest/run-daily-regime-v7-backtest";

import {
  MARKET_REGIME_V7_POLICY_CANDIDATES,
  type MarketRegimeV7Policy,
} from "@/lib/market/market-regime-v7-policy";

interface BacktestMetrics {
  runId: string;
  policy: MarketRegimeV7Policy;

  startDate: string;
  endDate: string;

  entryThreshold: number;

  tradeCount: number;
  winRate: number;
  netReturn: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;

  blockedV7Candidates: number;
  v7BlockedTradingDays: number;
  v7MissingFeatureDays: number;
}

interface ValidationScore {
  policy: MarketRegimeV7Policy;

  eligible: boolean;

  validationYears:
    Array<{
      year: number;
      metrics: BacktestMetrics;
      score: number;
    }>;

  meanScore: number;
  worstScore: number;
  robustScore: number;
}

interface FoldDefinition {
  fold: number;

  validationYears: number[];

  testYear: number;

  validationThreshold: number;
  testThreshold: number;

  testEndDate?: string;
}

export interface RunRegimeV7PolicyWalkForwardInput {
  stockCodes?: string[];

  initialCash?: number;

  stopDistanceRate?: number;

  feeRate?: number;
  taxRate?: number;
  slippageRate?: number;

  maxPositions?: number;
  maxPositionRate?: number;

  maxHoldingDays?: number;

  minValidationTradesPerYear?: number;
}

const DEFAULT_STOCK_CODES = [
  "000660",
  "005380",
  "005930",
  "035420",
  "035720",
];

const FOLDS:
  FoldDefinition[] = [
    {
      fold: 1,

      validationYears: [
        2024,
      ],

      testYear: 2025,

      validationThreshold:
        0.78,

      testThreshold:
        0.78,
    },

    {
      fold: 2,

      validationYears: [
        2024,
        2025,
      ],

      testYear: 2026,

      validationThreshold:
        0.78,

      testThreshold:
        0.70,

      testEndDate:
        "2026-07-31",
    },
  ];

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

/*
 * Score used only for policy selection on validation data.
 *
 * Higher is better:
 * - return
 * - Sharpe
 * - profit factor
 * - win rate
 *
 * Lower is better:
 * - drawdown
 *
 * The score is intentionally simple and fixed before test-year evaluation.
 */
function calculateValidationYearScore(
  metrics:
    BacktestMetrics,
): number {
  const returnComponent =
    clamp(
      metrics.netReturn,
      -0.50,
      0.50,
    );

  const sharpeComponent =
    clamp(
      metrics.sharpeRatio,
      -2,
      2,
    ) /
    2;

  const profitFactorComponent =
    clamp(
      metrics.profitFactor -
        1,
      -1,
      1,
    );

  const drawdownPenalty =
    clamp(
      metrics.maxDrawdown,
      0,
      0.60,
    );

  const winRateComponent =
    clamp(
      metrics.winRate,
      0,
      1,
    );

  return (
    0.35 *
      returnComponent +
    0.20 *
      sharpeComponent +
    0.20 *
      profitFactorComponent -
    0.20 *
      drawdownPenalty +
    0.05 *
      winRateComponent
  );
}

function yearStart(
  year: number,
) {
  return (
    `${year}-01-01`
  );
}

function yearEnd(
  year: number,
) {
  return (
    `${year}-12-31`
  );
}

function toMetrics(
  policy:
    MarketRegimeV7Policy,

  startDate: string,
  endDate: string,

  entryThreshold: number,

  result: Awaited<
    ReturnType<
      typeof runDailyRegimeV7Backtest
    >
  >,
): BacktestMetrics {
  return {
    runId:
      result.runId,

    policy,

    startDate,
    endDate,

    entryThreshold,

    tradeCount:
      result.tradeCount,

    /*
     * The backtest runner returns nullable metrics when a metric
     * cannot be calculated. Walk-forward selection needs stable
     * numeric values, so normalize them here.
     *
     * - winRate/sharpe: unavailable -> 0
     * - profitFactor: if there are trades but no losing trades,
     *   treat it as the capped "excellent" value 2.0 because the
     *   validation score caps PF contribution at PF >= 2 anyway.
     *   Otherwise unavailable -> 0.
     */
    winRate:
      result.winRate ??
      0,

    netReturn:
      result.netReturn,

    profitFactor:
      result.profitFactor ??
      (
        result.tradeCount > 0 &&
        result.losingTrades === 0
          ? 2
          : 0
      ),

    maxDrawdown:
      result.maxDrawdown,

    sharpeRatio:
      result.sharpeRatio ??
      0,

    blockedV7Candidates:
      result.blockedV7Candidates,

    v7BlockedTradingDays:
      result.v7BlockedTradingDays,

    v7MissingFeatureDays:
      result.v7MissingFeatureDays,
  };
}

function compoundReturns(
  returns: number[],
) {
  return (
    returns.reduce(
      (
        equityMultiplier,
        value,
      ) =>
        equityMultiplier *
        (
          1 +
          value
        ),
      1,
    ) -
    1
  );
}

export async function runRegimeV7PolicyWalkForward(
  input:
    RunRegimeV7PolicyWalkForwardInput = {},
) {
  const stockCodes =
    input.stockCodes &&
    input.stockCodes.length >
      0
      ? [
          ...new Set(
            input.stockCodes
              .map(
                (value) =>
                  value.trim(),
              )
              .filter(Boolean),
          ),
        ]
      : DEFAULT_STOCK_CODES;

  const initialCash =
    input.initialCash ??
    10_000_000;

  const stopDistanceRate =
    input.stopDistanceRate ??
    0.025;

  const feeRate =
    input.feeRate ??
    0.00015;

  const taxRate =
    input.taxRate ??
    0.0015;

  const slippageRate =
    input.slippageRate ??
    0.0005;

  const maxPositions =
    input.maxPositions ??
    3;

  const maxPositionRate =
    input.maxPositionRate ??
    0.20;

  const maxHoldingDays =
    input.maxHoldingDays ??
    10;

  const minValidationTradesPerYear =
    Math.max(
      10,
      Math.floor(
        input
          .minValidationTradesPerYear ??
        20,
      ),
    );

  const foldResults:
    Array<{
      fold: number;

      validationYears:
        number[];

      testYear: number;

      selectedPolicy:
        MarketRegimeV7Policy;

      validationRanking:
        ValidationScore[];

      test:
        BacktestMetrics;
    }> = [];

  /*
   * Cache validation runs because Fold 2 reuses 2024.
   */
  const validationCache =
    new Map<
      string,
      BacktestMetrics
    >();

  async function runOne(
    policy:
      MarketRegimeV7Policy,

    year: number,

    entryThreshold: number,

    endDateOverride?:
      string,
  ) {
    const cacheKey =
      [
        policy,
        year,
        entryThreshold,
        endDateOverride ??
          "",
      ].join("|");

    const cached =
      validationCache.get(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    const startDate =
      yearStart(
        year,
      );

    const endDate =
      endDateOverride ??
      yearEnd(
        year,
      );

    const result =
      await runDailyRegimeV7Backtest({
        startDate,
        endDate,

        stockCodes,

        initialCash,

        entryThreshold,
        stopDistanceRate,

        feeRate,
        taxRate,
        slippageRate,

        maxPositions,
        maxPositionRate,

        maxHoldingDays,

        v7Policy:
          policy,
      });

    const metrics =
      toMetrics(
        policy,
        startDate,
        endDate,
        entryThreshold,
        result,
      );

    validationCache.set(
      cacheKey,
      metrics,
    );

    return metrics;
  }

  for (
    const fold
    of FOLDS
  ) {
    const validationRanking:
      ValidationScore[] =
        [];

    for (
      const policy
      of
      MARKET_REGIME_V7_POLICY_CANDIDATES
    ) {
      const yearly:
        ValidationScore[
          "validationYears"
        ] = [];

      for (
        const validationYear
        of fold.validationYears
      ) {
        const metrics =
          await runOne(
            policy,
            validationYear,
            fold
              .validationThreshold,
          );

        yearly.push({
          year:
            validationYear,

          metrics,

          score:
            calculateValidationYearScore(
              metrics,
            ),
        });
      }

      const eligible =
        yearly.every(
          (item) =>
            item.metrics
              .tradeCount >=
            minValidationTradesPerYear,
        );

      const scores =
        yearly.map(
          (item) =>
            item.score,
        );

      const meanScore =
        scores.reduce(
          (
            sum,
            value,
          ) =>
            sum +
            value,
          0,
        ) /
        scores.length;

      const worstScore =
        Math.min(
          ...scores,
        );

      /*
       * Same philosophy as the earlier robust walk-forward:
       * reward average quality while strongly respecting
       * the worst validation year.
       */
      const robustScore =
        eligible
          ? (
              0.60 *
                meanScore +
              0.40 *
                worstScore
            )
          : Number
              .NEGATIVE_INFINITY;

      validationRanking.push({
        policy,

        eligible,

        validationYears:
          yearly,

        meanScore,
        worstScore,
        robustScore,
      });
    }

    validationRanking.sort(
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

        /*
         * Deterministic tie-break:
         * prefer the simpler / less restrictive policy
         * by original candidate order.
         */
        return (
          MARKET_REGIME_V7_POLICY_CANDIDATES
            .indexOf(
              left.policy,
            ) -
          MARKET_REGIME_V7_POLICY_CANDIDATES
            .indexOf(
              right.policy,
            )
        );
      },
    );

    const selected =
      validationRanking.find(
        (item) =>
          item.eligible,
      );

    if (!selected) {
      throw new Error(
        `NO_ELIGIBLE_POLICY_FOR_FOLD_${fold.fold}`,
      );
    }

    /*
     * The test year is touched only after policy selection.
     */
    const testMetrics =
      await runOne(
        selected.policy,
        fold.testYear,
        fold.testThreshold,
        fold.testEndDate,
      );

    foldResults.push({
      fold:
        fold.fold,

      validationYears:
        fold.validationYears,

      testYear:
        fold.testYear,

      selectedPolicy:
        selected.policy,

      validationRanking,

      test:
        testMetrics,
    });
  }

  const testReturns =
    foldResults.map(
      (fold) =>
        fold.test
          .netReturn,
    );

  const totalTrades =
    foldResults.reduce(
      (
        sum,
        fold,
      ) =>
        sum +
        fold.test
          .tradeCount,
      0,
    );

  const weightedWinRate =
    totalTrades > 0
      ? (
          foldResults.reduce(
            (
              sum,
              fold,
            ) =>
              sum +
              fold.test
                .winRate *
              fold.test
                .tradeCount,
            0,
          ) /
          totalTrades
        )
      : 0;

  return {
    mode:
      "RETROSPECTIVE_POLICY_WALK_FORWARD_V7_2",

    productionApplied:
      false,

    cleanOos:
      false,

    warning:
      "The policy family was discovered using 2024-2026 data, so these folds are a retrospective robustness check, not fully independent OOS evidence. Production blocking must still wait for genuinely unseen historical years or forward shadow/paper observations.",

    selectionMethod: {
      candidatePolicies:
        MARKET_REGIME_V7_POLICY_CANDIDATES,

      minValidationTradesPerYear,

      yearlyScore:
        "0.35*return + 0.20*(Sharpe/2) + 0.20*(PF-1) - 0.20*MDD + 0.05*winRate, with fixed clamping",

      robustScore:
        "0.60*meanYearScore + 0.40*worstYearScore",

      tieBreak:
        "prefer simpler policy by candidate order",
    },

    commonParameters: {
      stockCodes,
      initialCash,

      stopDistanceRate,

      feeRate,
      taxRate,
      slippageRate,

      maxPositions,
      maxPositionRate,

      maxHoldingDays,
    },

    folds:
      foldResults,

    aggregateTest: {
      foldCount:
        foldResults.length,

      compoundNetReturn:
        compoundReturns(
          testReturns,
        ),

      averageNetReturn:
        testReturns.reduce(
          (
            sum,
            value,
          ) =>
            sum +
            value,
          0,
        ) /
        testReturns.length,

      totalTrades,

      weightedWinRate,

      worstMaxDrawdown:
        Math.max(
          ...foldResults.map(
            (fold) =>
              fold.test
                .maxDrawdown,
          ),
        ),

      averageSharpe:
        foldResults.reduce(
          (
            sum,
            fold,
          ) =>
            sum +
            fold.test
              .sharpeRatio,
          0,
        ) /
        foldResults.length,
    },
  };
}
