import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  resolveSafePaperBuyExecution,
} from "@/lib/trading/resolve-safe-paper-buy-execution";


import {
  evaluatePaperExecutionRealismV2,
} from "@/lib/trading/paper-execution-realism-v2";
import {
  resolvePaperExecutionRealismV2MarketInput,
} from "@/lib/trading/resolve-paper-execution-realism-v2-market-input";
interface PaperOrderExecutionRecord {
  id: string;
  account_id: string;
  stock_code: string;
  side: string;
  status: string;
  approved_quantity: number | string | null;
  filled_quantity: number | string | null;
  entry_price: number | string | null;
  stop_price: number | string | null;
  reserved_risk_amount: number | string | null;
}

interface PaperAccountRecord {
  id: string;
  cash_balance: number | string | null;
  trading_mode: string;
}

interface PaperPositionRecord {
  stock_code: string;
  quantity: number | string | null;
  average_price: number | string | null;
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
    Number(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}

async function resolveCurrentPaperAccountEquity(
  accountId:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data:
      accountData,
    error:
      accountError,
  } =
    await supabase
      .from(
        "paper_accounts",
      )
      .select(
        "id,cash_balance,trading_mode",
      )
      .eq(
        "id",
        accountId,
      )
      .single();

  if (
    accountError ||
    !accountData
  ) {
    throw new Error(
      `PAPER_EXECUTION_ACCOUNT_READ_FAILED:${
        accountError
          ?.message ??
        accountId
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
      "PAPER_EXECUTION_REQUIRES_PAPER_ACCOUNT",
    );
  }

  const {
    data:
      positionData,
    error:
      positionError,
  } =
    await supabase
      .from(
        "paper_positions",
      )
      .select(
        "stock_code,quantity,average_price",
      )
      .eq(
        "account_id",
        accountId,
      );

  if (
    positionError
  ) {
    throw new Error(
      `PAPER_EXECUTION_POSITION_READ_FAILED:${positionError.message}`,
    );
  }

  const positions =
    (
      positionData ??
      []
    ) as
      PaperPositionRecord[];

  const stockCodes =
    [
      ...new Set(
        positions.map(
          (
            position,
          ) =>
            position.stock_code,
        ),
      ),
    ];

  const latestPriceByStock =
    new Map<
      string,
      number
    >();

  if (
    stockCodes.length >
    0
  ) {
    const {
      data:
        snapshotData,
      error:
        snapshotError,
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
        );

    if (
      snapshotError
    ) {
      throw new Error(
        `PAPER_EXECUTION_POSITION_SNAPSHOT_READ_FAILED:${snapshotError.message}`,
      );
    }

    for (
      const row of
        (
          snapshotData ??
          []
        ) as
          SnapshotRecord[]
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
          price,
        );
      }
    }
  }

  let investedAmount =
    0;

  for (
    const position of
      positions
  ) {
    const quantity =
      toNumber(
        position.quantity,
      );

    const price =
      latestPriceByStock.get(
        position.stock_code,
      ) ??
      toNumber(
        position.average_price,
      );

    investedAmount +=
      Math.max(
        0,
        quantity,
      ) *
      Math.max(
        0,
        price,
      );
  }

  return {
    account,

    accountEquity:
      Math.max(
        0,
        toNumber(
          account.cash_balance,
        ),
      ) +
      investedAmount,
  };
}

async function failUnsafePaperBuyExecution(
  input: {
    orderId: string;
    executionPrice:
      number |
      null;
    executionObservedAt:
      string |
      null;
    reason: string;
    riskSnapshot:
      unknown;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "paper_order_requests",
      )
      .update({
        status:
          "FAILED",

        execution_price:
          input.executionPrice,

        execution_price_observed_at:
          input.executionObservedAt,

        execution_price_source:
          "MARKET_SNAPSHOT_CLOSE",

        execution_rejection_reason:
          input.reason,

        execution_risk_snapshot:
          input.riskSnapshot,
      })
      .eq(
        "id",
        input.orderId,
      )
      .eq(
        "status",
        "RISK_APPROVED",
      )
      .select(
        "id,status,reserved_risk_amount,reserved_risk_released_at,reserved_risk_release_reason",
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `PAPER_EXECUTION_FAIL_TRANSITION_FAILED:${error.message}`,
    );
  }

  if (
    !data
  ) {
    throw new Error(
      "PAPER_EXECUTION_FAIL_TRANSITION_LOST_RACE",
    );
  }

  return data;
}

export async function executePaperOrder(
  orderId:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data:
      orderData,
    error:
      orderError,
  } =
    await supabase
      .from(
        "paper_order_requests",
      )
      .select(
        [
          "id",
          "account_id",
          "stock_code",
          "side",
          "status",
          "approved_quantity",
          "filled_quantity",
          "entry_price",
          "stop_price",
          "reserved_risk_amount",
        ].join(","),
      )
      .eq(
        "id",
        orderId,
      )
      .single();

  if (
    orderError ||
    !orderData
  ) {
    throw new Error(
      `PAPER_EXECUTION_ORDER_READ_FAILED:${
        orderError
          ?.message ??
        orderId
      }`,
    );
  }

  const order =
    orderData as
      PaperOrderExecutionRecord;

  if (
    order.side !==
    "BUY"
  ) {
    throw new Error(
      "PAPER_EXECUTION_BUY_ONLY",
    );
  }

  if (
    order.status !==
    "RISK_APPROVED"
  ) {
    throw new Error(
      `PAPER_EXECUTION_REQUIRES_RISK_APPROVED:${order.status}`,
    );
  }

  const quantity =
    toNumber(
      order.approved_quantity,
    );

  const plannedEntryPrice =
    toNumber(
      order.entry_price,
    );

  const stopPrice =
    toNumber(
      order.stop_price,
    );

  const reservedRiskAmount =
    toNumber(
      order.reserved_risk_amount,
    );

  if (
    !Number.isInteger(
      quantity,
    ) ||
    quantity <=
      0 ||
    plannedEntryPrice <=
      0 ||
    stopPrice <=
      0 ||
    reservedRiskAmount <
      0
  ) {
    throw new Error(
      "PAPER_EXECUTION_ORDER_RISK_FIELDS_INVALID",
    );
  }

  const {
    accountEquity,
  } =
    await resolveCurrentPaperAccountEquity(
      order.account_id,
    );

  if (
    accountEquity <=
    0
  ) {
    throw new Error(
      "PAPER_EXECUTION_ACCOUNT_EQUITY_INVALID",
    );
  }

  const safeExecution =
    await resolveSafePaperBuyExecution({
      stockCode:
        order.stock_code,

      plannedEntryPrice,

      stopPrice,

      quantity,

      accountEquity,

      reservedRiskAmount,
    });

  const realismRemainingQuantity =
    Math.max(
      0,
      Number(order.approved_quantity ?? 0) -
        Number((order as any).filled_quantity ?? 0),
    );

  if (realismRemainingQuantity <= 0) {
    throw new Error(
      "PAPER_EXECUTION_REALISM_V2_NO_REMAINING_QUANTITY",
    );
  }

  const realismMarketInput =
    await resolvePaperExecutionRealismV2MarketInput({
      supabase,
      stockCode: order.stock_code,
      observedAt: safeExecution.executionPriceObservedAt,
    });

  const realismDecision =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity:
        realismRemainingQuantity,
      referencePrice:
        safeExecution.executionPrice,
      now:
        safeExecution.executionPriceObservedAt,
      intervalVolume:
        realismMarketInput.intervalVolume,
    });

  if (
    !realismDecision.approved ||
    realismDecision.executionPrice === null ||
    realismDecision.filledQuantity <= 0
  ) {
    throw new Error(
      `PAPER_EXECUTION_REALISM_V2_BLOCKED:${realismDecision.blocker ?? "UNKNOWN"}`,
    );
  }


  if (
    !safeExecution.allowed ||
    safeExecution.executionPrice ===
      null ||
    !safeExecution.executionPriceObservedAt
  ) {
    const failedOrder =
      await failUnsafePaperBuyExecution({
        orderId:
          order.id,

        executionPrice:
          safeExecution.executionPrice,

        executionObservedAt:
          safeExecution.executionPriceObservedAt,

        reason:
          safeExecution.reason,

        riskSnapshot:
          safeExecution,
      });

    return {
      status:
        "PAPER_BUY_EXECUTION_BLOCKED",

      orderId:
        order.id,

      stockCode:
        order.stock_code,

      execution:
        safeExecution,

      order:
        failedOrder,
    };
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "execute_paper_buy_order_with_execution_price_v2",
      {
        p_order_id:
          order.id,

        p_execution_price: realismDecision.executionPrice,

        p_execution_observed_at:
          safeExecution.executionPriceObservedAt,
        p_fill_quantity:
          realismDecision.filledQuantity,
        p_broker_fee:
          realismDecision.brokerFee,
      },
    );

  if (
    error
  ) {
    throw new Error(
      `EXECUTE_PAPER_BUY_ORDER_WITH_EXECUTION_PRICE_FAILED:${error.message}`,
    );
  }

  return {
    status:
      "PAPER_BUY_EXECUTION_COMPLETE",

    orderId:
      order.id,

    stockCode:
      order.stock_code,

    execution:
      safeExecution,

    result:
      data,
  };
}
