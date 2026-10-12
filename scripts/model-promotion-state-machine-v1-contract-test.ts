import {
  MODEL_PROMOTION_STATE_MACHINE_VERSION,
  canCreateLiveRiskForPromotionStage,
  canCreatePaperRiskForPromotionStage,
  evaluateModelPromotionTransition,
  resolveInitialPromotionStageFromLegacyStatus,
} from "../lib/models/model-promotion-state-machine";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const legacyCases = [
  ["CANDIDATE", "CANDIDATE"],
  ["APPROVED", "PAPER"],
  ["REJECTED", "DISABLED"],
  ["RETIRED", "DISABLED"],
  ["UNKNOWN", "EXPERIMENTAL"],
] as const;

for (
  const [
    legacy,
    expected,
  ] of legacyCases
) {
  assert(
    resolveInitialPromotionStageFromLegacyStatus(
      legacy,
    ) === expected,
    `LEGACY_MAPPING_FAILED:${legacy}`,
  );
}

const forwardCases = [
  ["EXPERIMENTAL", "CANDIDATE", false],
  ["CANDIDATE", "SHADOW", false],
  ["SHADOW", "PAPER", false],
  ["PAPER", "LIMITED_LIVE", true],
  ["LIMITED_LIVE", "PRODUCTION", true],
] as const;

for (
  const [
    from,
    to,
    manual,
  ] of forwardCases
) {
  const decision =
    evaluateModelPromotionTransition(
      from,
      to,
    );

  assert(
    decision.allowed,
    `FORWARD_NOT_ALLOWED:${from}->${to}`,
  );

  assert(
    decision.requiresManualApproval === manual,
    `MANUAL_APPROVAL_MISMATCH:${from}->${to}`,
  );
}

assert(
  evaluateModelPromotionTransition(
    "PRODUCTION",
    "DEGRADED",
  ).allowed,
  "PRODUCTION_TO_DEGRADED_MUST_BE_ALLOWED",
);

assert(
  !evaluateModelPromotionTransition(
    "PRODUCTION",
    "DISABLED",
  ).allowed,
  "PRODUCTION_TO_DISABLED_MUST_REQUIRE_DEGRADED_PATH",
);

assert(
  evaluateModelPromotionTransition(
    "DEGRADED",
    "SHADOW",
  ).allowed,
  "DEGRADED_TO_SHADOW_RECOVERY_MUST_BE_ALLOWED",
);

assert(
  !evaluateModelPromotionTransition(
    "DISABLED",
    "CANDIDATE",
  ).allowed,
  "DISABLED_MUST_BE_TERMINAL_IN_V1",
);

assert(
  !canCreatePaperRiskForPromotionStage(
    "SHADOW",
  ),
  "SHADOW_MUST_NOT_CREATE_PAPER_RISK",
);

assert(
  canCreatePaperRiskForPromotionStage(
    "PAPER",
  ),
  "PAPER_MUST_ALLOW_PAPER_RISK",
);

assert(
  !canCreateLiveRiskForPromotionStage(
    "PAPER",
  ),
  "PAPER_MUST_NOT_ALLOW_LIVE_RISK",
);

assert(
  canCreateLiveRiskForPromotionStage(
    "LIMITED_LIVE",
  ),
  "LIMITED_LIVE_MUST_ALLOW_LIVE_RISK",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_STATE_MACHINE_V1_CONTRACT_VERIFIED",
      version:
        MODEL_PROMOTION_STATE_MACHINE_VERSION,
      legacyCases:
        legacyCases.length,
      forwardCases:
        forwardCases.length,
      invariants: [
        "LEGACY_STATUS_PRESERVED_BY_SEPARATE_PROMOTION_STAGE",
        "FORWARD_ONE_STAGE_ONLY",
        "LIVE_PROMOTION_REQUIRES_MANUAL_APPROVAL",
        "SHADOW_CANNOT_CREATE_PAPER_RISK",
        "PAPER_CANNOT_CREATE_LIVE_RISK",
        "DEGRADED_RECOVERS_TO_SHADOW_ONLY",
        "DISABLED_TERMINAL_IN_V1",
      ],
    },
    null,
    2,
  ),
);
