import {
  readCanonicalDataFreshnessState,
  type DataFreshnessSupabaseLike,
} from "./data-freshness-canonical-reader";

import {
  evaluateDataFreshnessProductionAction,
  type DataFreshnessProductionAction,
  type DataFreshnessProductionDecision,
} from "./data-freshness-production-contract";

export const DATA_FRESHNESS_PRODUCTION_GUARD_VERSION =
  "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V2" as const;

export class DataFreshnessBlockedError extends Error {
  readonly code =
    "DATA_FRESHNESS_NEW_RISK_BLOCKED";

  readonly action:
    DataFreshnessProductionAction;

  readonly decision:
    DataFreshnessProductionDecision;

  constructor(
    action:
      DataFreshnessProductionAction,
    decision:
      DataFreshnessProductionDecision,
  ) {
    super(
      [
        "DATA_FRESHNESS_NEW_RISK_BLOCKED",
        action,
        decision.reason,
      ].join(":"),
    );

    this.name =
      "DataFreshnessBlockedError";

    this.action =
      action;

    this.decision =
      decision;
  }
}

export async function readCurrentDataFreshnessProductionDecision(
  supabase:
    DataFreshnessSupabaseLike,
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const state =
    await readCanonicalDataFreshnessState(
      supabase,
    );

  return evaluateDataFreshnessProductionAction(
    state,
    action,
  );
}

export async function assertDataFreshnessAllows(
  supabase:
    DataFreshnessSupabaseLike,
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const decision =
    await readCurrentDataFreshnessProductionDecision(
      supabase,
      action,
    );

  if (!decision.allowed) {
    throw new DataFreshnessBlockedError(
      action,
      decision,
    );
  }

  return decision;
}
