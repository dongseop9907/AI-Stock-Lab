const fs = require("fs");
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
