
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

const ROOT = process.cwd();

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
        count: "exact",
        head: true,
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
      .from("ai_model_versions")
      .select(
        "id,model_name,model_version,purpose,status,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .order(
        "promotion_stage_updated_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  if (
    !model.promotion_stage_updated_at
  ) {
    throw new Error(
      "SHADOW_STARTED_AT_MISSING",
    );
  }

  const before = {
    totalSignals:
      await countRows(
        "ai_entry_signals",
      ),

    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),

    promotionEvents:
      await countRows(
        "model_promotion_events",
      ),

    controls:
      await getControls(),
  };

  const {
    data: postShadowSignals,
    error: signalError,
  } =
    await supabase
      .from("ai_entry_signals")
      .select(
        "id,model_id,stock_code,status,observed_at,created_at,recommended_entry_price,recommended_stop_price"
      )
      .eq(
        "model_id",
        model.id,
      )
      .gte(
        "created_at",
        model.promotion_stage_updated_at,
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      )
      .limit(5);

  if (signalError) {
    throw new Error(
      "POST_SHADOW_SIGNAL_READ_FAILED:" +
      signalError.message,
    );
  }

  const firstSignal =
    postShadowSignals?.[0] ??
    null;

  let canonical = null;

  if (firstSignal) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "model_shadow_signal_outcomes",
        )
        .select(
          "id,signal_id,model_id,stock_code,signal_observed_at,captured_at,promotion_stage_at_capture,promotion_stage_updated_at_at_capture,evaluation_status,return_1d,return_3d,return_5d,created_at"
        )
        .eq(
          "signal_id",
          firstSignal.id,
        )
        .maybeSingle();

    if (error) {
      throw new Error(
        "CANONICAL_SIGNAL_LOOKUP_FAILED:" +
        error.message,
      );
    }

    canonical = data;
  }

  const after = {
    totalSignals:
      await countRows(
        "ai_entry_signals",
      ),

    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),

    promotionEvents:
      await countRows(
        "model_promotion_events",
      ),

    controls:
      await getControls(),
  };

  const signalExists =
    firstSignal !== null;

  const canonicalExists =
    canonical !== null;

  const capturedAfterShadow =
    !canonical
      ? false
      : (
          Date.parse(
            canonical.captured_at,
          ) >=
          Date.parse(
            model.promotion_stage_updated_at,
          )
        );

  const captureStageIsShadow =
    canonical?.promotion_stage_at_capture ===
      "SHADOW";

  const modelBindingMatches =
    !!canonical &&
    canonical.model_id ===
      model.id &&
    canonical.signal_id ===
      firstSignal?.id;

  const countsUnchanged =
    before.totalSignals ===
      after.totalSignals &&
    before.canonicalRows ===
      after.canonicalRows &&
    before.orders ===
      after.orders &&
    before.positions ===
      after.positions &&
    before.promotionEvents ===
      after.promotionEvents;

  const controlsUnchanged =
    JSON.stringify(
      before.controls,
    ) ===
    JSON.stringify(
      after.controls,
    );

  const realTradingStillOff =
    after.controls?.real_order_enabled ===
      false;

  const waitingChecks = {
    entryTimingShadowModelFound:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    noPostShadowSignalYet:
      !signalExists,

    probeMadeNoChanges:
      countsUnchanged,

    controlsUnchanged,

    realTradingStillOff,
  };

  const verifiedChecks = {
    entryTimingShadowModelFound:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    postShadowSignalFound:
      signalExists,

    canonicalRowCreated:
      canonicalExists,

    canonicalBoundToSignalAndModel:
      modelBindingMatches,

    captureStageIsShadow,

    capturedAfterShadowStart:
      capturedAfterShadow,

    probeMadeNoChanges:
      countsUnchanged,

    controlsUnchanged,

    realTradingStillOff,
  };

  const waitingRequired = [
    "entryTimingShadowModelFound",
    "noPostShadowSignalYet",
    "probeMadeNoChanges",
    "controlsUnchanged",
    "realTradingStillOff",
  ] as const;

  const verifiedRequired = [
    "entryTimingShadowModelFound",
    "postShadowSignalFound",
    "canonicalRowCreated",
    "canonicalBoundToSignalAndModel",
    "captureStageIsShadow",
    "capturedAfterShadowStart",
    "probeMadeNoChanges",
    "controlsUnchanged",
    "realTradingStillOff",
  ] as const;

  const checks =
    signalExists
      ? verifiedChecks
      : waitingChecks;

  const failed =
    (
      signalExists
        ? verifiedRequired
        : waitingRequired
    ).filter(
      (key) =>
        !(
          checks as
            Record<
              string,
              boolean
            >
        )[key],
    );

  const status =
    failed.length > 0
      ? "MODEL_SHADOW_FIRST_REAL_POST_SHADOW_CANONICAL_CAPTURE_V1_FAILED"
      : signalExists
        ? "MODEL_SHADOW_FIRST_REAL_POST_SHADOW_CANONICAL_CAPTURE_V1_VERIFIED"
        : "MODEL_SHADOW_FIRST_REAL_POST_SHADOW_CANONICAL_CAPTURE_V1_WAITING_FOR_SIGNAL";

  const report = {
    status,

    model: {
      id:
        model.id,

      name:
        model.model_name,

      version:
        model.model_version,

      purpose:
        model.purpose,

      legacyStatus:
        model.status,

      promotionStage:
        model.promotion_stage,

      shadowStartedAt:
        model.promotion_stage_updated_at,
    },

    firstPostShadowSignal:
      firstSignal,

    canonicalOutcome:
      canonical,

    counts: {
      totalSignals:
        String(
          before.totalSignals,
        ) +
        "->" +
        String(
          after.totalSignals,
        ),

      canonicalRows:
        String(
          before.canonicalRows,
        ) +
        "->" +
        String(
          after.canonicalRows,
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

      promotionEvents:
        String(
          before.promotionEvents,
        ) +
        "->" +
        String(
          after.promotionEvents,
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
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      syntheticSignalCreated:
        false,

      historicalBackfill:
        false,

      ordersCreated:
        after.orders -
        before.orders,

      positionsChanged:
        after.positions -
        before.positions,

      promotionChange:
        false,

      controlsChanged:
        !controlsUnchanged,

      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length > 0
        ? "STOP_AND_INSPECT_FIRST_REAL_POST_SHADOW_CANONICAL_CAPTURE_GAP"
        : signalExists
          ? "VERIFY_REAL_POST_SHADOW_SIGNAL_CANONICAL_EVALUATION_LIFECYCLE"
          : "KEEP_SHADOW_WAIT_FOR_FIRST_REAL_POST_SHADOW_SIGNAL",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "model-shadow-first-real-post-shadow-canonical-capture-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_SHADOW_FIRST_REAL_POST_SHADOW_CANONICAL_CAPTURE_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            syntheticSignalCreated:
              false,

            orderCreation:
              false,

            positionChange:
              false,

            promotionChange:
              false,

            controlsChange:
              false,

            realTradingEnable:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
