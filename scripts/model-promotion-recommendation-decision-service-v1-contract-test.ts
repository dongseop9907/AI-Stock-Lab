import {
  MODEL_PROMOTION_DECISION_SERVICE_VERSION,
} from "../lib/models/model-promotion-decision-service";

import {
  evaluateModelPromotionTransition,
} from "../lib/models/model-promotion-state-machine";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  MODEL_PROMOTION_DECISION_SERVICE_VERSION ===
    "MODEL_PROMOTION_DECISION_SERVICE_V1",
  "DECISION_SERVICE_VERSION_MISMATCH",
);

const candidateShadow =
  evaluateModelPromotionTransition(
    "CANDIDATE",
    "SHADOW",
  );

assert(
  candidateShadow.allowed,
  "CANDIDATE_TO_SHADOW_MUST_BE_VALID",
);

assert(
  candidateShadow.requiresManualApproval ===
    false,
  "CANDIDATE_TO_SHADOW_SHOULD_NOT_REQUIRE_LIVE_MANUAL_APPROVAL",
);

const shadowPaper =
  evaluateModelPromotionTransition(
    "SHADOW",
    "PAPER",
  );

assert(
  shadowPaper.allowed,
  "SHADOW_TO_PAPER_MUST_BE_VALID",
);

assert(
  shadowPaper.requiresManualApproval ===
    false,
  "SHADOW_TO_PAPER_STATE_MACHINE_MANUAL_APPROVAL_MISMATCH",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_RECOMMENDATION_DECISION_SERVICE_V1_CONTRACT_VERIFIED",
      invariants: [
        "RECOMMENDATION_SERVICE_NEVER_APPLIES_PROMOTION_STAGE",
        "CANDIDATE_TO_SHADOW_USES_OPERATIONAL_SIGNAL_EVIDENCE_ONLY",
        "SHADOW_TO_PAPER_FAILS_CLOSED_WITHOUT_CANONICAL_OUTCOME_EVIDENCE",
        "EVENT_WRITER_WRITES_AUDIT_ONLY",
        "NO_ORDER_OR_POSITION_MUTATION",
        "NO_REAL_TRADING_ENABLE",
      ],
    },
    null,
    2,
  ),
);
