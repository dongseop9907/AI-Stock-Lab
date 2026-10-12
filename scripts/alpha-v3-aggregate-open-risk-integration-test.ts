import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

import type {
  BuyRiskInput,
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_INTEGRATION_TEST_V2";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-aggregate-open-risk-integration-test.json",
  );

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
      (value + Number.EPSILON) *
        factor,
    ) / factor
  );
}

function hasIssue(
  result:
    ReturnType<typeof validateBuyRisk>,
  code:
    string,
): boolean {
  return result.issues.some(
    (issue) =>
      issue.code === code,
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

  const latestPriceByStock =
    new Map<
      string,
      {
        price: number;
        observedAt: string;
      }
    >();

  for (
    const row
    of snapshotRows
  ) {
    if (
      latestPriceByStock.has(
        row.stock_code,
      )
    ) {
      continue;
    }

    const price =
      toNumber(
        row.close_price,
      );

    if (
      price >
      0
    ) {
      latestPriceByStock.set(
        row.stock_code,
        {
          price,
          observedAt:
            row.observed_at,
        },
      );
    }
  }

  let currentInvestedAmount =
    0;

  let currentAggregateOpenRiskAmount =
    0;

  let openPositionsMissingValidStopCount =
    0;

  const positionRisk =
    positions.map(
      (position) => {
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

        const currentStopPrice =
          toNumber(
            position.current_stop_price,
          );

        const snapshot =
          latestPriceByStock.get(
            position.stock_code,
          );

        const currentPrice =
          snapshot?.price ??
          averagePrice;

        const marketValue =
          currentPrice *
          quantity;

        currentInvestedAmount +=
          marketValue;

        const validStop =
          quantity === 0 ||
          (
            averagePrice >
              0 &&
            currentStopPrice >
              0
          );

        if (
          quantity >
            0 &&
          !validStop
        ) {
          openPositionsMissingValidStopCount +=
            1;
        }

        const openRiskAmount =
          validStop
            ? Math.max(
                0,
                averagePrice -
                  currentStopPrice,
              ) *
              quantity
            : 0;

        currentAggregateOpenRiskAmount +=
          openRiskAmount;

        return {
          stockCode:
            position.stock_code,

          sector:
            position.sector,

          quantity,

          averagePrice,

          currentStopPrice,

          currentPrice,

          latestObservedAt:
            snapshot
              ?.observedAt ??
            null,

          marketValue:
            round(
              marketValue,
            ),

          openRiskAmount:
            round(
              openRiskAmount,
            ),

          stopRiskRateVsPositionCost:
            averagePrice >
              0
              ? round(
                  Math.max(
                    0,
                    averagePrice -
                      currentStopPrice,
                  ) /
                    averagePrice,
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

  const policyRate =
    DEFAULT_RISK_POLICY
      .maxAggregateOpenRiskRate ??
    0.02;

  const maxAggregateOpenRiskAmount =
    accountEquity *
    policyRate;

  const remainingAggregateOpenRiskAmount =
    Math.max(
      0,
      maxAggregateOpenRiskAmount -
        currentAggregateOpenRiskAmount,
    );

  const aggregateOpenRiskRate =
    accountEquity >
      0
      ? currentAggregateOpenRiskAmount /
        accountEquity
      : 0;

  const utilizationRate =
    maxAggregateOpenRiskAmount >
      0
      ? currentAggregateOpenRiskAmount /
        maxAggregateOpenRiskAmount
      : 0;

  const syntheticEntryPrice =
    accountEquity >
      0
      ? accountEquity *
        0.01
      : 10000;

  const syntheticStopPrice =
    syntheticEntryPrice *
    0.95;

  const baseSyntheticInput:
    BuyRiskInput = {
      stockCode:
        "AGGREGATE_TEST",

      entryPrice:
        syntheticEntryPrice,

      proposedStopPrice:
        syntheticStopPrice,

      requestedQuantity:
        10,

      accountEquity:
        Math.max(
          accountEquity,
          1,
        ),

      availableCash:
        Math.max(
          accountEquity,
          1,
        ),

      currentInvestedAmount:
        0,

      currentStockExposureAmount:
        0,

      currentSectorExposureAmount:
        0,

      currentAggregateOpenRiskAmount:
        0,

      openPositionsMissingValidStopCount:
        0,

      dailyRealizedPnl:
        0,

      openPositionCount:
        0,

      isNewPosition:
        true,

      tradingMode:
        "PAPER",

      modelStatus:
        "CANDIDATE",
    };

  const zeroBookSanity =
    validateBuyRisk(
      baseSyntheticInput,
    );

  const actualBookIntegration =
    validateBuyRisk({
      ...baseSyntheticInput,

      currentAggregateOpenRiskAmount,

      openPositionsMissingValidStopCount,

      openPositionCount:
        positions.length,
    });

  const existingBookWithinBudget =
    currentAggregateOpenRiskAmount <=
    maxAggregateOpenRiskAmount +
      1e-8;

  const allOpenPositionsHaveValidStop =
    openPositionsMissingValidStopCount ===
    0;

  const fullRiskAmount =
    accountEquity *
    DEFAULT_RISK_POLICY
      .maxRiskPerTradeRate;

  const remainingFullRiskTradeCapacity =
    fullRiskAmount >
      0
      ? Math.floor(
          (
            remainingAggregateOpenRiskAmount /
            fullRiskAmount
          ) +
            1e-12,
        )
      : 0;

  const checks = {
    policyIsTwoPercent:
      Math.abs(
        policyRate -
          0.02,
      ) <
      1e-12,

    accountIsPaper:
      account.trading_mode ===
      "PAPER",

    aggregateCalculationFinite:
      Number.isFinite(
        currentAggregateOpenRiskAmount,
      ) &&
      currentAggregateOpenRiskAmount >=
        0,

    allOpenPositionsHaveValidStop,

    zeroBookFullRiskTradeApproved:
      zeroBookSanity.approved ===
      true,

    actualBookAggregateEnforced:
      existingBookWithinBudget
        ? (
            actualBookIntegration
              .maxAllowedQuantity <=
            10
          )
        : (
            actualBookIntegration
              .approved ===
              false &&
            hasIssue(
              actualBookIntegration,
              "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
            )
          ),
  };

  const integrationPassed =
    checks.policyIsTwoPercent &&
    checks.accountIsPaper &&
    checks.aggregateCalculationFinite &&
    checks.allOpenPositionsHaveValidStop &&
    checks.zeroBookFullRiskTradeApproved &&
    checks.actualBookAggregateEnforced;

  const report = {
    status:
      "ALPHA_V3_AGGREGATE_OPEN_RISK_INTEGRATION_TEST_COMPLETE",

    version:
      VERSION,

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

      dailyRealizedPnl:
        round(
          toNumber(
            account.daily_realized_pnl,
          ),
        ),
    },

    positions: {
      count:
        positions.length,

      missingValidStopCount:
        openPositionsMissingValidStopCount,

      risk:
        positionRisk,
    },

    aggregateOpenRisk: {
      policyRate,

      maxAmount:
        round(
          maxAggregateOpenRiskAmount,
        ),

      currentAmount:
        round(
          currentAggregateOpenRiskAmount,
        ),

      currentRate:
        round(
          aggregateOpenRiskRate,
        ),

      utilizationRate:
        round(
          utilizationRate,
        ),

      remainingAmount:
        round(
          remainingAggregateOpenRiskAmount,
        ),

      existingBookWithinBudget,

      remainingFullRiskTradeCapacity,
    },

    validatorIntegration: {
      syntheticContract: {
        positionRate:
          0.1,

        stopDistanceRate:
          0.05,

        accountRiskRate:
          0.005,
      },

      zeroBookSanity: {
        approved:
          zeroBookSanity.approved,

        maxAllowedQuantity:
          zeroBookSanity
            .maxAllowedQuantity,

        issues:
          zeroBookSanity
            .issues,
      },

      actualBook: {
        approved:
          actualBookIntegration
            .approved,

        maxAllowedQuantity:
          actualBookIntegration
            .maxAllowedQuantity,

        aggregateLimitIssue:
          hasIssue(
            actualBookIntegration,
            "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
          ),

        missingStopIssue:
          hasIssue(
            actualBookIntegration,
            "OPEN_POSITION_STOP_MISSING",
          ),

        issues:
          actualBookIntegration
            .issues,
      },
    },

    checks,

    decision: {
      integrationPassed,

      existingBookWithinBudget,

      allOpenPositionsHaveValidStop,

      productionPolicyChangedByTest:
        false,

      nextUse:
        !allOpenPositionsHaveValidStop
          ? "REPAIR_EXISTING_POSITION_STOPS"
          : !existingBookWithinBudget
            ? "REVIEW_EXISTING_BOOK_AGGREGATE_OPEN_RISK"
            : integrationPassed
              ? "RUN_RISK_V3_POST_IMPLEMENTATION_STRESS_TEST"
              : "REVIEW_AGGREGATE_OPEN_RISK_INTEGRATION_FAILURE",
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
      !allOpenPositionsHaveValidStop
        ? "REPAIR_EXISTING_POSITION_STOPS"
        : !existingBookWithinBudget
          ? "REVIEW_EXISTING_BOOK_AGGREGATE_OPEN_RISK"
          : integrationPassed
            ? "RUN_RISK_V3_POST_IMPLEMENTATION_STRESS_TEST"
            : "REVIEW_AGGREGATE_OPEN_RISK_INTEGRATION_FAILURE",

    outputFile:
      "logs/alpha-v3-aggregate-open-risk-integration-test.json",
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
      report,
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
            "ALPHA_V3_AGGREGATE_OPEN_RISK_INTEGRATION_TEST_FAILED",

          version:
            VERSION,

          error:
            error instanceof Error
              ? error.message
              : String(error),

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
            "REVIEW_AGGREGATE_OPEN_RISK_INTEGRATION_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
