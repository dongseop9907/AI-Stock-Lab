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

function sleep(
  milliseconds: number,
) {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds,
    );
  });
}

async function getStockPriceWithRetry(
  stockCode: string,
  accessToken: string,
  maxAttempts = 3,
) {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      return await getDomesticStockPrice(
        stockCode,
        accessToken,
      );
    } catch (error) {
      lastError = error;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const isRateLimitError =
        message.includes(
          "초당 거래건수를 초과",
        ) ||
        message.includes(
          "EGW00201",
        );

      if (
        !isRateLimitError ||
        attempt === maxAttempts
      ) {
        throw error;
      }

      /*
       * 1차 실패: 2초
       * 2차 실패: 4초
       */
      await sleep(
        2000 * attempt,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `${stockCode} 현재가 조회에 실패했습니다.`,
      );
}

function toNullableNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numberValue =
    Number(
      String(value).replaceAll(
        ",",
        "",
      ),
    );

  return Number.isFinite(
    numberValue,
  )
    ? numberValue
    : null;
}

/*
 * 한국시간 기준 현재 날짜/시간 정보를 만든다.
 */
function getKoreanDateTimeParts(
  date = new Date(),
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        weekday: "short",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23",
      },
    ).formatToParts(date);

  return Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ]),
  );
}

/*
 * 현재가 한국 주식 정규장 시간인지 검사한다.
 *
 * 월~금
 * 09:00 ~ 15:30 KST
 *
 * 공휴일 검사는 이후 거래소 캘린더 단계에서
 * 추가한다.
 */
function isKoreanRegularMarketSession(
  date = new Date(),
): boolean {
  const values =
    getKoreanDateTimeParts(
      date,
    );

  const weekday =
    values.weekday;

  if (
    weekday === "Sat" ||
    weekday === "Sun"
  ) {
    return false;
  }

  const hour =
    Number(values.hour);

  const minute =
    Number(values.minute);

  const minutes =
    hour * 60 +
    minute;

  const marketOpen =
    9 * 60;

  const marketClose =
    15 * 60 + 30;

  return (
    minutes >= marketOpen &&
    minutes <= marketClose
  );
}

function getKoreanDate(
  date = new Date(),
): string {
  const values =
    getKoreanDateTimeParts(
      date,
    );

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}

export async function syncMarketSnapshots() {
  const supabase =
    createSupabaseServerClient();

  const collectionStartedAt =
    new Date();

  /*
   * 주말이나 정규장 외 시간에
   * 이전 거래일 가격을 새 데이터처럼
   * 저장하는 것을 차단한다.
   */
  if (
    !isKoreanRegularMarketSession(
      collectionStartedAt,
    )
  ) {
    return {
      skipped: true,

      reason:
        "OUTSIDE_KOREAN_REGULAR_MARKET_SESSION",

      marketDate:
        getKoreanDate(
          collectionStartedAt,
        ),

      observedAt:
        collectionStartedAt.toISOString(),

      requested: 0,
      saved: 0,
      failures: [],
    };
  }

  const {
    data: stocks,
    error: stockError,
  } = await supabase
    .from("stocks")
    .select(`
      stock_code,
      stock_name
    `)
    .eq(
      "is_active",
      true,
    )
    .order(
      "stock_code",
      {
        ascending: true,
      },
    );

  if (stockError) {
    throw new Error(
      `종목 조회 실패: ${stockError.message}`,
    );
  }

  const activeStocks =
    (stocks ??
      []) as ActiveStock[];

  if (
    activeStocks.length === 0
  ) {
    return {
      skipped: false,

      observedAt: null,

      requested: 0,
      saved: 0,

      failures: [],
    };
  }

  const accessToken =
    await getKisAccessToken();

  const snapshots: Array<{
    stock_code: string;
    observed_at: string;

    open_price:
      | number
      | null;

    high_price:
      | number
      | null;

    low_price:
      | number
      | null;

    close_price:
      | number
      | null;

    volume:
      | number
      | null;

    raw_payload:
      Record<
        string,
        unknown
      >;
  }> = [];

  const failures:
    SyncFailure[] = [];

  for (
    const [
      index,
      stock,
    ] of activeStocks.entries()
  ) {
    try {
      const response =
        await getStockPriceWithRetry(
          stock.stock_code,
          accessToken,
        );

      const output =
        response.output;

      /*
       * 중요:
       * 15:30 고정값을 사용하지 않는다.
       *
       * 실제로 해당 종목의 API 응답을
       * 받은 시각을 observed_at으로 기록한다.
       */
      const collectedAt =
        new Date();

      const observedAt =
        collectedAt.toISOString();

      snapshots.push({
        stock_code:
          stock.stock_code,

        observed_at:
          observedAt,

        open_price:
          toNullableNumber(
            output.stck_oprc,
          ),

        high_price:
          toNullableNumber(
            output.stck_hgpr,
          ),

        low_price:
          toNullableNumber(
            output.stck_lwpr,
          ),

        close_price:
          toNullableNumber(
            output.stck_prpr,
          ),

        volume:
          toNullableNumber(
            output.acml_vol,
          ),

        raw_payload: {
          source:
            "KIS_DOMESTIC_PRICE",

          collected_at:
            observedAt,

          market_date:
            getKoreanDate(
              collectedAt,
            ),

          response,
        },
      });
    } catch (error) {
      failures.push({
        stockCode:
          stock.stock_code,

        stockName:
          stock.stock_name,

        message:
          error instanceof Error
            ? error.message
            : "알 수 없는 시세 조회 오류",
      });
    }

    /*
     * KIS 호출 제한 방지
     */
    if (
      index <
      activeStocks.length - 1
    ) {
      await sleep(1500);
    }
  }

  if (
    snapshots.length > 0
  ) {
    const {
      error: saveError,
    } = await supabase
      .from(
        "market_snapshots",
      )
      .upsert(
        snapshots,
        {
          onConflict:
            "stock_code,observed_at",
        },
      );

    if (saveError) {
      throw new Error(
        `시세 저장 실패: ${saveError.message}`,
      );
    }
  }

  return {
    skipped: false,

    observedAt:
      snapshots[0]
        ?.observed_at ??
      null,

    requested:
      activeStocks.length,

    saved:
      snapshots.length,

    failures,
  };
}