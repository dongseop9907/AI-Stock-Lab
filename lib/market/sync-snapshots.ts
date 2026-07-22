import {
  getDomesticStockPrice,
  getKisAccessToken,
} from "@/lib/kis/client";
import { createSupabaseServerClient } from "@/lib/supabase";

interface ActiveStock {
  stock_code: string;
  stock_name: string;
}

interface SyncFailure {
  stockCode: string;
  stockName: string;
  message: string;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function getStockPriceWithRetry(
  stockCode: string,
  accessToken: string,
  maxAttempts = 3,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getDomesticStockPrice(stockCode, accessToken);
    } catch (error) {
      lastError = error;

      const message =
        error instanceof Error ? error.message : String(error);

      const isRateLimitError =
        message.includes("초당 거래건수를 초과") ||
        message.includes("EGW00201");

      if (!isRateLimitError || attempt === maxAttempts) {
        throw error;
      }

      // 1차 실패 시 2초, 2차 실패 시 4초 대기
      await sleep(2000 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${stockCode} 현재가 조회에 실패했습니다.`);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(String(value).replaceAll(",", ""));

  return Number.isFinite(numberValue) ? numberValue : null;
}

function getKoreanObservedAt(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  /*
   * 한 거래일당 하나의 행을 유지하기 위해
   * observed_at을 해당 날짜 15:30 KST로 고정한다.
   */
  return `${values.year}-${values.month}-${values.day}T15:30:00+09:00`;
}

export async function syncMarketSnapshots() {
  const supabase = createSupabaseServerClient();

  const { data: stocks, error: stockError } = await supabase
    .from("stocks")
    .select("stock_code, stock_name")
    .eq("is_active", true)
    .order("stock_code", { ascending: true });

  if (stockError) {
    throw new Error(`종목 조회 실패: ${stockError.message}`);
  }

  const activeStocks = (stocks ?? []) as ActiveStock[];

  if (activeStocks.length === 0) {
    return {
      observedAt: null,
      requested: 0,
      saved: 0,
      failures: [],
    };
  }

  const accessToken = await getKisAccessToken();
  const observedAt = getKoreanObservedAt();

  const snapshots: Array<{
    stock_code: string;
    observed_at: string;
    open_price: number | null;
    high_price: number | null;
    low_price: number | null;
    close_price: number | null;
    volume: number | null;
    raw_payload: object;
  }> = [];

  const failures: SyncFailure[] = [];

  for (const [index, stock] of activeStocks.entries()) {
    try {
      const response = await getStockPriceWithRetry(
        stock.stock_code,
         accessToken,
        );

      const output = response.output;

      snapshots.push({
        stock_code: stock.stock_code,
        observed_at: observedAt,
        open_price: toNullableNumber(output.stck_oprc),
        high_price: toNullableNumber(output.stck_hgpr),
        low_price: toNullableNumber(output.stck_lwpr),
        close_price: toNullableNumber(output.stck_prpr),
        volume: toNullableNumber(output.acml_vol),
        raw_payload: response,
      });
    } catch (error) {
      failures.push({
        stockCode: stock.stock_code,
        stockName: stock.stock_name,
        message:
          error instanceof Error
            ? error.message
            : "알 수 없는 시세 조회 오류",
      });
    }

    /*
     * 처음에는 5개 테스트 종목만 사용한다.
     * 연속 호출 제한을 피하기 위해 요청 사이에 간격을 둔다.
     */
    if (index < activeStocks.length - 1) {
        // 호출 제한을 피하기 위해 종목별 요청 간격 유지
        await sleep(1500);
        }
  }

  if (snapshots.length > 0) {
    const { error: saveError } = await supabase
      .from("market_snapshots")
      .upsert(snapshots, {
        onConflict: "stock_code,observed_at",
      });

    if (saveError) {
      throw new Error(`시세 저장 실패: ${saveError.message}`);
    }
  }

  return {
    observedAt,
    requested: activeStocks.length,
    saved: snapshots.length,
    failures,
  };
}