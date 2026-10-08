import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  resolveOrderModel,
} from "@/lib/models/resolve-order-model";

import {
  validateBuyRisk,
} from "@/lib/trading/risk-manager";

import type {
  BuyRiskInput,
  BuyRiskResult,
} from "@/lib/trading/types";

export interface ReadOnlyBuyRiskPreflightInput {
  stockCode: string;
  modelId: string;

  entryPrice: number;
  proposedStopPrice: number;
  requestedQuantity: number;

  entryObservedAt?: string | null;
}

interface PaperAccountRecord {
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

interface StockRecord {
  stock_code: string;
  stock_name: string;
  sector: string | null;
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

function validatePreflightRequest(
  input:
    ReadOnlyBuyRiskPreflightInput,
) {
  if (
    !input.stockCode
      ?.trim()
  ) {
    throw new Error(
      "PREFLIGHT_STOCK_CODE_REQUIRED",
    );
  }

  if (
    !input.modelId
      ?.trim()
  ) {
    throw new Error(
      "PREFLIGHT_MODEL_ID_REQUIRED",
    );
  }

  if (
    !Number.isFinite(
      input.entryPrice,
    ) ||
    input.entryPrice <=
      0
  ) {
    throw new Error(
      "PREFLIGHT_ENTRY_PRICE_INVALID",
    );
  }

  if (
    !Number.isFinite(
      input.proposedStopPrice,
    ) ||
    input.proposedStopPrice <=
      0
  ) {
    throw new Error(
      "PREFLIGHT_STOP_PRICE_INVALID",
    );
  }

  if (
    !Number.isInteger(
      input.requestedQuantity,
    ) ||
    input.requestedQuantity <=
      0
  ) {
    throw new Error(
      "PREFLIGHT_QUANTITY_INVALID",
    );
  }
}

export async function evaluateReadOnlyBuyRiskPreflight(
  input:
    ReadOnlyBuyRiskPreflightInput,
) {
  validatePreflightRequest(
    input,
  );

  const supabase =
    createSupabaseServerClient();

  const {
    data: accountData,
    error: accountError,
  } =
    await supabase
      .from(
        "paper_accounts",
      )
      .select(`
        id,
        cash_balance,
        daily_realized_pnl,
        trading_mode
      `)
      .eq(
        "account_name",
        "default-paper",
      )
      .single();

  if (
    accountError ||
    !accountData
  ) {
    throw new Error(
      `PREFLIGHT_ACCOUNT_READ_FAILED:${
        accountError
          ?.message ??
        "ACCOUNT_NOT_FOUND"
      }`,
    );
  }

  const account =
    accountData as
      PaperAccountRecord;

  if (
    account.trading_mode !==
    "PAPER"
  ) {
    throw new Error(
      "PREFLIGHT_REQUIRES_PAPER_ACCOUNT",
    );
  }

  const orderModel =
    await resolveOrderModel(
      input.modelId,
      account.trading_mode,
    );

  const {
    data: stockData,
    error: stockError,
  } =
    await supabase
      .from(
        "stocks",
      )
      .select(
        "stock_code, stock_name, sector",
      )
      .eq(
        "stock_code",
        input.stockCode,
      )
      .eq(
        "is_active",
        true,
      )
      .single();

  if (
    stockError ||
    !stockData
  ) {
    throw new Error(
      `PREFLIGHT_STOCK_READ_FAILED:${
        stockError
          ?.message ??
        input.stockCode
      }`,
    );
  }

  const stock =
    stockData as
      StockRecord;

  /*
   * Read the latest target price only for drift diagnostics.
   * The actual validator uses the Entry Timing candidate's entryPrice,
   * preserving the exact proposed trade being preflighted.
   */
  const {
    data:
      targetSnapshots,
    error:
      targetPriceError,
  } =
    await supabase
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code, close_price, observed_at",
      )
      .eq(
        "stock_code",
        input.stockCode,
      )
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(1);

  if (
    targetPriceError
  ) {
    throw new Error(
      `PREFLIGHT_TARGET_PRICE_READ_FAILED:${targetPriceError.message}`,
    );
  }

  const latestTargetSnapshot =
    (
      targetSnapshots?.[0] ??
      null
    ) as
      SnapshotRecord |
      null;

  const latestMarketPrice =
    toNumber(
      latestTargetSnapshot
        ?.close_price,
    );

  const {
    data: positionData,
    error: positionError,
  } =
    await supabase
      .from(
        "paper_positions",
      )
      .select(`
        stock_code,
        sector,
        quantity,
        average_price,
        current_stop_price
      `)
      .eq(
        "account_id",
        account.id,
      );

  if (
    positionError
  ) {
    throw new Error(
      `PREFLIGHT_POSITION_READ_FAILED:${positionError.message}`,
    );
  }

  const positions =
    (
      positionData ??
      []
    ) as
      PositionRecord[];

  const positionCodes =
    [
      ...new Set(
        positions.map(
          (
            position,
          ) =>
            position
              .stock_code,
        ),
      ),
    ];

  let snapshotRows:
    SnapshotRecord[] =
    [];

  if (
    positionCodes.length >
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
          "stock_code, close_price, observed_at",
        )
        .in(
          "stock_code",
          positionCodes,
        )
        .order(
          "observed_at",
          {
            ascending:
              false,
          },
        );

    if (error) {
      throw new Error(
        `PREFLIGHT_POSITION_PRICE_READ_FAILED:${error.message}`,
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
      number
    >();

  for (
    const snapshot
    of snapshotRows
  ) {
    if (
      latestPriceByStock
        .has(
          snapshot
            .stock_code,
        )
    ) {
      continue;
    }

    const price =
      toNumber(
        snapshot
          .close_price,
      );

    if (
      price >
      0
    ) {
      latestPriceByStock
        .set(
          snapshot
            .stock_code,
          price,
        );
    }
  }

  let currentInvestedAmount =
    0;

  let currentStockExposureAmount =
    0;

  let currentSectorExposureAmount =
    0;

  let currentAggregateOpenRiskAmount =
    0;

  let openPositionsMissingValidStopCount =
    0;

  for (
    const position
    of positions
  ) {
    const currentPrice =
      latestPriceByStock
        .get(
          position
            .stock_code,
        ) ??
      toNumber(
        position
          .average_price,
      );

    const positionValue =
      currentPrice *
      position.quantity;

    const averagePrice =
      toNumber(
        position.average_price,
      );

    const currentStopPrice =
      toNumber(
        position.current_stop_price,
      );

    if (
      position.quantity > 0 &&
      averagePrice > 0 &&
      currentStopPrice > 0
    ) {
      currentAggregateOpenRiskAmount +=
        Math.max(
          0,
          averagePrice - currentStopPrice,
        ) *
        position.quantity;
    } else if (
      position.quantity > 0
    ) {
      openPositionsMissingValidStopCount +=
        1;
    }

    currentInvestedAmount +=
      positionValue;

    if (
      position.stock_code ===
      input.stockCode
    ) {
      currentStockExposureAmount +=
        positionValue;
    }

    if (
      stock.sector &&
      position.sector ===
        stock.sector
    ) {
      currentSectorExposureAmount +=
        positionValue;
    }
  }

  const cashBalance =
    toNumber(
      account
        .cash_balance,
    );

  const accountEquity =
    cashBalance +
    currentInvestedAmount;

  const existingPosition =
    positions.find(
      (
        position,
      ) =>
        position.stock_code ===
        input.stockCode,
    );

  const riskInput:
    BuyRiskInput =
    {
      stockCode:
        input.stockCode,

      entryPrice:
        input.entryPrice,

      proposedStopPrice:
        input.proposedStopPrice,

      requestedQuantity:
        input.requestedQuantity,

      accountEquity,
      availableCash:
        cashBalance,

      currentInvestedAmount,
      currentStockExposureAmount,
      currentSectorExposureAmount,
      currentAggregateOpenRiskAmount,
      openPositionsMissingValidStopCount,

      dailyRealizedPnl:
        toNumber(
          account
            .daily_realized_pnl,
        ),

      openPositionCount:
        positions.length,

      isNewPosition:
        !existingPosition,

      tradingMode:
        account
          .trading_mode,

      modelStatus:
        orderModel.status,
    };

  const riskResult:
    BuyRiskResult =
    validateBuyRisk(
      riskInput,
    );

  const marketPriceDifference =
    latestMarketPrice >
      0
      ? latestMarketPrice -
        input.entryPrice
      : null;

  const marketPriceDifferenceRate =
    latestMarketPrice >
      0 &&
    input.entryPrice >
      0
      ? (
          latestMarketPrice -
          input.entryPrice
        ) /
        input.entryPrice
      : null;

  const priceDriftWarnings:
    string[] =
    [];

  if (
    latestMarketPrice >
      0 &&
    latestMarketPrice !==
      input.entryPrice
  ) {
    priceDriftWarnings.push(
      "ENTRY_PRICE_DIFFERS_FROM_LATEST_SNAPSHOT",
    );
  }

  if (
    input.entryObservedAt &&
    latestTargetSnapshot
      ?.observed_at &&
    new Date(
      latestTargetSnapshot
        .observed_at,
    ).getTime() >
      new Date(
        input.entryObservedAt,
      ).getTime()
  ) {
    priceDriftWarnings.push(
      "NEWER_MARKET_SNAPSHOT_EXISTS_AFTER_ENTRY_CANDIDATE",
    );
  }

  return {
    status:
      "READ_ONLY_BUY_RISK_PREFLIGHT_COMPLETE",

    input: {
      stockCode:
        input.stockCode,

      modelId:
        input.modelId,

      entryPrice:
        input.entryPrice,

      proposedStopPrice:
        input.proposedStopPrice,

      requestedQuantity:
        input.requestedQuantity,

      entryObservedAt:
        input
          .entryObservedAt ??
        null,
    },

    resolved: {
      accountId:
        account.id,

      tradingMode:
        account
          .trading_mode,

      modelStatus:
        orderModel.status,

      stockName:
        stock.stock_name,

      sector:
        stock.sector,

      latestMarketPrice:
        latestMarketPrice >
          0
          ? latestMarketPrice
          : null,

      latestMarketObservedAt:
        latestTargetSnapshot
          ?.observed_at ??
        null,

      marketPriceDifference,
      marketPriceDifferenceRate,

      priceDriftWarnings,
    },

    accountSnapshot: {
      accountEquity,
      availableCash:
        cashBalance,

      currentInvestedAmount,
      currentStockExposureAmount,
      currentSectorExposureAmount,
      currentAggregateOpenRiskAmount,
      openPositionsMissingValidStopCount,

      dailyRealizedPnl:
        toNumber(
          account
            .daily_realized_pnl,
        ),

      openPositionCount:
        positions.length,

      isNewPosition:
        !existingPosition,
    },

    riskInput,
    risk:
      riskResult,

    approved:
      riskResult
        .approved,

    executionEligible:
      riskResult
        .approved &&
      priceDriftWarnings
        .length ===
        0,

    executionBlockers: [
      ...(
        riskResult
          .approved
          ? []
          : riskResult
              .issues
              .map(
                (
                  issue,
                ) =>
                  `RISK:${issue.code}`,
              )
      ),

      ...priceDriftWarnings,
    ],

    safety: {
      databaseWrites:
        0,

      riskDecisionWrites:
        0,

      entrySignalWrites:
        0,

      orderWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };
}
