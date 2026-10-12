#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_REAL_FEATURE_ADAPTERS_INSTALLER';

const adapter = "import type {\n  AlphaCandidateInput,\n  AlphaFeatureEvidence,\n} from \"./candidate-scoring\";\n\nexport interface DisclosurePredictionCandidate {\n  stock_code: string;\n  stock_name?: string | null;\n  score: number;\n  direction?: string | null;\n  confidence: number;\n  is_candidate?: boolean | null;\n}\n\nexport interface DisclosurePredictionGate {\n  available: boolean;\n  fresh: boolean;\n  predictionDate: string | null;\n  generatedAt: string | null;\n  modelName: string | null;\n  modelVersion: string | null;\n  ageMinutes?: number | null;\n  maximumAgeMinutes?: number | null;\n  candidateCount?: number | null;\n  stockCodes?: string[];\n  candidates?: DisclosurePredictionCandidate[];\n  reason?: string | null;\n}\n\nexport interface MarketRegimeShadow {\n  mode?: string | null;\n  appliedToOrders?: boolean | null;\n  regime: string | null;\n  wouldBlockByRegime?: boolean | null;\n  breadth20: number | null;\n  avgReturn20: number | null;\n  sampleSize?: number | null;\n  returnSampleSize?: number | null;\n  stockCodes?: string[];\n  latestMarketDate?: string | null;\n  latestSnapshotObservedAt?: string | null;\n  observedAt: string | null;\n  source?: string | null;\n  reason?: string | null;\n}\n\nexport interface MarketSnapshotLike {\n  stock_code: string;\n  observed_at: string;\n  close_price: number | string | null;\n  open_price: number | string | null;\n  high_price: number | string | null;\n  low_price: number | string | null;\n  volume: number | string | null;\n}\n\nexport interface AlphaRealFeatureAdapterInput {\n  stockCode: string;\n  decisionAt: string;\n\n  disclosurePredictionGate?: DisclosurePredictionGate | null;\n  marketRegimeShadow?: MarketRegimeShadow | null;\n  marketSnapshots?: MarketSnapshotLike[];\n\n  flowEvidence?: AlphaFeatureEvidence;\n  eventPersistenceEvidence?: AlphaFeatureEvidence;\n  riskEvidence?: AlphaFeatureEvidence;\n\n  modelId?: string;\n  modelVersion?: string;\n}\n\nfunction clamp01(value: number): number {\n  return Math.min(1, Math.max(0, value));\n}\n\nfunction toNumber(\n  value: number | string | null | undefined,\n): number | null {\n  if (value === null || value === undefined) {\n    return null;\n  }\n\n  const parsed = Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction normalizeStockCode(value: string): string {\n  const normalized = value.trim();\n\n  if (!/^\\d{6}$/.test(normalized)) {\n    throw new Error(\n      `INVALID_STOCK_CODE:${value}`,\n    );\n  }\n\n  return normalized;\n}\n\nfunction marketRegimeScore(\n  regime: string | null,\n  breadth20: number | null,\n  avgReturn20: number | null,\n): number {\n  const normalized =\n    String(regime ?? \"\")\n      .trim()\n      .toUpperCase();\n\n  const regimeBase =\n    normalized === \"BULL\"\n      ? 0.85\n      : normalized === \"BEAR\"\n        ? 0.20\n        : 0.50;\n\n  const breadthScore =\n    breadth20 === null\n      ? 0.50\n      : clamp01(breadth20);\n\n  const returnScore =\n    avgReturn20 === null\n      ? 0.50\n      : clamp01(\n          (avgReturn20 + 0.10) / 0.20,\n        );\n\n  return clamp01(\n    regimeBase * 0.50 +\n    breadthScore * 0.30 +\n    returnScore * 0.20,\n  );\n}\n\nfunction predictionToCatalyst(\n  stockCode: string,\n  gate: DisclosurePredictionGate,\n): AlphaFeatureEvidence | undefined {\n  if (\n    !gate.available ||\n    !gate.fresh ||\n    !gate.generatedAt\n  ) {\n    return undefined;\n  }\n\n  const candidate =\n    (gate.candidates ?? [])\n      .find(\n        (row) =>\n          String(row.stock_code)\n            .padStart(6, \"0\") ===\n          stockCode,\n      );\n\n  if (!candidate) {\n    return undefined;\n  }\n\n  const rawScore =\n    clamp01(\n      toNumber(candidate.score) ?? 0.5,\n    );\n\n  const rawConfidence =\n    clamp01(\n      toNumber(candidate.confidence) ??\n      0.5,\n    );\n\n  const direction =\n    String(\n      candidate.direction ?? \"\",\n    )\n      .trim()\n      .toUpperCase();\n\n  const directionalScore =\n    direction === \"UP\"\n      ? rawScore\n      : direction === \"DOWN\"\n        ? 1 - rawScore\n        : 0.5 + (rawScore - 0.5) * 0.35;\n\n  return {\n    score:\n      clamp01(directionalScore),\n\n    confidence:\n      rawConfidence,\n\n    availableAt:\n      gate.generatedAt,\n\n    source:\n      gate.modelName ??\n      \"DISCLOSURE_PREDICTION_GATE\",\n\n    sourceVersion:\n      gate.modelVersion ??\n      undefined,\n\n    maxAgeMinutes:\n      gate.maximumAgeMinutes ??\n      180,\n\n    metadata: {\n      predictionDate:\n        gate.predictionDate,\n\n      direction:\n        candidate.direction ?? null,\n\n      isCandidate:\n        candidate.is_candidate ?? null,\n\n      upstreamScore:\n        rawScore,\n\n      upstreamConfidence:\n        rawConfidence,\n\n      gateReason:\n        gate.reason ?? null,\n    },\n  };\n}\n\nfunction regimeToFeature(\n  regime: MarketRegimeShadow,\n): AlphaFeatureEvidence | undefined {\n  if (!regime.observedAt) {\n    return undefined;\n  }\n\n  const breadth20 =\n    toNumber(regime.breadth20);\n\n  const avgReturn20 =\n    toNumber(regime.avgReturn20);\n\n  const sampleSize =\n    Math.max(\n      0,\n      Math.floor(\n        toNumber(regime.sampleSize) ?? 0,\n      ),\n    );\n\n  const confidence =\n    clamp01(\n      sampleSize <= 0\n        ? 0.45\n        : 0.55 +\n          Math.min(sampleSize, 50) /\n            50 *\n            0.35,\n    );\n\n  return {\n    score:\n      marketRegimeScore(\n        regime.regime,\n        breadth20,\n        avgReturn20,\n      ),\n\n    confidence,\n\n    availableAt:\n      regime.observedAt,\n\n    observedAt:\n      regime.latestSnapshotObservedAt ??\n      regime.observedAt,\n\n    source:\n      regime.source ??\n      \"MARKET_REGIME_SHADOW\",\n\n    sourceVersion:\n      \"alpha-adapter-v1\",\n\n    maxAgeMinutes:\n      240,\n\n    metadata: {\n      regime:\n        regime.regime,\n\n      breadth20,\n      avgReturn20,\n      sampleSize,\n\n      latestMarketDate:\n        regime.latestMarketDate ?? null,\n\n      wouldBlockByRegime:\n        regime.wouldBlockByRegime ?? null,\n    },\n  };\n}\n\nfunction priceVolumeAndLiquidity(\n  stockCode: string,\n  snapshots: MarketSnapshotLike[],\n): {\n  priceVolume?: AlphaFeatureEvidence;\n  liquidity?: AlphaFeatureEvidence;\n} {\n  const rows =\n    snapshots\n      .filter(\n        (row) =>\n          String(row.stock_code)\n            .padStart(6, \"0\") ===\n          stockCode,\n      )\n      .sort(\n        (a, b) =>\n          new Date(b.observed_at).getTime() -\n          new Date(a.observed_at).getTime(),\n      );\n\n  const latest = rows[0];\n\n  if (!latest) {\n    return {};\n  }\n\n  const latestClose =\n    toNumber(latest.close_price);\n\n  if (\n    latestClose === null ||\n    latestClose <= 0\n  ) {\n    return {};\n  }\n\n  const latestOpen =\n    toNumber(latest.open_price);\n\n  const latestHigh =\n    toNumber(latest.high_price);\n\n  const latestLow =\n    toNumber(latest.low_price);\n\n  const latestVolume =\n    Math.max(\n      0,\n      toNumber(latest.volume) ?? 0,\n    );\n\n  const priorClose =\n    toNumber(rows[1]?.close_price) ??\n    latestOpen ??\n    latestClose;\n\n  const momentum =\n    priorClose > 0\n      ? (\n          latestClose -\n          priorClose\n        ) / priorClose\n      : 0;\n\n  const intraday =\n    latestOpen !== null &&\n    latestOpen > 0\n      ? (\n          latestClose -\n          latestOpen\n        ) / latestOpen\n      : 0;\n\n  const rangePosition =\n    latestHigh !== null &&\n    latestLow !== null &&\n    latestHigh > latestLow\n      ? clamp01(\n          (\n            latestClose -\n            latestLow\n          ) /\n          (\n            latestHigh -\n            latestLow\n          ),\n        )\n      : 0.5;\n\n  const priorVolumes =\n    rows\n      .slice(1, 11)\n      .map(\n        (row) =>\n          toNumber(row.volume),\n      )\n      .filter(\n        (value): value is number =>\n          value !== null &&\n          value > 0,\n      );\n\n  const averagePriorVolume =\n    priorVolumes.length > 0\n      ? priorVolumes.reduce(\n          (sum, value) =>\n            sum + value,\n          0,\n        ) / priorVolumes.length\n      : latestVolume;\n\n  const volumeRatio =\n    averagePriorVolume > 0\n      ? latestVolume /\n        averagePriorVolume\n      : 1;\n\n  const momentumScore =\n    clamp01(\n      (momentum + 0.04) / 0.10,\n    );\n\n  const intradayScore =\n    clamp01(\n      (intraday + 0.025) / 0.06,\n    );\n\n  const volumeScore =\n    clamp01(\n      (volumeRatio - 0.60) / 1.80,\n    );\n\n  const priceVolumeScore =\n    clamp01(\n      momentumScore * 0.40 +\n      intradayScore * 0.20 +\n      rangePosition * 0.15 +\n      volumeScore * 0.25,\n    );\n\n  const snapshotCoverage =\n    clamp01(\n      rows.length / 10,\n    );\n\n  const priceVolume:\n    AlphaFeatureEvidence = {\n      score:\n        priceVolumeScore,\n\n      confidence:\n        0.55 +\n        snapshotCoverage * 0.40,\n\n      availableAt:\n        latest.observed_at,\n\n      observedAt:\n        latest.observed_at,\n\n      source:\n        \"MARKET_SNAPSHOTS_PRICE_VOLUME\",\n\n      sourceVersion:\n        \"alpha-adapter-v1\",\n\n      maxAgeMinutes:\n        240,\n\n      metadata: {\n        snapshotCount:\n          rows.length,\n\n        momentum,\n        intraday,\n        rangePosition,\n        volumeRatio,\n      },\n    };\n\n  const turnoverProxy =\n    latestClose *\n    latestVolume;\n\n  const turnoverLog10 =\n    turnoverProxy > 0\n      ? Math.log10(turnoverProxy)\n      : 0;\n\n  const liquidityScore =\n    clamp01(\n      (turnoverLog10 - 7) / 4,\n    );\n\n  const liquidity:\n    AlphaFeatureEvidence = {\n      score:\n        liquidityScore,\n\n      confidence:\n        Math.min(\n          0.78,\n          0.50 +\n          snapshotCoverage * 0.28,\n        ),\n\n      availableAt:\n        latest.observed_at,\n\n      observedAt:\n        latest.observed_at,\n\n      source:\n        \"MARKET_SNAPSHOTS_TURNOVER_PROXY\",\n\n      sourceVersion:\n        \"alpha-adapter-v1\",\n\n      maxAgeMinutes:\n        240,\n\n      metadata: {\n        closePrice:\n          latestClose,\n\n        volume:\n          latestVolume,\n\n        turnoverProxy,\n\n        snapshotCount:\n          rows.length,\n\n        limitation:\n          \"NO_ORDERBOOK_OR_MARKET_CAP_YET\",\n      },\n    };\n\n  return {\n    priceVolume,\n    liquidity,\n  };\n}\n\nexport function buildAlphaCandidateInputFromRealSources(\n  input: AlphaRealFeatureAdapterInput,\n): AlphaCandidateInput {\n  const stockCode =\n    normalizeStockCode(\n      input.stockCode,\n    );\n\n  const catalyst =\n    input.disclosurePredictionGate\n      ? predictionToCatalyst(\n          stockCode,\n          input.disclosurePredictionGate,\n        )\n      : undefined;\n\n  const marketRegime =\n    input.marketRegimeShadow\n      ? regimeToFeature(\n          input.marketRegimeShadow,\n        )\n      : undefined;\n\n  const {\n    priceVolume,\n    liquidity,\n  } =\n    priceVolumeAndLiquidity(\n      stockCode,\n      input.marketSnapshots ?? [],\n    );\n\n  return {\n    stockCode,\n    decisionAt:\n      input.decisionAt,\n\n    modelId:\n      input.modelId,\n\n    modelVersion:\n      input.modelVersion,\n\n    features: {\n      catalyst,\n      flow:\n        input.flowEvidence,\n\n      marketRegime,\n      priceVolume,\n      liquidity,\n\n      eventPersistence:\n        input.eventPersistenceEvidence,\n\n      riskPenalty:\n        input.riskEvidence,\n    },\n\n    metadata: {\n      adapterVersion:\n        \"ALPHA_V1_REAL_FEATURE_ADAPTERS\",\n\n      sourcePresence: {\n        catalyst:\n          Boolean(catalyst),\n\n        flow:\n          Boolean(input.flowEvidence),\n\n        marketRegime:\n          Boolean(marketRegime),\n\n        priceVolume:\n          Boolean(priceVolume),\n\n        liquidity:\n          Boolean(liquidity),\n\n        eventPersistence:\n          Boolean(\n            input.eventPersistenceEvidence,\n          ),\n\n        riskPenalty:\n          Boolean(input.riskEvidence),\n      },\n    },\n  };\n}\n";
const smoke = "import assert from \"node:assert/strict\";\n\nimport {\n  rankAlphaCandidates,\n} from \"../lib/alpha/candidate-scoring\";\n\nimport {\n  buildAlphaCandidateInputFromRealSources,\n  type DisclosurePredictionGate,\n  type MarketRegimeShadow,\n  type MarketSnapshotLike,\n} from \"../lib/alpha/feature-adapters\";\n\nconst decisionAt =\n  \"2026-08-02T14:01:08.000Z\";\n\nconst predictionGate:\n  DisclosurePredictionGate = {\n    available: true,\n    fresh: true,\n    predictionDate:\n      \"2026-08-02\",\n    generatedAt:\n      \"2026-08-02T14:01:07.590Z\",\n    modelName:\n      \"DISCLOSURE_PRICE_RULE\",\n    modelVersion:\n      \"v1\",\n    ageMinutes:\n      0,\n    maximumAgeMinutes:\n      180,\n    candidateCount:\n      1,\n    stockCodes: [\n      \"000660\",\n    ],\n    candidates: [\n      {\n        stock_code:\n          \"000660\",\n        stock_name:\n          \"SK\ud558\uc774\ub2c9\uc2a4\",\n        score:\n          0.78,\n        direction:\n          \"UP\",\n        confidence:\n          0.84,\n        is_candidate:\n          true,\n      },\n    ],\n    reason:\n      \"CANDIDATE_AVAILABLE\",\n  };\n\nconst marketRegime:\n  MarketRegimeShadow = {\n    mode:\n      \"SHADOW\",\n    appliedToOrders:\n      false,\n    regime:\n      \"BEAR\",\n    wouldBlockByRegime:\n      true,\n    breadth20:\n      0.4,\n    avgReturn20:\n      -0.078025,\n    sampleSize:\n      5,\n    returnSampleSize:\n      5,\n    stockCodes: [\n      \"000660\",\n      \"005380\",\n      \"005930\",\n      \"035420\",\n      \"035720\",\n    ],\n    latestMarketDate:\n      \"2026-07-31\",\n    latestSnapshotObservedAt:\n      \"2026-07-31T06:30:00+00:00\",\n    observedAt:\n      \"2026-08-02T14:01:07.776Z\",\n    source:\n      \"ACTIVE_STOCK_PROXY_V1\",\n  };\n\nconst snapshots:\n  MarketSnapshotLike[] = [\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T14:00:00.000Z\",\n      close_price:\n        200000,\n      open_price:\n        196000,\n      high_price:\n        202000,\n      low_price:\n        194000,\n      volume:\n        1500000,\n    },\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T13:50:00.000Z\",\n      close_price:\n        197000,\n      open_price:\n        195000,\n      high_price:\n        198000,\n      low_price:\n        194000,\n      volume:\n        900000,\n    },\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T13:40:00.000Z\",\n      close_price:\n        196500,\n      open_price:\n        194500,\n      high_price:\n        197000,\n      low_price:\n        194000,\n      volume:\n        850000,\n    },\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T13:30:00.000Z\",\n      close_price:\n        196000,\n      open_price:\n        194000,\n      high_price:\n        196500,\n      low_price:\n        193500,\n      volume:\n        800000,\n    },\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T13:20:00.000Z\",\n      close_price:\n        195500,\n      open_price:\n        194000,\n      high_price:\n        196000,\n      low_price:\n        193000,\n      volume:\n        780000,\n    },\n    {\n      stock_code:\n        \"000660\",\n      observed_at:\n        \"2026-08-02T13:10:00.000Z\",\n      close_price:\n        195000,\n      open_price:\n        193500,\n      high_price:\n        195500,\n      low_price:\n        193000,\n      volume:\n        760000,\n    },\n  ];\n\nconst adapted =\n  buildAlphaCandidateInputFromRealSources({\n    stockCode:\n      \"000660\",\n\n    decisionAt,\n\n    disclosurePredictionGate:\n      predictionGate,\n\n    marketRegimeShadow:\n      marketRegime,\n\n    marketSnapshots:\n      snapshots,\n\n    modelVersion:\n      \"alpha-v1-real-adapters\",\n  });\n\nassert(\n  adapted.features.catalyst,\n  \"catalyst adapter missing\",\n);\n\nassert(\n  adapted.features.marketRegime,\n  \"market regime adapter missing\",\n);\n\nassert(\n  adapted.features.priceVolume,\n  \"price-volume adapter missing\",\n);\n\nassert(\n  adapted.features.liquidity,\n  \"liquidity adapter missing\",\n);\n\nassert.equal(\n  adapted.features.flow,\n  undefined,\n);\n\nassert.equal(\n  adapted.features.eventPersistence,\n  undefined,\n);\n\nconst stable =\n  rankAlphaCandidates(\n    [adapted],\n    \"STABLE\",\n  )[0];\n\nconst aggressive =\n  rankAlphaCandidates(\n    [adapted],\n    \"AGGRESSIVE\",\n  )[0];\n\nassert(stable);\nassert(aggressive);\n\nassert.equal(\n  stable.metadata.lookaheadDimensions.length,\n  0,\n);\n\nassert.equal(\n  stable.metadata.missingDimensions.includes(\n    \"flow\",\n  ),\n  true,\n);\n\nassert.equal(\n  stable.metadata.missingDimensions.includes(\n    \"eventPersistence\",\n  ),\n  true,\n);\n\nassert.equal(\n  stable.eligibleForEntryTiming,\n  false,\n  \"partial real adapters must not silently pass STABLE before flow/eventPersistence are wired\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"ALPHA_V1_REAL_FEATURE_ADAPTERS_SMOKE_PASS\",\n\n      sourceContract: {\n        catalyst:\n          \"DISCLOSURE_PRICE_RULE predictionGate\",\n\n        marketRegime:\n          \"marketRegimeShadow / ACTIVE_STOCK_PROXY_V1\",\n\n        priceVolume:\n          \"market_snapshots\",\n\n        liquidity:\n          \"market_snapshots turnover proxy\",\n\n        flow:\n          \"NOT_WIRED_NO_GUESS\",\n\n        eventPersistence:\n          \"NOT_WIRED_NO_GUESS\",\n\n        riskPenalty:\n          \"NOT_WIRED_NO_GUESS\",\n      },\n\n      adaptedFeaturePresence:\n        adapted.metadata,\n\n      stable: {\n        score:\n          stable.score,\n\n        coverage:\n          stable.coverage,\n\n        quality:\n          stable.quality,\n\n        eligibleForEntryTiming:\n          stable.eligibleForEntryTiming,\n\n        blockingIssues:\n          stable.blockingIssues,\n\n        warnings:\n          stable.warnings,\n      },\n\n      aggressive: {\n        score:\n          aggressive.score,\n\n        coverage:\n          aggressive.coverage,\n\n        quality:\n          aggressive.quality,\n\n        eligibleForEntryTiming:\n          aggressive.eligibleForEntryTiming,\n\n        blockingIssues:\n          aggressive.blockingIssues,\n      },\n\n      safety: {\n        databaseReads:\n          0,\n\n        databaseWrites:\n          0,\n\n        networkRequests:\n          0,\n\n        ordersCreated:\n          0,\n      },\n\n      nextGate:\n        \"ALPHA_V1_SOURCE_LOCATOR_FLOW_EVENT_RISK\",\n    },\n    null,\n    2,\n  ),\n);\n";

function atomicWrite(file, content) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

try {
  const root =
    path.resolve(__dirname, '..');

  atomicWrite(
    path.join(
      root,
      'lib',
      'alpha',
      'feature-adapters.ts',
    ),
    adapter,
  );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-real-feature-adapters-smoke.ts',
    ),
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REAL_FEATURE_ADAPTERS_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/alpha/feature-adapters.ts',
          'scripts/alpha-v1-real-feature-adapters-smoke.ts',
        ],

        sourceContract: {
          catalyst:
            'DISCLOSURE_PRICE_RULE predictionGate',

          marketRegime:
            'marketRegimeShadow / ACTIVE_STOCK_PROXY_V1',

          priceVolume:
            'market_snapshots',

          liquidity:
            'market_snapshots turnover proxy',

          flow:
            'NOT_WIRED_NO_GUESS',

          eventPersistence:
            'NOT_WIRED_NO_GUESS',

          riskPenalty:
            'NOT_WIRED_NO_GUESS',
        },

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkRequests:
            0,

          ordersCreated:
            0,
        },

        nextAction:
          'RUN_ALPHA_V1_REAL_FEATURE_ADAPTERS_SMOKE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REAL_FEATURE_ADAPTERS_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkRequests:
            0,

          ordersCreated:
            0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
