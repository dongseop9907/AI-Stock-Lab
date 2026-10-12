$ErrorActionPreference = "Stop"

$root = "C:\Users\user\Desktop\ai-stock-lab"
$target = Join-Path $root "lib\kis\client.ts"

if (-not (Test-Path $target)) {
    throw "TARGET_NOT_FOUND: $target"
}

$content = [System.IO.File]::ReadAllText(
    $target,
    [System.Text.Encoding]::UTF8
)

if ($content.Contains("getDomesticDailyIndexPrices")) {
    Write-Host "SKIP: getDomesticDailyIndexPrices already exists."
    exit 0
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$target.backup-index-v7-$timestamp"
Copy-Item $target $backup -Force

$block = @'

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
'@

$utf8NoBom =
    New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
    $target,
    $content + $block,
    $utf8NoBom
)

Write-Host ""
Write-Host "KIS index daily client v7 appended."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Next: npx.cmd tsc --noEmit"