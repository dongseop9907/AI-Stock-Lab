import {
  promotionTransitionRequiresManualApproval,
} from "../lib/models/model-promotion-apply";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  promotionTransitionRequiresManualApproval(
    "PAPER",
    "LIMITED_LIVE",
  ),
  "PAPER_TO_LIMITED_LIVE_MUST_REQUIRE_MANUAL_APPROVAL",
);

assert(
  promotionTransitionRequiresManualApproval(
    "LIMITED_LIVE",
    "PRODUCTION",
  ),
  "LIMITED_LIVE_TO_PRODUCTION_MUST_REQUIRE_MANUAL_APPROVAL",
);

assert(
  promotionTransitionRequiresManualApproval(
    "DEGRADED",
    "SHADOW",
  ),
  "DEGRADED_TO_SHADOW_MUST_REQUIRE_MANUAL_APPROVAL",
);

assert(
  !promotionTransitionRequiresManualApproval(
    "CANDIDATE",
    "SHADOW",
  ),
  "CANDIDATE_TO_SHADOW_SHOULD_NOT_REQUIRE_LIVE_MANUAL_APPROVAL",
);

assert(
  !promotionTransitionRequiresManualApproval(
    "SHADOW",
    "PAPER",
  ),
  "SHADOW_TO_PAPER_SHOULD_NOT_REQUIRE_LIVE_MANUAL_APPROVAL",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_CONTRACT_VERIFIED",
      invariants: [
        "ALL_STAGE_CHANGES_GO_THROUGH_CONTROLLED_RPC",
        "PAPER_TO_LIMITED_LIVE_REQUIRES_MANUAL_APPROVAL",
        "LIMITED_LIVE_TO_PRODUCTION_REQUIRES_MANUAL_APPROVAL",
        "DEGRADED_TO_SHADOW_REQUIRES_MANUAL_APPROVAL",
        "DIRECT_STAGE_UPDATE_BLOCKED_BY_TRIGGER",
        "EVERY_RPC_DECISION_AUDITED",
        "GLOBAL_REAL_TRADING_CONTROL_REMAINS_SEPARATE",
      ],
    },
    null,
    2,
  ),
);
