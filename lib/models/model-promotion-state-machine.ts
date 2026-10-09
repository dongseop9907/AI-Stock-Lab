export const MODEL_PROMOTION_STATE_MACHINE_VERSION =
  "MODEL_PROMOTION_STATE_MACHINE_V1" as const;

export const MODEL_PROMOTION_STAGES = [
  "EXPERIMENTAL",
  "CANDIDATE",
  "SHADOW",
  "PAPER",
  "LIMITED_LIVE",
  "PRODUCTION",
  "DEGRADED",
  "DISABLED",
] as const;

export type ModelPromotionStage =
  (typeof MODEL_PROMOTION_STAGES)[number];

export type LegacyModelStatus =
  | "CANDIDATE"
  | "APPROVED"
  | "REJECTED"
  | "RETIRED"
  | string;

export type ModelPromotionTransitionKind =
  | "FORWARD"
  | "DEGRADE"
  | "DISABLE"
  | "RECOVER"
  | "NOOP";

export interface ModelPromotionTransitionDecision {
  allowed: boolean;
  fromStage: ModelPromotionStage;
  toStage: ModelPromotionStage;
  kind: ModelPromotionTransitionKind;
  requiresManualApproval: boolean;
  reason:
    | "SAME_STAGE"
    | "FORWARD_ONE_STAGE"
    | "DEGRADE_ACTIVE_STAGE"
    | "DISABLE_FROM_NON_PRODUCTION_STAGE"
    | "RECOVER_DEGRADED_TO_SHADOW"
    | "INVALID_TRANSITION";
}

const ACTIVE_FORWARD_STAGES:
  readonly ModelPromotionStage[] = [
    "EXPERIMENTAL",
    "CANDIDATE",
    "SHADOW",
    "PAPER",
    "LIMITED_LIVE",
    "PRODUCTION",
  ];

const FORWARD_NEXT_STAGE:
  Readonly<
    Partial<
      Record<
        ModelPromotionStage,
        ModelPromotionStage
      >
    >
  > = Object.freeze({
    EXPERIMENTAL:
      "CANDIDATE",
    CANDIDATE:
      "SHADOW",
    SHADOW:
      "PAPER",
    PAPER:
      "LIMITED_LIVE",
    LIMITED_LIVE:
      "PRODUCTION",
  });

export function isModelPromotionStage(
  value: unknown,
): value is ModelPromotionStage {
  return (
    typeof value ===
      "string" &&
    (
      MODEL_PROMOTION_STAGES as
        readonly string[]
    ).includes(value)
  );
}

/*
 * Legacy status compatibility:
 *
 * - CANDIDATE: existing candidate model -> CANDIDATE
 * - APPROVED: existing system only has PAPER risk enabled and LIVE disabled,
 *   so the safest canonical interpretation is PAPER rather than PRODUCTION.
 * - REJECTED / RETIRED: no new risk should be opened -> DISABLED.
 * - unknown legacy status: EXPERIMENTAL, fail-closed for paper/live risk.
 *
 * This adapter does NOT mutate ai_model_versions.status.
 */
export function resolveInitialPromotionStageFromLegacyStatus(
  legacyStatus: LegacyModelStatus | null | undefined,
): ModelPromotionStage {
  switch (legacyStatus) {
    case "CANDIDATE":
      return "CANDIDATE";

    case "APPROVED":
      return "PAPER";

    case "REJECTED":
    case "RETIRED":
      return "DISABLED";

    default:
      return "EXPERIMENTAL";
  }
}

export function isLivePromotionStage(
  stage: ModelPromotionStage,
): boolean {
  return (
    stage ===
      "LIMITED_LIVE" ||
    stage ===
      "PRODUCTION"
  );
}

export function canCreatePaperRiskForPromotionStage(
  stage: ModelPromotionStage,
): boolean {
  return (
    stage ===
      "PAPER" ||
    stage ===
      "LIMITED_LIVE" ||
    stage ===
      "PRODUCTION"
  );
}

export function canCreateLiveRiskForPromotionStage(
  stage: ModelPromotionStage,
): boolean {
  return isLivePromotionStage(
    stage,
  );
}

/*
 * V1 safety policy:
 * - forward promotion is one stage at a time only.
 * - any forward promotion from PAPER upward requires explicit manual approval.
 * - all LIVE-capable stages require explicit manual approval.
 * - active stages may be degraded immediately.
 * - non-production stages may be disabled immediately.
 * - DEGRADED may recover only to SHADOW, forcing revalidation.
 * - DISABLED is terminal in V1; reactivation requires a future explicit
 *   administrative workflow rather than an implicit status flip.
 */
export function evaluateModelPromotionTransition(
  fromStage: ModelPromotionStage,
  toStage: ModelPromotionStage,
): ModelPromotionTransitionDecision {
  if (
    fromStage ===
      toStage
  ) {
    return {
      allowed:
        true,
      fromStage,
      toStage,
      kind:
        "NOOP",
      requiresManualApproval:
        false,
      reason:
        "SAME_STAGE",
    };
  }

  const next =
    FORWARD_NEXT_STAGE[
      fromStage
    ];

  if (
    next ===
      toStage
  ) {
    return {
      allowed:
        true,
      fromStage,
      toStage,
      kind:
        "FORWARD",
      requiresManualApproval:
        fromStage ===
          "PAPER" ||
        fromStage ===
          "LIMITED_LIVE" ||
        toStage ===
          "LIMITED_LIVE" ||
        toStage ===
          "PRODUCTION",
      reason:
        "FORWARD_ONE_STAGE",
    };
  }

  if (
    ACTIVE_FORWARD_STAGES.includes(
      fromStage,
    ) &&
    toStage ===
      "DEGRADED"
  ) {
    return {
      allowed:
        true,
      fromStage,
      toStage,
      kind:
        "DEGRADE",
      requiresManualApproval:
        false,
      reason:
        "DEGRADE_ACTIVE_STAGE",
    };
  }

  if (
    fromStage !==
      "PRODUCTION" &&
    fromStage !==
      "DISABLED" &&
    toStage ===
      "DISABLED"
  ) {
    return {
      allowed:
        true,
      fromStage,
      toStage,
      kind:
        "DISABLE",
      requiresManualApproval:
        false,
      reason:
        "DISABLE_FROM_NON_PRODUCTION_STAGE",
    };
  }

  if (
    fromStage ===
      "PRODUCTION" &&
    toStage ===
      "DISABLED"
  ) {
    return {
      allowed:
        false,
      fromStage,
      toStage,
      kind:
        "DISABLE",
      requiresManualApproval:
        true,
      reason:
        "INVALID_TRANSITION",
    };
  }

  if (
    fromStage ===
      "DEGRADED" &&
    toStage ===
      "SHADOW"
  ) {
    return {
      allowed:
        true,
      fromStage,
      toStage,
      kind:
        "RECOVER",
      requiresManualApproval:
        true,
      reason:
        "RECOVER_DEGRADED_TO_SHADOW",
    };
  }

  return {
    allowed:
      false,
    fromStage,
    toStage,
    kind:
      "NOOP",
    requiresManualApproval:
      false,
    reason:
      "INVALID_TRANSITION",
  };
}

export function assertModelPromotionTransition(
  fromStage: ModelPromotionStage,
  toStage: ModelPromotionStage,
): ModelPromotionTransitionDecision {
  const decision =
    evaluateModelPromotionTransition(
      fromStage,
      toStage,
    );

  if (
    !decision.allowed
  ) {
    throw new Error(
      `MODEL_PROMOTION_TRANSITION_NOT_ALLOWED:${fromStage}->${toStage}`,
    );
  }

  return decision;
}
