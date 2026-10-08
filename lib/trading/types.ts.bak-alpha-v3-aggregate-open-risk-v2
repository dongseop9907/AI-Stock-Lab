export type TradingMode = "PAPER" | "LIVE";

export type ModelStatus =
  | "CANDIDATE"
  | "APPROVED"
  | "REJECTED"
  | "RETIRED";

export interface BuyRiskInput {
  stockCode: string;

  entryPrice: number;
  proposedStopPrice: number;
  requestedQuantity: number;

  accountEquity: number;
  availableCash: number;

  currentInvestedAmount: number;
  currentStockExposureAmount: number;
  currentSectorExposureAmount: number;

  dailyRealizedPnl: number;
  openPositionCount: number;
  isNewPosition: boolean;

  tradingMode: TradingMode;
  modelStatus: ModelStatus;
}

export interface StopUpdateInput {
  stockCode: string;
  currentPrice: number;
  currentStopPrice: number;
  proposedStopPrice: number;
}

export type RiskIssueCode =
  | "INVALID_INPUT"
  | "STOP_NOT_BELOW_ENTRY"
  | "STOP_TOO_CLOSE"
  | "STOP_TOO_FAR"
  | "RISK_LIMIT_EXCEEDED"
  | "POSITION_LIMIT_EXCEEDED"
  | "PORTFOLIO_LIMIT_EXCEEDED"
  | "SECTOR_LIMIT_EXCEEDED"
  | "INSUFFICIENT_CASH"
  | "MAX_POSITIONS_REACHED"
  | "DAILY_LOSS_LIMIT_REACHED"
  | "MODEL_NOT_APPROVED"
  | "QUANTITY_LIMIT_EXCEEDED"
  | "STOP_MOVED_DOWN"
  | "STOP_ABOVE_MARKET_PRICE";

export interface RiskIssue {
  code: RiskIssueCode;
  message: string;
}

export interface BuyRiskResult {
  approved: boolean;
  requestedQuantity: number;
  maxAllowedQuantity: number;
  approvedQuantity: number;

  metrics: {
    orderAmount: number;
    stopDistanceRate: number;
    riskPerShare: number;
    totalRiskAmount: number;
    maxRiskAmount: number;
    maxPositionAmount: number;
    maxPortfolioAmount: number;
    maxSectorAmount: number;
  };

  issues: RiskIssue[];
}

export interface StopUpdateResult {
  approved: boolean;
  issues: RiskIssue[];
}