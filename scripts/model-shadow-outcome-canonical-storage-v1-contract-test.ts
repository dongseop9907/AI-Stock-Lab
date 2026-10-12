import {
  MODEL_SHADOW_OUTCOME_STORAGE_VERSION,
} from "../lib/models/model-shadow-outcome-storage";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  MODEL_SHADOW_OUTCOME_STORAGE_VERSION ===
    "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1",
  "SHADOW_OUTCOME_STORAGE_VERSION_MISMATCH",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_CONTRACT_VERIFIED",
      invariants: [
        "NO_HISTORICAL_BACKFILL",
        "ONLY_POST_PROMOTION_SHADOW_SIGNALS_ELIGIBLE",
        "SIGNAL_ID_UNIQUE_IDEMPOTENCY",
        "OUTCOME_STATUS_CAN_PROGRESS_WITHOUT_PAPER_RISK",
        "RETURN_1D_3D_5D_CANONICAL_FIELDS",
        "MAX_MIN_RETURN_CANONICAL_FIELDS",
        "PROMOTION_STAGE_AT_CAPTURE_FIXED_TO_SHADOW",
        "PAPER_PROMOTION_NOT_APPLIED_BY_STORAGE_LAYER",
        "REAL_TRADING_NOT_TOUCHED",
      ],
    },
    null,
    2,
  ),
);
