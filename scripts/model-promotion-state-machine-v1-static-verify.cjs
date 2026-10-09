const fs = require("fs");
const path = require("path");

const root = process.cwd();

const modulePath =
  path.resolve(
    root,
    "lib/models/model-promotion-state-machine.ts",
  );

const migrationPath =
  path.resolve(
    root,
    "supabase/migrations/20261009000300_model_promotion_state_machine_v1.sql",
  );

for (
  const file of [
    modulePath,
    migrationPath,
  ]
) {
  if (
    !fs.existsSync(file)
  ) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${path.relative(root, file)}`,
    );
  }
}

const source =
  fs.readFileSync(
    modulePath,
    "utf8",
  );

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const checks = {
  separatePromotionStage:
    /promotion_stage/.test(
      migration,
    ),

  legacyStatusNotRewritten:
    !/set\s+status\s*=/i.test(
      migration,
    ),

  legacyCandidateMapsCandidate:
    /status\s*=\s*'CANDIDATE'[\s\S]*?'CANDIDATE'/i.test(
      migration,
    ),

  legacyApprovedMapsPaper:
    /status\s*=\s*'APPROVED'[\s\S]*?'PAPER'/i.test(
      migration,
    ),

  rejectedRetiredDisabled:
    /'REJECTED'[\s\S]*?'RETIRED'[\s\S]*?'DISABLED'/i.test(
      migration,
    ),

  eightCanonicalStages:
    [
      "EXPERIMENTAL",
      "CANDIDATE",
      "SHADOW",
      "PAPER",
      "LIMITED_LIVE",
      "PRODUCTION",
      "DEGRADED",
      "DISABLED",
    ].every(
      (stage) =>
        source.includes(
          `"${stage}"`,
        ) &&
        migration.includes(
          `'${stage}'`,
        ),
    ),

  hasPromotionEventAudit:
    /model_promotion_events/i.test(
      migration,
    ),

  hasDbTransitionValidator:
    /validate_model_promotion_transition_v1/i.test(
      migration,
    ),

  hasDbTransitionTrigger:
    /enforce_model_promotion_stage_transition_v1/i.test(
      migration,
    ) &&
    /trg_ai_model_versions_promotion_stage_guard_v1/i.test(
      migration,
    ),

  forwardOneStageOnly:
    /FORWARD_ONE_STAGE/.test(
      source,
    ) &&
    /FORWARD_ONE_STAGE/.test(
      migration,
    ),

  liveManualApproval:
    /LIMITED_LIVE/.test(
      source,
    ) &&
    /requiresManualApproval/.test(
      source,
    ),

  paperLiveRiskSeparated:
    /canCreatePaperRiskForPromotionStage/.test(
      source,
    ) &&
    /canCreateLiveRiskForPromotionStage/.test(
      source,
    ),

  disabledTerminal:
    /DISABLED_MUST_BE_TERMINAL|DISABLED is terminal/i.test(
      source,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      source +
      "\n" +
      migration,
    ),

  noOrderMutation:
    !/\b(insert\s+into|update|delete\s+from)\s+public\.(paper_order_requests|paper_positions|trade_orders)\b/i.test(
      migration,
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        !ok,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "MODEL_PROMOTION_STATE_MACHINE_V1_STATIC_VERIFIED"
          : "MODEL_PROMOTION_STATE_MACHINE_V1_STATIC_FAILED",
      checks,
      failed,
      databaseApplied:
        false,
    },
    null,
    2,
  ),
);

if (
  failed.length >
    0
) {
  process.exitCode =
    1;
}
