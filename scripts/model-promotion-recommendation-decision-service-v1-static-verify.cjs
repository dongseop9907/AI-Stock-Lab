const fs = require("fs");
const path = require("path");

const root = process.cwd();

const serviceRel =
  "lib/models/model-promotion-decision-service.ts";

const abs =
  path.resolve(
    root,
    serviceRel,
  );

if (!fs.existsSync(abs)) {
  throw new Error(
    `REQUIRED_FILE_MISSING:${serviceRel}`,
  );
}

const source =
  fs.readFileSync(
    abs,
    "utf8",
  );

const checks = {
  readsModelRegistry:
    source.includes(
      '.from("ai_model_versions")',
    ),

  readsEntrySignals:
    source.includes(
      '.from("ai_entry_signals")',
    ),

  readsPaperTradeHistory:
    source.includes(
      '.from("paper_trade_history")',
    ),

  candidateShadowRecommendation:
    source.includes(
      '"CANDIDATE_SHADOW_SIGNAL_PIPELINE_READY"',
    ),

  shadowPaperFailClosed:
    source.includes(
      '"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"',
    ),

  writesPromotionEvents:
    source.includes(
      '.from(\n        "model_promotion_events",',
    ) &&
    source.includes(
      ".insert({",
    ),

  neverUpdatesPromotionStage:
    !/\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,600}?\.update\s*\(/.test(
      source,
    ),

  recommendationOnly:
    source.includes(
      "recommendationOnly:",
    ),

  noOrderMutation:
    !/\.from\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
      source,
    ),

  noPositionMutation:
    !/\.from\(\s*["']paper_positions["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
      source,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      source,
    ),

  noAutomaticPromotion:
    source.includes(
      "automaticPromotion:\n        false",
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "MODEL_PROMOTION_RECOMMENDATION_DECISION_SERVICE_V1_STATIC_VERIFIED"
          : "MODEL_PROMOTION_RECOMMENDATION_DECISION_SERVICE_V1_STATIC_FAILED",
      checks,
      failed,
      databaseWrites:
        0,
      promotionEventsWritten:
        0,
      promotionStageChanged:
        false,
      realTradingChanged:
        false,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
