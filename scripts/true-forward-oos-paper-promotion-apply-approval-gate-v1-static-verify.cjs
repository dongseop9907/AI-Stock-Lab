const fs = require("fs");
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
