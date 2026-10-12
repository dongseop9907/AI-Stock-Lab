const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-approval-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-approval-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1.ts",
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
  const gateSource = `import {
  runPaperPromotionEligibilityPreflightV1,
  type PaperPromotionEligibilityPreflightInput,
} from "./true-forward-oos-paper-promotion-eligibility-preflight-v1";

export const TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE =
  "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY" as const;

export interface PaperPromotionApplyApprovalGateInput
  extends PaperPromotionEligibilityPreflightInput {
  applyApprovalConfirmed?: boolean;
  applyApprovalPhrase?: string;
  approvalFeatureEnabled?: boolean;

  eligibilityRunner?: (
    input: PaperPromotionEligibilityPreflightInput,
  ) => Promise<any>;
}

export async function runPaperPromotionApplyApprovalGateV1(
  input:
    PaperPromotionApplyApprovalGateInput = {},
) {
  const eligibilityRunner =
    input.eligibilityRunner ??
    runPaperPromotionEligibilityPreflightV1;

  const eligibility =
    await eligibilityRunner(
      input,
    );

  if (
    eligibility.eligibilityStatus ===
    "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

      approvalStatus:
        "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY",

      readyForPromotionApplyDryRun:
        false,

      promotionApplyExecuted:
        false,

      failed:
        [],

      eligibility: {
        eligibilityStatus:
          eligibility.eligibilityStatus,

        eligibleForSeparatePromotionApplyReview:
          eligibility
            .eligibleForSeparatePromotionApplyReview ??
          false,
      },

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_MANUAL_REVIEW_DECISION",
    };
  }

  if (
    eligibility.eligibilityStatus !==
      "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" ||
    eligibility.eligibleForSeparatePromotionApplyReview !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

      approvalStatus:
        "BLOCKED_PAPER_PROMOTION_NOT_ELIGIBLE",

      readyForPromotionApplyDryRun:
        false,

      promotionApplyExecuted:
        false,

      failed: [
        "PAPER_PROMOTION_ELIGIBILITY_NOT_READY",
      ],

      eligibility: {
        eligibilityStatus:
          eligibility.eligibilityStatus,

        eligibleForSeparatePromotionApplyReview:
          eligibility
            .eligibleForSeparatePromotionApplyReview ??
          false,
      },

      safety:
        safety(),

      nextGate:
        "KEEP_SHADOW_AND_WAIT_OR_REPAIR_ELIGIBILITY",
    };
  }

  const featureEnabled =
    input.approvalFeatureEnabled ??
    (
      process.env
        .ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL ===
      "true"
    );

  if (
    featureEnabled !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_FEATURE_DISABLED",
      "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL=true",
      eligibility,
    );
  }

  if (
    input.applyApprovalConfirmed !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",
      "SET_applyApprovalConfirmed=true",
      eligibility,
    );
  }

  if (
    input.applyApprovalPhrase !==
    TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_PHRASE_REQUIRED",
      TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,
      eligibility,
    );
  }

  const checks = {
    eligibilityPassed:
      eligibility.eligibilityStatus ===
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" &&
      eligibility.eligibleForSeparatePromotionApplyReview ===
        true,

    approvalFeatureEnabled:
      featureEnabled ===
        true,

    explicitApplyApprovalConfirmed:
      input.applyApprovalConfirmed ===
        true,

    exactApplyApprovalPhraseMatched:
      input.applyApprovalPhrase ===
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

    noPromotionApplyExecuted:
      eligibility.actualPromotionApplyExecuted ===
        false &&
      eligibility.safety
        ?.applyManualPaperPromotionCalled ===
        false,

    realTradingStillDisabled:
      eligibility.safety
        ?.realTradingEnabled ===
        false,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

    approvalStatus:
      failed.length ===
      0
        ? "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY"
        : "PAPER_PROMOTION_APPLY_APPROVAL_FAILED",

    readyForPromotionApplyDryRun:
      failed.length ===
      0,

    promotionApplyExecuted:
      false,

    exactApprovalPhrase:
      TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

    eligibility: {
      eligibilityStatus:
        eligibility.eligibilityStatus,

      eligibleForSeparatePromotionApplyReview:
        eligibility
          .eligibleForSeparatePromotionApplyReview,

      modelId:
        eligibility.modelId ??
        null,

      existingPromotionPreflight:
        eligibility.existingPromotionPreflight ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "BUILD_PROMOTION_APPLY_DRY_RUN_ONLY_GATE"
        : "STOP_AND_INSPECT_PAPER_PROMOTION_APPLY_APPROVAL_GATE",
  };
}

function blocked(
  approvalStatus:
    string,
  required:
    string,
  eligibility:
    any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

    approvalStatus,

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    required,

    eligibility: {
      eligibilityStatus:
        eligibility.eligibilityStatus,

      eligibleForSeparatePromotionApplyReview:
        eligibility
          .eligibleForSeparatePromotionApplyReview ??
        false,

      modelId:
        eligibility.modelId ??
        null,
    },

    failed:
      [],

    safety:
      safety(),

    nextGate:
      "WAIT_FOR_EXPLICIT_PAPER_PROMOTION_APPLY_APPROVAL",
  };
}

function safety() {
  return {
    readOnly:
      true,

    approvalRecordWritten:
      false,

    promotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalled:
      false,

    modelStageChanged:
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
    await runPaperPromotionApplyApprovalGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.approvalStatus ===
      "PAPER_PROMOTION_APPLY_APPROVAL_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_ERROR",

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

import {
  runPaperPromotionApplyApprovalGateV1,
  TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,
} from "./true-forward-oos-paper-promotion-apply-approval-gate-v1";

function waitingEligibility() {
  return {
    eligibilityStatus:
      "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION",

    eligibleForSeparatePromotionApplyReview:
      false,

    actualPromotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function blockedEligibility() {
  return {
    eligibilityStatus:
      "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT",

    eligibleForSeparatePromotionApplyReview:
      false,

    actualPromotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function readyEligibility() {
  return {
    eligibilityStatus:
      "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

    eligibleForSeparatePromotionApplyReview:
      true,

    actualPromotionApplyExecuted:
      false,

    modelId:
      "model-1",

    existingPromotionPreflight: {
      allowed:
        true,

      reason:
        "READY",

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
    },

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

async function main() {
  let eligibilityCalls =
    0;

  const waiting =
    await runPaperPromotionApplyApprovalGateV1({
      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return waitingEligibility();
        },
    });

  const notEligible =
    await runPaperPromotionApplyApprovalGateV1({
      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return blockedEligibility();
        },
    });

  const featureDisabled =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        false,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const noApproval =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        false,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const wrongPhrase =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE",

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const ready =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const checks = {
    waitingSafe:
      waiting.approvalStatus ===
        "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY" &&
      waiting.readyForPromotionApplyDryRun ===
        false,

    notEligibleBlocked:
      notEligible.approvalStatus ===
        "BLOCKED_PAPER_PROMOTION_NOT_ELIGIBLE",

    featureDisabledBlocked:
      featureDisabled.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_FEATURE_DISABLED",

    explicitApprovalRequired:
      noApproval.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",

    wrongPhraseBlocked:
      wrongPhrase.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_PHRASE_REQUIRED",

    allConditionsReady:
      ready.approvalStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY" &&
      ready.readyForPromotionApplyDryRun ===
        true,

    exactPhraseBound:
      ready.exactApprovalPhrase ===
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

    noPromotionApply:
      ready.promotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false &&
      ready.safety
        .promotionRouteCalled ===
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

    eligibilityCalledOncePerCase:
      eligibilityCalls ===
        6,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.approvalStatus,

          notEligible:
            notEligible.approvalStatus,

          featureDisabled:
            featureDisabled.approvalStatus,

          noApproval:
            noApproval.approvalStatus,

          wrongPhrase:
            wrongPhrase.approvalStatus,

          ready:
            ready.approvalStatus,

          eligibilityCalls,
        },

        safety: {
          syntheticOnly:
            true,

          realEligibilityPreflightCalled:
            false,

          applyManualPaperPromotionCalled:
            false,

          promotionRouteCalled:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_APPROVAL_GATE_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_STATIC_FAILED",

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

    eligibilityPreflightRequired:
      source.includes(
        "runPaperPromotionEligibilityPreflightV1"
      ),

    separateFeatureFlag:
      source.includes(
        "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL"
      ),

    separateExactPhrase:
      source.includes(
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY"
      ),

    explicitApprovalBoolean:
      source.includes(
        "applyApprovalConfirmed"
      ),

    waitsBeforeEligibility:
      source.includes(
        "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY"
      ),

    blocksNotEligible:
      source.includes(
        "BLOCKED_PAPER_PROMOTION_NOT_ELIGIBLE"
      ),

    dryRunApprovalOnly:
      source.includes(
        "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY"
      ),

    nextGateIsDryRunOnly:
      source.includes(
        "BUILD_PROMOTION_APPLY_DRY_RUN_ONLY_GATE"
      ),

    noApplyManualImport:
      !source.includes(
        "applyManualPaperPromotion,"
      ) &&
      !source.includes(
        "applyManualPaperPromotion("
      ),

    noPromotionRoute:
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      actualEligibilityExecuted:
        false,

      promotionApplyExecuted:
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
        ? "RUN_PAPER_PROMOTION_APPLY_APPROVAL_CONTRACT"
        : "REPAIR_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",
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
      "forward-oos:paper-promotion-apply-approval"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-apply-approval"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-apply-approval-static"
    ] =
      "node ./scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
        "scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "REQUIRE_SEPARATE_EXPLICIT_HUMAN_APPROVAL_BEFORE_ANY_PAPER_PROMOTION_APPLY_DRY_RUN",

      requirements: {
        eligibility:
          "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

        featureFlag:
          "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL=true",

        explicitApproval:
          "applyApprovalConfirmed=true",

        exactPhrase:
          "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY"
      },

      behavior: {
        waitingEligibility:
          "WAIT",

        ineligible:
          "BLOCK",

        approvalMissing:
          "BLOCK",

        phraseMismatch:
          "BLOCK",

        allReady:
          "ALLOW_NEXT_DRY_RUN_GATE_ONLY",

        actualPromotionApply:
          "NEVER"
      },

      safety: {
        installerExecutedEligibility:
          false,

        installerExecutedPromotion:
          false,

        applyManualPaperPromotionCalled:
          false,

        promotionRouteCalled:
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
        "RUN_STATIC_CONTRACT_AND_CURRENT_APPROVAL_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
