const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1.ts",
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
  const gateSource = `import fs from "node:fs";
import path from "node:path";

import {
  runPaperPromotionFinalAuthorizationGateV1,
  type PaperPromotionFinalAuthorizationGateInput,
} from "./true-forward-oos-paper-promotion-final-authorization-gate-v1";

const ROOT =
  process.cwd();

const ACTUAL_APPLY_SOURCE_FILE =
  path.resolve(
    ROOT,
    "lib/models/model-promotion-manual-apply.ts",
  );

export interface ActualPromotionExecutionReviewGateInput
  extends PaperPromotionFinalAuthorizationGateInput {
  applySourceText?: string;

  finalAuthorizationRunner?: (
    input: PaperPromotionFinalAuthorizationGateInput,
  ) => Promise<any>;
}

export function auditActualPromotionMutationContractV1(
  sourceText: string,
) {
  const source =
    String(
      sourceText ??
      "",
    );

  const eventInsertIndex =
    source.indexOf(
      '.from(\\n        "model_promotion_events",',
    );

  const stageUpdateIndex =
    source.indexOf(
      '.from(\\n        "ai_model_versions",',
      Math.max(
        0,
        eventInsertIndex + 1,
      ),
    );

  const compensationDeleteIndex =
    source.indexOf(
      ".delete()",
      Math.max(
        0,
        stageUpdateIndex + 1,
      ),
    );

  const checks = {
    applyFunctionExists:
      source.includes(
        "export async function applyManualPaperPromotion("
      ),

    applyCallsPreflightFirst:
      source.includes(
        "const preflight ="
      ) &&
      source.includes(
        "await preflightManualPaperPromotion("
      ) &&
      source.indexOf(
        "await preflightManualPaperPromotion("
      ) <
      source.indexOf(
        '.from(\\n        "model_promotion_events",'
      ),

    preflightFailClosed:
      source.includes(
        "!preflight.allowed"
      ) &&
      source.includes(
        "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:"
      ),

    featureFlagRequired:
      source.includes(
        "ENABLE_MANUAL_MODEL_PROMOTION_APPLY"
      ),

    eventInsertExists:
      eventInsertIndex >=
      0,

    eventInsertedBeforeStageUpdate:
      eventInsertIndex >=
        0 &&
      stageUpdateIndex >
        eventInsertIndex,

    eventModelId:
      source.includes(
        "model_id:\\n          input.modelId"
      ),

    eventFromShadow:
      source.includes(
        'from_stage:\\n          "SHADOW"'
      ),

    eventToPaper:
      source.includes(
        'to_stage:\\n          "PAPER"'
      ),

    eventTransitionKind:
      source.includes(
        "transition_kind:\\n          preflight.transitionKind"
      ),

    eventDecision:
      source.includes(
        "decision:\\n          recommendation.decision"
      ),

    eventRequiresManualApproval:
      source.includes(
        "requires_manual_approval:\\n          true"
      ),

    eventManualApprovalConfirmed:
      source.includes(
        "manual_approval_confirmed:\\n          true"
      ),

    eventActor:
      source.includes(
        "actor:\\n          input.actor"
      ),

    eventReasonTagged:
      source.includes(
        "MANUAL_APPLY_APPROVED:\${"
      ),

    eventEvidenceIncludesManualApply:
      source.includes(
        "manualApply: {"
      ) &&
      source.includes(
        "confirmationPhrase:"
      ) &&
      source.includes(
        "canonicalReady:"
      ),

    stageUpdateExists:
      stageUpdateIndex >=
      0,

    stageSetPaper:
      source.includes(
        'promotion_stage:\\n          "PAPER"'
      ),

    stageUpdatedAtSet:
      source.includes(
        "promotion_stage_updated_at:\\n          now"
      ),

    stageReasonTagged:
      source.includes(
        "MANUAL_APPLY:\${"
      ),

    stageUpdateMatchesModelId:
      source.includes(
        '.eq(\\n        "id",\\n        input.modelId,'
      ),

    stageUpdateCompareAndSetShadow:
      source.includes(
        '.eq(\\n        "promotion_stage",\\n        "SHADOW",'
      ),

    stageUpdateReturnsRow:
      source.includes(
        '"id,purpose,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason"'
      ) &&
      source.includes(
        ".maybeSingle();"
      ),

    updateFailureDetected:
      source.includes(
        "updateError ||"
      ) &&
      source.includes(
        "!updated"
      ),

    compensationDeleteExists:
      compensationDeleteIndex >
      stageUpdateIndex,

    compensationTargetsInsertedEvent:
      source.includes(
        '.delete()\\n      .eq(\\n        "id",\\n        event.id,'
      ),

    compensationBeforeStageUpdateErrorThrow:
      compensationDeleteIndex >=
        0 &&
      source.indexOf(
        "MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:",
        compensationDeleteIndex,
      ) >
        compensationDeleteIndex,

    exactPhraseStillBound:
      source.includes(
        '"PROMOTE_SHADOW_TO_PAPER" as const'
      ),

    entryTimingOnly:
      source.includes(
        'model.purpose !==\\n      "ENTRY_TIMING"'
      ),

    canonicalEvidenceFailClosed:
      source.includes(
        '"CANONICAL_OUTCOME_EVIDENCE_NOT_READY"'
      ),

    recommendationMustBeReady:
      source.includes(
        '"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"'
      ),
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
    contractStatus:
      failed.length ===
      0
        ? "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        : "ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFTED",

    checks,
    failed,

    mutationOrder: {
      eventInsertBeforeStageUpdate:
        eventInsertIndex >=
          0 &&
        stageUpdateIndex >
          eventInsertIndex,

      compensationDeleteAfterStageUpdateAttempt:
        compensationDeleteIndex >
        stageUpdateIndex,
    },

    expectedMutationContract: {
      first:
        "INSERT model_promotion_events SHADOW_TO_PAPER",

      second:
        "COMPARE_AND_SET ai_model_versions SHADOW_TO_PAPER",

      onSecondFailure:
        "DELETE_INSERTED_PROMOTION_EVENT_THEN_THROW",

      stageReason:
        "MANUAL_APPLY:<reason>",

      eventReason:
        "MANUAL_APPLY_APPROVED:<reason>",
    },
  };
}

export async function runActualPromotionExecutionReviewGateV1(
  input:
    ActualPromotionExecutionReviewGateInput = {},
) {
  const finalAuthorizationRunner =
    input.finalAuthorizationRunner ??
    runPaperPromotionFinalAuthorizationGateV1;

  const authorization =
    await finalAuthorizationRunner(
      input,
    );

  if (
    authorization.authorizationStatus ===
    "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

      reviewStatus:
        "WAITING_FOR_FINAL_PROMOTION_AUTHORIZATION",

      readyForSeparateActualExecutionGate:
        false,

      actualPromotionApplyExecuted:
        false,

      mutationContractInspected:
        false,

      failed:
        [],

      authorizationStatus:
        authorization.authorizationStatus,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",
    };
  }

  if (
    authorization.authorizationStatus !==
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY" ||
    authorization.readyForActualPromotionExecutionReview !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

      reviewStatus:
        "BLOCKED_FINAL_PROMOTION_AUTHORIZATION_NOT_READY",

      readyForSeparateActualExecutionGate:
        false,

      actualPromotionApplyExecuted:
        false,

      mutationContractInspected:
        false,

      failed: [
        "FINAL_PROMOTION_AUTHORIZATION_NOT_READY",
      ],

      authorizationStatus:
        authorization.authorizationStatus,

      safety:
        safety(),

      nextGate:
        "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
    };
  }

  const sourceText =
    Object.prototype.hasOwnProperty.call(
      input,
      "applySourceText",
    )
      ? String(
          input.applySourceText ??
          "",
        )
      : fs.readFileSync(
          ACTUAL_APPLY_SOURCE_FILE,
          "utf8",
        );

  const contract =
    auditActualPromotionMutationContractV1(
      sourceText,
    );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

    reviewStatus:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        ? "ACTUAL_PROMOTION_EXECUTION_REVIEW_READY"
        : "BLOCKED_ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFT",

    readyForSeparateActualExecutionGate:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED",

    actualPromotionApplyExecuted:
      false,

    mutationContractInspected:
      true,

    modelId:
      authorization.modelId ??
      null,

    authorizationEvidence: {
      authorizationStatus:
        authorization.authorizationStatus,

      dryRunStatus:
        authorization
          .dryRunEvidence
          ?.dryRunStatus ??
        null,

      dryRunRouteCalled:
        authorization
          .dryRunEvidence
          ?.dryRunRouteCalled ??
        false,
    },

    mutationContract:
      contract,

    failed:
      contract.failed,

    safety:
      safety(),

    nextGate:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        ? "BUILD_SEPARATE_ACTUAL_PROMOTION_EXECUTION_GATE_WITH_POSTCONDITION_VERIFICATION"
        : "STOP_AND_REVIEW_PROMOTION_MUTATION_CONTRACT_DRIFT",
  };
}

function safety() {
  return {
    readOnlyReviewGate:
      true,

    sourceReadOnly:
      true,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalledByThisGate:
      false,

    databaseReadsByThisGate:
      0,

    databaseWritesByThisGate:
      0,

    modelStageChangedByThisGate:
      false,

    promotionEventWrittenByThisGate:
      false,

    ordersCreatedByThisGate:
      0,

    positionsChangedByThisGate:
      0,

    controlsChangedByThisGate:
      false,

    realTradingEnabledByThisGate:
      false,
  };
}

async function main() {
  const result =
    await runActualPromotionExecutionReviewGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.reviewStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_ERROR",

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
import fs from "node:fs";
import path from "node:path";

import {
  auditActualPromotionMutationContractV1,
  runActualPromotionExecutionReviewGateV1,
} from "./true-forward-oos-paper-promotion-actual-execution-review-gate-v1";

const ROOT =
  process.cwd();

const ACTUAL_SOURCE =
  fs.readFileSync(
    path.resolve(
      ROOT,
      "lib/models/model-promotion-manual-apply.ts",
    ),
    "utf8",
  );

function waitingAuthorization() {
  return {
    authorizationStatus:
      "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,
  };
}

function blockedAuthorization() {
  return {
    authorizationStatus:
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,
  };
}

function readyAuthorization() {
  return {
    authorizationStatus:
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY",

    readyForActualPromotionExecutionReview:
      true,

    actualPromotionApplyExecuted:
      false,

    modelId:
      "model-1",

    dryRunEvidence: {
      dryRunStatus:
        "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

      dryRunRouteCalled:
        true,
    },
  };
}

async function main() {
  const direct =
    auditActualPromotionMutationContractV1(
      ACTUAL_SOURCE,
    );

  const driftedSource =
    ACTUAL_SOURCE.replace(
      '.eq(\\n        "promotion_stage",\\n        "SHADOW",',
      '.eq(\\n        "promotion_stage",\\n        "PAPER",',
    );

  const drifted =
    auditActualPromotionMutationContractV1(
      driftedSource,
    );

  const waiting =
    await runActualPromotionExecutionReviewGateV1({
      finalAuthorizationRunner:
        async () =>
          waitingAuthorization(),
    });

  const blocked =
    await runActualPromotionExecutionReviewGateV1({
      finalAuthorizationRunner:
        async () =>
          blockedAuthorization(),
    });

  const ready =
    await runActualPromotionExecutionReviewGateV1({
      applySourceText:
        ACTUAL_SOURCE,

      finalAuthorizationRunner:
        async () =>
          readyAuthorization(),
    });

  const readyButDrifted =
    await runActualPromotionExecutionReviewGateV1({
      applySourceText:
        driftedSource,

      finalAuthorizationRunner:
        async () =>
          readyAuthorization(),
    });

  const checks = {
    actualSourceContractVerified:
      direct.contractStatus ===
        "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED",

    eventBeforeStageUpdate:
      direct.checks
        .eventInsertedBeforeStageUpdate ===
        true,

    compareAndSetShadow:
      direct.checks
        .stageUpdateCompareAndSetShadow ===
        true,

    compensationDeleteVerified:
      direct.checks
        .compensationDeleteExists ===
        true &&
      direct.checks
        .compensationTargetsInsertedEvent ===
        true &&
      direct.checks
        .compensationBeforeStageUpdateErrorThrow ===
        true,

    waitingSkipsSourceInspection:
      waiting.reviewStatus ===
        "WAITING_FOR_FINAL_PROMOTION_AUTHORIZATION" &&
      waiting.mutationContractInspected ===
        false,

    blockedAuthorizationStops:
      blocked.reviewStatus ===
        "BLOCKED_FINAL_PROMOTION_AUTHORIZATION_NOT_READY",

    readyReviewPasses:
      ready.reviewStatus ===
        "ACTUAL_PROMOTION_EXECUTION_REVIEW_READY" &&
      ready.readyForSeparateActualExecutionGate ===
        true,

    contractDriftBlocks:
      drifted.contractStatus ===
        "ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFTED" &&
      drifted.failed.includes(
        "stageUpdateCompareAndSetShadow",
      ),

    readyButDriftedBlocks:
      readyButDrifted.reviewStatus ===
        "BLOCKED_ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFT" &&
      readyButDrifted.readyForSeparateActualExecutionGate ===
        false,

    stillNoActualPromotion:
      ready.actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false,

    noTradingSideEffects:
      ready.safety
        .databaseWritesByThisGate ===
        0 &&
      ready.safety
        .ordersCreatedByThisGate ===
        0 &&
      ready.safety
        .positionsChangedByThisGate ===
        0 &&
      ready.safety
        .realTradingEnabledByThisGate ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          direct:
            direct.contractStatus,

          waiting:
            waiting.reviewStatus,

          blocked:
            blocked.reviewStatus,

          ready:
            ready.reviewStatus,

          drifted:
            drifted.failed,

          readyButDrifted:
            readyButDrifted.reviewStatus,
        },

        safety: {
          syntheticAuthorizationOnly:
            true,

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

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_EXECUTION_REVIEW_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    finalAuthorizationRequired:
      source.includes(
        "runPaperPromotionFinalAuthorizationGateV1"
      ),

    actualApplySourceReadOnly:
      source.includes(
        "lib/models/model-promotion-manual-apply.ts"
      ) &&
      source.includes(
        "readFileSync"
      ),

    eventInsertChecked:
      source.includes(
        "eventInsertExists"
      ),

    eventBeforeStageChecked:
      source.includes(
        "eventInsertedBeforeStageUpdate"
      ),

    compareAndSetShadowChecked:
      source.includes(
        "stageUpdateCompareAndSetShadow"
      ),

    compensationDeleteChecked:
      source.includes(
        "compensationDeleteExists"
      ) &&
      source.includes(
        "compensationTargetsInsertedEvent"
      ),

    updateFailureThrowChecked:
      source.includes(
        "MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:"
      ),

    exactPhraseChecked:
      source.includes(
        "exactPhraseStillBound"
      ),

    entryTimingChecked:
      source.includes(
        "entryTimingOnly"
      ),

    canonicalFailClosedChecked:
      source.includes(
        "canonicalEvidenceFailClosed"
      ),

    recommendationReadyChecked:
      source.includes(
        "recommendationMustBeReady"
      ),

    noApplyImport:
      !source.includes(
        "applyManualPaperPromotion,"
      ) &&
      !source.includes(
        "applyManualPaperPromotion("
      ),

    noPromotionRouteImport:
      !source.includes(
        "app/api/models/promotion/apply/route"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      finalAuthorizationExecuted:
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
        ? "RUN_ACTUAL_PROMOTION_EXECUTION_REVIEW_CONTRACT"
        : "REPAIR_ACTUAL_PROMOTION_EXECUTION_REVIEW_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    GATE,
    gateSource,
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
      "forward-oos:paper-promotion-actual-execution-review"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-actual-execution-review"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-actual-execution-review-static"
    ] =
      "node ./scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts",
        "scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "VERIFY_EXACT_MUTATION_ORDER_COMPARE_AND_SET_AND_COMPENSATION_CONTRACT_BEFORE_ANY_ACTUAL_PAPER_PROMOTION_EXECUTION_GATE",

      exactMutationContract: {
        step1:
          "INSERT_MODEL_PROMOTION_EVENT_SHADOW_TO_PAPER",

        step2:
          "COMPARE_AND_SET_AI_MODEL_VERSIONS_SHADOW_TO_PAPER",

        compareAndSetGuard:
          "id=modelId AND promotion_stage=SHADOW",

        onStageUpdateFailure:
          "DELETE_INSERTED_EVENT_BY_EVENT_ID_THEN_THROW",

        stageReason:
          "MANUAL_APPLY:<reason>",

        eventReason:
          "MANUAL_APPLY_APPROVED:<reason>"
      },

      behavior: {
        beforeFinalAuthorization:
          "WAIT_OR_BLOCK_WITHOUT_SOURCE_EXECUTION",

        afterFinalAuthorization:
          "READ_AND_VERIFY_SOURCE_CONTRACT_ONLY",

        contractDrift:
          "FAIL_CLOSED",

        actualPromotionApply:
          "NEVER"
      },

      safety: {
        installerExecutedFinalAuthorization:
          false,

        installerExecutedPromotion:
          false,

        applyManualPaperPromotionCalled:
          false,

        promotionRouteCalled:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        modelStageChanged:
          false,

        promotionEventWritten:
          false,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_ACTUAL_EXECUTION_REVIEW"
    }, null, 2));

    process.exitCode = 0;
  }
}
