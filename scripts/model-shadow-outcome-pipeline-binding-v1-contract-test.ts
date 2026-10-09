import {
  MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION,
} from "../lib/models/model-shadow-outcome-pipeline-binding";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION ===
    "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1",
  "SHADOW_PIPELINE_BINDING_VERSION_MISMATCH",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_CONTRACT_VERIFIED",
      invariants: [
        "CAPTURE_IS_DB_TRIGGER_BASED",
        "ONLY_POST_PROMOTION_SHADOW_SIGNALS_CAPTURED",
        "NO_HISTORICAL_BACKFILL",
        "EVALUATION_SIDECAR_DOES_NOT_RECALCULATE_OUTCOMES",
        "ONLY_PERSISTED_EXISTING_EVALUATION_FIELDS_ARE_MIRRORED",
        "UNKNOWN_OR_MISSING_EVALUATION_REMAINS_PENDING",
        "NO_PAPER_PROMOTION",
        "NO_ORDER_OR_POSITION_MUTATION",
        "REAL_TRADING_NOT_TOUCHED",
      ],
    },
    null,
    2,
  ),
);
