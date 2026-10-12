export type Direction = "UP" | "DOWN" | "NEUTRAL";

export interface PredictionSummary {
  stockCode: string;
  stockName: string;
  direction: Direction;
  probability: number;
  horizonDays: number;
  expectedExcessReturn: number;
  marketRegime: string;
  reasons: string[];
  risks: string[];
}
