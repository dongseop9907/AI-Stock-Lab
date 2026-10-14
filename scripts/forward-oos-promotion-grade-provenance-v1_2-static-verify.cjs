const fs = require("fs");
const path = require("path");

const root = process.cwd();

const producerRel =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const evaluatorRel =
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts";

const producer =
  fs.readFileSync(
    path.resolve(
      root,
      producerRel,
    ),
    "utf8",
  );

const evaluator =
  fs.readFileSync(
    path.resolve(
      root,
      evaluatorRel,
    ),
    "utf8",
  );

const requiredFields = [
  "shadowMode",
  "commitSha",
  "configHash",
  "strategyVersion",
  "alphaVersion",
  "entryVersion",
  "riskVersion",
  "generatedAt",
];

const checks = {
  existingControlledSchemaPreserved:
    producer.includes(
      "FORWARD_OOS_CONTROLLED_PROVENANCE_V1"
    ),

  existingControlledModePreserved:
    producer.includes(
      "FORWARD_OOS_PROVENANCE_MODE"
    ) &&
    producer.includes(
      "CONTROLLED_NORMAL"
    ),

  existingRunIdPreserved:
    producer.includes(
      "FORWARD_OOS_PROVENANCE_RUN_ID"
    ),

  existingEvidenceFilePreserved:
    producer.includes(
      "FORWARD_OOS_PROVENANCE_EVIDENCE_FILE"
    ),

  promotionSchemaAdded:
    producer.includes(
      "FORWARD_OOS_PROMOTION_GRADE_PROVENANCE_V1_2"
    ),

  allRequiredFieldsAdded:
    requiredFields.every(
      (field) =>
        producer.includes(
          field,
        ),
    ),

  developmentShadowOnly:
    producer.includes(
      '"DEVELOPMENT_SHADOW" as const'
    ) &&
    !producer.includes(
      '"PROMOTION_SHADOW" as const'
    ),

  configHashUsesFrozenContract:
    producer.includes(
      "HISTORICAL_CUTOFF"
    ) &&
    producer.includes(
      "FROZEN_ENTRY_THRESHOLD"
    ) &&
    producer.includes(
      "FROZEN_PREMIUM_CAP"
    ) &&
    producer.includes(
      "hashJson({"
    ),

  commitShaResolution:
    producer.includes(
      "AI_STOCK_LAB_COMMIT_SHA"
    ) &&
    producer.includes(
      "fs.realpathSync("
    ),

  controlledProvenanceExtended:
    producer.includes(
      "...promotionGrade,"
    ),

  sessionStillUsesProvenanceVariable:
    /const\s+provenance\s*=\s*\n\s*controlledProvenance\(\);/m.test(
      producer,
    ) &&
    /const\s+session\s*=\s*\{[\s\S]*?\bprovenance\s*,/m.test(
      producer,
    ),

  integrityStillCoversProvenance:
    /const\s+integrityPayload\s*=\s*\{[\s\S]*?\bprovenance\s*,[\s\S]*?\};/m.test(
      producer,
    ),

  evaluatorAuditAdded:
    evaluator.includes(
      "FORWARD_OOS_EVALUATOR_PROVENANCE_AUDIT_V1_2"
    ),

  evaluatorReadsCanonicalSessionFile:
    evaluator.includes(
      "alpha-v3-true-forward-top1-sessions-v1.json"
    ),

  evaluatorReportContainsAudit:
    evaluator.includes(
      "promotionGradeSessionProvenance,"
    ),

  evaluatorTracksLegacy:
    evaluator.includes(
      "legacyOrInvalid:"
    ),

  evaluatorTracksDevelopment:
    evaluator.includes(
      "developmentShadow,"
    ),

  evaluatorTracksPromotion:
    evaluator.includes(
      "promotionShadow,"
    ),

  manualPromotionReviewPreserved:
    evaluator.includes(
      "MANUAL_FORWARD_OOS_REVIEW_BEFORE_ANY_PROMOTION"
    ),

  noBackfill:
    !producer.includes(
      "BACKFILL_EXISTING_SESSION"
    ) &&
    !evaluator.includes(
      "BACKFILL_EXISTING_SESSION"
    ),

  noRealTradingEnable:
    !producer.includes(
      "REAL_TRADING_ENABLED = true"
    ) &&
    !evaluator.includes(
      "REAL_TRADING_ENABLED = true"
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) =>
      ok !== true
    )
    .map(([name]) =>
      name
    );

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_FORWARD_OOS_PROMOTION_GRADE_PROVENANCE_V1_2_STATIC_VERIFIED"
      : "AI_STOCK_LAB_FORWARD_OOS_PROMOTION_GRADE_PROVENANCE_V1_2_STATIC_FAILED",

  classification:
    failed.length === 0
      ? "CONTROLLED_PROVENANCE_EXTENDED_WITH_DEVELOPMENT_SHADOW_PROMOTION_GRADE_FIELDS"
      : "PROMOTION_GRADE_PROVENANCE_V1_2_REQUIRES_FIX",

  checks,
  failed,

  policy: {
    currentShadowMode:
      "DEVELOPMENT_SHADOW",

    promotionShadowEnabled:
      false,

    existingSessionBackfill:
      false,

    futureSessionsReceiveExtendedProvenance:
      true,

    existingControlledProvenancePreserved:
      true,

    integrityHashCoversExtendedProvenance:
      true,

    evaluatorOnlyAuditsPromotionEligibility:
      true,

    automaticPromotion:
      false,
  },

  safety: {
    sourceOnly:
      true,

    producerExecuted:
      false,

    evaluatorExecuted:
      false,

    shadowCollectionExecuted:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    networkRequests:
      0,

    kisOrdersSubmitted:
      0,

    realTradingChanged:
      false,
  },

  nextAction:
    failed.length === 0
      ? "TYPECHECK_PROBE_ONLY_DIFF_THEN_DEPLOY_SOURCE_TO_CLOUD"
      : "STOP_AND_DIAGNOSE",
}, null, 2));

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
