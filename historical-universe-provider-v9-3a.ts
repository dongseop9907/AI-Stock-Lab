export type HistoricalUniverseCoverageStatus =
  | "COMPLETE" | "PARTIAL" | "UNKNOWN";

export type HistoricalUniverseMarket =
  | "KOSPI" | "KOSDAQ" | "KONEX" | "UNKNOWN";

export interface NormalizedHistoricalSecurity {
  stockCode: string;
  stockName: string;
  market: HistoricalUniverseMarket;
  sector?: string | null;
  securityType?: string | null;
  listed?: boolean;
  tradable?: boolean;
  listingDate?: string | null;
  delistingDate?: string | null;
  sourcePayload?: Record<string, unknown>;
}

export interface HistoricalUniverseSnapshotPayload {
  universeCode: string;
  asOfDate: string;
  provider: string;
  providerVersion: string;
  coverageStatus: HistoricalUniverseCoverageStatus;
  expectedMemberCount?: number | null;
  members: NormalizedHistoricalSecurity[];
  metadata?: Record<string, unknown>;
  isValidation?: boolean;
}

export interface HistoricalUniverseProvider {
  providerName: string;
  providerVersion: string;
  fetchSnapshot(asOfDate: string): Promise<HistoricalUniverseSnapshotPayload>;
}
