import fs from "fs";
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
