const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000600_model_shadow_outcome_pipeline_binding_v1.sql";

const helperRel =
  "lib/models/model-shadow-outcome-pipeline-binding.ts";

const routeRel =
  "app/api/signals/shadow/evaluate/route.ts";

const migration =
  fs.readFileSync(
    path.resolve(root, migrationRel),
    "utf8",
  );

const helper =
  fs.readFileSync(
    path.resolve(root, helperRel),
    "utf8",
  );

const route =
  fs.readFileSync(
    path.resolve(root, routeRel),
    "utf8",
  );

const evalIndex =
  route.indexOf(
    "evaluateShadowSignals(",
  );

const syncIndex =
  route.indexOf(
    "syncCanonicalShadowOutcomeFromEntrySignalsV1(",
  );

const checks = {
  captureTriggerFunction:
    /create\s+or\s+replace\s+function\s+public\.capture_model_shadow_signal_outcome_v1/i.test(
      migration,
    ),

  captureAfterInsertTrigger:
    /create\s+trigger\s+trg_capture_model_shadow_signal_outcome_v1[\s\S]*after\s+insert\s+on\s+public\.ai_entry_signals/i.test(
      migration,
    ),

  stageShadowOnly:
    migration.includes(
      "v_stage is distinct from 'SHADOW'",
    ),

  postPromotionTimestampGuard:
    migration.includes(
      "new.created_at < v_stage_updated_at",
    ),

  noHistoricalBackfill:
    !/insert\s+into\s+public\.model_shadow_signal_outcomes[\s\S]{0,1600}select[\s\S]{0,1600}from\s+public\.ai_entry_signals/i.test(
      migration,
    ),

  sidecarReadsCanonicalPending:
    helper.includes(
      '"model_shadow_signal_outcomes"',
    ) &&
    helper.includes(
      '"PENDING"',
    ),

  sidecarReadsPersistedSignals:
    helper.includes(
      '.from("ai_entry_signals")',
    ),

  sidecarNoMarketSnapshotRead:
    !helper.includes(
      '"market_snapshots"',
    ),

  sidecarNoOutcomeRecalculation:
    helper.includes(
      "noOutcomeRecalculation:",
    ),

  unresolvedStaysUnchanged:
    helper.includes(
      "unresolved += 1",
    ),

  routeImportsSidecar:
    route.includes(
      "syncCanonicalShadowOutcomeFromEntrySignalsV1",
    ),

  routeCallsExistingEvaluatorFirst:
    evalIndex >= 0 &&
    syncIndex > evalIndex,

  noPaperOrderMutation:
    !/\.from\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
      helper,
    ),

  noPositionMutation:
    !/\.from\(\s*["']paper_positions["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
      helper,
    ),

  noPromotionMutation:
    !/\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,600}?\.update\s*\(/.test(
      helper,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      migration +
      "\n" +
      helper +
      "\n" +
      route,
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
          ? "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_STATIC_VERIFIED"
          : "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_STATIC_FAILED",
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
