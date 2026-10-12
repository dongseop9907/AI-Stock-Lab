const fs = require("fs");
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
