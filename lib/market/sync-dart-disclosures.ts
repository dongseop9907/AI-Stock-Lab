import { createSupabaseServerClient } from "@/lib/supabase";

interface SyncDartDisclosuresInput {
  lookbackDays?: number;
  maxPages?: number;
}

interface StockRecord {
  stock_code: string;
}

interface DartDisclosureItem {
  corp_cls?: string;
  corp_name?: string;
  corp_code?: string;
  stock_code?: string;
  report_nm?: string;
  rcept_no?: string;
  flr_nm?: string;
  rcept_dt?: string;
  rm?: string;
}

interface DartDisclosureResponse {
  status?: string;
  message?: string;

  page_no?: number | string;
  page_count?: number | string;
  total_count?: number | string;
  total_page?: number | string;

  list?: DartDisclosureItem[];
}

interface DisclosureAnalysis {
  importanceScore: number;

  sentimentHint:
    | "POSITIVE"
    | "NEGATIVE"
    | "NEUTRAL";

  matchedKeywords: string[];
}

export interface SyncDartDisclosuresResult {
  beginDate: string;
  endDate: string;

  requestedPages: number;
  received: number;
  matched: number;
  ignored: number;
  saved: number;

  activeStockCount: number;
}

const DART_LIST_ENDPOINT =
  "https://opendart.fss.or.kr/api/list.json";

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function formatKoreaDate(
  date: Date,
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return [
    values.year,
    values.month,
    values.day,
  ].join("");
}

function parseReceivedDate(
  value: string | undefined,
): string | null {
  if (
    !value ||
    !/^\d{8}$/.test(value)
  ) {
    return null;
  }

  return [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
  ].join("-");
}

function normalizeStockCode(
  value: string | undefined,
): string {
  return String(value ?? "")
    .trim()
    .padStart(6, "0");
}

function normalizeReportName(
  value: string,
): string {
  return value
    .replace(/\s+/g, "")
    .toUpperCase();
}

function analyzeDisclosure(
  reportName: string,
): DisclosureAnalysis {
  const normalized =
    normalizeReportName(
      reportName,
    );

  const positiveRules = [
    {
      keyword:
        "단일판매ㆍ공급계약체결",
      score: 0.90,
    },
    {
      keyword:
        "자기주식취득결정",
      score: 0.85,
    },
    {
      keyword:
        "현금ㆍ현물배당결정",
      score: 0.75,
    },
    {
      keyword:
        "무상증자결정",
      score: 0.75,
    },
    {
      keyword:
        "신규시설투자",
      score: 0.70,
    },
    {
      keyword:
        "특허권취득",
      score: 0.65,
    },
  ];

  const negativeRules = [
    {
      keyword: "횡령ㆍ배임",
      score: 1.0,
    },
    {
      keyword: "상장폐지",
      score: 1.0,
    },
    {
      keyword: "부도발생",
      score: 1.0,
    },
    {
      keyword: "회생절차",
      score: 0.95,
    },
    {
      keyword: "영업정지",
      score: 0.90,
    },
    {
      keyword: "감사의견",
      score: 0.85,
    },
    {
      keyword:
        "유상증자결정",
      score: 0.80,
    },
    {
      keyword:
        "전환사채권발행결정",
      score: 0.75,
    },
    {
      keyword:
        "관리종목",
      score: 0.90,
    },
  ];

  const neutralImpactRules = [
    {
      keyword:
        "매출액또는손익구조",
      score: 0.80,
    },
    {
      keyword:
        "잠정실적",
      score: 0.75,
    },
    {
      keyword:
        "최대주주변경",
      score: 0.75,
    },
    {
      keyword: "합병",
      score: 0.75,
    },
    {
      keyword: "회사분할",
      score: 0.75,
    },
    {
      keyword:
        "주요사항보고서",
      score: 0.65,
    },
  ];

  const matchedKeywords:
    string[] = [];

  let importanceScore =
    0.30;

  let hasPositive =
    false;

  let hasNegative =
    false;

  for (
    const rule of positiveRules
  ) {
    if (
      normalized.includes(
        normalizeReportName(
          rule.keyword,
        ),
      )
    ) {
      matchedKeywords.push(
        rule.keyword,
      );

      importanceScore =
        Math.max(
          importanceScore,
          rule.score,
        );

      hasPositive = true;
    }
  }

  for (
    const rule of negativeRules
  ) {
    if (
      normalized.includes(
        normalizeReportName(
          rule.keyword,
        ),
      )
    ) {
      matchedKeywords.push(
        rule.keyword,
      );

      importanceScore =
        Math.max(
          importanceScore,
          rule.score,
        );

      hasNegative = true;
    }
  }

  for (
    const rule of neutralImpactRules
  ) {
    if (
      normalized.includes(
        normalizeReportName(
          rule.keyword,
        ),
      )
    ) {
      matchedKeywords.push(
        rule.keyword,
      );

      importanceScore =
        Math.max(
          importanceScore,
          rule.score,
        );
    }
  }

  const sentimentHint =
    hasNegative
      ? "NEGATIVE"
      : hasPositive
        ? "POSITIVE"
        : "NEUTRAL";

  return {
    importanceScore:
      Number(
        importanceScore.toFixed(2),
      ),

    sentimentHint,

    matchedKeywords:
      Array.from(
        new Set(
          matchedKeywords,
        ),
      ),
  };
}

async function fetchDartPage(
  apiKey: string,
  beginDate: string,
  endDate: string,
  pageNumber: number,
): Promise<DartDisclosureResponse> {
  const searchParams =
    new URLSearchParams({
      crtfc_key:
        apiKey,

      bgn_de:
        beginDate,

      end_de:
        endDate,

      last_reprt_at:
        "N",

      sort:
        "date",

      sort_mth:
        "desc",

      page_no:
        String(pageNumber),

      page_count:
        "100",
    });

  const response =
    await fetch(
      `${DART_LIST_ENDPOINT}?${searchParams.toString()}`,
      {
        method: "GET",
        cache: "no-store",

        headers: {
          Accept:
            "application/json",
        },
      },
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenDART HTTP 오류: ${response.status}`,
    );
  }

  let payload:
    DartDisclosureResponse;

  try {
    payload =
      JSON.parse(
        responseText,
      ) as DartDisclosureResponse;
  } catch {
    throw new Error(
      "OpenDART가 JSON이 아닌 응답을 반환했습니다.",
    );
  }

  return payload;
}

export async function syncDartDisclosures(
  input: SyncDartDisclosuresInput = {},
): Promise<SyncDartDisclosuresResult> {
  const apiKey =
    process.env
      .DART_API_KEY
      ?.trim();

  if (!apiKey) {
    throw new Error(
      "DART_API_KEY가 설정되지 않았습니다.",
    );
  }

  const lookbackDays =
    clamp(
      Math.floor(
        Number(
          input.lookbackDays ??
            3,
        ),
      ),
      1,
      30,
    );

  const maxPages =
    clamp(
      Math.floor(
        Number(
          input.maxPages ??
            10,
        ),
      ),
      1,
      50,
    );

  const now =
    new Date();

  const begin =
    new Date(
      now.getTime() -
        (
          lookbackDays - 1
        ) *
          24 *
          60 *
          60 *
          1000,
    );

  const beginDate =
    formatKoreaDate(begin);

  const endDate =
    formatKoreaDate(now);

  const supabase =
    createSupabaseServerClient();

  const {
    data: stockData,
    error: stockError,
  } = await supabase
    .from("stocks")
    .select("stock_code")
    .eq("is_active", true);

  if (stockError) {
    throw new Error(
      `활성 종목 조회 실패: ${stockError.message}`,
    );
  }

  const stocks =
    (stockData ??
      []) as StockRecord[];

  const activeStockCodes =
    new Set(
      stocks.map((stock) =>
        normalizeStockCode(
          stock.stock_code,
        ),
      ),
    );

  if (
    activeStockCodes.size === 0
  ) {
    return {
      beginDate,
      endDate,

      requestedPages: 0,
      received: 0,
      matched: 0,
      ignored: 0,
      saved: 0,

      activeStockCount: 0,
    };
  }

  let requestedPages = 0;
  let received = 0;

  const matchedItems:
    DartDisclosureItem[] = [];

  const firstPage =
    await fetchDartPage(
      apiKey,
      beginDate,
      endDate,
      1,
    );

  requestedPages += 1;

  /*
   * 013은 조회 결과 없음이다.
   */
  if (
    firstPage.status === "013"
  ) {
    return {
      beginDate,
      endDate,

      requestedPages,
      received: 0,
      matched: 0,
      ignored: 0,
      saved: 0,

      activeStockCount:
        activeStockCodes.size,
    };
  }

  if (
    firstPage.status !== "000"
  ) {
    throw new Error(
      `OpenDART 오류 ${firstPage.status ?? "UNKNOWN"}: ${firstPage.message ?? "알 수 없는 오류"}`,
    );
  }

  const totalPages =
    Math.max(
      1,
      Number(
        firstPage.total_page ??
          1,
      ),
    );

  const pagesToRequest =
    Math.min(
      totalPages,
      maxPages,
    );

  const allItems:
    DartDisclosureItem[] = [
      ...(firstPage.list ?? []),
  ];

  for (
    let page = 2;
    page <= pagesToRequest;
    page += 1
  ) {
    const pageResult =
      await fetchDartPage(
        apiKey,
        beginDate,
        endDate,
        page,
      );

    requestedPages += 1;

    if (
      pageResult.status !==
      "000"
    ) {
      throw new Error(
        `OpenDART ${page}페이지 오류 ${pageResult.status ?? "UNKNOWN"}: ${pageResult.message ?? "알 수 없는 오류"}`,
      );
    }

    allItems.push(
      ...(pageResult.list ??
        []),
    );
  }

  received =
    allItems.length;

  for (
    const item of allItems
  ) {
    const stockCode =
      normalizeStockCode(
        item.stock_code,
      );

    if (
      activeStockCodes.has(
        stockCode,
      )
    ) {
      matchedItems.push(item);
    }
  }

  const nowIso =
    now.toISOString();

  const rows =
    matchedItems
      .map((item) => {
        const stockCode =
          normalizeStockCode(
            item.stock_code,
          );

        const reportName =
          String(
            item.report_nm ??
              "",
          ).trim();

        const receivedDate =
          parseReceivedDate(
            item.rcept_dt,
          );

        const receiptNumber =
          String(
            item.rcept_no ??
              "",
          ).trim();

        if (
          !receiptNumber ||
          !reportName ||
          !receivedDate
        ) {
          return null;
        }

        const analysis =
          analyzeDisclosure(
            reportName,
          );

        return {
          rcept_no:
            receiptNumber,

          stock_code:
            stockCode,

          corp_code:
            item.corp_code ??
            null,

          corp_name:
            item.corp_name ??
            null,

          corp_class:
            item.corp_cls ??
            null,

          report_name:
            reportName,

          filer_name:
            item.flr_nm ??
            null,

          received_date:
            receivedDate,

          remark:
            item.rm ??
            null,

          importance_score:
            analysis.importanceScore,

          sentiment_hint:
            analysis.sentimentHint,

          matched_keywords:
            analysis.matchedKeywords,

          raw_payload:
            item,

          last_seen_at:
            nowIso,

          updated_at:
            nowIso,
        };
      })
      .filter(
        (
          row,
        ): row is NonNullable<
          typeof row
        > =>
          row !== null,
      );

  if (
    rows.length > 0
  ) {
    const {
      error: saveError,
    } = await supabase
      .from(
        "dart_disclosures",
      )
      .upsert(
        rows,
        {
          onConflict:
            "rcept_no",
        },
      );

    if (saveError) {
      throw new Error(
        `DART 공시 저장 실패: ${saveError.message}`,
      );
    }
  }

  return {
    beginDate,
    endDate,

    requestedPages,
    received,

    matched:
      matchedItems.length,

    ignored:
      received -
      matchedItems.length,

    saved:
      rows.length,

    activeStockCount:
      activeStockCodes.size,
  };
}