import type {
  AlphaCandidateInput,
  AlphaFeatureEvidence,
} from "./candidate-scoring";

export interface DisclosurePredictionCandidate {
  stock_code: string;
  stock_name?: string | null;
  score: number;
  direction?: string | null;
  confidence: number;
  is_candidate?: boolean | null;
}

export interface DisclosurePredictionGate {
  available: boolean;
  fresh: boolean;
  predictionDate: string | null;
  generatedAt: string | null;
  modelName: string | null;
  modelVersion: string | null;
  ageMinutes?: number | null;
  maximumAgeMinutes?: number | null;
  candidateCount?: number | null;
  stockCodes?: string[];
  candidates?: DisclosurePredictionCandidate[];
  reason?: string | null;
}

export interface MarketRegimeShadow {
  mode?: string | null;
  appliedToOrders?: boolean | null;
  regime: string | null;
  wouldBlockByRegime?: boolean | null;
  breadth20: number | null;
  avgReturn20: number | null;
  sampleSize?: number | null;
  returnSampleSize?: number | null;
  stockCodes?: string[];
  latestMarketDate?: string | null;
  latestSnapshotObservedAt?: string | null;
  observedAt: string | null;
  source?: string | null;
  reason?: string | null;
}

export interface MarketSnapshotLike {
  stock_code: string;
  observed_at: string;
  close_price: number | string | null;
  open_price: number | string | null;
  high_price: number | string | null;
  low_price: number | string | null;
  volume: number | string | null;
}

export interface AlphaRealFeatureAdapterInput {
  stockCode: string;
  decisionAt: string;

  disclosurePredictionGate?: DisclosurePredictionGate | null;
  marketRegimeShadow?: MarketRegimeShadow | null;
  marketSnapshots?: MarketSnapshotLike[];

  flowEvidence?: AlphaFeatureEvidence;
  eventPersistenceEvidence?: AlphaFeatureEvidence;
  riskEvidence?: AlphaFeatureEvidence;

  modelId?: string;
  modelVersion?: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeStockCode(value: string): string {
  const normalized = value.trim();

  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(
      `INVALID_STOCK_CODE:${value}`,
    );
  }

  return normalized;
}

function marketRegimeScore(
  regime: string | null,
  breadth20: number | null,
  avgReturn20: number | null,
): number {
  const normalized =
    String(regime ?? "")
      .trim()
      .toUpperCase();

  const regimeBase =
    normalized === "BULL"
      ? 0.85
      : normalized === "BEAR"
        ? 0.20
        : 0.50;

  const breadthScore =
    breadth20 === null
      ? 0.50
      : clamp01(breadth20);

  const returnScore =
    avgReturn20 === null
      ? 0.50
      : clamp01(
          (avgReturn20 + 0.10) / 0.20,
        );

  return clamp01(
    regimeBase * 0.50 +
    breadthScore * 0.30 +
    returnScore * 0.20,
  );
}

function predictionToCatalyst(
  stockCode: string,
  gate: DisclosurePredictionGate,
): AlphaFeatureEvidence | undefined {
  if (
    !gate.available ||
    !gate.fresh ||
    !gate.generatedAt
  ) {
    return undefined;
  }

  const candidate =
    (gate.candidates ?? [])
      .find(
        (row) =>
          String(row.stock_code)
            .padStart(6, "0") ===
          stockCode,
      );

  if (!candidate) {
    return undefined;
  }

  const rawScore =
    clamp01(
      toNumber(candidate.score) ?? 0.5,
    );

  const rawConfidence =
    clamp01(
      toNumber(candidate.confidence) ??
      0.5,
    );

  const direction =
    String(
      candidate.direction ?? "",
    )
      .trim()
      .toUpperCase();

  const directionalScore =
    direction === "UP"
      ? rawScore
      : direction === "DOWN"
        ? 1 - rawScore
        : 0.5 + (rawScore - 0.5) * 0.35;

  return {
    score:
      clamp01(directionalScore),

    confidence:
      rawConfidence,

    availableAt:
      gate.generatedAt,

    source:
      gate.modelName ??
      "DISCLOSURE_PREDICTION_GATE",

    sourceVersion:
      gate.modelVersion ??
      undefined,

    maxAgeMinutes:
      gate.maximumAgeMinutes ??
      180,

    metadata: {
      predictionDate:
        gate.predictionDate,

      direction:
        candidate.direction ?? null,

      isCandidate:
        candidate.is_candidate ?? null,

      upstreamScore:
        rawScore,

      upstreamConfidence:
        rawConfidence,

      gateReason:
        gate.reason ?? null,
    },
  };
}

function regimeToFeature(
  regime: MarketRegimeShadow,
): AlphaFeatureEvidence | undefined {
  if (!regime.observedAt) {
    return undefined;
  }

  const breadth20 =
    toNumber(regime.breadth20);

  const avgReturn20 =
    toNumber(regime.avgReturn20);

  const sampleSize =
    Math.max(
      0,
      Math.floor(
        toNumber(regime.sampleSize) ?? 0,
      ),
    );

  const confidence =
    clamp01(
      sampleSize <= 0
        ? 0.45
        : 0.55 +
          Math.min(sampleSize, 50) /
            50 *
            0.35,
    );

  return {
    score:
      marketRegimeScore(
        regime.regime,
        breadth20,
        avgReturn20,
      ),

    confidence,

    availableAt:
      regime.observedAt,

    observedAt:
      regime.latestSnapshotObservedAt ??
      regime.observedAt,

    source:
      regime.source ??
      "MARKET_REGIME_SHADOW",

    sourceVersion:
      "alpha-adapter-v1",

    maxAgeMinutes:
      240,

    metadata: {
      regime:
        regime.regime,

      breadth20,
      avgReturn20,
      sampleSize,

      latestMarketDate:
        regime.latestMarketDate ?? null,

      wouldBlockByRegime:
        regime.wouldBlockByRegime ?? null,
    },
  };
}

function priceVolumeAndLiquidity(
  stockCode: string,
  snapshots: MarketSnapshotLike[],
): {
  priceVolume?: AlphaFeatureEvidence;
  liquidity?: AlphaFeatureEvidence;
} {
  const rows =
    snapshots
      .filter(
        (row) =>
          String(row.stock_code)
            .padStart(6, "0") ===
          stockCode,
      )
      .sort(
        (a, b) =>
          new Date(b.observed_at).getTime() -
          new Date(a.observed_at).getTime(),
      );

  const latest = rows[0];

  if (!latest) {
    return {};
  }

  const latestClose =
    toNumber(latest.close_price);

  if (
    latestClose === null ||
    latestClose <= 0
  ) {
    return {};
  }

  const latestOpen =
    toNumber(latest.open_price);

  const latestHigh =
    toNumber(latest.high_price);

  const latestLow =
    toNumber(latest.low_price);

  const latestVolume =
    Math.max(
      0,
      toNumber(latest.volume) ?? 0,
    );

  const priorClose =
    toNumber(rows[1]?.close_price) ??
    latestOpen ??
    latestClose;

  const momentum =
    priorClose > 0
      ? (
          latestClose -
          priorClose
        ) / priorClose
      : 0;

  const intraday =
    latestOpen !== null &&
    latestOpen > 0
      ? (
          latestClose -
          latestOpen
        ) / latestOpen
      : 0;

  const rangePosition =
    latestHigh !== null &&
    latestLow !== null &&
    latestHigh > latestLow
      ? clamp01(
          (
            latestClose -
            latestLow
          ) /
          (
            latestHigh -
            latestLow
          ),
        )
      : 0.5;

  const priorVolumes =
    rows
      .slice(1, 11)
      .map(
        (row) =>
          toNumber(row.volume),
      )
      .filter(
        (value): value is number =>
          value !== null &&
          value > 0,
      );

  const averagePriorVolume =
    priorVolumes.length > 0
      ? priorVolumes.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) / priorVolumes.length
      : latestVolume;

  const volumeRatio =
    averagePriorVolume > 0
      ? latestVolume /
        averagePriorVolume
      : 1;

  const momentumScore =
    clamp01(
      (momentum + 0.04) / 0.10,
    );

  const intradayScore =
    clamp01(
      (intraday + 0.025) / 0.06,
    );

  const volumeScore =
    clamp01(
      (volumeRatio - 0.60) / 1.80,
    );

  const priceVolumeScore =
    clamp01(
      momentumScore * 0.40 +
      intradayScore * 0.20 +
      rangePosition * 0.15 +
      volumeScore * 0.25,
    );

  const snapshotCoverage =
    clamp01(
      rows.length / 10,
    );

  const priceVolume:
    AlphaFeatureEvidence = {
      score:
        priceVolumeScore,

      confidence:
        0.55 +
        snapshotCoverage * 0.40,

      availableAt:
        latest.observed_at,

      observedAt:
        latest.observed_at,

      source:
        "MARKET_SNAPSHOTS_PRICE_VOLUME",

      sourceVersion:
        "alpha-adapter-v1",

      maxAgeMinutes:
        240,

      metadata: {
        snapshotCount:
          rows.length,

        momentum,
        intraday,
        rangePosition,
        volumeRatio,
      },
    };

  const turnoverProxy =
    latestClose *
    latestVolume;

  const turnoverLog10 =
    turnoverProxy > 0
      ? Math.log10(turnoverProxy)
      : 0;

  const liquidityScore =
    clamp01(
      (turnoverLog10 - 7) / 4,
    );

  const liquidity:
    AlphaFeatureEvidence = {
      score:
        liquidityScore,

      confidence:
        Math.min(
          0.78,
          0.50 +
          snapshotCoverage * 0.28,
        ),

      availableAt:
        latest.observed_at,

      observedAt:
        latest.observed_at,

      source:
        "MARKET_SNAPSHOTS_TURNOVER_PROXY",

      sourceVersion:
        "alpha-adapter-v1",

      maxAgeMinutes:
        240,

      metadata: {
        closePrice:
          latestClose,

        volume:
          latestVolume,

        turnoverProxy,

        snapshotCount:
          rows.length,

        limitation:
          "NO_ORDERBOOK_OR_MARKET_CAP_YET",
      },
    };

  return {
    priceVolume,
    liquidity,
  };
}

export function buildAlphaCandidateInputFromRealSources(
  input: AlphaRealFeatureAdapterInput,
): AlphaCandidateInput {
  const stockCode =
    normalizeStockCode(
      input.stockCode,
    );

  const catalyst =
    input.disclosurePredictionGate
      ? predictionToCatalyst(
          stockCode,
          input.disclosurePredictionGate,
        )
      : undefined;

  const marketRegime =
    input.marketRegimeShadow
      ? regimeToFeature(
          input.marketRegimeShadow,
        )
      : undefined;

  const {
    priceVolume,
    liquidity,
  } =
    priceVolumeAndLiquidity(
      stockCode,
      input.marketSnapshots ?? [],
    );

  return {
    stockCode,
    decisionAt:
      input.decisionAt,

    modelId:
      input.modelId,

    modelVersion:
      input.modelVersion,

    features: {
      catalyst,
      flow:
        input.flowEvidence,

      marketRegime,
      priceVolume,
      liquidity,

      eventPersistence:
        input.eventPersistenceEvidence,

      riskPenalty:
        input.riskEvidence,
    },

    metadata: {
      adapterVersion:
        "ALPHA_V1_REAL_FEATURE_ADAPTERS",

      sourcePresence: {
        catalyst:
          Boolean(catalyst),

        flow:
          Boolean(input.flowEvidence),

        marketRegime:
          Boolean(marketRegime),

        priceVolume:
          Boolean(priceVolume),

        liquidity:
          Boolean(liquidity),

        eventPersistence:
          Boolean(
            input.eventPersistenceEvidence,
          ),

        riskPenalty:
          Boolean(input.riskEvidence),
      },
    },
  };
}
