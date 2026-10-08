import { resolveOrderModel } from "@/lib/models/resolve-order-model";
import { createSupabaseServerClient } from "@/lib/supabase";
import { createPaperBuyOrderWithCommittedRisk } from "@/lib/trading/committed-risk-reservation";
import { validateBuyRisk } from "@/lib/trading/risk-manager";

import { assertKillSwitchAllows } from "@/lib/trading/kill-switch-guard";
interface CreatePaperBuyOrderInput {
  stockCode: string;
  proposedStopPrice: number;
  requestedQuantity: number;
  modelId: string;
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
  current_stop_price: number | string | null;
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
  value: number | string | null,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function validateRequest(
  input: CreatePaperBuyOrderInput,
): void {
  if (!input.stockCode?.trim()) {
    throw new Error(
      "종목코드가 없습니다.",
    );
  }

  if (!input.modelId?.trim()) {
    throw new Error(
      "모델 ID가 없습니다.",
    );
  }

  if (
    !Number.isInteger(
      input.requestedQuantity,
    ) ||
    input.requestedQuantity <= 0
  ) {
    throw new Error(
      "주문 수량은 1주 이상의 정수여야 합니다.",
    );
  }

  if (
    !Number.isFinite(
      input.proposedStopPrice,
    ) ||
    input.proposedStopPrice <= 0
  ) {
    throw new Error(
      "손절가가 올바르지 않습니다.",
    );
  }
}

export async function createPaperBuyOrder(
  input: CreatePaperBuyOrderInput,
) {
  await assertKillSwitchAllows("PAPER_BUY_CREATE");

  validateRequest(input);

  const supabase =
    createSupabaseServerClient();

  /*
   * 계좌/잔액은 클라이언트 입력을 신뢰하지 않고
   * 서버 DB에서 직접 조회한다.
   */
  const {
    data: accountData,
    error: accountError,
  } =
    await supabase
      .from("paper_accounts")
      .select(
        `
          id,
          cash_balance,
          daily_realized_pnl,
          trading_mode
        `,
      )
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
      `모의계좌 조회 실패: ${
        accountError?.message ??
        "계좌가 없습니다."
      }`,
    );
  }

  const account =
    accountData as PaperAccountRecord;

  if (
    account.trading_mode !==
    "PAPER"
  ) {
    throw new Error(
      "현재 주문 API는 모의투자 계좌만 사용할 수 있습니다.",
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
      .from("stocks")
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
      `종목 조회 실패: ${
        stockError?.message ??
        input.stockCode
      }`,
    );
  }

  const stock =
    stockData as StockRecord;

  /*
   * 매수가도 클라이언트 입력이 아니라
   * 서버에 저장된 최신 snapshot을 사용한다.
   */
  const {
    data: targetSnapshots,
    error: priceError,
  } =
    await supabase
      .from("market_snapshots")
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
          ascending: false,
        },
      )
      .limit(1);

  if (priceError) {
    throw new Error(
      `현재가 조회 실패: ${priceError.message}`,
    );
  }

  const latestTargetSnapshot =
    targetSnapshots?.[0] as
      | SnapshotRecord
      | undefined;

  const entryPrice =
    toNumber(
      latestTargetSnapshot
        ?.close_price ??
        null,
    );

  if (entryPrice <= 0) {
    throw new Error(
      "저장된 현재가가 없습니다. 먼저 시세를 수집해 주세요.",
    );
  }

  /*
   * Risk V3:
   * exposure + aggregate open stop-risk 계산에
   * 현재 보유 포지션의 진입가와 손절가가 모두 필요하다.
   */
  const {
    data: positionData,
    error: positionError,
  } =
    await supabase
      .from("paper_positions")
      .select(
        `
          stock_code,
          sector,
          quantity,
          average_price,
          current_stop_price
        `,
      )
      .eq(
        "account_id",
        account.id,
      );

  if (positionError) {
    throw new Error(
      `보유 종목 조회 실패: ${positionError.message}`,
    );
  }

  const positions =
    (
      positionData ??
      []
    ) as PositionRecord[];

  const positionCodes =
    Array.from(
      new Set(
        positions.map(
          (position) =>
            position.stock_code,
        ),
      ),
    );

  let snapshotRows:
    SnapshotRecord[] =
    [];

  if (
    positionCodes.length > 0
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
            ascending: false,
          },
        );

    if (error) {
      throw new Error(
        `보유 종목 시세 조회 실패: ${error.message}`,
      );
    }

    snapshotRows =
      (
        data ??
        []
      ) as SnapshotRecord[];
  }

  const latestPriceByStock =
    new Map<
      string,
      number
    >();

  for (
    const snapshot of snapshotRows
  ) {
    if (
      latestPriceByStock.has(
        snapshot.stock_code,
      )
    ) {
      continue;
    }

    const currentPrice =
      toNumber(
        snapshot.close_price,
      );

    if (
      currentPrice > 0
    ) {
      latestPriceByStock.set(
        snapshot.stock_code,
        currentPrice,
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

  let hasMissingOpenPositionStop =
    false;

  for (
    const position of positions
  ) {
    const currentPrice =
      latestPriceByStock.get(
        position.stock_code,
      ) ??
      toNumber(
        position.average_price,
      );

    const positionValue =
      currentPrice *
      position.quantity;

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

    const averagePrice =
      toNumber(
        position.average_price,
      );

    const stopPrice =
      toNumber(
        position.current_stop_price,
      );

    if (
      averagePrice <= 0 ||
      stopPrice <= 0
    ) {
      openPositionsMissingValidStopCount +=
        1;

      hasMissingOpenPositionStop =
        true;

      continue;
    }

    currentAggregateOpenRiskAmount +=
      Math.max(
        0,
        averagePrice -
          stopPrice,
      ) *
      Math.max(
        0,
        position.quantity,
      );
  }

  const cashBalance =
    toNumber(
      account.cash_balance,
    );

  const accountEquity =
    cashBalance +
    currentInvestedAmount;

  const existingPosition =
    positions.find(
      (position) =>
        position.stock_code ===
        input.stockCode,
    );

  const riskInput = {
    stockCode:
      input.stockCode,

    entryPrice,

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
        account.daily_realized_pnl,
      ),

    openPositionCount:
      positions.length,

    isNewPosition:
      !existingPosition,

    tradingMode:
      account.trading_mode,

    modelStatus:
      orderModel.status,
  };

  const riskResult =
    validateBuyRisk(
      riskInput,
    );

  /*
   * 사전 위험판단은 승인/거부와 관계없이 기록한다.
   * Atomic committed-risk RPC는 이 decision id를 idempotency key로 사용한다.
   */
  const {
    data: decisionData,
    error: decisionError,
  } =
    await supabase
      .from(
        "risk_decisions",
      )
      .insert({
        account_id:
          account.id,

        stock_code:
          input.stockCode,

        action:
          "BUY",

        approved:
          riskResult.approved,

        requested_payload: {
          originalRequest:
            input,

          resolvedEntryPrice:
            entryPrice,

          priceObservedAt:
            latestTargetSnapshot
              ?.observed_at ??
            null,

          accountSnapshot: {
            accountEquity,

            availableCash:
              cashBalance,

            currentInvestedAmount,

            currentStockExposureAmount,

            currentSectorExposureAmount,

            currentAggregateOpenRiskAmount,


            openPositionsMissingValidStopCount,

            hasMissingOpenPositionStop,

            openPositionCount:
              positions.length,
          },
        },

        result_payload:
          riskResult,
      })
      .select("id")
      .single();

  if (
    decisionError ||
    !decisionData
  ) {
    throw new Error(
      `위험검증 결과 저장 실패: ${
        decisionError?.message ??
        "결과가 없습니다."
      }`,
    );
  }

  /*
   * Risk V3 committed-risk boundary.
   *
   * 여기서부터는 paper_order_requests에 직접 INSERT하지 않는다.
   * PostgreSQL RPC가 account-scoped advisory lock 아래에서:
   * - 기존 open position stop risk
   * - active BUY reservation risk
   * - 이번 proposed risk
   * 를 합산하고 order + reservation을 원자적으로 만든다.
   */
  const committedOrderResult =
    await createPaperBuyOrderWithCommittedRisk({
      accountId:
        account.id,

      stockCode:
        input.stockCode,

      requestedQuantity:
        input.requestedQuantity,

      entryPrice,

      stopPrice:
        input.proposedStopPrice,

      riskDecisionId:
        decisionData.id,

      preflightApproved:
        riskResult.approved,

      equity:
        accountEquity,

      maxAggregateOpenRiskRate:
        0.02,
    });

  const orderData =
    committedOrderResult.order;

  const committedRisk =
    committedOrderResult.committedRisk;

  if (!orderData) {
    throw new Error(
      "모의주문 저장 실패: 주문 결과가 없습니다.",
    );
  }

  return {
    account: {
      id:
        account.id,

      accountEquity,

      cashBalance,

      tradingMode:
        account.trading_mode,
    },

    stock: {
      stockCode:
        stock.stock_code,

      stockName:
        stock.stock_name,

      entryPrice,

      sector:
        stock.sector,
    },

    risk: {
      ...riskResult,

      /*
       * DB atomic committed-risk gate가 최종 승인권자다.
       * 사전 riskResult가 true여도 동시 주문 때문에 최종 거부될 수 있다.
       */
      approved:
        orderData.status ===
        "RISK_APPROVED",

      committedRisk,
    },

    order:
      orderData,
  };
}
