import { createSupabaseServerClient } from "@/lib/supabase";

interface GenerateStockPredictionsInput {
  disclosureLookbackDays?: number;
  candidateThreshold?: number;
}

interface StockRecord {
  stock_code: string;
  stock_name: string;
  market: string | null;
  sector: string | null;
}

interface MarketSnapshotRecord {
  id: number | string;
  stock_code: string;
  observed_at: string;

  open_price:
    | number
    | string
    | null;

  high_price:
    | number
    | string
    | null;

  low_price:
    | number
    | string
    | null;

  close_price:
    | number
    | string
    | null;

  volume:
    | number
    | string
    | null;

  raw_payload: unknown;
}

interface DisclosureRecord {
  stock_code: string;
  report_name: string;
  received_date: string;

  importance_score:
    | number
    | string;

  sentiment_hint:
    | "POSITIVE"
    | "NEGATIVE"
    | "NEUTRAL";
}

interface PredictionRow {
  stock_code: string;
  stock_name: string;
  score: number;
  direction: "UP" | "NEUTRAL" | "DOWN";
  confidence: number;
  is_candidate: boolean;
}

export interface GenerateStockPredictionsResult {
  predictionDate: string;
  modelName: string;
  modelVersion: string;

  analyzed: number;
  saved: number;

  upCount: number;
  neutralCount: number;
  downCount: number;
  candidateCount: number;

  predictions: PredictionRow[];
}

const MODEL_NAME =
  "DISCLOSURE_PRICE_RULE";

const MODEL_VERSION =
  "v1";

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function roundNumber(
  value: number,
  digits = 6,
): number {
  return Number(
    value.toFixed(digits),
  );
}

function getKoreaDate(
  date = new Date(),
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

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

  return `${values.year}-${values.month}-${values.day}`;
}

function getRawSource(
  value: unknown,
): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return "";
  }

  const source =
    (
      value as Record<
        string,
        unknown
      >
    ).source;

  return typeof source ===
    "string"
    ? source
    : "";
}

function isTestSnapshot(
  snapshot: MarketSnapshotRecord,
): boolean {
  const source =
    getRawSource(
      snapshot.raw_payload,
    ).toUpperCase();

  return (
    source.includes("TEST") ||
    source.includes("MOCK") ||
    source.includes("DUMMY")
  );
}

function calculateAverage(
  values: number[],
): number | null {
  if (values.length === 0) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    values.length
  );
}

function getDisclosureAgeDays(
  receivedDate: string,
  now: Date,
): number {
  const parsed =
    new Date(
      `${receivedDate}T00:00:00+09:00`,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return 365;
  }

  return Math.max(
    0,
    (
      now.getTime() -
      parsed.getTime()
    ) /
      (
        24 *
        60 *
        60 *
        1000
      ),
  );
}

export async function generateStockPredictions(
  input: GenerateStockPredictionsInput = {},
): Promise<GenerateStockPredictionsResult> {
  const supabase =
    createSupabaseServerClient();

  const now =
    new Date();

  const nowIso =
    now.toISOString();

  const predictionDate =
    getKoreaDate(now);

  const disclosureLookbackDays =
    Math.min(
      90,
      Math.max(
        1,
        Math.floor(
          input.disclosureLookbackDays ??
            14,
        ),
      ),
    );

  const candidateThreshold =
    clamp(
      Number.isFinite(
        input.candidateThreshold,
      )
        ? Number(
            input.candidateThreshold,
          )
        : 0.62,
      0.5,
      0.9,
    );

  const disclosureSince =
    getKoreaDate(
      new Date(
        now.getTime() -
          disclosureLookbackDays *
            24 *
            60 *
            60 *
            1000,
      ),
    );

  const [
    stockResult,
    snapshotResult,
    disclosureResult,
  ] =
    await Promise.all([
      supabase
        .from("stocks")
        .select(`
          stock_code,
          stock_name,
          market,
          sector
        `)
        .eq("is_active", true)
        .order(
          "stock_code",
          {
            ascending: true,
          },
        ),

      supabase
        .from(
          "market_snapshots",
        )
        .select(`
          id,
          stock_code,
          observed_at,
          open_price,
          high_price,
          low_price,
          close_price,
          volume,
          raw_payload
        `)
        .lte(
          "observed_at",
          nowIso,
        )
        .order(
          "observed_at",
          {
            ascending: false,
          },
        )
        .limit(2000),

      supabase
        .from(
          "dart_disclosures",
        )
        .select(`
          stock_code,
          report_name,
          received_date,
          importance_score,
          sentiment_hint
        `)
        .gte(
          "received_date",
          disclosureSince,
        )
        .lte(
          "received_date",
          predictionDate,
        )
        .order(
          "received_date",
          {
            ascending: false,
          },
        )
        .limit(3000),
    ]);

  if (stockResult.error) {
    throw new Error(
      `예측 대상 종목 조회 실패: ${stockResult.error.message}`,
    );
  }

  if (snapshotResult.error) {
    throw new Error(
      `예측 시세 조회 실패: ${snapshotResult.error.message}`,
    );
  }

  if (disclosureResult.error) {
    throw new Error(
      `예측 공시 조회 실패: ${disclosureResult.error.message}`,
    );
  }

  const stocks =
    (
      stockResult.data ??
      []
    ) as StockRecord[];

  const snapshots =
    (
      snapshotResult.data ??
      []
    ) as MarketSnapshotRecord[];

  const disclosures =
    (
      disclosureResult.data ??
      []
    ) as DisclosureRecord[];

  const snapshotMap =
    new Map<
      string,
      MarketSnapshotRecord[]
    >();

  for (const snapshot of snapshots) {
    if (
      isTestSnapshot(snapshot)
    ) {
      continue;
    }

    const closePrice =
      toNumber(
        snapshot.close_price,
      );

    if (
      closePrice === null ||
      closePrice <= 0
    ) {
      continue;
    }

    const stockSnapshots =
      snapshotMap.get(
        snapshot.stock_code,
      ) ??
      [];

    if (
      stockSnapshots.length <
      30
    ) {
      stockSnapshots.push(
        snapshot,
      );

      snapshotMap.set(
        snapshot.stock_code,
        stockSnapshots,
      );
    }
  }

  const disclosureMap =
    new Map<
      string,
      DisclosureRecord[]
    >();

  for (
    const disclosure of
    disclosures
  ) {
    const stockDisclosures =
      disclosureMap.get(
        disclosure.stock_code,
      ) ??
      [];

    stockDisclosures.push(
      disclosure,
    );

    disclosureMap.set(
      disclosure.stock_code,
      stockDisclosures,
    );
  }

  const databaseRows: Array<
    Record<string, unknown>
  > = [];

  const predictions:
    PredictionRow[] = [];

  for (const stock of stocks) {
    const stockSnapshots =
      snapshotMap.get(
        stock.stock_code,
      ) ??
      [];

    if (
      stockSnapshots.length === 0
    ) {
      continue;
    }

    const latestSnapshot =
      stockSnapshots[0];

    const previousSnapshot =
      stockSnapshots[1] ??
      null;

    const latestPrice =
      toNumber(
        latestSnapshot.close_price,
      );

    if (
      latestPrice === null ||
      latestPrice <= 0
    ) {
      continue;
    }

    const previousPrice =
      toNumber(
        previousSnapshot
          ?.close_price,
      );

    const openPrice =
      toNumber(
        latestSnapshot.open_price,
      );

    const highPrice =
      toNumber(
        latestSnapshot.high_price,
      );

    const lowPrice =
      toNumber(
        latestSnapshot.low_price,
      );

    const latestVolume =
      toNumber(
        latestSnapshot.volume,
      );

    const previousVolumes =
      stockSnapshots
        .slice(1, 11)
        .map(
          (snapshot) =>
            toNumber(
              snapshot.volume,
            ),
        )
        .filter(
          (
            value,
          ): value is number =>
            value !== null &&
            value > 0,
        );

    const averagePreviousVolume =
      calculateAverage(
        previousVolumes,
      );

    const momentumRate =
      previousPrice &&
      previousPrice > 0
        ? latestPrice /
            previousPrice -
          1
        : 0;

    const intradayReturn =
      openPrice &&
      openPrice > 0
        ? latestPrice /
            openPrice -
          1
        : 0;

    const rangePosition =
      highPrice !== null &&
      lowPrice !== null &&
      highPrice > lowPrice
        ? clamp(
            (
              latestPrice -
              lowPrice
            ) /
              (
                highPrice -
                lowPrice
              ),
            0,
            1,
          )
        : 0.5;

    const volumeRatio =
      latestVolume &&
      averagePreviousVolume &&
      averagePreviousVolume >
        0
        ? latestVolume /
          averagePreviousVolume
        : 1;

    const stockDisclosures =
      disclosureMap.get(
        stock.stock_code,
      ) ??
      [];

    let signedDisclosureImpact =
      0;

    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    const disclosureReasons:
      string[] = [];

    for (
      const disclosure of
      stockDisclosures
    ) {
      const importance =
        clamp(
          toNumber(
            disclosure
              .importance_score,
          ) ??
            0.3,
          0,
          1,
        );

      const ageDays =
        getDisclosureAgeDays(
          disclosure.received_date,
          now,
        );

      /*
       * 7일마다 영향력을 절반으로 줄인다.
       */
      const recencyWeight =
        Math.pow(
          0.5,
          ageDays / 7,
        );

      const weightedImpact =
        importance *
        recencyWeight;

      if (
        disclosure.sentiment_hint ===
        "POSITIVE"
      ) {
        signedDisclosureImpact +=
          weightedImpact;

        positiveCount += 1;

        if (
          disclosureReasons.length <
          3
        ) {
          disclosureReasons.push(
            `긍정 공시: ${disclosure.report_name}`,
          );
        }
      } else if (
        disclosure.sentiment_hint ===
        "NEGATIVE"
      ) {
        signedDisclosureImpact -=
          weightedImpact;

        negativeCount += 1;

        if (
          disclosureReasons.length <
          3
        ) {
          disclosureReasons.push(
            `부정 공시: ${disclosure.report_name}`,
          );
        }
      } else {
        neutralCount += 1;
      }
    }

    const disclosureScore =
      clamp(
        signedDisclosureImpact /
          2,
        -1,
        1,
      );

    const momentumNormalized =
      clamp(
        momentumRate / 0.03,
        -1,
        1,
      );

    const intradayNormalized =
      clamp(
        intradayReturn / 0.05,
        -1,
        1,
      );

    const rangeNormalized =
      clamp(
        (
          rangePosition -
          0.5
        ) *
          2,
        -1,
        1,
      );

    const volumeNormalized =
      clamp(
        (
          volumeRatio -
          1
        ) /
          1.5,
        -1,
        1,
      );

    const score =
      clamp(
        0.5 +
          momentumNormalized *
            0.16 +
          intradayNormalized *
            0.12 +
          rangeNormalized *
            0.08 +
          volumeNormalized *
            0.04 +
          disclosureScore *
            0.20,
        0,
        1,
      );

    const roundedScore =
      roundNumber(score);

    const direction:
      | "UP"
      | "NEUTRAL"
      | "DOWN" =
      roundedScore >=
      candidateThreshold
        ? "UP"
        : roundedScore <=
            0.38
          ? "DOWN"
          : "NEUTRAL";

    const snapshotAgeMinutes =
      Math.max(
        0,
        (
          now.getTime() -
          new Date(
            latestSnapshot
              .observed_at,
          ).getTime()
        ) /
          (
            60 *
            1000
          ),
      );

    const freshnessScore =
      snapshotAgeMinutes <= 30
        ? 1
        : snapshotAgeMinutes <=
            24 * 60
          ? 0.7
          : 0.35;

    const dataCompleteness =
      clamp(
        stockSnapshots.length /
          10,
        0,
        1,
      );

    const disclosureCompleteness =
      clamp(
        stockDisclosures.length /
          3,
        0,
        1,
      );

    const confidence =
      clamp(
        0.25 +
          Math.abs(
            roundedScore -
              0.5,
          ) *
            0.8 +
          freshnessScore *
            0.20 +
          dataCompleteness *
            0.15 +
          disclosureCompleteness *
            0.10,
        0,
        1,
      );

    const reasons:
      string[] = [];

    if (
      momentumRate > 0.005
    ) {
      reasons.push(
        "최근 관측 가격보다 상승했습니다.",
      );
    } else if (
      momentumRate < -0.005
    ) {
      reasons.push(
        "최근 관측 가격보다 하락했습니다.",
      );
    }

    if (
      intradayReturn >
      0.01
    ) {
      reasons.push(
        "시가보다 현재 가격이 강합니다.",
      );
    } else if (
      intradayReturn <
      -0.01
    ) {
      reasons.push(
        "시가보다 현재 가격이 약합니다.",
      );
    }

    if (
      rangePosition >= 0.7
    ) {
      reasons.push(
        "당일 고가 부근에 위치합니다.",
      );
    }

    if (
      volumeRatio >= 1.3
    ) {
      reasons.push(
        "최근 평균보다 거래량이 증가했습니다.",
      );
    }

    reasons.push(
      ...disclosureReasons,
    );

    if (
      snapshotAgeMinutes >
      24 * 60
    ) {
      reasons.push(
        "최신 시세가 오래되어 신뢰도를 낮췄습니다.",
      );
    }

    if (
      reasons.length === 0
    ) {
      reasons.push(
        "뚜렷한 상승 또는 하락 요인이 없습니다.",
      );
    }

    const latestDisclosureDate =
      stockDisclosures[0]
        ?.received_date ??
      null;

    const isCandidate =
      direction === "UP";

    databaseRows.push({
      stock_code:
        stock.stock_code,

      prediction_date:
        predictionDate,

      generated_at:
        nowIso,

      model_name:
        MODEL_NAME,

      model_version:
        MODEL_VERSION,

      score:
        roundedScore,

      direction,

      confidence:
        roundNumber(
          confidence,
        ),

      is_candidate:
        isCandidate,

      price_momentum:
        roundNumber(
          momentumRate,
        ),

      intraday_return:
        roundNumber(
          intradayReturn,
        ),

      volume_ratio:
        roundNumber(
          volumeRatio,
        ),

      range_position:
        roundNumber(
          rangePosition,
        ),

      disclosure_score:
        roundNumber(
          disclosureScore,
        ),

      positive_disclosure_count:
        positiveCount,

      negative_disclosure_count:
        negativeCount,

      neutral_disclosure_count:
        neutralCount,

      latest_disclosure_date:
        latestDisclosureDate,

      source_snapshot_id:
        Number(
          latestSnapshot.id,
        ),

      reasons,

      factors: {
        momentumNormalized,
        intradayNormalized,
        rangeNormalized,
        volumeNormalized,
        disclosureScore,
      },

      raw_payload: {
        stockName:
          stock.stock_name,

        market:
          stock.market,

        sector:
          stock.sector,

        latestPrice,

        previousPrice,

        snapshotObservedAt:
          latestSnapshot
            .observed_at,

        snapshotAgeMinutes:
          roundNumber(
            snapshotAgeMinutes,
            2,
          ),

        snapshotCount:
          stockSnapshots.length,

        disclosureCount:
          stockDisclosures.length,

        candidateThreshold,
      },

      updated_at:
        nowIso,
    });

    predictions.push({
      stock_code:
        stock.stock_code,

      stock_name:
        stock.stock_name,

      score:
        roundedScore,

      direction,

      confidence:
        roundNumber(
          confidence,
        ),

      is_candidate:
        isCandidate,
    });
  }

  if (
    databaseRows.length > 0
  ) {
    const {
      error: saveError,
    } = await supabase
      .from(
        "ai_stock_predictions",
      )
      .upsert(
        databaseRows,
        {
          onConflict:
            "stock_code,prediction_date,model_name,model_version",
        },
      );

    if (saveError) {
      throw new Error(
        `AI 종목 예측 저장 실패: ${saveError.message}`,
      );
    }
  }

  predictions.sort(
    (left, right) =>
      right.score -
      left.score,
  );

  return {
    predictionDate,

    modelName:
      MODEL_NAME,

    modelVersion:
      MODEL_VERSION,

    analyzed:
      stocks.length,

    saved:
      databaseRows.length,

    upCount:
      predictions.filter(
        (item) =>
          item.direction ===
          "UP",
      ).length,

    neutralCount:
      predictions.filter(
        (item) =>
          item.direction ===
          "NEUTRAL",
      ).length,

    downCount:
      predictions.filter(
        (item) =>
          item.direction ===
          "DOWN",
      ).length,

    candidateCount:
      predictions.filter(
        (item) =>
          item.is_candidate,
      ).length,

    predictions,
  };
}