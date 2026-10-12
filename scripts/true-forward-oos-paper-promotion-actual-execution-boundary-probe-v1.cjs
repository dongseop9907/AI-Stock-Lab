const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = [
  "lib/models/model-promotion-manual-apply.ts",
  "app/api/models/promotion/apply/route.ts",
  "lib/models/model-promotion-state-machine.ts",
  "lib/models/model-promotion-decision-service.ts",
  "lib/models/model-shadow-outcome-storage.ts",
].filter(
  rel =>
    fs.existsSync(
      path.join(
        ROOT,
        rel,
      ),
    ),
);

const NEEDLES = [
  ".update(",
  ".insert(",
  ".upsert(",
  ".delete(",
  "ai_model_versions",
  "model_promotion_events",
  "promotion_stage",
  "promotion_stage_updated_at",
  "from_stage",
  "to_stage",
  "actor",
  "reason",
  "applyManualPaperPromotion",
  "preflightManualPaperPromotion",
  "ENABLE_MANUAL_MODEL_PROMOTION_APPLY",
  "PROMOTE_SHADOW_TO_PAPER",
  "SHADOW",
  "PAPER",
  "ENTRY_TIMING",
  "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
  "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED",
];

function snippet(
  lines,
  index,
  radius = 8,
) {
  const start =
    Math.max(
      0,
      index - radius,
    );

  const end =
    Math.min(
      lines.length - 1,
      index + radius,
    );

  return lines
    .slice(
      start,
      end + 1,
    )
    .map(
      (text, offset) => ({
        line:
          start +
          offset +
          1,
        text,
      }),
    );
}

const reportFiles = [];

for (
  const rel of FILES
) {
  const full =
    path.join(
      ROOT,
      rel,
    );

  const text =
    fs.readFileSync(
      full,
      "utf8",
    );

  const lines =
    text.split(/\r?\n/);

  const matches = {};

  for (
    const needle of NEEDLES
  ) {
    const rows = [];

    for (
      let i = 0;
      i < lines.length;
      i++
    ) {
      if (
        !lines[i].includes(
          needle,
        )
      ) {
        continue;
      }

      rows.push({
        line:
          i + 1,
        snippet:
          snippet(
            lines,
            i,
          ),
      });

      if (
        rows.length >=
        12
      ) {
        break;
      }
    }

    if (
      rows.length > 0
    ) {
      matches[needle] =
        rows;
    }
  }

  reportFiles.push({
    file:
      rel,

    contains: {
      applyFunction:
        text.includes(
          "applyManualPaperPromotion"
        ),

      preflightFunction:
        text.includes(
          "preflightManualPaperPromotion"
        ),

      aiModelVersions:
        text.includes(
          "ai_model_versions"
        ),

      promotionEvents:
        text.includes(
          "model_promotion_events"
        ),

      updateMutation:
        text.includes(
          ".update("
        ),

      insertMutation:
        text.includes(
          ".insert("
        ),

      manualApplyFeatureFlag:
        text.includes(
          "ENABLE_MANUAL_MODEL_PROMOTION_APPLY"
        ),

      exactPhrase:
        text.includes(
          "PROMOTE_SHADOW_TO_PAPER"
        ),

      entryTiming:
        text.includes(
          "ENTRY_TIMING"
        ),

      shadow:
        /\bSHADOW\b/.test(
          text,
        ),

      paper:
        /\bPAPER\b/.test(
          text,
        ),
    },

    matches,
  });
}

const manualApply =
  reportFiles.find(
    item =>
      item.file ===
      "lib/models/model-promotion-manual-apply.ts"
  );

const route =
  reportFiles.find(
    item =>
      item.file ===
      "app/api/models/promotion/apply/route.ts"
  );

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_BOUNDARY_PROBE_V1_COMPLETE",

  mode:
    "READ_ONLY_SOURCE_PROBE",

  files:
    reportFiles,

  summary: {
    manualApplyFileFound:
      !!manualApply,

    routeFileFound:
      !!route,

    manualApplyHasUpdateMutation:
      manualApply
        ?.contains
        ?.updateMutation ===
      true,

    manualApplyHasInsertMutation:
      manualApply
        ?.contains
        ?.insertMutation ===
      true,

    manualApplyReferencesModelTable:
      manualApply
        ?.contains
        ?.aiModelVersions ===
      true,

    manualApplyReferencesPromotionEvents:
      manualApply
        ?.contains
        ?.promotionEvents ===
      true,

    exactPhraseBound:
      manualApply
        ?.contains
        ?.exactPhrase ===
      true,

    manualApplyFeatureFlagBound:
      manualApply
        ?.contains
        ?.manualApplyFeatureFlag ===
      true,

    entryTimingGuardPresent:
      manualApply
        ?.contains
        ?.entryTiming ===
      true,

    shadowToPaperPresent:
      manualApply
        ?.contains
        ?.shadow ===
        true &&
      manualApply
        ?.contains
        ?.paper ===
        true,
  },

  safety: {
    sourceOnly:
      true,

    routeExecuted:
      false,

    preflightExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    promotionApplied:
      false,

    modelStageChanged:
      false,

    promotionEventWritten:
      false,

    ordersCreated:
      0,

    positionsChanged:
      0,

    controlsChanged:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    "BUILD_ACTUAL_PROMOTION_EXECUTION_REVIEW_GATE_FROM_EXACT_MUTATION_CONTRACT",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-paper-promotion-actual-execution-boundary-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
