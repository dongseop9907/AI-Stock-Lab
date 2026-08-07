interface KisTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number | string;
  access_token_token_expired?: string;
}

export interface KisDomesticPriceOutput {
  stck_prpr: string;
  stck_oprc: string;
  stck_hgpr: string;
  stck_lwpr: string;
  acml_vol: string;
  prdy_ctrt?: string;

  [key: string]:
    | string
    | undefined;
}

export interface KisDomesticPriceResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;

  output:
    KisDomesticPriceOutput;
}

/*
 * 국내주식 기간별 시세의
 * 개별 일봉 데이터
 */
export interface KisDomesticDailyPriceOutput {
  /*
   * YYYYMMDD
   */
  stck_bsop_date: string;

  /*
   * 종가
   */
  stck_clpr: string;

  /*
   * 시가
   */
  stck_oprc: string;

  /*
   * 고가
   */
  stck_hgpr: string;

  /*
   * 저가
   */
  stck_lwpr: string;

  /*
   * 누적 거래량
   */
  acml_vol: string;

  /*
   * 누적 거래대금
   */
  acml_tr_pbmn?: string;

  /*
   * 전일 대비
   */
  prdy_vrss?: string;

  /*
   * 전일 대비 부호
   */
  prdy_vrss_sign?: string;

  /*
   * 전일 대비율
   */
  prdy_ctrt?: string;

  /*
   * 수정 여부 등
   */
  mod_yn?: string;

  [key: string]:
    | string
    | undefined;
}

export interface KisDomesticDailyPriceResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;

  output1?:
    Record<
      string,
      string
    >;

  output2:
    KisDomesticDailyPriceOutput[];
}

export interface GetDomesticDailyPricesInput {
  /*
   * 6자리 종목코드
   * ex) 005930
   */
  stockCode: string;

  /*
   * YYYYMMDD
   */
  startDate: string;

  /*
   * YYYYMMDD
   */
  endDate: string;

  /*
   * D = 일
   * W = 주
   * M = 월
   * Y = 년
   */
  period?:
    | "D"
    | "W"
    | "M"
    | "Y";

  /*
   * true:
   * 액면분할 등의 영향을 조정한
   * 수정주가 기준으로 조회
   *
   * 백테스트에서는 기본 true 사용.
   */
  adjustedPrice?: boolean;
}

let tokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

function getKisConfig() {
  const appKey =
    process.env.KIS_APP_KEY;

  const appSecret =
    process.env.KIS_APP_SECRET;

  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (
    !appKey ||
    !appSecret
  ) {
    throw new Error(
      "KIS_APP_KEY 또는 KIS_APP_SECRET이 없습니다.",
    );
  }

  return {
    appKey,
    appSecret,
    baseUrl,
  };
}

export async function issueKisAccessToken(): Promise<KisTokenResponse> {
  const {
    appKey,
    appSecret,
    baseUrl,
  } =
    getKisConfig();

  const response =
    await fetch(
      `${baseUrl}/oauth2/tokenP`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body:
          JSON.stringify({
            grant_type:
              "client_credentials",

            appkey:
              appKey,

            appsecret:
              appSecret,
          }),

        cache:
          "no-store",
      },
    );

  const body =
    (await response.json()) as Partial<KisTokenResponse> & {
      error_description?: string;
    };

  if (
    !response.ok ||
    !body.access_token
  ) {
    throw new Error(
      body.error_description ??
        `KIS 접근토큰 발급 실패: HTTP ${response.status}`,
    );
  }

  return (
    body as
      KisTokenResponse
  );
}

export async function getKisAccessToken(): Promise<string> {
  const now =
    Date.now();

  if (
    tokenCache &&
    now <
      tokenCache.expiresAt -
        60_000
  ) {
    return (
      tokenCache.accessToken
    );
  }

  const token =
    await issueKisAccessToken();

  const expiresIn =
    Number(
      token.expires_in,
    );

  tokenCache = {
    accessToken:
      token.access_token,

    expiresAt:
      now +
      (
        Number.isFinite(
          expiresIn,
        )
          ? expiresIn
          : 3600
      ) *
        1000,
  };

  return (
    token.access_token
  );
}

/*
 * ============================================================
 * 현재가 조회
 * ============================================================
 */

export async function getDomesticStockPrice(
  stockCode: string,
  accessToken: string,
): Promise<KisDomesticPriceResponse> {
  const {
    appKey,
    appSecret,
    baseUrl,
  } =
    getKisConfig();

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        stockCode,
    });

  const response =
    await fetch(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`,
      {
        method: "GET",

        headers: {
          authorization:
            `Bearer ${accessToken}`,

          appkey:
            appKey,

          appsecret:
            appSecret,

          tr_id:
            "FHKST01010100",
        },

        cache:
          "no-store",
      },
    );

  const body =
    (await response.json()) as
      KisDomesticPriceResponse;

  if (
    !response.ok
  ) {
    throw new Error(
      body.msg1 ||
        `KIS 현재가 조회 실패: HTTP ${response.status}`,
    );
  }

  if (
    body.rt_cd !==
    "0"
  ) {
    throw new Error(
      `${stockCode} 현재가 조회 실패: ${
        body.msg1 ||
        body.msg_cd
      }`,
    );
  }

  return body;
}

/*
 * ============================================================
 * 과거 기간별 시세 조회
 * ============================================================
 *
 * 국내주식 기간별 시세
 *
 * endpoint:
 * /uapi/domestic-stock/v1/quotations/
 * inquire-daily-itemchartprice
 *
 * TR:
 * FHKST03010100
 *
 * 백테스트에서는 기본적으로
 * period = D
 * adjustedPrice = true
 *
 * 로 사용한다.
 * ============================================================
 */

export async function getDomesticDailyStockPrices(
  input:
    GetDomesticDailyPricesInput,
  accessToken: string,
): Promise<KisDomesticDailyPriceResponse> {
  const {
    appKey,
    appSecret,
    baseUrl,
  } =
    getKisConfig();

  const stockCode =
    input.stockCode.trim();

  const startDate =
    input.startDate.trim();

  const endDate =
    input.endDate.trim();

  const period =
    input.period ??
    "D";

  const adjustedPrice =
    input.adjustedPrice !==
    false;

  /*
   * 잘못된 종목코드 방지
   */
  if (
    !/^\d{6}$/.test(
      stockCode,
    )
  ) {
    throw new Error(
      `INVALID_STOCK_CODE: ${stockCode}`,
    );
  }

  /*
   * YYYYMMDD 검증
   */
  if (
    !/^\d{8}$/.test(
      startDate,
    ) ||
    !/^\d{8}$/.test(
      endDate,
    )
  ) {
    throw new Error(
      "KIS 기간 조회 날짜는 YYYYMMDD 형식이어야 합니다.",
    );
  }

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "KIS 기간 조회 시작일이 종료일보다 늦습니다.",
    );
  }

  const params =
    new URLSearchParams({
      /*
       * J:
       * 국내 주식/ETF/ETN
       */
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        stockCode,

      /*
       * YYYYMMDD
       */
      FID_INPUT_DATE_1:
        startDate,

      FID_INPUT_DATE_2:
        endDate,

      /*
       * D / W / M / Y
       */
      FID_PERIOD_DIV_CODE:
        period,

      /*
       * KIS 기간별시세 API:
       *
       * 0 = 수정주가 기준
       * 1 = 원주가 기준
       *
       * 백테스트에서는
       * 수정주가를 기본값으로 한다.
       */
      FID_ORG_ADJ_PRC:
        adjustedPrice
          ? "0"
          : "1",
    });

  const response =
    await fetch(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
      {
        method:
          "GET",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          authorization:
            `Bearer ${accessToken}`,

          appkey:
            appKey,

          appsecret:
            appSecret,

          tr_id:
            "FHKST03010100",

          /*
           * 개인 고객
           */
          custtype:
            "P",
        },

        cache:
          "no-store",
      },
    );

  const body =
    (await response.json()) as
      KisDomesticDailyPriceResponse;

  if (
    !response.ok
  ) {
    throw new Error(
      body.msg1 ||
        `${stockCode} KIS 과거시세 조회 실패: HTTP ${response.status}`,
    );
  }

  if (
    body.rt_cd !==
    "0"
  ) {
    throw new Error(
      `${stockCode} KIS 과거시세 조회 실패: ${
        body.msg1 ||
        body.msg_cd
      }`,
    );
  }

  /*
   * API 응답에 output2가 없는
   * 비정상 상황도 방어
   */
  if (
    !Array.isArray(
      body.output2,
    )
  ) {
    return {
      ...body,
      output2: [],
    };
  }

  return body;
}
/*
 * ============================================================
 * Market Regime v7 - domestic index daily chart
 * endpoint:
 * /uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice
 * TR: FHKUP03500100
 * market: U
 * 0001 = KOSPI
 * 1001 = KOSDAQ
 * ============================================================
 */

export interface GetDomesticDailyIndexPricesInput {
  indexCode: string;
  startDate: string;
  endDate: string;
  period?: "D" | "W" | "M" | "Y";
}

export interface KisDomesticDailyIndexPriceOutput {
  stck_bsop_date?: string;
  bstp_nmix_prpr?: string | number | null;
  bstp_nmix_oprc?: string | number | null;
  bstp_nmix_hgpr?: string | number | null;
  bstp_nmix_lwpr?: string | number | null;
  acml_vol?: string | number | null;
  acml_tr_pbmn?: string | number | null;
  mod_yn?: string | null;
  [key: string]: unknown;
}

export interface KisDomesticDailyIndexPriceResponse {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
  output1?: Record<string, unknown> | null;
  output2?: KisDomesticDailyIndexPriceOutput[];
  [key: string]: unknown;
}

export async function getDomesticDailyIndexPrices(
  input: GetDomesticDailyIndexPricesInput,
  accessToken: string,
): Promise<KisDomesticDailyIndexPriceResponse> {
  const {
    appKey,
    appSecret,
    baseUrl,
  } = getKisConfig();

  const indexCode = input.indexCode.trim();
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  const period = input.period ?? "D";

  if (!/^\d{4}$/.test(indexCode)) {
    throw new Error(
      `INVALID_INDEX_CODE: ${indexCode}`,
    );
  }

  if (
    !/^\d{8}$/.test(startDate) ||
    !/^\d{8}$/.test(endDate)
  ) {
    throw new Error(
      "KIS index dates must use YYYYMMDD.",
    );
  }

  if (startDate > endDate) {
    throw new Error(
      "KIS index startDate cannot be after endDate.",
    );
  }

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: indexCode,
      FID_INPUT_DATE_1: startDate,
      FID_INPUT_DATE_2: endDate,
      FID_PERIOD_DIV_CODE: period,
    });

  const response =
    await fetch(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice?${params}`,
      {
        method: "GET",
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",
          authorization:
            `Bearer ${accessToken}`,
          appkey: appKey,
          appsecret: appSecret,
          tr_id: "FHKUP03500100",
          custtype: "P",
        },
        cache: "no-store",
      },
    );

  const body =
    (await response.json()) as
      KisDomesticDailyIndexPriceResponse;

  if (!response.ok) {
    throw new Error(
      body.msg1 ||
        `${indexCode} KIS index daily chart failed: HTTP ${response.status}`,
    );
  }

  if (body.rt_cd !== "0") {
    throw new Error(
      `${indexCode} KIS index daily chart failed: ${
        body.msg1 ||
        body.msg_cd ||
        "UNKNOWN_KIS_ERROR"
      }`,
    );
  }

  if (!Array.isArray(body.output2)) {
    return {
      ...body,
      output2: [],
    };
  }

  return body;
}