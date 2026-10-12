import {
  canCreateLiveRiskForPromotionStage,
  canCreatePaperRiskForPromotionStage,
} from "../lib/models/model-promotion-state-machine";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const paperAllowed = [
  "PAPER",
  "LIMITED_LIVE",
  "PRODUCTION",
] as const;

const paperBlocked = [
  "EXPERIMENTAL",
  "CANDIDATE",
  "SHADOW",
  "DEGRADED",
  "DISABLED",
] as const;

for (const stage of paperAllowed) {
  assert(
    canCreatePaperRiskForPromotionStage(
      stage,
    ),
    `PAPER_RISK_SHOULD_BE_ALLOWED:${stage}`,
  );
}

for (const stage of paperBlocked) {
  assert(
    !canCreatePaperRiskForPromotionStage(
      stage,
    ),
    `PAPER_RISK_SHOULD_BE_BLOCKED:${stage}`,
  );
}

assert(
  canCreateLiveRiskForPromotionStage(
    "LIMITED_LIVE",
  ),
  "LIMITED_LIVE_MUST_ALLOW_LIVE_STAGE_POLICY",
);

assert(
  canCreateLiveRiskForPromotionStage(
    "PRODUCTION",
  ),
  "PRODUCTION_MUST_ALLOW_LIVE_STAGE_POLICY",
);

for (
  const stage of [
    "EXPERIMENTAL",
    "CANDIDATE",
    "SHADOW",
    "PAPER",
    "DEGRADED",
    "DISABLED",
  ] as const
) {
  assert(
    !canCreateLiveRiskForPromotionStage(
      stage,
    ),
    `LIVE_RISK_SHOULD_BE_BLOCKED:${stage}`,
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_CONTRACT_VERIFIED",
      invariants: [
        "CANDIDATE_CAN_GENERATE_SIGNALS_BUT_CANNOT_CREATE_PAPER_RISK",
        "SHADOW_CANNOT_CREATE_PAPER_RISK",
        "PAPER_CAN_CREATE_PAPER_RISK",
        "LIMITED_LIVE_CAN_CREATE_PAPER_RISK",
        "PRODUCTION_CAN_CREATE_PAPER_RISK",
        "ONLY_LIMITED_LIVE_AND_PRODUCTION_ARE_LIVE_STAGE_ELIGIBLE",
        "NO_LIVE_WRITER_IS_BOUND_BY_THIS_PATCH",
      ],
    },
    null,
    2,
  ),
);
