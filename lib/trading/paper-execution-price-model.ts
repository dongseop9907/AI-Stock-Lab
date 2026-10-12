export const PAPER_EXECUTION_PRICE_MODEL_VERSION =
  "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1" as const;

export interface PaperExecutionPricePolicy {
  maxSnapshotAgeMs: number;
  maxFutureClockSkewMs: number;
}

export const DEFAULT_PAPER_EXECUTION_PRICE_POLICY:
  Readonly<PaperExecutionPricePolicy> =
  Object.freeze({
    maxSnapshotAgeMs:
      10 * 60_000,

    maxFutureClockSkewMs:
      30_000,
  });

export interface MarketSnapshotLike {
  stock_code: string;
  close_price:
    | number
    | string
    | null;
  observed_at: string;
}

export type PaperExecutionPriceBlocker =
  | "STOCK_CODE_REQUIRED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_STOCK_MISMATCH"
  | "SNAPSHOT_PRICE_INVALID"
  | "SNAPSHOT_TIME_INVALID"
  | "SNAPSHOT_FROM_FUTURE"
  | "SNAPSHOT_STALE";

export interface PaperExecutionPriceDecision {
  version:
    typeof PAPER_EXECUTION_PRICE_MODEL_VERSION;

  usable: boolean;

  blocker:
    PaperExecutionPriceBlocker |
    null;

  executionPrice:
    number |
    null;

  source:
    "MARKET_SNAPSHOT_CLOSE";

  observedAt:
    string |
    null;

  ageMs:
    number |
    null;

  policy:
    PaperExecutionPricePolicy;

  semantics: {
    syntheticRandomSlippage: false;
    plannedEntryPriceUsedAsFillFallback: false;
    missingOrStaleMarketPriceFailsClosed: true;
  };
}

function numeric(
  value:
    unknown,
): number | null {
  const parsed =
    Number(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

export function evaluatePaperExecutionPriceSnapshot(
  input: {
    stockCode: string;
    snapshot:
      MarketSnapshotLike |
      null;
    now?: Date;
  },
  policy:
    PaperExecutionPricePolicy =
      DEFAULT_PAPER_EXECUTION_PRICE_POLICY,
): PaperExecutionPriceDecision {
  const now =
    input.now ??
    new Date();

  const base = {
    version:
      PAPER_EXECUTION_PRICE_MODEL_VERSION,

    source:
      "MARKET_SNAPSHOT_CLOSE" as const,

    policy: {
      ...policy,
    },

    semantics: {
      syntheticRandomSlippage:
        false as const,

      plannedEntryPriceUsedAsFillFallback:
        false as const,

      missingOrStaleMarketPriceFailsClosed:
        true as const,
    },
  };

  const stockCode =
    input.stockCode.trim();

  if (
    !stockCode
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "STOCK_CODE_REQUIRED",
      executionPrice:
        null,
      observedAt:
        null,
      ageMs:
        null,
    };
  }

  if (
    !input.snapshot
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_NOT_FOUND",
      executionPrice:
        null,
      observedAt:
        null,
      ageMs:
        null,
    };
  }

  if (
    input.snapshot
      .stock_code !==
    stockCode
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_STOCK_MISMATCH",
      executionPrice:
        null,
      observedAt:
        input.snapshot
          .observed_at,
      ageMs:
        null,
    };
  }

  const price =
    numeric(
      input.snapshot
        .close_price,
    );

  if (
    price ===
      null ||
    price <=
      0
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_PRICE_INVALID",
      executionPrice:
        null,
      observedAt:
        input.snapshot
          .observed_at,
      ageMs:
        null,
    };
  }

  const observedMs =
    Date.parse(
      input.snapshot
        .observed_at,
    );

  if (
    !Number.isFinite(
      observedMs,
    )
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_TIME_INVALID",
      executionPrice:
        null,
      observedAt:
        input.snapshot
          .observed_at,
      ageMs:
        null,
    };
  }

  const ageMs =
    now.getTime() -
    observedMs;

  if (
    ageMs <
      -policy.maxFutureClockSkewMs
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_FROM_FUTURE",
      executionPrice:
        null,
      observedAt:
        input.snapshot
          .observed_at,
      ageMs,
    };
  }

  if (
    ageMs >
    policy.maxSnapshotAgeMs
  ) {
    return {
      ...base,
      usable:
        false,
      blocker:
        "SNAPSHOT_STALE",
      executionPrice:
        null,
      observedAt:
        input.snapshot
          .observed_at,
      ageMs,
    };
  }

  return {
    ...base,

    usable:
      true,

    blocker:
      null,

    executionPrice:
      price,

    observedAt:
      input.snapshot
        .observed_at,

    ageMs:
      Math.max(
        0,
        ageMs,
      ),
  };
}
