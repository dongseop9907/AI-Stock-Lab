const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migration =
  fs.readFileSync(
    path.resolve(
      root,
      "supabase/migrations/20261009000500_model_shadow_outcome_canonical_storage_v1.sql",
    ),
    "utf8",
  );

const moduleSource =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/models/model-shadow-outcome-storage.ts",
    ),
    "utf8",
  );

const checks = {
  canonicalTable:
    /create\s+table\s+if\s+not\s+exists\s+public\.model_shadow_signal_outcomes/i.test(
      migration,
    ),

  uniqueSignalId:
    /signal_id\s+uuid\s+not\s+null\s+unique/i.test(
      migration,
    ),

  modelForeignKey:
    /model_id\s+uuid\s+not\s+null[\s\S]{0,120}references\s+public\.ai_model_versions/i.test(
      migration,
    ),

  stageFixedToShadow:
    migration.includes(
      "promotion_stage_at_capture = 'SHADOW'",
    ),

  hasEvaluationStatus:
    migration.includes(
      "evaluation_status text not null default 'PENDING'",
    ),

  fiveStatuses:
    [
      "PENDING",
      "PARTIAL",
      "COMPLETED",
      "EXPIRED",
      "INVALID",
    ].every(
      (status) =>
        migration.includes(
          `'${status}'`,
        ),
    ),

  hasReturnHorizons:
    [
      "return_1d",
      "return_3d",
      "return_5d",
    ].every(
      (column) =>
        migration.includes(
          column,
        ),
    ),

  hasMaxMinReturns:
    [
      "max_return_1d",
      "max_return_3d",
      "max_return_5d",
      "min_return_1d",
      "min_return_3d",
      "min_return_5d",
    ].every(
      (column) =>
        migration.includes(
          column,
        ),
    ),

  noHistoricalBackfillSql:
    !/insert\s+into\s+public\.model_shadow_signal_outcomes[\s\S]{0,1000}select[\s\S]{0,1000}from\s+public\.ai_entry_signals/i.test(
      migration,
    ),

  captureRequiresCurrentShadow:
    moduleSource.includes(
      'model.promotion_stage !==\n      "SHADOW"',
    ),

  historicalSignalBlocked:
    moduleSource.includes(
      "SHADOW_OUTCOME_HISTORICAL_SIGNAL_BACKFILL_BLOCKED",
    ),

  adapterReadsCanonicalTable:
    moduleSource.includes(
      '"model_shadow_signal_outcomes"',
    ),

  noPaperOrderMutation:
    !/\.from\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,400}?\.(insert|update|delete)\s*\(/.test(
      moduleSource,
    ),

  noPositionMutation:
    !/\.from\(\s*["']paper_positions["']\s*\)[\s\S]{0,400}?\.(insert|update|delete)\s*\(/.test(
      moduleSource,
    ),

  noPromotionMutation:
    !/\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,600}?\.update\s*\(/.test(
      moduleSource,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      migration +
      "\n" +
      moduleSource,
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
          ? "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_STATIC_VERIFIED"
          : "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_STATIC_FAILED",
      checks,
      failed,
      databaseApplied:
        false,
      historicalBackfill:
        false,
      paperPromotionApplied:
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
