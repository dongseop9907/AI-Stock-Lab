import {
  DEFAULT_RISK_POLICY,
  type RiskPolicy,
} from "@/lib/trading/policy";

import type {
  BuyRiskInput,
  BuyRiskResult,
  RiskIssue,
  StopUpdateInput,
  StopUpdateResult,
} from "@/lib/trading/types";

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function floorNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function calculateQuantityLimit(
  remainingAmount: number,
  entryPrice: number,
): number {
  if (remainingAmount <= 0 || entryPrice <= 0) {
    return 0;
  }

  return floorNonNegative(remainingAmount / entryPrice);
}

export function validateBuyRisk(
  input: BuyRiskInput,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): BuyRiskResult {
  const issues: RiskIssue[] = [];

  const basicInputIsValid =
    input.stockCode.trim().length > 0 &&
    isPositiveNumber(input.entryPrice) &&
    isPositiveNumber(input.proposedStopPrice) &&
    Number.isInteger(input.requestedQuantity) &&
    input.requestedQuantity > 0 &&
    isPositiveNumber(input.accountEquity) &&
    input.availableCash >= 0 &&
    input.currentInvestedAmount >= 0 &&
    input.currentStockExposureAmount >= 0 &&
    input.currentSectorExposureAmount >= 0 &&
    Number.isInteger(input.openPositionCount) &&
    input.openPositionCount >= 0;

  if (!basicInputIsValid) {
    issues.push({
      code: "INVALID_INPUT",
      message: "주문 또는 계좌 입력값이 올바르지 않습니다.",
    });
  }

  const orderAmount =
    input.entryPrice * input.requestedQuantity;

  const riskPerShare =
    input.entryPrice - input.proposedStopPrice;

  const stopDistanceRate =
    input.entryPrice > 0
      ? riskPerShare / input.entryPrice
      : 0;

  const totalRiskAmount =
    Math.max(0, riskPerShare) *
    Math.max(0, input.requestedQuantity);

  const maxRiskAmount =
    input.accountEquity * policy.maxRiskPerTradeRate;

  const maxPositionAmount =
    input.accountEquity * policy.maxPositionRate;

  const maxPortfolioAmount =
    input.accountEquity *
    policy.maxPortfolioExposureRate;

  const maxSectorAmount =
    input.accountEquity *
    policy.maxSectorExposureRate;

  if (input.proposedStopPrice >= input.entryPrice) {
    issues.push({
      code: "STOP_NOT_BELOW_ENTRY",
      message: "최초 손절가는 예상 매수가보다 낮아야 합니다.",
    });
  }

  if (
    riskPerShare > 0 &&
    stopDistanceRate < policy.minStopDistanceRate
  ) {
    issues.push({
      code: "STOP_TOO_CLOSE",
      message: `손절 거리가 너무 가깝습니다. 최소 ${
        policy.minStopDistanceRate * 100
      }% 이상이어야 합니다.`,
    });
  }

  if (stopDistanceRate > policy.maxStopDistanceRate) {
    issues.push({
      code: "STOP_TOO_FAR",
      message: `손절 거리가 너무 멉니다. 최대 ${
        policy.maxStopDistanceRate * 100
      }% 이하여야 합니다.`,
    });
  }

  if (totalRiskAmount > maxRiskAmount) {
    issues.push({
      code: "RISK_LIMIT_EXCEEDED",
      message: "이번 거래의 예상 손실액이 거래별 위험 한도를 초과합니다.",
    });
  }

  if (
    input.currentStockExposureAmount + orderAmount >
    maxPositionAmount
  ) {
    issues.push({
      code: "POSITION_LIMIT_EXCEEDED",
      message: "해당 종목의 최대 투자 비중을 초과합니다.",
    });
  }

  if (
    input.currentInvestedAmount + orderAmount >
    maxPortfolioAmount
  ) {
    issues.push({
      code: "PORTFOLIO_LIMIT_EXCEEDED",
      message: "전체 포트폴리오 투자 한도를 초과합니다.",
    });
  }

  if (
    input.currentSectorExposureAmount + orderAmount >
    maxSectorAmount
  ) {
    issues.push({
      code: "SECTOR_LIMIT_EXCEEDED",
      message: "동일 업종의 최대 투자 비중을 초과합니다.",
    });
  }

  if (orderAmount > input.availableCash) {
    issues.push({
      code: "INSUFFICIENT_CASH",
      message: "주문에 필요한 주문 가능 현금이 부족합니다.",
    });
  }

  if (
    input.isNewPosition &&
    input.openPositionCount >= policy.maxOpenPositions
  ) {
    issues.push({
      code: "MAX_POSITIONS_REACHED",
      message: "최대 보유 종목 수에 도달했습니다.",
    });
  }

  const maxDailyLossAmount =
    input.accountEquity * policy.maxDailyLossRate;

  if (input.dailyRealizedPnl <= -maxDailyLossAmount) {
    issues.push({
      code: "DAILY_LOSS_LIMIT_REACHED",
      message: "하루 손실 한도에 도달하여 신규 매수를 중단합니다.",
    });
  }

  if (
    input.tradingMode === "LIVE" &&
    input.modelStatus !== "APPROVED"
  ) {
    issues.push({
      code: "MODEL_NOT_APPROVED",
      message: "검증 완료된 모델만 실제 매매에 사용할 수 있습니다.",
    });
  }

  const riskQuantityLimit =
    riskPerShare > 0
      ? floorNonNegative(maxRiskAmount / riskPerShare)
      : 0;

  const positionQuantityLimit =
    calculateQuantityLimit(
      maxPositionAmount -
        input.currentStockExposureAmount,
      input.entryPrice,
    );

  const portfolioQuantityLimit =
    calculateQuantityLimit(
      maxPortfolioAmount -
        input.currentInvestedAmount,
      input.entryPrice,
    );

  const sectorQuantityLimit =
    calculateQuantityLimit(
      maxSectorAmount -
        input.currentSectorExposureAmount,
      input.entryPrice,
    );

  const cashQuantityLimit =
    calculateQuantityLimit(
      input.availableCash,
      input.entryPrice,
    );

  let maxAllowedQuantity = Math.min(
    riskQuantityLimit,
    positionQuantityLimit,
    portfolioQuantityLimit,
    sectorQuantityLimit,
    cashQuantityLimit,
  );

  if (
    input.isNewPosition &&
    input.openPositionCount >= policy.maxOpenPositions
  ) {
    maxAllowedQuantity = 0;
  }

  if (
    input.dailyRealizedPnl <= -maxDailyLossAmount
  ) {
    maxAllowedQuantity = 0;
  }

  if (
    input.tradingMode === "LIVE" &&
    input.modelStatus !== "APPROVED"
  ) {
    maxAllowedQuantity = 0;
  }

  if (input.requestedQuantity > maxAllowedQuantity) {
    issues.push({
      code: "QUANTITY_LIMIT_EXCEEDED",
      message: `요청 수량은 ${input.requestedQuantity}주이지만 최대 허용 수량은 ${maxAllowedQuantity}주입니다.`,
    });
  }

  const approved =
    issues.length === 0 &&
    input.requestedQuantity <= maxAllowedQuantity;

  return {
    approved,
    requestedQuantity: input.requestedQuantity,
    maxAllowedQuantity,
    approvedQuantity: approved
      ? input.requestedQuantity
      : maxAllowedQuantity,
    metrics: {
      orderAmount,
      stopDistanceRate,
      riskPerShare,
      totalRiskAmount,
      maxRiskAmount,
      maxPositionAmount,
      maxPortfolioAmount,
      maxSectorAmount,
    },
    issues,
  };
}

/**
 * 매수 후 손절가는 유지하거나 위로만 이동할 수 있다.
 */
export function validateStopUpdate(
  input: StopUpdateInput,
): StopUpdateResult {
  const issues: RiskIssue[] = [];

  if (
    !input.stockCode ||
    !isPositiveNumber(input.currentPrice) ||
    !isPositiveNumber(input.currentStopPrice) ||
    !isPositiveNumber(input.proposedStopPrice)
  ) {
    issues.push({
      code: "INVALID_INPUT",
      message: "손절가 변경 입력값이 올바르지 않습니다.",
    });

    return {
      approved: false,
      issues,
    };
  }

  if (
    input.proposedStopPrice <
    input.currentStopPrice
  ) {
    issues.push({
      code: "STOP_MOVED_DOWN",
      message: "매수 후 손절가는 아래로 이동할 수 없습니다.",
    });
  }

  if (
    input.proposedStopPrice >= input.currentPrice
  ) {
    issues.push({
      code: "STOP_ABOVE_MARKET_PRICE",
      message: "새 손절가는 현재가보다 낮아야 합니다.",
    });
  }

  return {
    approved: issues.length === 0,
    issues,
  };
}