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
  [key: string]: string | undefined;
}

export interface KisDomesticPriceResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output: KisDomesticPriceOutput;
}

let tokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

function getKisConfig() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (!appKey || !appSecret) {
    throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET이 없습니다.");
  }

  return {
    appKey,
    appSecret,
    baseUrl,
  };
}

export async function issueKisAccessToken(): Promise<KisTokenResponse> {
  const { appKey, appSecret, baseUrl } = getKisConfig();

  const response = await fetch(`${baseUrl}/oauth2/tokenP`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
    cache: "no-store",
  });

  const body = (await response.json()) as Partial<KisTokenResponse> & {
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        `KIS 접근토큰 발급 실패: HTTP ${response.status}`,
    );
  }

  return body as KisTokenResponse;
}

export async function getKisAccessToken(): Promise<string> {
  const now = Date.now();

  if (tokenCache && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const token = await issueKisAccessToken();
  const expiresIn = Number(token.expires_in);

  tokenCache = {
    accessToken: token.access_token,
    expiresAt:
      now +
      (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };

  return token.access_token;
}

export async function getDomesticStockPrice(
  stockCode: string,
  accessToken: string,
): Promise<KisDomesticPriceResponse> {
  const { appKey, appSecret, baseUrl } = getKisConfig();

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: stockCode,
  });

  const response = await fetch(
    `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: "FHKST01010100",
      },
      cache: "no-store",
    },
  );

  const body = (await response.json()) as KisDomesticPriceResponse;

  if (!response.ok) {
    throw new Error(
      body.msg1 || `KIS 현재가 조회 실패: HTTP ${response.status}`,
    );
  }

  if (body.rt_cd !== "0") {
    throw new Error(
      `${stockCode} 현재가 조회 실패: ${body.msg1 || body.msg_cd}`,
    );
  }

  return body;
}