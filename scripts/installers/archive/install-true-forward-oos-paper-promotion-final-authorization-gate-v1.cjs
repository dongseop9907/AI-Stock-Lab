const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-final-authorization-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-final-authorization-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-final-authorization-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts",
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
  runPaperPromotionApplyDryRunOnlyGateV1,
  type PaperPromotionApplyDryRunOnlyGateInput,
} from "./true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1";

export const TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE =
  "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY" as const;

export interface PaperPromotionFinalAuthorizationGateInput
  extends PaperPromotionApplyDryRunOnlyGateInput {
  finalAuthorizationFeatureEnabled?: boolean;
  finalAuthorizationConfirmed?: boolean;
  finalAuthorizationPhrase?: string;

  dryRunGateRunner?: (
    input: PaperPromotionApplyDryRunOnlyGateInput,
  ) => Promise<any>;
}

export async function runPaperPromotionFinalAuthorizationGateV1(
  input:
    PaperPromotionFinalAuthorizationGateInput = {},
) {
  const dryRunGateRunner =
    input.dryRunGateRunner ??
    runPaperPromotionApplyDryRunOnlyGateV1;

  const dryRun =
    await dryRunGateRunner(
      input,
    );

  if (
    dryRun.dryRunStatus ===
    "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

      authorizationStatus:
        "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",

      readyForActualPromotionExecutionReview:
        false,

      actualPromotionApplyExecuted:
        false,

      failed:
        [],

      dryRunStatus:
        dryRun.dryRunStatus,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_PAPER_PROMOTION_APPLY_DRY_RUN",
    };
  }

  if (
    dryRun.dryRunStatus !==
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

      authorizationStatus:
        "BLOCKED_PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",

      readyForActualPromotionExecutionReview:
        false,

      actualPromotionApplyExecuted:
        false,

      failed: [
        "PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",
      ],

      dryRunStatus:
        dryRun.dryRunStatus,

      safety:
        safety(),

      nextGate:
        "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
    };
  }

  const featureEnabled =
    input.finalAuthorizationFeatureEnabled ??
    (
      process.env
        .ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION ===
      "true"
    );

  if (
    featureEnabled !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_FEATURE_DISABLED",
      "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION=true",
      dryRun,
    );
  }

  if (
    input.finalAuthorizationConfirmed !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",
      "SET_finalAuthorizationConfirmed=true",
      dryRun,
    );
  }

  if (
    input.finalAuthorizationPhrase !==
    TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE_REQUIRED",
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,
      dryRun,
    );
  }

  const checks = {
    dryRunVerified:
      dryRun.dryRunStatus ===
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

    dryRunRouteWasCalled:
      dryRun.dryRunRouteCalled ===
      true,

    dryRunDidNotApply:
      dryRun.promotionApplyExecuted ===
      false,

    dryRunRequestForcedTrue:
      dryRun.requestContract
        ?.dryRun ===
      true,

    dryRunTargetPaper:
      dryRun.requestContract
        ?.toStage ===
      "PAPER",

    dryRunExistingPhraseCorrect:
      dryRun.requestContract
        ?.confirmationPhrase ===
      "PROMOTE_SHADOW_TO_PAPER",

    dryRunPreflightAllowed:
      dryRun.routeResult
        ?.preflight
        ?.allowed ===
      true,

    dryRunPreflightReasonReady:
      dryRun.routeResult
        ?.preflight
        ?.reason ===
      "READY",

    dryRunCanonicalEvidenceReady:
      dryRun.routeResult
        ?.preflight
        ?.canonicalShadowOutcomeEvidenceReady ===
      true,

    finalFeatureEnabled:
      featureEnabled ===
      true,

    finalAuthorizationConfirmed:
      input.finalAuthorizationConfirmed ===
      true,

    finalAuthorizationPhraseMatched:
      input.finalAuthorizationPhrase ===
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

    actualPromotionStillNotExecuted:
      true,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

    authorizationStatus:
      failed.length ===
      0
        ? "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY"
        : "PAPER_PROMOTION_FINAL_AUTHORIZATION_FAILED",

    readyForActualPromotionExecutionReview:
      failed.length ===
      0,

    actualPromotionApplyExecuted:
      false,

    exactFinalAuthorizationPhrase:
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

    modelId:
      dryRun.modelId ??
      null,

    dryRunEvidence: {
      dryRunStatus:
        dryRun.dryRunStatus,

      dryRunRouteCalled:
        dryRun.dryRunRouteCalled ??
        false,

      requestContract:
        dryRun.requestContract ??
        null,

      routeResult:
        dryRun.routeResult ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "READY_FOR_SEPARATE_ACTUAL_PAPER_PROMOTION_EXECUTION_REVIEW_ONLY"
        : "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
  };
}

function blocked(
  authorizationStatus:
    string,
  required:
    string,
  dryRun:
    any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

    authorizationStatus,

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,

    required,

    dryRunStatus:
      dryRun.dryRunStatus,

    modelId:
      dryRun.modelId ??
      null,

    failed:
      [],

    safety:
      safety(),

    nextGate:
      "WAIT_FOR_EXPLICIT_FINAL_PAPER_PROMOTION_AUTHORIZATION",
  };
}

function safety() {
  return {
    readOnlyAuthorizationGate:
      true,

    authorizationRecordWritten:
      false,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalledByThisGate:
      false,

    modelStageChangedByThisGate:
      false,

    promotionEventWrittenByThisGate:
      false,

    databaseWritesByThisGate:
      0,

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
    await runPaperPromotionFinalAuthorizationGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.authorizationStatus ===
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_FAILED" ||
    result.authorizationStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-final-authorization-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_ERROR",

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
  runPaperPromotionFinalAuthorizationGateV1,
  TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,
} from "./true-forward-oos-paper-promotion-final-authorization-gate-v1";

function waitingDryRun() {
  return {
    dryRunStatus:
      "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL",

    dryRunRouteCalled:
      false,

    promotionApplyExecuted:
      false,
  };
}

function failedDryRun() {
  return {
    dryRunStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED",

    dryRunRouteCalled:
      true,

    promotionApplyExecuted:
      false,

    failed: [
      "dryRunEcho",
    ],
  };
}

function verifiedDryRun() {
  return {
    dryRunStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

    dryRunRouteCalled:
      true,

    promotionApplyExecuted:
      false,

    modelId:
      "model-1",

    requestContract: {
      toStage:
        "PAPER",

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        "PROMOTE_SHADOW_TO_PAPER",

      dryRun:
        true,
    },

    routeResult: {
      httpStatus:
        200,

      dryRun:
        true,

      applied:
        false,

      preflight: {
        allowed:
          true,

        reason:
          "READY",

        modelId:
          "model-1",

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
      },
    },
  };
}

async function main() {
  let dryRunCalls =
    0;

  const waiting =
    await runPaperPromotionFinalAuthorizationGateV1({
      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return waitingDryRun();
        },
    });

  const badDryRun =
    await runPaperPromotionFinalAuthorizationGateV1({
      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return failedDryRun();
        },
    });

  const featureDisabled =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        false,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const noAuthorization =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        false,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const wrongPhrase =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        "AUTHORIZE",

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const ready =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const checks = {
    waitingSafe:
      waiting.authorizationStatus ===
        "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN" &&
      waiting.readyForActualPromotionExecutionReview ===
        false,

    failedDryRunBlocked:
      badDryRun.authorizationStatus ===
        "BLOCKED_PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",

    featureDisabledBlocked:
      featureDisabled.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_FEATURE_DISABLED",

    explicitFinalAuthorizationRequired:
      noAuthorization.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",

    wrongPhraseBlocked:
      wrongPhrase.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE_REQUIRED",

    allConditionsReady:
      ready.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY" &&
      ready.readyForActualPromotionExecutionReview ===
        true,

    exactFinalPhraseBound:
      ready.exactFinalAuthorizationPhrase ===
        "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY",

    verifiedDryRunEvidenceRequired:
      ready.checks
        .dryRunVerified ===
        true &&
      ready.checks
        .dryRunRequestForcedTrue ===
        true &&
      ready.checks
        .dryRunPreflightAllowed ===
        true &&
      ready.checks
        .dryRunCanonicalEvidenceReady ===
        true,

    stillNoActualPromotion:
      ready.actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .actualPromotionApplyExecuted ===
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

    dryRunCalledOncePerCase:
      dryRunCalls ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.authorizationStatus,

          badDryRun:
            badDryRun.authorizationStatus,

          featureDisabled:
            featureDisabled.authorizationStatus,

          noAuthorization:
            noAuthorization.authorizationStatus,

          wrongPhrase:
            wrongPhrase.authorizationStatus,

          ready:
            ready.authorizationStatus,

          dryRunCalls,
        },

        safety: {
          syntheticOnly:
            true,

          actualDryRunRouteCalled:
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

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_FINAL_AUTHORIZATION_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-paper-promotion-final-authorization-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_STATIC_FAILED",

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

    dryRunGateRequired:
      source.includes(
        "runPaperPromotionApplyDryRunOnlyGateV1"
      ),

    verifiedDryRunRequired:
      source.includes(
        "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED"
      ),

    separateFinalFeatureFlag:
      source.includes(
        "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION"
      ),

    explicitFinalAuthorizationBoolean:
      source.includes(
        "finalAuthorizationConfirmed"
      ),

    separateFinalPhrase:
      source.includes(
        "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY"
      ),

    canonicalDryRunEvidenceChecked:
      source.includes(
        "dryRunCanonicalEvidenceReady"
      ),

    noActualApply:
      source.includes(
        "actualPromotionApplyExecuted:"
      ) &&
      source.includes(
        "false"
      ),

    finalReadyOnlyForExecutionReview:
      source.includes(
        "READY_FOR_SEPARATE_ACTUAL_PAPER_PROMOTION_EXECUTION_REVIEW_ONLY"
      ),

    noApplyManualImport:
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      dryRunExecuted:
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
        ? "RUN_PAPER_PROMOTION_FINAL_AUTHORIZATION_CONTRACT"
        : "REPAIR_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",
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
      "forward-oos:paper-promotion-final-authorization"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-final-authorization"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-final-authorization-static"
    ] =
      "node ./scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1.ts",
        "scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "REQUIRE_SEPARATE_FINAL_HUMAN_AUTHORIZATION_AFTER_VERIFIED_DRY_RUN_WITHOUT_EXECUTING_ACTUAL_PROMOTION",

      requirements: {
        dryRunStatus:
          "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

        featureFlag:
          "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION=true",

        explicitAuthorization:
          "finalAuthorizationConfirmed=true",

        exactPhrase:
          "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY"
      },

      behavior: {
        beforeVerifiedDryRun:
          "WAIT_OR_BLOCK",

        missingFinalAuthorization:
          "BLOCK",

        allReady:
          "ALLOW_SEPARATE_ACTUAL_EXECUTION_REVIEW_ONLY",

        actualPromotionApply:
          "NEVER"
      },

      safety: {
        installerExecutedDryRun:
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
        "RUN_STATIC_CONTRACT_AND_CURRENT_FINAL_AUTHORIZATION_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
