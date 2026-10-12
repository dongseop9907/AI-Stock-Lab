const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
  "app/api/models/promotion/apply/route.ts",
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
  const gateSource = `import {
  runPaperPromotionApplyApprovalGateV1,
  type PaperPromotionApplyApprovalGateInput,
} from "./true-forward-oos-paper-promotion-apply-approval-gate-v1";

import {
  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
} from "../lib/models/model-promotion-manual-apply";

export interface PaperPromotionApplyDryRunOnlyGateInput
  extends PaperPromotionApplyApprovalGateInput {
  routeCaller?: (
    body: Record<string, unknown>,
  ) => Promise<{
    status: number;
    payload: any;
  }>;

  dryRunActor?: string;
  dryRunReason?: string;
}

async function callActualDryRunRoute(
  body: Record<string, unknown>,
) {
  const {
    POST,
  } =
    await import(
      "../app/api/models/promotion/apply/route"
    );

  const request =
    new Request(
      "http://localhost/api/models/promotion/apply",
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body:
          JSON.stringify(
            body,
          ),
      },
    );

  const response =
    await POST(
      request,
    );

  let payload:
    any =
    null;

  try {
    payload =
      await response.json();
  } catch {
    payload =
      null;
  }

  return {
    status:
      response.status,

    payload,
  };
}

export async function runPaperPromotionApplyDryRunOnlyGateV1(
  input:
    PaperPromotionApplyDryRunOnlyGateInput = {},
) {
  const approval =
    await runPaperPromotionApplyApprovalGateV1(
      input,
    );

  if (
    approval.approvalStatus ===
    "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",

      dryRunStatus:
        "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL",

      dryRunRouteCalled:
        false,

      promotionApplyExecuted:
        false,

      failed:
        [],

      approvalStatus:
        approval.approvalStatus,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_MANUAL_REVIEW_DECISION",
    };
  }

  if (
    approval.approvalStatus !==
      "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY" ||
    approval.readyForPromotionApplyDryRun !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",

      dryRunStatus:
        "BLOCKED_PAPER_PROMOTION_APPLY_APPROVAL_NOT_READY",

      dryRunRouteCalled:
        false,

      promotionApplyExecuted:
        false,

      failed: [
        "PAPER_PROMOTION_APPLY_APPROVAL_NOT_READY",
      ],

      approvalStatus:
        approval.approvalStatus,

      safety:
        safety(),

      nextGate:
        "STOP_BEFORE_PROMOTION_DRY_RUN",
    };
  }

  const modelId =
    String(
      approval
        .eligibility
        ?.modelId ??
      input.modelId ??
      "",
    ).trim();

  if (
    !modelId
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",

      dryRunStatus:
        "BLOCKED_MODEL_ID_REQUIRED",

      dryRunRouteCalled:
        false,

      promotionApplyExecuted:
        false,

      failed: [
        "MODEL_ID_REQUIRED",
      ],

      approvalStatus:
        approval.approvalStatus,

      safety:
        safety(),

      nextGate:
        "PROVIDE_EXPLICIT_ENTRY_TIMING_SHADOW_MODEL_ID",
    };
  }

  const actor =
    (
      input.dryRunActor ??
      "TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1"
    ).trim();

  const reason =
    (
      input.dryRunReason ??
      "VERIFIED_TRUE_FORWARD_OOS_DRY_RUN_ONLY"
    ).trim();

  if (
    !actor ||
    !reason
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",

      dryRunStatus:
        "BLOCKED_ACTOR_OR_REASON_REQUIRED",

      dryRunRouteCalled:
        false,

      promotionApplyExecuted:
        false,

      failed: [
        "ACTOR_OR_REASON_REQUIRED",
      ],

      approvalStatus:
        approval.approvalStatus,

      safety:
        safety(),

      nextGate:
        "PROVIDE_DRY_RUN_ACTOR_AND_REASON",
    };
  }

  const body = {
    modelId,

    toStage:
      "PAPER",

    manualApprovalConfirmed:
      true,

    confirmationPhrase:
      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,

    actor,
    reason,

    dryRun:
      true,
  };

  const caller =
    input.routeCaller ??
    callActualDryRunRoute;

  const beforeTradingFlags = {
    REAL_TRADING_ENABLED:
      process.env
        .REAL_TRADING_ENABLED,

    ENABLE_REAL_TRADING:
      process.env
        .ENABLE_REAL_TRADING,

    ENABLE_LIVE_TRADING:
      process.env
        .ENABLE_LIVE_TRADING,
  };

  const routeResult =
    await caller(
      body,
    );

  const payload =
    routeResult.payload;

  const preflight =
    payload &&
    typeof payload ===
      "object"
      ? payload.preflight
      : null;

  const checks = {
    http200:
      routeResult.status ===
        200,

    dryRunEcho:
      payload
        ?.dryRun ===
        true,

    requestDryRunForced:
      body.dryRun ===
        true,

    exactExistingConfirmationPhrase:
      body.confirmationPhrase ===
        "PROMOTE_SHADOW_TO_PAPER",

    targetPaperOnly:
      body.toStage ===
        "PAPER",

    manualApprovalTrue:
      body.manualApprovalConfirmed ===
        true,

    preflightPresent:
      !!preflight &&
      typeof preflight ===
        "object",

    preflightAllowed:
      preflight
        ?.allowed ===
        true,

    preflightReadyReason:
      preflight
        ?.reason ===
        "READY",

    preflightFromShadow:
      preflight
        ?.fromStage ===
        "SHADOW",

    preflightToPaper:
      preflight
        ?.toStage ===
        "PAPER",

    canonicalEvidenceReady:
      preflight
        ?.canonicalShadowOutcomeEvidenceReady ===
        true,

    recommendationReady:
      preflight
        ?.recommendationDecision ===
        "RECOMMENDED",

    recommendationReasonReady:
      preflight
        ?.recommendationReason ===
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

    routeDidNotReportApplied:
      payload
        ?.applied !==
        true &&
      payload
        ?.promotionApplied !==
        true,

    realTradingFlagsNotChanged:
      process.env
        .REAL_TRADING_ENABLED ===
        beforeTradingFlags
          .REAL_TRADING_ENABLED &&
      process.env
        .ENABLE_REAL_TRADING ===
        beforeTradingFlags
          .ENABLE_REAL_TRADING &&
      process.env
        .ENABLE_LIVE_TRADING ===
        beforeTradingFlags
          .ENABLE_LIVE_TRADING,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",

    dryRunStatus:
      failed.length ===
      0
        ? "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED"
        : "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED",

    dryRunRouteCalled:
      true,

    promotionApplyExecuted:
      false,

    modelId,

    requestContract: {
      toStage:
        body.toStage,

      manualApprovalConfirmed:
        body.manualApprovalConfirmed,

      confirmationPhrase:
        body.confirmationPhrase,

      dryRun:
        body.dryRun,

      actor:
        body.actor,

      reason:
        body.reason,
    },

    routeResult: {
      httpStatus:
        routeResult.status,

      dryRun:
        payload
          ?.dryRun ??
        null,

      applied:
        payload
          ?.applied ??
        payload
          ?.promotionApplied ??
        null,

      preflight:
        preflight
          ? {
              allowed:
                preflight.allowed ??
                null,

              reason:
                preflight.reason ??
                null,

              modelId:
                preflight.modelId ??
                null,

              fromStage:
                preflight.fromStage ??
                null,

              toStage:
                preflight.toStage ??
                null,

              recommendationDecision:
                preflight
                  .recommendationDecision ??
                null,

              recommendationReason:
                preflight
                  .recommendationReason ??
                null,

              canonicalShadowOutcomeEvidenceReady:
                preflight
                  .canonicalShadowOutcomeEvidenceReady ??
                null,

              transitionKind:
                preflight
                  .transitionKind ??
                null,

              featureEnabled:
                preflight
                  .featureEnabled ??
                null,
            }
          : null,
    },

    checks,
    failed,

    safety:
      {
        ...safety(),

        routeHandlerExecuted:
          true,

        routeDryRunOnly:
          true,
      },

    nextGate:
      failed.length ===
      0
        ? "DRY_RUN_VERIFIED_STOP_BEFORE_ANY_REAL_PAPER_PROMOTION_APPLY"
        : "STOP_AND_INSPECT_PAPER_PROMOTION_DRY_RUN",
  };
}

function safety() {
  return {
    dryRunOnly:
      true,

    actualPromotionApplyExecuted:
      false,

    promotionStageChangedByGate:
      false,

    promotionEventWrittenByGate:
      false,

    databaseWritesByGate:
      0,

    ordersCreatedByGate:
      0,

    positionsChangedByGate:
      0,

    controlsChangedByGate:
      false,

    realTradingEnabledByGate:
      false,
  };
}

async function main() {
  const result =
    await runPaperPromotionApplyDryRunOnlyGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.dryRunStatus ===
      "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED" ||
    result.dryRunStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_ERROR",

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
  runPaperPromotionApplyDryRunOnlyGateV1,
} from "./true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1";

function waitingApproval() {
  return {
    approvalStatus:
      "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY",

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function blockedApproval() {
  return {
    approvalStatus:
      "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function readyApproval() {
  return {
    approvalStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY",

    readyForPromotionApplyDryRun:
      true,

    promotionApplyExecuted:
      false,

    eligibility: {
      modelId:
        "model-1",

      eligibilityStatus:
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

      eligibleForSeparatePromotionApplyReview:
        true,
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
  let routeCalls =
    0;

  let capturedBody:
    any =
    null;

  const mockReadyRoute =
    async (
      body:
        Record<string, unknown>,
    ) => {
      routeCalls +=
        1;

      capturedBody =
        body;

      return {
        status:
          200,

        payload: {
          ok:
            true,

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
              body.modelId,

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
        },
      };
    };

  const waiting =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      eligibilityRunner:
        async () => ({
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
        }),

      routeCaller:
        mockReadyRoute,
    });

  const blocked =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      eligibilityRunner:
        async () => ({
          eligibilityStatus:
            "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED",

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
        }),

      routeCaller:
        mockReadyRoute,
    });

  const ready =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      modelId:
        "model-1",

      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

      eligibilityRunner:
        async () => ({
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
          },

          safety: {
            applyManualPaperPromotionCalled:
              false,

            realTradingEnabled:
              false,
          },
        }),

      routeCaller:
        mockReadyRoute,
    });

  const badRoute =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      modelId:
        "model-1",

      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

      eligibilityRunner:
        async () => ({
          eligibilityStatus:
            "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

          eligibleForSeparatePromotionApplyReview:
            true,

          actualPromotionApplyExecuted:
            false,

          modelId:
            "model-1",

          safety: {
            applyManualPaperPromotionCalled:
              false,

            realTradingEnabled:
              false,
          },
        }),

      routeCaller:
        async (
          body:
            Record<string, unknown>,
        ) => ({
          status:
            200,

          payload: {
            dryRun:
              false,

            applied:
              true,

            preflight: {
              allowed:
                true,

              reason:
                "READY",

              modelId:
                body.modelId,

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
        }),
    });

  const checks = {
    waitingSkipsRoute:
      waiting.dryRunStatus ===
        "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL" &&
      waiting.dryRunRouteCalled ===
        false,

    blockedSkipsRoute:
      blocked.dryRunStatus ===
        "BLOCKED_PAPER_PROMOTION_APPLY_APPROVAL_NOT_READY" &&
      blocked.dryRunRouteCalled ===
        false,

    readyDryRunPasses:
      ready.dryRunStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED" &&
      ready.dryRunRouteCalled ===
        true,

    dryRunForcedTrue:
      capturedBody
        ?.dryRun ===
        true,

    existingExactPhraseForced:
      capturedBody
        ?.confirmationPhrase ===
        "PROMOTE_SHADOW_TO_PAPER",

    paperTargetForced:
      capturedBody
        ?.toStage ===
        "PAPER",

    manualApprovalForced:
      capturedBody
        ?.manualApprovalConfirmed ===
        true,

    badRouteBlocked:
      badRoute.dryRunStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED" &&
      badRoute.failed.includes(
        "dryRunEcho",
      ) &&
      badRoute.failed.includes(
        "routeDidNotReportApplied",
      ),

    noPromotionApplyReported:
      ready.promotionApplyExecuted ===
        false,

    noTradingSideEffectsByGate:
      ready.safety
        .databaseWritesByGate ===
        0 &&
      ready.safety
        .ordersCreatedByGate ===
        0 &&
      ready.safety
        .positionsChangedByGate ===
        0 &&
      ready.safety
        .realTradingEnabledByGate ===
        false,

    routeCalledOnlyForApprovedCases:
      routeCalls ===
        1,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.dryRunStatus,

          blocked:
            blocked.dryRunStatus,

          ready:
            ready.dryRunStatus,

          badRoute:
            {
              dryRunStatus:
                badRoute.dryRunStatus,

              failed:
                badRoute.failed,
            },

          routeCalls,

          capturedRequest: {
            dryRun:
              capturedBody
                ?.dryRun ??
              null,

            toStage:
              capturedBody
                ?.toStage ??
              null,

            manualApprovalConfirmed:
              capturedBody
                ?.manualApprovalConfirmed ??
              null,

            confirmationPhrase:
              capturedBody
                ?.confirmationPhrase ??
              null,
          },
        },

        safety: {
          syntheticOnly:
            true,

          actualPromotionRouteCalled:
            false,

          promotionApplied:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_DRY_RUN_GATE_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_STATIC_FAILED",

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

    approvalGateRequired:
      source.includes(
        "runPaperPromotionApplyApprovalGateV1"
      ),

    actualPromotionRouteBound:
      source.includes(
        "../app/api/models/promotion/apply/route"
      ),

    exactExistingConfirmationBound:
      source.includes(
        "MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE"
      ),

    dryRunForced:
      /dryRun:\\s*true/.test(
        source
      ),

    paperTargetForced:
      /toStage:\\s*"PAPER"/.test(
        source
      ),

    manualApprovalForced:
      /manualApprovalConfirmed:\\s*true/.test(
        source
      ),

    waitingSkipsRoute:
      source.includes(
        "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL"
      ),

    approvalRequired:
      source.includes(
        "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY"
      ),

    dryRunEchoChecked:
      source.includes(
        "dryRunEcho"
      ),

    appliedFalseChecked:
      source.includes(
        "routeDidNotReportApplied"
      ),

    canonicalEvidenceChecked:
      source.includes(
        "canonicalEvidenceReady"
      ),

    stopBeforeRealApply:
      source.includes(
        "DRY_RUN_VERIFIED_STOP_BEFORE_ANY_REAL_PAPER_PROMOTION_APPLY"
      ),

    noApplyManualServiceImport:
      !source.includes(
        "applyManualPaperPromotion,"
      ) &&
      !source.includes(
        "applyManualPaperPromotion("
      ),

    noDatabaseWriteSurfaceInGate:
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      routeExecuted:
        false,

      dryRunOnly:
        true,

      promotionApplied:
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
        ? "RUN_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_CONTRACT"
        : "REPAIR_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1",
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
      "forward-oos:paper-promotion-apply-dry-run"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-apply-dry-run"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-paper-promotion-apply-dry-run-static"
    ] =
      "node ./scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.ts",
        "scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "CALL_EXISTING_PROMOTION_APPLY_ROUTE_WITH_DRY_RUN_TRUE_ONLY_AFTER_FULL_EXPLICIT_APPROVAL_CHAIN",

      actualRouteContract: {
        endpoint:
          "/api/models/promotion/apply",

        method:
          "POST",

        dryRun:
          true,

        targetStage:
          "PAPER",

        manualApprovalConfirmed:
          true,

        confirmationPhrase:
          "PROMOTE_SHADOW_TO_PAPER"
      },

      behavior: {
        beforeApprovalReady:
          "DO_NOT_CALL_ROUTE",

        afterApprovalReady:
          "CALL_ROUTE_WITH_DRY_RUN_TRUE_ONLY",

        ifRouteReportsApplied:
          "FAIL_CLOSED",

        ifDryRunEchoFalse:
          "FAIL_CLOSED",

        afterDryRunVerified:
          "STOP_BEFORE_ANY_REAL_PROMOTION_APPLY"
      },

      safety: {
        installerCalledRoute:
          false,

        installerExecutedPromotion:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        promotionApplied:
          false,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_DRY_RUN_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
