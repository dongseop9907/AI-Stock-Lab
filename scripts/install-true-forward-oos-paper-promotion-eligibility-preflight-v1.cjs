const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const PREFLIGHT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-eligibility-preflight-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-eligibility-preflight-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-eligibility-preflight-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-manual-review-decision-integrity-v1.ts",
  "lib/models/model-promotion-manual-apply.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const preflightSource = `import {
  auditManualReviewDecisionIntegrityV1,
} from "./true-forward-oos-manual-review-decision-integrity-v1";

import {
  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
  preflightManualPaperPromotion,
} from "../lib/models/model-promotion-manual-apply";

export interface PaperPromotionEligibilityPreflightInput {
  modelId?: string;
  actor?: string;
  reason?: string;

  decisionRecord?: any;
  packet?: any;
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;

  promotionPreflight?: (
    input: {
      modelId: string;
      toStage: "PAPER";
      manualApprovalConfirmed: boolean;
      confirmationPhrase: string;
      actor: string;
      reason: string;
    },
  ) => Promise<any>;
}

function hasOwn(
  input: PaperPromotionEligibilityPreflightInput,
  key:
    | "decisionRecord"
    | "packet"
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
) {
  return Object.prototype.hasOwnProperty.call(
    input,
    key,
  );
}

export async function runPaperPromotionEligibilityPreflightV1(
  input:
    PaperPromotionEligibilityPreflightInput = {},
) {
  const decisionIntegrity =
    auditManualReviewDecisionIntegrityV1({
      ...(hasOwn(
        input,
        "decisionRecord",
      )
        ? {
            decisionRecord:
              input.decisionRecord,
          }
        : {}),

      ...(hasOwn(
        input,
        "packet",
      )
        ? {
            packet:
              input.packet,
          }
        : {}),

      ...(hasOwn(
        input,
        "observationsDocument",
      )
        ? {
            observationsDocument:
              input.observationsDocument,
          }
        : {}),

      ...(hasOwn(
        input,
        "evaluatorReport",
      )
        ? {
            evaluatorReport:
              input.evaluatorReport,
          }
        : {}),

      ...(hasOwn(
        input,
        "summaryReport",
      )
        ? {
            summaryReport:
              input.summaryReport,
          }
        : {}),
    });

  if (
    decisionIntegrity.integrityStatus ===
    "WAITING_FOR_MANUAL_REVIEW_DECISION"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_APPROVE_DECISION",
    };
  }

  if (
    decisionIntegrity.integrityStatus !==
      "MANUAL_REVIEW_DECISION_INTEGRITY_VERIFIED" ||
    decisionIntegrity.paperPromotionReviewEligible !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      decisionIntegrity: {
        integrityStatus:
          decisionIntegrity.integrityStatus,

        decision:
          decisionIntegrity.decision ??
          null,

        paperPromotionReviewEligible:
          decisionIntegrity.paperPromotionReviewEligible ??
          false,
      },

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_OR_REPAIR_DECISION",
    };
  }

  const modelId =
    (
      input.modelId ??
      process.env
        .TRUE_FORWARD_OOS_PAPER_PROMOTION_MODEL_ID ??
      ""
    ).trim();

  if (!modelId) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_MODEL_ID_REQUIRED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed: [
        "MODEL_ID_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "PROVIDE_EXPLICIT_ENTRY_TIMING_SHADOW_MODEL_ID",
    };
  }

  const actor =
    (
      input.actor ??
      "TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1"
    ).trim();

  const reason =
    (
      input.reason ??
      "VERIFIED_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION"
    ).trim();

  if (
    !actor ||
    !reason
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_ACTOR_OR_REASON_REQUIRED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed: [
        "ACTOR_OR_REASON_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "PROVIDE_ACTOR_AND_REASON",
    };
  }

  const preflightFn =
    input.promotionPreflight ??
    preflightManualPaperPromotion;

  const promotionPreflight =
    await preflightFn({
      modelId,
      toStage:
        "PAPER",

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,

      actor,
      reason,
    });

  const checks = {
    exactConfirmationPhrase:
      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE ===
      "PROMOTE_SHADOW_TO_PAPER",

    modelIdMatches:
      promotionPreflight
        ?.modelId ===
        modelId,

    fromStageShadow:
      promotionPreflight
        ?.fromStage ===
        "SHADOW",

    toStagePaper:
      promotionPreflight
        ?.toStage ===
        "PAPER",

    recommendationRecommended:
      promotionPreflight
        ?.recommendationDecision ===
        "RECOMMENDED",

    recommendationReasonCanonicalReady:
      promotionPreflight
        ?.recommendationReason ===
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

    canonicalEvidenceReady:
      promotionPreflight
        ?.canonicalShadowOutcomeEvidenceReady ===
        true,

    transitionAllowed:
      promotionPreflight
        ?.transitionKind ===
        "ALLOWED" ||
      promotionPreflight
        ?.transitionKind ===
        "SHADOW_TO_PAPER",

    manualPreflightAllowed:
      promotionPreflight
        ?.allowed ===
        true,

    manualPreflightReasonReady:
      promotionPreflight
        ?.reason ===
        "READY",
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

    eligibilityStatus:
      failed.length ===
      0
        ? "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW"
        : "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT",

    eligibleForSeparatePromotionApplyReview:
      failed.length ===
      0,

    actualPromotionApplyExecuted:
      false,

    promotionPreflightCalled:
      true,

    modelId,

    existingPromotionPreflight: {
      allowed:
        promotionPreflight
          ?.allowed ??
        null,

      reason:
        promotionPreflight
          ?.reason ??
        null,

      fromStage:
        promotionPreflight
          ?.fromStage ??
        null,

      toStage:
        promotionPreflight
          ?.toStage ??
        null,

      recommendationDecision:
        promotionPreflight
          ?.recommendationDecision ??
        null,

      recommendationReason:
        promotionPreflight
          ?.recommendationReason ??
        null,

      canonicalShadowOutcomeEvidenceReady:
        promotionPreflight
          ?.canonicalShadowOutcomeEvidenceReady ??
        null,

      transitionKind:
        promotionPreflight
          ?.transitionKind ??
        null,

      featureEnabled:
        promotionPreflight
          ?.featureEnabled ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "BUILD_SEPARATE_EXPLICIT_PAPER_PROMOTION_APPLY_APPROVAL_GATE"
        : "KEEP_SHADOW_AND_REPAIR_OR_WAIT_FOR_EXISTING_PROMOTION_PREFLIGHT",
  };
}

function safety() {
  return {
    readOnly:
      true,

    decisionWritten:
      false,

    packetWritten:
      false,

    promotionPreflightReadOnly:
      true,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionStageChanged:
      false,

    promotionEventWritten:
      false,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    controlsChanged:
      false,

    realTradingEnabled:
      false,
  };
}

async function main() {
  const result =
    await runPaperPromotionEligibilityPreflightV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.eligibilityStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-eligibility-preflight-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),

            safety:
              safety(),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
`;

  const contractSource = `import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  runPaperPromotionEligibilityPreflightV1,
} from "./true-forward-oos-paper-promotion-eligibility-preflight-v1";

import {
  APPROVE_DECISION,
  REJECT_DECISION,
} from "./true-forward-oos-manual-review-decision-v1";

function stableJson(
  value: unknown,
) {
  return JSON.stringify(
    value,
    null,
    2,
  );
}

function sha256(
  value: unknown,
) {
  return crypto
    .createHash("sha256")
    .update(
      stableJson(value),
    )
    .digest("hex");
}

function fixtures(
  decisionValue:
    string,
) {
  const observationsDocument = {
    observations: [
      {
        sourceTradingDate:
          "2026-10-08",

        targetSessionDate:
          "2026-10-12",

        stockCode:
          "005930",
      },
    ],
  };

  const evaluatorReport = {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED",
  };

  const summaryReport = {
    decision: {
      enoughEvidenceForFinalEntryGate:
        true,

      productionPolicyLocked:
        false,
    },
  };

  const packetCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

    generatedAt:
      "2026-12-15T07:00:00.000Z",

    reviewGate: {
      gateStatus:
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",

      reviewReady:
        true,
    },

    frozenContract: {
      historicalCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,

      retuningAllowed:
        false,
    },

    counts: {
      observations:
        1,

      qualifiedObservations:
        1,

      filledObservations:
        1,
    },

    evaluatorDecision: {
      enoughSample:
        true,

      fillPassed:
        true,

      pairedPassed:
        true,

      forwardOosGatePassed:
        true,

      nextUse:
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",
    },

    summaryDecision: {
      trueForwardReady:
        true,

      enoughEvidenceForFinalEntryGate:
        true,

      productionPolicyLocked:
        false,
    },

    sourceHashes: {
      observationsSha256:
        sha256(
          observationsDocument,
        ),

      evaluatorSha256:
        sha256(
          evaluatorReport,
        ),

      summarySha256:
        sha256(
          summaryReport,
        ),
    },

    safety: {
      manualReviewOnly:
        true,

      promotionExecuted:
        false,

      automaticPromotion:
        false,

      realTradingEnabled:
        false,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };

  const packet = {
    ...packetCore,

    packetSha256:
      sha256(
        packetCore,
      ),
  };

  const decisionCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

    recordedAt:
      "2026-12-15T08:00:00.000Z",

    decision:
      decisionValue,

    note:
      "contract",

    packetReference: {
      packetSha256:
        packet.packetSha256,

      observationsSha256:
        packet.sourceHashes
          .observationsSha256,

      evaluatorSha256:
        packet.sourceHashes
          .evaluatorSha256,

      summarySha256:
        packet.sourceHashes
          .summarySha256,
    },

    decisionSemantics: {
      promotionApproved:
        false,

      paperPromotionExecuted:
        false,

      automaticPromotion:
        false,

      approvalMeaning:
        decisionValue ===
        APPROVE_DECISION
          ? "ALLOW_SEPARATE_PAPER_PROMOTION_REVIEW_GATE_ONLY"
          : "CONTINUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    },

    safety: {
      packetIntegrityVerified:
        true,

      promotionExecuted:
        false,

      automaticPromotion:
        false,

      realTradingEnabled:
        false,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };

  const decisionRecord = {
    ...decisionCore,

    decisionRecordSha256:
      sha256(
        decisionCore,
      ),
  };

  return {
    observationsDocument,
    evaluatorReport,
    summaryReport,
    packet,
    decisionRecord,
  };
}

async function main() {
  let preflightCalls =
    0;

  const mockReadyPreflight =
    async (
      input: any,
    ) => {
      preflightCalls +=
        1;

      return {
        allowed:
          true,

        reason:
          "READY",

        modelId:
          input.modelId,

        fromStage:
          "SHADOW",

        toStage:
          "PAPER",

        recommendationDecision:
          "RECOMMENDED",

        recommendationReason:
          "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

        canonicalShadowOutcomeEvidenceReady:
          true,

        transitionKind:
          "SHADOW_TO_PAPER",

        featureEnabled:
          false,
      };
    };

  const waiting =
    await runPaperPromotionEligibilityPreflightV1({
      decisionRecord:
        undefined,

      promotionPreflight:
        mockReadyPreflight,
    });

  const rejectFixtures =
    fixtures(
      REJECT_DECISION,
    );

  const rejected =
    await runPaperPromotionEligibilityPreflightV1({
      ...rejectFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        mockReadyPreflight,
    });

  const approveFixtures =
    fixtures(
      APPROVE_DECISION,
    );

  const noModel =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      promotionPreflight:
        mockReadyPreflight,
    });

  const ready =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        mockReadyPreflight,
    });

  const blockedExisting =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        async (
          input: any,
        ) => {
          return {
            allowed:
              false,

            reason:
              "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

            modelId:
              input.modelId,

            fromStage:
              "SHADOW",

            toStage:
              "PAPER",

            recommendationDecision:
              "BLOCKED",

            recommendationReason:
              "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

            canonicalShadowOutcomeEvidenceReady:
              false,

            transitionKind:
              "SHADOW_TO_PAPER",

            featureEnabled:
              false,
          };
        },
    });

  const checks = {
    waitingSkipsExistingPreflight:
      waiting.eligibilityStatus ===
        "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION" &&
      waiting.promotionPreflightCalled ===
        false,

    rejectDecisionSkipsExistingPreflight:
      rejected.eligibilityStatus ===
        "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED" &&
      rejected.promotionPreflightCalled ===
        false,

    modelIdRequiredAfterApproval:
      noModel.eligibilityStatus ===
        "BLOCKED_MODEL_ID_REQUIRED" &&
      noModel.promotionPreflightCalled ===
        false,

    eligibleWhenAllExistingChecksReady:
      ready.eligibilityStatus ===
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" &&
      ready.eligibleForSeparatePromotionApplyReview ===
        true,

    existingCanonicalNotReadyBlocks:
      blockedExisting.eligibilityStatus ===
        "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT" &&
      blockedExisting.eligibleForSeparatePromotionApplyReview ===
        false,

    exactPhraseBound:
      ready.checks
        .exactConfirmationPhrase ===
        true,

    noActualApply:
      ready.actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false,

    noTradingSideEffects:
      ready.safety
        .databaseWrites ===
        0 &&
      ready.safety
        .ordersCreated ===
        0 &&
      ready.safety
        .positionsChanged ===
        0 &&
      ready.safety
        .realTradingEnabled ===
        false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.eligibilityStatus,

          rejected:
            rejected.eligibilityStatus,

          noModel:
            noModel.eligibilityStatus,

          ready:
            ready.eligibilityStatus,

          blockedExisting:
            {
              eligibilityStatus:
                blockedExisting.eligibilityStatus,

              existingReason:
                blockedExisting
                  .existingPromotionPreflight
                  ?.reason ??
                null,
            },

          promotionPreflightCalls:
            preflightCalls,
        },

        safety: {
          syntheticOnly:
            true,

          realPromotionPreflightCalled:
            false,

          applyManualPaperPromotionCalled:
            false,

          promotionExecuted:
            false,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_ELIGIBILITY_PREFLIGHT_EXPECT_WAITING",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_CONTRACT_FAILED",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-paper-promotion-eligibility-preflight-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_STATIC_FAILED",

    failed:
      ["preflightExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    preflightExists:
      true,

    decisionIntegrityRequired:
      source.includes(
        "auditManualReviewDecisionIntegrityV1"
      ),

    existingPromotionPreflightBound:
      source.includes(
        "preflightManualPaperPromotion"
      ),

    exactConfirmationConstantBound:
      source.includes(
        "MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE"
      ),

    exactPhraseVerified:
      source.includes(
        '"PROMOTE_SHADOW_TO_PAPER"'
      ),

    shadowRequired:
      source.includes(
        '"SHADOW"'
      ),

    paperTarget:
      source.includes(
        '"PAPER"'
      ),

    recommendationRequired:
      source.includes(
        '"RECOMMENDED"'
      ),

    canonicalReadyReasonRequired:
      source.includes(
        '"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"'
      ),

    canonicalEvidenceRequired:
      source.includes(
        "canonicalShadowOutcomeEvidenceReady"
      ),

    modelIdExplicit:
      source.includes(
        "TRUE_FORWARD_OOS_PAPER_PROMOTION_MODEL_ID"
      ),

    noApplyImport:
      !source.includes(
        "applyManualPaperPromotion,"
      ) &&
      !source.includes(
        "applyManualPaperPromotion("
      ),

    noPromotionRouteExecution:
      !source.includes(
        "/api/models/promotion/apply"
      ),

    noDatabaseWriteSurface:
      !/\\.insert\\s*\\(|\\.update\\s*\\(|\\.upsert\\s*\\(|\\.delete\\s*\\(/.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      promotionPreflightExecuted:
        false,

      actualPromotionApplyExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_CONTRACT"
        : "REPAIR_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    PREFLIGHT,
    preflightSource,
    "utf8"
  );

  fs.writeFileSync(
    CONTRACT,
    contractSource,
    "utf8"
  );

  fs.writeFileSync(
    STATIC,
    staticSource,
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "forward-oos:paper-promotion-eligibility"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-eligibility"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-eligibility-static"
    ] =
      "node ./scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1-static-verify.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1.ts",
        "scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1-contract-test.ts",
        "scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      actualBindings: {
        decisionIntegrity:
          "auditManualReviewDecisionIntegrityV1",

        existingPromotionPreflight:
          "preflightManualPaperPromotion",

        exactConfirmationPhrase:
          "PROMOTE_SHADOW_TO_PAPER",

        requiredFromStage:
          "SHADOW",

        targetStage:
          "PAPER",

        requiredRecommendation:
          "RECOMMENDED",

        requiredRecommendationReason:
          "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

        requiredCanonicalEvidence:
          true
      },

      behavior: {
        currentWithoutDecisionRecord:
          "WAIT_WITHOUT_CALLING_EXISTING_PROMOTION_PREFLIGHT",

        approvedDecisionWithoutModelId:
          "BLOCK",

        approvedDecisionWithModelId:
          "CALL_EXISTING_READ_ONLY_PREFLIGHT_ONLY",

        actualPromotionApply:
          "NEVER"
      },

      safety: {
        installerCalledPromotionPreflight:
          false,

        installerExecutedPromotion:
          false,

        applyManualPaperPromotionCalled:
          false,

        modelStageChanged:
          false,

        promotionEventWritten:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_ELIGIBILITY_PREFLIGHT"
    }, null, 2));

    process.exitCode = 0;
  }
}
