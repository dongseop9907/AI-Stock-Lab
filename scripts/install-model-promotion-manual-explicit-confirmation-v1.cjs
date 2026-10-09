const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SERVICE_FILE = path.join(
  ROOT,
  "lib",
  "models",
  "model-promotion-manual-apply.ts",
);

const ROUTE_FILE = path.join(
  ROOT,
  "app",
  "api",
  "models",
  "promotion",
  "apply",
  "route.ts",
);

const REGRESSION_FILE = path.join(
  ROOT,
  "scripts",
  "model-promotion-manual-explicit-confirmation-regression-v1.ts",
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
);

const SERVICE_BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-manual-apply.before-explicit-confirmation-v1.ts",
);

const ROUTE_BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-apply-route.before-explicit-confirmation-v1.ts",
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_V1_INSTALL_FAILED",
        reason,
        ...extra,
        safety: {
          databaseWrites: 0,
          promotionApplied: false,
          orderCreation: false,
          positionChange: false,
          controlsChange: false,
          realTradingEnable: false,
        },
      },
      null,
      2,
    ),
  );

  process.exit(1);
}

for (const file of [
  SERVICE_FILE,
  ROUTE_FILE,
]) {
  if (!fs.existsSync(file)) {
    fail(
      "TARGET_FILE_NOT_FOUND",
      {
        file:
          path
            .relative(
              ROOT,
              file,
            )
            .replace(
              /\\/g,
              "/",
            ),
      },
    );
  }
}

let ts;

try {
  ts =
    require("typescript");
} catch (error) {
  fail(
    "TYPESCRIPT_NOT_AVAILABLE",
    {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    },
  );
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive: true,
  },
);

const originalService =
  fs.readFileSync(
    SERVICE_FILE,
    "utf8",
  );

const originalRoute =
  fs.readFileSync(
    ROUTE_FILE,
    "utf8",
  );

if (
  !fs.existsSync(
    SERVICE_BACKUP,
  )
) {
  fs.writeFileSync(
    SERVICE_BACKUP,
    originalService,
    "utf8",
  );
}

if (
  !fs.existsSync(
    ROUTE_BACKUP,
  )
) {
  fs.writeFileSync(
    ROUTE_BACKUP,
    originalRoute,
    "utf8",
  );
}

let service =
  originalService;

let route =
  originalRoute;

const phraseConst =
  'export const MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE =\n  "PROMOTE_SHADOW_TO_PAPER" as const;\n';

if (
  !service.includes(
    "MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE",
  )
) {
  const versionNeedle =
    'export const MODEL_PROMOTION_MANUAL_APPLY_VERSION =\n  "MODEL_PROMOTION_MANUAL_APPLY_V1" as const;\n';

  if (
    !service.includes(
      versionNeedle,
    )
  ) {
    fail(
      "MANUAL_APPLY_VERSION_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      versionNeedle,
      versionNeedle +
        "\n" +
        phraseConst,
    );
}

if (
  !service.includes(
    "confirmationPhrase: string;",
  )
) {
  const inputNeedle =
    "  manualApprovalConfirmed: boolean;\n  actor: string;";

  if (
    !service.includes(
      inputNeedle,
    )
  ) {
    fail(
      "INPUT_INTERFACE_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      inputNeedle,
      "  manualApprovalConfirmed: boolean;\n  confirmationPhrase: string;\n  actor: string;",
    );
}

if (
  !service.includes(
    '| "EXPLICIT_CONFIRMATION_REQUIRED"',
  )
) {
  const reasonNeedle =
    '    | "MANUAL_APPROVAL_REQUIRED"\n';

  if (
    !service.includes(
      reasonNeedle,
    )
  ) {
    fail(
      "PREFLIGHT_REASON_UNION_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      reasonNeedle,
      reasonNeedle +
        '    | "EXPLICIT_CONFIRMATION_REQUIRED"\n',
    );
}

if (
  !service.includes(
    "input.confirmationPhrase !==\n      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE",
  )
) {
  const manualApprovalBlock = `  if (
    input.manualApprovalConfirmed !==
      true
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "MANUAL_APPROVAL_REQUIRED",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        recommendation.decision,
      recommendationReason:
        recommendation.reason,
      canonicalShadowOutcomeEvidenceReady:
        canonicalReady,
      transitionKind:
        transition.kind,
      featureEnabled,
    };
  }

`;

  if (
    !service.includes(
      manualApprovalBlock,
    )
  ) {
    fail(
      "MANUAL_APPROVAL_BLOCK_ANCHOR_NOT_FOUND",
    );
  }

  const explicitConfirmationBlock = `  if (
    input.confirmationPhrase !==
      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "EXPLICIT_CONFIRMATION_REQUIRED",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        recommendation.decision,
      recommendationReason:
        recommendation.reason,
      canonicalShadowOutcomeEvidenceReady:
        canonicalReady,
      transitionKind:
        transition.kind,
      featureEnabled,
    };
  }

`;

  service =
    service.replace(
      manualApprovalBlock,
      manualApprovalBlock +
        explicitConfirmationBlock,
    );
}

if (
  !service.includes(
    "confirmationPhrase:\n              input.confirmationPhrase",
  )
) {
  const evidenceNeedle = `            reason:
              input.reason,
            canonicalReady:
              preflight
                .canonicalShadowOutcomeEvidenceReady,`;

  if (
    !service.includes(
      evidenceNeedle,
    )
  ) {
    fail(
      "MANUAL_APPLY_EVIDENCE_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      evidenceNeedle,
      `            reason:
              input.reason,
            confirmationPhrase:
              input.confirmationPhrase,
            canonicalReady:
              preflight
                .canonicalShadowOutcomeEvidenceReady,`,
    );
}

if (
  !service.includes(
    "explicitConfirmationMatched:",
  )
) {
  const safetyNeedle = `      manualApprovalConfirmed:
        true,
      canonicalEvidenceReady:
        true,`;

  if (
    !service.includes(
      safetyNeedle,
    )
  ) {
    fail(
      "RETURN_SAFETY_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      safetyNeedle,
      `      manualApprovalConfirmed:
        true,
      explicitConfirmationMatched:
        input.confirmationPhrase ===
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
      canonicalEvidenceReady:
        true,`,
    );
}

if (
  !route.includes(
    "confirmationPhrase?: unknown;",
  )
) {
  const routeInterfaceNeedle =
    "  manualApprovalConfirmed?: unknown;\n  actor?: unknown;";

  if (
    !route.includes(
      routeInterfaceNeedle,
    )
  ) {
    fail(
      "ROUTE_INTERFACE_ANCHOR_NOT_FOUND",
    );
  }

  route =
    route.replace(
      routeInterfaceNeedle,
      "  manualApprovalConfirmed?: unknown;\n  confirmationPhrase?: unknown;\n  actor?: unknown;",
    );
}

if (
  !route.includes(
    "const confirmationPhrase =",
  )
) {
  const routeActorNeedle = `    const actor =
      String(
        body.actor ??
        "",
      )
        .trim();

`;

  if (
    !route.includes(
      routeActorNeedle,
    )
  ) {
    fail(
      "ROUTE_ACTOR_ANCHOR_NOT_FOUND",
    );
  }

  const confirmationBlock = `    const confirmationPhrase =
      String(
        body.confirmationPhrase ??
        "",
      )
        .trim();

`;

  route =
    route.replace(
      routeActorNeedle,
      confirmationBlock +
        routeActorNeedle,
    );
}

if (
  !route.includes(
    "confirmationPhrase,\n      actor,",
  )
) {
  const routeInputNeedle = `      manualApprovalConfirmed,
      actor,
      reason,`;

  if (
    !route.includes(
      routeInputNeedle,
    )
  ) {
    fail(
      "ROUTE_INPUT_ANCHOR_NOT_FOUND",
    );
  }

  route =
    route.replace(
      routeInputNeedle,
      `      manualApprovalConfirmed,
      confirmationPhrase,
      actor,
      reason,`,
    );
}

function parseOrFail(
  file,
  text,
) {
  const sf =
    ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  if (
    sf.parseDiagnostics &&
    sf.parseDiagnostics.length >
      0
  ) {
    fail(
      "GENERATED_SOURCE_PARSE_FAILED",
      {
        file:
          path
            .relative(
              ROOT,
              file,
            )
            .replace(
              /\\/g,
              "/",
            ),
        diagnostics:
          sf.parseDiagnostics.map(
            (diag) => ({
              message:
                ts.flattenDiagnosticMessageText(
                  diag.messageText,
                  "\n",
                ),
            }),
          ),
      },
    );
  }
}

parseOrFail(
  SERVICE_FILE,
  service,
);

parseOrFail(
  ROUTE_FILE,
  route,
);

const regressionSource = `import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  applyManualPaperPromotion,
  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
  preflightManualPaperPromotion,
} from "@/lib/models/model-promotion-manual-apply";

const ROOT =
  process.cwd();

async function countRows(
  table: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from(table)
      .select("*", {
        count:
          "exact",
        head:
          true,
      });

  if (error) {
    throw new Error(
      "COUNT_FAILED:" +
      table +
      ":" +
      error.message,
    );
  }

  return count ?? 0;
}

async function getControls() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trading_system_controls",
      )
      .select(
        "control_key,emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled"
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      "CONTROL_READ_FAILED:" +
      error.message,
    );
  }

  return data;
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id,purpose,status,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND",
    );
  }

  const before = {
    events:
      await countRows(
        "model_promotion_events",
      ),
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
    controls:
      await getControls(),
  };

  const noApproval =
    await preflightManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        false,
      confirmationPhrase:
        "",
      actor:
        "EXPLICIT_CONFIRMATION_REGRESSION_V1",
      reason:
        "NO_APPROVAL_CASE",
    });

  const wrongPhrase =
    await preflightManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      confirmationPhrase:
        "PROMOTE",
      actor:
        "EXPLICIT_CONFIRMATION_REGRESSION_V1",
      reason:
        "WRONG_PHRASE_CASE",
    });

  const correctPhrase =
    await preflightManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      confirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
      actor:
        "EXPLICIT_CONFIRMATION_REGRESSION_V1",
      reason:
        "CORRECT_PHRASE_BUT_NO_CANONICAL_EVIDENCE",
    });

  let wrongApplyError:
    string | null =
      null;

  try {
    await applyManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      confirmationPhrase:
        "PROMOTE",
      actor:
        "EXPLICIT_CONFIRMATION_REGRESSION_V1",
      reason:
        "WRONG_PHRASE_APPLY_CASE",
    });
  } catch (error) {
    wrongApplyError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  let correctPhraseApplyError:
    string | null =
      null;

  try {
    await applyManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      confirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
      actor:
        "EXPLICIT_CONFIRMATION_REGRESSION_V1",
      reason:
        "CORRECT_PHRASE_NO_EVIDENCE_APPLY_CASE",
    });
  } catch (error) {
    correctPhraseApplyError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const {
    data: modelAfter,
    error: modelAfterError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "id",
        model.id,
      )
      .single();

  if (
    modelAfterError ||
    !modelAfter
  ) {
    throw new Error(
      "MODEL_AFTER_READ_FAILED",
    );
  }

  const after = {
    events:
      await countRows(
        "model_promotion_events",
      ),
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
    controls:
      await getControls(),
  };

  const automationFiles = [
    "app/api/trading/automation/run/route.ts",
    "app/api/trading/automation/cycle/route.ts",
    "app/api/trading/automation/manual/route.ts",
  ];

  const automationReferencesApply =
    automationFiles.filter(
      (file) => {
        const full =
          path.join(
            ROOT,
            file,
          );

        if (
          !fs.existsSync(
            full,
          )
        ) {
          return false;
        }

        const text =
          fs.readFileSync(
            full,
            "utf8",
          );

        return (
          text.includes(
            "model-promotion-manual-apply"
          ) ||
          text.includes(
            "/api/models/promotion/apply"
          ) ||
          text.includes(
            "applyManualPaperPromotion"
          )
        );
      },
    );

  const checks = {
    noApprovalBlocked:
      noApproval.allowed ===
        false &&
      noApproval.reason ===
        "MANUAL_APPROVAL_REQUIRED",

    wrongPhraseBlocked:
      wrongPhrase.allowed ===
        false &&
      wrongPhrase.reason ===
        "EXPLICIT_CONFIRMATION_REQUIRED",

    correctPhraseStillBlockedWithoutCanonicalEvidence:
      correctPhrase.allowed ===
        false &&
      correctPhrase.reason ===
        "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    wrongPhraseApplyFailClosed:
      wrongApplyError ===
        "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:EXPLICIT_CONFIRMATION_REQUIRED",

    correctPhraseApplyStillFailClosedWithoutEvidence:
      correctPhraseApplyError ===
        "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    modelStillShadow:
      modelAfter
        .promotion_stage ===
      "SHADOW",

    modelStageTimestampUnchanged:
      modelAfter
        .promotion_stage_updated_at ===
      model
        .promotion_stage_updated_at,

    noPromotionEventCreated:
      before.events ===
      after.events,

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    controlsUnchanged:
      JSON.stringify(
        before.controls,
      ) ===
      JSON.stringify(
        after.controls,
      ),

    automationCannotCallManualApply:
      automationReferencesApply
        .length ===
      0,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
      )
      .map(
        ([key]) =>
          key,
      );

  const report = {
    status:
      failed.length ===
      0
        ? "MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_REGRESSION_V1_VERIFIED"
        : "MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_REGRESSION_V1_FAILED",

    model: {
      id:
        model.id,
      promotionStage:
        model.promotion_stage,
      promotionStageUpdatedAt:
        model
          .promotion_stage_updated_at,
    },

    contract: {
      requiredPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
      manualApprovalBooleanRequired:
        true,
      canonicalEvidenceRequired:
        true,
      featureFlagStillRequiredForActualApply:
        true,
    },

    preflight: {
      noApproval,
      wrongPhrase,
      correctPhrase,
    },

    applyAttempts: {
      wrongPhraseError:
        wrongApplyError,
      correctPhraseWithoutEvidenceError:
        correctPhraseApplyError,
    },

    automationReferencesApply,

    counts: {
      promotionEvents:
        String(
          before.events,
        ) +
        "->" +
        String(
          after.events,
        ),
      orders:
        String(
          before.orders,
        ) +
        "->" +
        String(
          after.orders,
        ),
      positions:
        String(
          before.positions,
        ) +
        "->" +
        String(
          after.positions,
        ),
    },

    controls: {
      before:
        before.controls,
      after:
        after.controls,
    },

    checks,

    failed,

    safety: {
      databaseWrites:
        0,
      promotionApplied:
        false,
      promotionEventsCreated:
        after.events -
        before.events,
      ordersCreated:
        after.orders -
        before.orders,
      positionsChanged:
        after.positions -
        before.positions,
      controlsChanged:
        JSON.stringify(
          before.controls,
        ) !==
        JSON.stringify(
          after.controls,
        ),
      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length ===
      0
        ? "KEEP_SHADOW_AND_VERIFY_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT"
        : "STOP_AND_INSPECT_EXPLICIT_CONFIRMATION_CONTRACT_GAP",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
    0
      ? 0
      : 1;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_REGRESSION_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
`;

parseOrFail(
  REGRESSION_FILE,
  regressionSource,
);

fs.writeFileSync(
  SERVICE_FILE,
  service,
  "utf8",
);

fs.writeFileSync(
  ROUTE_FILE,
  route,
  "utf8",
);

fs.writeFileSync(
  REGRESSION_FILE,
  regressionSource,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_V1_INSTALLED",

      modifiedFiles: [
        "lib/models/model-promotion-manual-apply.ts",
        "app/api/models/promotion/apply/route.ts"
      ],

      generatedFiles: [
        "scripts/model-promotion-manual-explicit-confirmation-regression-v1.ts"
      ],

      backups: [
        "scripts/backups/model-promotion-manual-apply.before-explicit-confirmation-v1.ts",
        "scripts/backups/model-promotion-apply-route.before-explicit-confirmation-v1.ts"
      ],

      contract: {
        manualApprovalConfirmed:
          true,
        confirmationPhrase:
          "PROMOTE_SHADOW_TO_PAPER",
        canonicalEvidenceReady:
          true,
        featureFlag:
          "ENABLE_MANUAL_MODEL_PROMOTION_APPLY=true",
        automationBinding:
          "NONE"
      },

      safety: {
        installerDatabaseWrites:
          0,
        promotionApplied:
          false,
        orderCreation:
          false,
        positionChange:
          false,
        controlsChange:
          false,
        realTradingEnable:
          false,
      },

      nextAction:
        "RUN_EXPLICIT_CONFIRMATION_REGRESSION",
    },
    null,
    2,
  ),
);
