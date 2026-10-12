export const DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION =
  "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_V1" as const;

export type DataFreshnessProductionAction =
  | "OBSERVE"
  | "ANALYZE"
  | "PAPER_BUY_CREATE"
  | "PAPER_BUY_EXECUTE"
  | "LIVE_BUY_SUBMIT"
  | "PROTECTIVE_EXIT"
  | "RISK_MAINTENANCE";

export type DataFreshnessStatus =
  | "FRESH"
  | "STALE"
  | "UNKNOWN"
  | "MISSING"
  | "DATE_MISMATCH";

export type DataQualityStatus =
  | "PASS"
  | "WARNING"
  | "FAIL_FRESHNESS"
  | "FAIL_INTEGRITY"
  | "UNKNOWN";

export interface DataFreshnessProductionInput {
  freshnessStatus:
    DataFreshnessStatus | string | null | undefined;

  usableForProduction:
    boolean | null | undefined;

  qualityStatus?:
    DataQualityStatus | string | null | undefined;

  expectedMarketDate?:
    string | null;

  latestCommonDate?:
    string | null;
}

export interface DataFreshnessProductionDecision {
  version:
    typeof DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION;

  action:
    DataFreshnessProductionAction;

  allowed:
    boolean;

  blocksNewRisk:
    boolean;

  reason:
    | "OBSERVATION_ALLOWED"
    | "ANALYSIS_ALLOWED"
    | "PROTECTIVE_EXIT_ALLOWED"
    | "RISK_MAINTENANCE_ALLOWED"
    | "FRESH_DATA_NEW_RISK_ALLOWED"
    | "FRESHNESS_STATE_MISSING"
    | "FRESHNESS_NOT_USABLE_FOR_PRODUCTION"
    | "STALE_MARKET_DATA"
    | "MARKET_DATE_MISMATCH"
    | "QUALITY_GATE_FAILED"
    | "UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED";

  failClosed:
    boolean;
}

const NEW_RISK_ACTIONS:
  readonly DataFreshnessProductionAction[] = [
    "PAPER_BUY_CREATE",
    "PAPER_BUY_EXECUTE",
    "LIVE_BUY_SUBMIT",
  ];

export function isDataFreshnessNewRiskAction(
  action:
    DataFreshnessProductionAction,
): boolean {
  return NEW_RISK_ACTIONS.includes(
    action,
  );
}

function normalizeStatus(
  value:
    unknown,
): string {
  return String(
    value ?? "",
  )
    .trim()
    .toUpperCase();
}

export function evaluateDataFreshnessProductionAction(
  input:
    DataFreshnessProductionInput,
  action:
    DataFreshnessProductionAction,
): DataFreshnessProductionDecision {
  if (
    action ===
    "OBSERVE"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: true,
      blocksNewRisk: false,
      reason:
        "OBSERVATION_ALLOWED",
      failClosed: false,
    };
  }

  if (
    action ===
    "ANALYZE"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: true,
      blocksNewRisk: false,
      reason:
        "ANALYSIS_ALLOWED",
      failClosed: false,
    };
  }

  if (
    action ===
    "PROTECTIVE_EXIT"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: true,
      blocksNewRisk: false,
      reason:
        "PROTECTIVE_EXIT_ALLOWED",
      failClosed: false,
    };
  }

  if (
    action ===
    "RISK_MAINTENANCE"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: true,
      blocksNewRisk: false,
      reason:
        "RISK_MAINTENANCE_ALLOWED",
      failClosed: false,
    };
  }

  const freshnessStatus =
    normalizeStatus(
      input.freshnessStatus,
    );

  const qualityStatus =
    normalizeStatus(
      input.qualityStatus,
    );

  if (
    !freshnessStatus
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "FRESHNESS_STATE_MISSING",
      failClosed: true,
    };
  }

  if (
    freshnessStatus ===
    "STALE"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "STALE_MARKET_DATA",
      failClosed: true,
    };
  }

  if (
    freshnessStatus ===
      "DATE_MISMATCH" ||
    (
      input.expectedMarketDate &&
      input.latestCommonDate &&
      input.expectedMarketDate !==
        input.latestCommonDate
    )
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "MARKET_DATE_MISMATCH",
      failClosed: true,
    };
  }

  if (
    qualityStatus ===
      "FAIL_FRESHNESS" ||
    qualityStatus ===
      "FAIL_INTEGRITY"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "QUALITY_GATE_FAILED",
      failClosed: true,
    };
  }

  if (
    input.usableForProduction !==
    true
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "FRESHNESS_NOT_USABLE_FOR_PRODUCTION",
      failClosed: true,
    };
  }

  if (
    freshnessStatus !==
    "FRESH"
  ) {
    return {
      version:
        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
      action,
      allowed: false,
      blocksNewRisk: true,
      reason:
        "UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED",
      failClosed: true,
    };
  }

  return {
    version:
      DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,
    action,
    allowed: true,
    blocksNewRisk: false,
    reason:
      "FRESH_DATA_NEW_RISK_ALLOWED",
    failClosed: false,
  };
}
