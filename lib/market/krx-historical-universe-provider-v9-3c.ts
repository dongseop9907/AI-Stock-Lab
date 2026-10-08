import type {
  HistoricalUniverseProvider,
  HistoricalUniverseSnapshotPayload,
  NormalizedHistoricalSecurity,
} from "@/lib/market/historical-universe-provider-v9-3a";

const PROVIDER_NAME = "KRX_OPEN_API_STOCK_BASE_V1";
const PROVIDER_VERSION = "v9.3C-1";

const KOSPI_URL =
  "https://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info";
const KOSDAQ_URL =
  "https://data-dbg.krx.co.kr/svc/apis/sto/ksq_isu_base_info";

type KrxRow = {
  ISU_CD?: string;
  ISU_SRT_CD?: string;
  ISU_NM?: string;
  ISU_ABBRV?: string;
  ISU_ENG_NM?: string;
  LIST_DD?: string;
  MKT_TP_NM?: string;
  SECUGRP_NM?: string;
  SECT_TP_NM?: string;
  KIND_STKCERT_TP_NM?: string;
  PARVAL?: string;
  LIST_SHRS?: string;
  [key: string]: unknown;
};

type KrxResponse = {
  OutBlock_1?: KrxRow[];
  respCode?: string;
  respMsg?: string;
};

export interface KrxHistoricalSnapshotFetchResult {
  payload: HistoricalUniverseSnapshotPayload;
  rawCounts: { kospi: number; kosdaq: number };
  apiRequestCount: number;
}

function requireDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("INVALID_KRX_HISTORICAL_AS_OF_DATE");
  }
  return value;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function compactDate(sqlDate: string) {
  return sqlDate.replaceAll("-", "");
}

function sqlDateFromKrx(value: unknown): string | null {
  const text = clean(value);
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
}

function securityTypeFromKrx(row: KrxRow) {
  const type = clean(row.KIND_STKCERT_TP_NM);
  if (type === "보통주") return "COMMON";
  if (type.includes("우선") || type.includes("종류")) return "PREFERRED";
  return type || "UNKNOWN";
}

async function fetchKrxRows(url: string, asOfDate: string) {
  const key = process.env.KRX_OPEN_API_KEY?.trim();
  if (!key) throw new Error("KRX_OPEN_API_KEY_NOT_CONFIGURED");

  const response = await fetch(
    `${url}?basDd=${compactDate(asOfDate)}`,
    {
      method: "GET",
      headers: {
        AUTH_KEY: key,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const text = await response.text();
  let body: KrxResponse;
  try {
    body = JSON.parse(text) as KrxResponse;
  } catch {
    throw new Error(`KRX_OPEN_API_NON_JSON_${response.status}`);
  }

  if (!response.ok) {
    throw new Error(
      `KRX_OPEN_API_HTTP_${response.status}_${clean(body.respCode)}_${clean(body.respMsg)}`,
    );
  }

  return Array.isArray(body.OutBlock_1) ? body.OutBlock_1 : [];
}

function normalizeRows(
  rows: KrxRow[],
  expectedMarket: "KOSPI" | "KOSDAQ",
) {
  const output: NormalizedHistoricalSecurity[] = [];

  for (const row of rows) {
    const stockCode = clean(row.ISU_SRT_CD);
    const stockName = clean(row.ISU_ABBRV) || clean(row.ISU_NM);
    const market = clean(row.MKT_TP_NM).toUpperCase();
    const securityGroup = clean(row.SECUGRP_NM);

    if (
      !stockCode ||
      !stockName ||
      market !== expectedMarket ||
      securityGroup !== "주권"
    ) {
      continue;
    }

    output.push({
      stockCode,
      stockName,
      market: expectedMarket,
      sector: clean(row.SECT_TP_NM) || null,
      securityType: securityTypeFromKrx(row),
      listed: true,
      // This endpoint proves listing membership, not suspension status.
      tradable: true,
      listingDate: sqlDateFromKrx(row.LIST_DD),
      delistingDate: null,
      sourcePayload: {
        isuCd: clean(row.ISU_CD),
        isuShortCode: stockCode,
        isuName: clean(row.ISU_NM),
        isuAbbreviation: stockName,
        isuEnglishName: clean(row.ISU_ENG_NM),
        listingDate: clean(row.LIST_DD),
        marketType: clean(row.MKT_TP_NM),
        securityGroup,
        sectionType: clean(row.SECT_TP_NM),
        stockCertificateType: clean(row.KIND_STKCERT_TP_NM),
        parValue: clean(row.PARVAL),
        listedShares: clean(row.LIST_SHRS),
        historicalTradabilityEvidence: "LISTING_SNAPSHOT_ONLY",
      },
    });
  }

  return output;
}

export async function fetchKrxHistoricalUniverseSnapshotV93C(
  asOfDateInput: string,
): Promise<KrxHistoricalSnapshotFetchResult> {
  const asOfDate = requireDate(asOfDateInput);

  // Sequential on purpose; historical import is not latency sensitive.
  const kospiRows = await fetchKrxRows(KOSPI_URL, asOfDate);
  const kosdaqRows = await fetchKrxRows(KOSDAQ_URL, asOfDate);

  if (kospiRows.length < 500) {
    throw new Error(
      `KRX_KOSPI_SNAPSHOT_IMPLAUSIBLY_SMALL_${kospiRows.length}`,
    );
  }
  if (kosdaqRows.length < 1000) {
    throw new Error(
      `KRX_KOSDAQ_SNAPSHOT_IMPLAUSIBLY_SMALL_${kosdaqRows.length}`,
    );
  }

  const kospiMembers = normalizeRows(kospiRows, "KOSPI");
  const kosdaqMembers = normalizeRows(kosdaqRows, "KOSDAQ");
  const members = [...kospiMembers, ...kosdaqMembers];

  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.stockCode)) {
      throw new Error(
        `KRX_HISTORICAL_DUPLICATE_STOCK_CODE_${member.stockCode}`,
      );
    }
    seen.add(member.stockCode);
  }

  if (members.length < 1500) {
    throw new Error(
      `KRX_COMBINED_SNAPSHOT_IMPLAUSIBLY_SMALL_${members.length}`,
    );
  }

  return {
    payload: {
      universeCode: "KRX_ALL_LISTED",
      asOfDate,
      provider: PROVIDER_NAME,
      providerVersion: PROVIDER_VERSION,
      coverageStatus: "COMPLETE",
      expectedMemberCount: members.length,
      members,
      metadata: {
        version: "KRX_HISTORICAL_PIT_PROVIDER_V9_3C",
        source: "KRX_OPEN_API",
        endpoints: {
          kospi: "stk_isu_base_info",
          kosdaq: "ksq_isu_base_info",
        },
        rawCounts: {
          kospi: kospiRows.length,
          kosdaq: kosdaqRows.length,
        },
        normalizedCounts: {
          kospi: kospiMembers.length,
          kosdaq: kosdaqMembers.length,
          combined: members.length,
        },
        pointInTimeRequestParameter: "basDd",
        currentUniverseSubstituted: false,
        tradabilityCaveat:
          "Base-info establishes historical listing membership; market-data gates validate actual trading availability later.",
        productionApplied: false,
      },
      isValidation: false,
    },
    rawCounts: {
      kospi: kospiRows.length,
      kosdaq: kosdaqRows.length,
    },
    apiRequestCount: 2,
  };
}

export class KrxHistoricalUniverseProviderV93C
implements HistoricalUniverseProvider {
  providerName = PROVIDER_NAME;
  providerVersion = PROVIDER_VERSION;

  async fetchSnapshot(asOfDate: string) {
    const result = await fetchKrxHistoricalUniverseSnapshotV93C(asOfDate);
    return result.payload;
  }
}

export const KRX_HISTORICAL_PIT_PROVIDER_NAME_V93C =
  PROVIDER_NAME;
