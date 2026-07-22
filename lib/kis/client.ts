interface KisTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  access_token_token_expired?: string;
}

export async function issueKisAccessToken(): Promise<KisTokenResponse> {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const baseUrl = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

  if (!appKey || !appSecret) {
    throw new Error("KIS_APP_KEY or KIS_APP_SECRET is missing.");
  }

  const response = await fetch(`${baseUrl}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`KIS token request failed: ${response.status}`);
  return response.json();
}

export async function getDomesticStockPrice(stockCode: string, accessToken: string) {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const baseUrl = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

  if (!appKey || !appSecret) throw new Error("KIS credentials are missing.");

  const params = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stockCode });
  const response = await fetch(`${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST01010100",
    },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`KIS quote request failed: ${response.status}`);
  return response.json();
}
