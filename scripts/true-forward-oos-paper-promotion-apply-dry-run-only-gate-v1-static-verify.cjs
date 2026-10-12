const fs = require("fs");
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
      /dryRun:\s*true/.test(
        source
      ),

    paperTargetForced:
      /toStage:\s*"PAPER"/.test(
        source
      ),

    manualApprovalForced:
      /manualApprovalConfirmed:\s*true/.test(
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
      !/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*[:=]\s*["']true["']/i.test(
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
