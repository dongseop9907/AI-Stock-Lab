import type {
  AlphaFeatureEvidence,
} from "./candidate-scoring";

export interface PredictionHistoryLike {
  stock_code: string;
  score: number | string | null;
  direction: string | null;
  confidence: number | string | null;
  is_candidate?: boolean | null;

  /**
   * At least one timestamp must be supplied.
   * generated_at is preferred because it represents when the prediction
   * became available to the strategy.
   */
  generated_at?: string | null;
  prediction_date?: string | null;
  created_at?: string | null;

  model_name?: string | null;
  model_version?: string | null;
}

export interface BuyRiskValidationLike {
  approved?: boolean | null;

  issues?: string[] | null;

  riskPerShare?: number | string | null;
  stopDistanceRate?: number | string | null;

  maxRiskAmount?: number | string | null;
  maxPositionAmount?: number | string | null;
  maxPortfolioAmount?: number | string | null;
  maxSectorAmount?: number | string | null;

  requestedQuantity?: number | string | null;
  requested?: number | string | null;

  maxAllowedQuantity?: number | string | null;
  maxAllowed?: number | string | null;

  positionAmount?: number | string | null;
  requestedPositionAmount?: number | string | null;
}

export interface EventPersistenceAdapterInput {
  stockCode: string;
  decisionAt: string;
  predictions: PredictionHistoryLike[];

  /**
   * Historical window used only after availability-time filtering.
   */
  lookbackHours?: number;
}

export interface RiskPenaltyAdapterInput {
  decisionAt: string;
  result: BuyRiskValidationLike;

  sourceVersion?: string;
}

function clamp01(value: number): number {
  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseTime(
  value:
    | string
    | null
    | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const parsed =
    new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeStockCode(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^\d{6}$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `INVALID_STOCK_CODE:${value}`,
    );
  }

  return normalized;
}

function normalizeDirection(
  value:
    | string
    | null
    | undefined,
): "UP" | "DOWN" | "NEUTRAL" {
  const normalized =
    String(value ?? "")
      .trim()
      .toUpperCase();

  if (
    normalized === "UP"
  ) {
    return "UP";
  }

  if (
    normalized === "DOWN"
  ) {
    return "DOWN";
  }

  return "NEUTRAL";
}

function resolveAvailableAt(
  row: PredictionHistoryLike,
): string | null {
  return (
    row.generated_at ??
    row.created_at ??
    (
      row.prediction_date
        ? `${row.prediction_date}T00:00:00.000Z`
        : null
    )
  );
}

function directionalSignal(
  row: PredictionHistoryLike,
): number {
  const score =
    clamp01(
      toNumber(
        row.score,
      ) ?? 0.5,
    );

  const direction =
    normalizeDirection(
      row.direction,
    );

  if (
    direction === "UP"
  ) {
    return score;
  }

  if (
    direction === "DOWN"
  ) {
    return 1 - score;
  }

  /**
   * Neutral predictions contribute only weak directional evidence.
   */
  return (
    0.5 +
    (score - 0.5) * 0.25
  );
}

export function buildEventPersistenceEvidence(
  input: EventPersistenceAdapterInput,
): AlphaFeatureEvidence | undefined {
  const stockCode =
    normalizeStockCode(
      input.stockCode,
    );

  const decisionAtMs =
    parseTime(
      input.decisionAt,
    );

  if (
    decisionAtMs === null
  ) {
    throw new Error(
      `INVALID_DECISION_AT:${input.decisionAt}`,
    );
  }

  const lookbackHours =
    Math.max(
      1,
      Math.min(
        24 * 30,
        Math.floor(
          input.lookbackHours ??
          72,
        ),
      ),
    );

  const minimumMs =
    decisionAtMs -
    lookbackHours *
      60 *
      60 *
      1000;

  const usable =
    input.predictions
      .map((row) => {
        const rowStock =
          String(
            row.stock_code,
          ).padStart(
            6,
            "0",
          );

        const availableAt =
          resolveAvailableAt(
            row,
          );

        const availableAtMs =
          parseTime(
            availableAt,
          );

        return {
          row,
          rowStock,
          availableAt,
          availableAtMs,
        };
      })
      .filter(
        (item) =>
          item.rowStock ===
            stockCode &&
          item.availableAt !==
            null &&
          item.availableAtMs !==
            null &&
          item.availableAtMs <=
            decisionAtMs &&
          item.availableAtMs >=
            minimumMs,
      )
      .sort(
        (a, b) =>
          (b.availableAtMs ?? 0) -
          (a.availableAtMs ?? 0),
      );

  if (
    usable.length === 0
  ) {
    return undefined;
  }

  let weightedSignal = 0;
  let weightedConfidence = 0;
  let totalWeight = 0;

  let upWeight = 0;
  let downWeight = 0;
  let neutralWeight = 0;

  for (
    const item
    of usable
  ) {
    const ageHours =
      (
        decisionAtMs -
        (item.availableAtMs ?? decisionAtMs)
      ) /
      (
        60 *
        60 *
        1000
      );

    /**
     * 24-hour half-life.
     */
    const recencyWeight =
      Math.exp(
        -Math.log(2) *
        ageHours /
        24,
      );

    const confidence =
      clamp01(
        toNumber(
          item.row.confidence,
        ) ?? 0.5,
      );

    const effectiveWeight =
      recencyWeight *
      (
        0.4 +
        confidence * 0.6
      );

    const signal =
      directionalSignal(
        item.row,
      );

    weightedSignal +=
      signal *
      effectiveWeight;

    weightedConfidence +=
      confidence *
      effectiveWeight;

    totalWeight +=
      effectiveWeight;

    const direction =
      normalizeDirection(
        item.row.direction,
      );

    if (
      direction === "UP"
    ) {
      upWeight +=
        effectiveWeight;
    } else if (
      direction === "DOWN"
    ) {
      downWeight +=
        effectiveWeight;
    } else {
      neutralWeight +=
        effectiveWeight;
    }
  }

  if (
    totalWeight <= 0
  ) {
    return undefined;
  }

  const meanSignal =
    weightedSignal /
    totalWeight;

  const meanConfidence =
    weightedConfidence /
    totalWeight;

  const directionalWeight =
    upWeight +
    downWeight;

  const consistency =
    directionalWeight > 0
      ? Math.abs(
          upWeight -
          downWeight,
        ) /
        directionalWeight
      : 0.25;

  const historyDepth =
    clamp01(
      usable.length / 6,
    );

  /**
   * Persistent positive evidence scores high.
   * A single isolated prediction receives lower confidence.
   */
  const score =
    clamp01(
      meanSignal *
        0.75 +
      (
        0.5 +
        (consistency - 0.5) *
          0.5
      ) *
        0.25,
    );

  const confidence =
    clamp01(
      meanConfidence *
        0.60 +
      consistency *
        0.20 +
      historyDepth *
        0.20,
    );

  return {
    score,
    confidence,

    availableAt:
      usable[0]
        .availableAt as string,

    observedAt:
      usable[0]
        .availableAt as string,

    source:
      "AI_STOCK_PREDICTIONS_HISTORY",

    sourceVersion:
      "alpha-event-persistence-v1",

    maxAgeMinutes:
      lookbackHours * 60,

    metadata: {
      stockCode,
      lookbackHours,
      usablePredictions:
        usable.length,

      meanSignal,
      meanConfidence,
      consistency,
      historyDepth,

      upWeight,
      downWeight,
      neutralWeight,

      latestModelName:
        usable[0]
          .row
          .model_name ??
        null,

      latestModelVersion:
        usable[0]
          .row
          .model_version ??
        null,
    },
  };
}

function issueSeverity(
  issue: string,
): number {
  const normalized =
    issue
      .trim()
      .toUpperCase();

  if (
    normalized.includes(
      "STOP_NOT_BELOW_ENTRY",
    )
  ) {
    return 1.0;
  }

  if (
    normalized.includes(
      "POSITION_LIMIT_EXCEEDED",
    )
  ) {
    return 0.9;
  }

  if (
    normalized.includes(
      "PORTFOLIO",
    ) ||
    normalized.includes(
      "SECTOR",
    )
  ) {
    return 0.85;
  }

  if (
    normalized.includes(
      "CASH",
    ) ||
    normalized.includes(
      "EQUITY",
    )
  ) {
    return 0.80;
  }

  return 0.65;
}

export function buildRiskPenaltyEvidence(
  input: RiskPenaltyAdapterInput,
): AlphaFeatureEvidence {
  const decisionAtMs =
    parseTime(
      input.decisionAt,
    );

  if (
    decisionAtMs === null
  ) {
    throw new Error(
      `INVALID_DECISION_AT:${input.decisionAt}`,
    );
  }

  const issues =
    (
      input.result.issues ??
      []
    )
      .map(
        (issue) =>
          String(issue),
      )
      .filter(Boolean);

  const approved =
    input.result.approved ===
    true;

  const stopDistanceRate =
    toNumber(
      input.result
        .stopDistanceRate,
    );

  const requestedQuantity =
    toNumber(
      input.result
        .requestedQuantity ??
      input.result
        .requested,
    );

  const maxAllowedQuantity =
    toNumber(
      input.result
        .maxAllowedQuantity ??
      input.result
        .maxAllowed,
    );

  const positionAmount =
    toNumber(
      input.result
        .requestedPositionAmount ??
      input.result
        .positionAmount,
    );

  const maxPositionAmount =
    toNumber(
      input.result
        .maxPositionAmount,
    );

  const severeIssuePenalty =
    issues.length > 0
      ? Math.max(
          ...issues.map(
            issueSeverity,
          ),
        )
      : 0;

  let quantityPenalty = 0;

  if (
    requestedQuantity !==
      null &&
    requestedQuantity >
      0 &&
    maxAllowedQuantity !==
      null
  ) {
    if (
      maxAllowedQuantity <=
      0
    ) {
      quantityPenalty = 1;
    } else {
      quantityPenalty =
        clamp01(
          (
            requestedQuantity -
            maxAllowedQuantity
          ) /
          requestedQuantity,
        );
    }
  }

  let positionUsagePenalty = 0;

  if (
    positionAmount !==
      null &&
    positionAmount >=
      0 &&
    maxPositionAmount !==
      null &&
    maxPositionAmount >
      0
  ) {
    const usage =
      positionAmount /
      maxPositionAmount;

    positionUsagePenalty =
      clamp01(
        (
          usage -
          0.60
        ) /
        0.40,
      );
  }

  let stopPenalty = 0;

  if (
    stopDistanceRate !==
    null
  ) {
    if (
      stopDistanceRate <=
      0
    ) {
      stopPenalty = 1;
    } else {
      /**
       * <=2%: low penalty
       * 8%+: high penalty
       */
      stopPenalty =
        clamp01(
          (
            stopDistanceRate -
            0.02
          ) /
          0.06,
        );
    }
  }

  const approvalPenalty =
    approved
      ? 0
      : 0.75;

  const penalty =
    clamp01(
      Math.max(
        approvalPenalty,
        severeIssuePenalty,
        quantityPenalty,
        stopPenalty * 0.80,
        positionUsagePenalty * 0.75,
      ),
    );

  /**
   * Risk validation is deterministic and directly used by paper-order
   * creation, so confidence is high when the result exists.
   */
  const confidence =
    issues.length > 0 ||
    input.result.approved !==
      undefined
      ? 0.95
      : 0.80;

  return {
    score:
      penalty,

    confidence,

    availableAt:
      new Date(
        decisionAtMs,
      ).toISOString(),

    observedAt:
      new Date(
        decisionAtMs,
      ).toISOString(),

    source:
      "VALIDATE_BUY_RISK",

    sourceVersion:
      input.sourceVersion ??
      "risk-manager-v1",

    maxAgeMinutes:
      5,

    metadata: {
      approved,
      issues,

      stopDistanceRate,

      requestedQuantity,
      maxAllowedQuantity,

      positionAmount,
      maxPositionAmount,

      maxRiskAmount:
        toNumber(
          input.result
            .maxRiskAmount,
        ),

      maxPortfolioAmount:
        toNumber(
          input.result
            .maxPortfolioAmount,
        ),

      maxSectorAmount:
        toNumber(
          input.result
            .maxSectorAmount,
        ),

      components: {
        approvalPenalty,
        severeIssuePenalty,
        quantityPenalty,
        stopPenalty,
        positionUsagePenalty,
      },
    },
  };
}
