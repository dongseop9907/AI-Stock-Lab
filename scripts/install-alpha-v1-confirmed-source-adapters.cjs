#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_INSTALLER';

const adapter =
  "import type {\n  AlphaFeatureEvidence,\n} from \"./candidate-scoring\";\n\nexport interface PredictionHistoryLike {\n  stock_code: string;\n  score: number | string | null;\n  direction: string | null;\n  confidence: number | string | null;\n  is_candidate?: boolean | null;\n\n  /**\n   * At least one timestamp must be supplied.\n   * generated_at is preferred because it represents when the prediction\n   * became available to the strategy.\n   */\n  generated_at?: string | null;\n  prediction_date?: string | null;\n  created_at?: string | null;\n\n  model_name?: string | null;\n  model_version?: string | null;\n}\n\nexport interface BuyRiskValidationLike {\n  approved?: boolean | null;\n\n  issues?: string[] | null;\n\n  riskPerShare?: number | string | null;\n  stopDistanceRate?: number | string | null;\n\n  maxRiskAmount?: number | string | null;\n  maxPositionAmount?: number | string | null;\n  maxPortfolioAmount?: number | string | null;\n  maxSectorAmount?: number | string | null;\n\n  requestedQuantity?: number | string | null;\n  requested?: number | string | null;\n\n  maxAllowedQuantity?: number | string | null;\n  maxAllowed?: number | string | null;\n\n  positionAmount?: number | string | null;\n  requestedPositionAmount?: number | string | null;\n}\n\nexport interface EventPersistenceAdapterInput {\n  stockCode: string;\n  decisionAt: string;\n  predictions: PredictionHistoryLike[];\n\n  /**\n   * Historical window used only after availability-time filtering.\n   */\n  lookbackHours?: number;\n}\n\nexport interface RiskPenaltyAdapterInput {\n  decisionAt: string;\n  result: BuyRiskValidationLike;\n\n  sourceVersion?: string;\n}\n\nfunction clamp01(value: number): number {\n  return Math.min(\n    1,\n    Math.max(\n      0,\n      value,\n    ),\n  );\n}\n\nfunction toNumber(\n  value:\n    | number\n    | string\n    | null\n    | undefined,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction parseTime(\n  value:\n    | string\n    | null\n    | undefined,\n): number | null {\n  if (!value) {\n    return null;\n  }\n\n  const parsed =\n    new Date(value).getTime();\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction normalizeStockCode(\n  value: string,\n): string {\n  const normalized =\n    value.trim();\n\n  if (\n    !/^\\d{6}$/.test(\n      normalized,\n    )\n  ) {\n    throw new Error(\n      `INVALID_STOCK_CODE:${value}`,\n    );\n  }\n\n  return normalized;\n}\n\nfunction normalizeDirection(\n  value:\n    | string\n    | null\n    | undefined,\n): \"UP\" | \"DOWN\" | \"NEUTRAL\" {\n  const normalized =\n    String(value ?? \"\")\n      .trim()\n      .toUpperCase();\n\n  if (\n    normalized === \"UP\"\n  ) {\n    return \"UP\";\n  }\n\n  if (\n    normalized === \"DOWN\"\n  ) {\n    return \"DOWN\";\n  }\n\n  return \"NEUTRAL\";\n}\n\nfunction resolveAvailableAt(\n  row: PredictionHistoryLike,\n): string | null {\n  return (\n    row.generated_at ??\n    row.created_at ??\n    (\n      row.prediction_date\n        ? `${row.prediction_date}T00:00:00.000Z`\n        : null\n    )\n  );\n}\n\nfunction directionalSignal(\n  row: PredictionHistoryLike,\n): number {\n  const score =\n    clamp01(\n      toNumber(\n        row.score,\n      ) ?? 0.5,\n    );\n\n  const direction =\n    normalizeDirection(\n      row.direction,\n    );\n\n  if (\n    direction === \"UP\"\n  ) {\n    return score;\n  }\n\n  if (\n    direction === \"DOWN\"\n  ) {\n    return 1 - score;\n  }\n\n  /**\n   * Neutral predictions contribute only weak directional evidence.\n   */\n  return (\n    0.5 +\n    (score - 0.5) * 0.25\n  );\n}\n\nexport function buildEventPersistenceEvidence(\n  input: EventPersistenceAdapterInput,\n): AlphaFeatureEvidence | undefined {\n  const stockCode =\n    normalizeStockCode(\n      input.stockCode,\n    );\n\n  const decisionAtMs =\n    parseTime(\n      input.decisionAt,\n    );\n\n  if (\n    decisionAtMs === null\n  ) {\n    throw new Error(\n      `INVALID_DECISION_AT:${input.decisionAt}`,\n    );\n  }\n\n  const lookbackHours =\n    Math.max(\n      1,\n      Math.min(\n        24 * 30,\n        Math.floor(\n          input.lookbackHours ??\n          72,\n        ),\n      ),\n    );\n\n  const minimumMs =\n    decisionAtMs -\n    lookbackHours *\n      60 *\n      60 *\n      1000;\n\n  const usable =\n    input.predictions\n      .map((row) => {\n        const rowStock =\n          String(\n            row.stock_code,\n          ).padStart(\n            6,\n            \"0\",\n          );\n\n        const availableAt =\n          resolveAvailableAt(\n            row,\n          );\n\n        const availableAtMs =\n          parseTime(\n            availableAt,\n          );\n\n        return {\n          row,\n          rowStock,\n          availableAt,\n          availableAtMs,\n        };\n      })\n      .filter(\n        (item) =>\n          item.rowStock ===\n            stockCode &&\n          item.availableAt !==\n            null &&\n          item.availableAtMs !==\n            null &&\n          item.availableAtMs <=\n            decisionAtMs &&\n          item.availableAtMs >=\n            minimumMs,\n      )\n      .sort(\n        (a, b) =>\n          (b.availableAtMs ?? 0) -\n          (a.availableAtMs ?? 0),\n      );\n\n  if (\n    usable.length === 0\n  ) {\n    return undefined;\n  }\n\n  let weightedSignal = 0;\n  let weightedConfidence = 0;\n  let totalWeight = 0;\n\n  let upWeight = 0;\n  let downWeight = 0;\n  let neutralWeight = 0;\n\n  for (\n    const item\n    of usable\n  ) {\n    const ageHours =\n      (\n        decisionAtMs -\n        (item.availableAtMs ?? decisionAtMs)\n      ) /\n      (\n        60 *\n        60 *\n        1000\n      );\n\n    /**\n     * 24-hour half-life.\n     */\n    const recencyWeight =\n      Math.exp(\n        -Math.log(2) *\n        ageHours /\n        24,\n      );\n\n    const confidence =\n      clamp01(\n        toNumber(\n          item.row.confidence,\n        ) ?? 0.5,\n      );\n\n    const effectiveWeight =\n      recencyWeight *\n      (\n        0.4 +\n        confidence * 0.6\n      );\n\n    const signal =\n      directionalSignal(\n        item.row,\n      );\n\n    weightedSignal +=\n      signal *\n      effectiveWeight;\n\n    weightedConfidence +=\n      confidence *\n      effectiveWeight;\n\n    totalWeight +=\n      effectiveWeight;\n\n    const direction =\n      normalizeDirection(\n        item.row.direction,\n      );\n\n    if (\n      direction === \"UP\"\n    ) {\n      upWeight +=\n        effectiveWeight;\n    } else if (\n      direction === \"DOWN\"\n    ) {\n      downWeight +=\n        effectiveWeight;\n    } else {\n      neutralWeight +=\n        effectiveWeight;\n    }\n  }\n\n  if (\n    totalWeight <= 0\n  ) {\n    return undefined;\n  }\n\n  const meanSignal =\n    weightedSignal /\n    totalWeight;\n\n  const meanConfidence =\n    weightedConfidence /\n    totalWeight;\n\n  const directionalWeight =\n    upWeight +\n    downWeight;\n\n  const consistency =\n    directionalWeight > 0\n      ? Math.abs(\n          upWeight -\n          downWeight,\n        ) /\n        directionalWeight\n      : 0.25;\n\n  const historyDepth =\n    clamp01(\n      usable.length / 6,\n    );\n\n  /**\n   * Persistent positive evidence scores high.\n   * A single isolated prediction receives lower confidence.\n   */\n  const score =\n    clamp01(\n      meanSignal *\n        0.75 +\n      (\n        0.5 +\n        (consistency - 0.5) *\n          0.5\n      ) *\n        0.25,\n    );\n\n  const confidence =\n    clamp01(\n      meanConfidence *\n        0.60 +\n      consistency *\n        0.20 +\n      historyDepth *\n        0.20,\n    );\n\n  return {\n    score,\n    confidence,\n\n    availableAt:\n      usable[0]\n        .availableAt as string,\n\n    observedAt:\n      usable[0]\n        .availableAt as string,\n\n    source:\n      \"AI_STOCK_PREDICTIONS_HISTORY\",\n\n    sourceVersion:\n      \"alpha-event-persistence-v1\",\n\n    maxAgeMinutes:\n      lookbackHours * 60,\n\n    metadata: {\n      stockCode,\n      lookbackHours,\n      usablePredictions:\n        usable.length,\n\n      meanSignal,\n      meanConfidence,\n      consistency,\n      historyDepth,\n\n      upWeight,\n      downWeight,\n      neutralWeight,\n\n      latestModelName:\n        usable[0]\n          .row\n          .model_name ??\n        null,\n\n      latestModelVersion:\n        usable[0]\n          .row\n          .model_version ??\n        null,\n    },\n  };\n}\n\nfunction issueSeverity(\n  issue: string,\n): number {\n  const normalized =\n    issue\n      .trim()\n      .toUpperCase();\n\n  if (\n    normalized.includes(\n      \"STOP_NOT_BELOW_ENTRY\",\n    )\n  ) {\n    return 1.0;\n  }\n\n  if (\n    normalized.includes(\n      \"POSITION_LIMIT_EXCEEDED\",\n    )\n  ) {\n    return 0.9;\n  }\n\n  if (\n    normalized.includes(\n      \"PORTFOLIO\",\n    ) ||\n    normalized.includes(\n      \"SECTOR\",\n    )\n  ) {\n    return 0.85;\n  }\n\n  if (\n    normalized.includes(\n      \"CASH\",\n    ) ||\n    normalized.includes(\n      \"EQUITY\",\n    )\n  ) {\n    return 0.80;\n  }\n\n  return 0.65;\n}\n\nexport function buildRiskPenaltyEvidence(\n  input: RiskPenaltyAdapterInput,\n): AlphaFeatureEvidence {\n  const decisionAtMs =\n    parseTime(\n      input.decisionAt,\n    );\n\n  if (\n    decisionAtMs === null\n  ) {\n    throw new Error(\n      `INVALID_DECISION_AT:${input.decisionAt}`,\n    );\n  }\n\n  const issues =\n    (\n      input.result.issues ??\n      []\n    )\n      .map(\n        (issue) =>\n          String(issue),\n      )\n      .filter(Boolean);\n\n  const approved =\n    input.result.approved ===\n    true;\n\n  const stopDistanceRate =\n    toNumber(\n      input.result\n        .stopDistanceRate,\n    );\n\n  const requestedQuantity =\n    toNumber(\n      input.result\n        .requestedQuantity ??\n      input.result\n        .requested,\n    );\n\n  const maxAllowedQuantity =\n    toNumber(\n      input.result\n        .maxAllowedQuantity ??\n      input.result\n        .maxAllowed,\n    );\n\n  const positionAmount =\n    toNumber(\n      input.result\n        .requestedPositionAmount ??\n      input.result\n        .positionAmount,\n    );\n\n  const maxPositionAmount =\n    toNumber(\n      input.result\n        .maxPositionAmount,\n    );\n\n  const severeIssuePenalty =\n    issues.length > 0\n      ? Math.max(\n          ...issues.map(\n            issueSeverity,\n          ),\n        )\n      : 0;\n\n  let quantityPenalty = 0;\n\n  if (\n    requestedQuantity !==\n      null &&\n    requestedQuantity >\n      0 &&\n    maxAllowedQuantity !==\n      null\n  ) {\n    if (\n      maxAllowedQuantity <=\n      0\n    ) {\n      quantityPenalty = 1;\n    } else {\n      quantityPenalty =\n        clamp01(\n          (\n            requestedQuantity -\n            maxAllowedQuantity\n          ) /\n          requestedQuantity,\n        );\n    }\n  }\n\n  let positionUsagePenalty = 0;\n\n  if (\n    positionAmount !==\n      null &&\n    positionAmount >=\n      0 &&\n    maxPositionAmount !==\n      null &&\n    maxPositionAmount >\n      0\n  ) {\n    const usage =\n      positionAmount /\n      maxPositionAmount;\n\n    positionUsagePenalty =\n      clamp01(\n        (\n          usage -\n          0.60\n        ) /\n        0.40,\n      );\n  }\n\n  let stopPenalty = 0;\n\n  if (\n    stopDistanceRate !==\n    null\n  ) {\n    if (\n      stopDistanceRate <=\n      0\n    ) {\n      stopPenalty = 1;\n    } else {\n      /**\n       * <=2%: low penalty\n       * 8%+: high penalty\n       */\n      stopPenalty =\n        clamp01(\n          (\n            stopDistanceRate -\n            0.02\n          ) /\n          0.06,\n        );\n    }\n  }\n\n  const approvalPenalty =\n    approved\n      ? 0\n      : 0.75;\n\n  const penalty =\n    clamp01(\n      Math.max(\n        approvalPenalty,\n        severeIssuePenalty,\n        quantityPenalty,\n        stopPenalty * 0.80,\n        positionUsagePenalty * 0.75,\n      ),\n    );\n\n  /**\n   * Risk validation is deterministic and directly used by paper-order\n   * creation, so confidence is high when the result exists.\n   */\n  const confidence =\n    issues.length > 0 ||\n    input.result.approved !==\n      undefined\n      ? 0.95\n      : 0.80;\n\n  return {\n    score:\n      penalty,\n\n    confidence,\n\n    availableAt:\n      new Date(\n        decisionAtMs,\n      ).toISOString(),\n\n    observedAt:\n      new Date(\n        decisionAtMs,\n      ).toISOString(),\n\n    source:\n      \"VALIDATE_BUY_RISK\",\n\n    sourceVersion:\n      input.sourceVersion ??\n      \"risk-manager-v1\",\n\n    maxAgeMinutes:\n      5,\n\n    metadata: {\n      approved,\n      issues,\n\n      stopDistanceRate,\n\n      requestedQuantity,\n      maxAllowedQuantity,\n\n      positionAmount,\n      maxPositionAmount,\n\n      maxRiskAmount:\n        toNumber(\n          input.result\n            .maxRiskAmount,\n        ),\n\n      maxPortfolioAmount:\n        toNumber(\n          input.result\n            .maxPortfolioAmount,\n        ),\n\n      maxSectorAmount:\n        toNumber(\n          input.result\n            .maxSectorAmount,\n        ),\n\n      components: {\n        approvalPenalty,\n        severeIssuePenalty,\n        quantityPenalty,\n        stopPenalty,\n        positionUsagePenalty,\n      },\n    },\n  };\n}\n";

const smoke =
  "import assert from \"node:assert/strict\";\n\nimport {\n  buildEventPersistenceEvidence,\n  buildRiskPenaltyEvidence,\n} from \"../lib/alpha/confirmed-source-adapters\";\n\nconst decisionAt =\n  \"2026-10-06T06:00:00.000Z\";\n\nconst event =\n  buildEventPersistenceEvidence({\n    stockCode:\n      \"000660\",\n\n    decisionAt,\n\n    lookbackHours:\n      72,\n\n    predictions: [\n      {\n        stock_code:\n          \"000660\",\n\n        score:\n          0.78,\n\n        direction:\n          \"UP\",\n\n        confidence:\n          0.84,\n\n        is_candidate:\n          true,\n\n        generated_at:\n          \"2026-10-06T05:40:00.000Z\",\n\n        model_name:\n          \"DISCLOSURE_PRICE_RULE\",\n\n        model_version:\n          \"v1\",\n      },\n      {\n        stock_code:\n          \"000660\",\n\n        score:\n          0.74,\n\n        direction:\n          \"UP\",\n\n        confidence:\n          0.80,\n\n        generated_at:\n          \"2026-10-05T06:00:00.000Z\",\n\n        model_name:\n          \"DISCLOSURE_PRICE_RULE\",\n\n        model_version:\n          \"v1\",\n      },\n      {\n        stock_code:\n          \"000660\",\n\n        score:\n          0.68,\n\n        direction:\n          \"NEUTRAL\",\n\n        confidence:\n          0.72,\n\n        generated_at:\n          \"2026-10-04T06:00:00.000Z\",\n\n        model_name:\n          \"DISCLOSURE_PRICE_RULE\",\n\n        model_version:\n          \"v1\",\n      },\n\n      /**\n       * Deliberate future row:\n       * must be filtered out before aggregation.\n       */\n      {\n        stock_code:\n          \"000660\",\n\n        score:\n          0.99,\n\n        direction:\n          \"UP\",\n\n        confidence:\n          0.99,\n\n        generated_at:\n          \"2026-10-06T06:10:00.000Z\",\n      },\n    ],\n  });\n\nassert(\n  event,\n  \"event persistence evidence missing\",\n);\n\nassert.equal(\n  event.source,\n  \"AI_STOCK_PREDICTIONS_HISTORY\",\n);\n\nassert(\n  Number(\n    event.metadata\n      ?.usablePredictions,\n  ) === 3,\n  \"future prediction leaked into event persistence\",\n);\n\nassert(\n  event.score > 0.5,\n  \"persistent positive predictions should score above neutral\",\n);\n\nconst approvedRisk =\n  buildRiskPenaltyEvidence({\n    decisionAt,\n\n    result: {\n      approved:\n        true,\n\n      issues:\n        [],\n\n      stopDistanceRate:\n        0.03,\n\n      requestedQuantity:\n        1,\n\n      maxAllowedQuantity:\n        4,\n\n      requestedPositionAmount:\n        200000,\n\n      maxPositionAmount:\n        1000000,\n\n      maxRiskAmount:\n        50000,\n\n      maxPortfolioAmount:\n        6000000,\n\n      maxSectorAmount:\n        2500000,\n    },\n  });\n\nconst blockedRisk =\n  buildRiskPenaltyEvidence({\n    decisionAt,\n\n    result: {\n      approved:\n        false,\n\n      issues: [\n        \"STOP_NOT_BELOW_ENTRY\",\n        \"POSITION_LIMIT_EXCEEDED\",\n      ],\n\n      stopDistanceRate:\n        -0.03,\n\n      requestedQuantity:\n        1,\n\n      maxAllowedQuantity:\n        0,\n\n      requestedPositionAmount:\n        1200000,\n\n      maxPositionAmount:\n        1000000,\n    },\n  });\n\nassert(\n  approvedRisk.score <\n  0.5,\n  \"approved low-risk case should have low penalty\",\n);\n\nassert(\n  blockedRisk.score >=\n  0.9,\n  \"blocked risk case should have very high penalty\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_SMOKE_PASS\",\n\n      eventPersistence: {\n        score:\n          event.score,\n\n        confidence:\n          event.confidence,\n\n        source:\n          event.source,\n\n        metadata:\n          event.metadata,\n      },\n\n      approvedRisk: {\n        penalty:\n          approvedRisk.score,\n\n        confidence:\n          approvedRisk.confidence,\n\n        metadata:\n          approvedRisk.metadata,\n      },\n\n      blockedRisk: {\n        penalty:\n          blockedRisk.score,\n\n        confidence:\n          blockedRisk.confidence,\n\n        metadata:\n          blockedRisk.metadata,\n      },\n\n      flow: {\n        status:\n          \"UNAVAILABLE\",\n\n        reason:\n          \"NO_CONFIRMED_FOREIGN_INSTITUTIONAL_FLOW_SOURCE_IN_REPO\",\n      },\n\n      safety: {\n        databaseReads:\n          0,\n\n        databaseWrites:\n          0,\n\n        networkRequests:\n          0,\n\n        ordersCreated:\n          0,\n      },\n\n      nextGate:\n        \"ALPHA_V1_REAL_RUNNER_DB_READ_ONLY\",\n    },\n    null,\n    2,\n  ),\n);\n";

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
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
    path.resolve(
      __dirname,
      '..',
    );

  atomicWrite(
    path.join(
      root,
      'lib',
      'alpha',
      'confirmed-source-adapters.ts',
    ),
    adapter,
  );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-confirmed-source-adapters-smoke.ts',
    ),
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/alpha/confirmed-source-adapters.ts',
          'scripts/alpha-v1-confirmed-source-adapters-smoke.ts',
        ],

        bindings: {
          eventPersistence:
            'AI_STOCK_PREDICTIONS_HISTORY',

          riskPenalty:
            'VALIDATE_BUY_RISK_RESULT',

          flow:
            'UNAVAILABLE_NO_GUESS',
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
          'RUN_ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_SMOKE',
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
          'ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_INSTALL_FAILED',

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
