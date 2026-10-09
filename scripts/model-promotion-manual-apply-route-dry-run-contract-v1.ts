
import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  POST,
} from "@/app/api/models/promotion/apply/route";

import {
  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
} from "@/lib/models/model-promotion-manual-apply";

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

async function callRoute(
  body: Record<string, unknown>,
) {
  const request =
    new Request(
      "http://localhost/api/models/promotion/apply",
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body:
          JSON.stringify(
            body,
          ),
      },
    );

  const response =
    await POST(
      request,
    );

  let payload:
    unknown =
      null;

  try {
    payload =
      await response.json();
  } catch {
    payload =
      null;
  }

  return {
    status:
      response.status,

    payload,
  };
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
      .order(
        "promotion_stage_updated_at",
        {
          ascending:
            false,
        },
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

  const base = {
    modelId:
      model.id,

    toStage:
      "PAPER",

    actor:
      "MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1",

    dryRun:
      true,
  };

  const noApproval =
    await callRoute({
      ...base,

      manualApprovalConfirmed:
        false,

      confirmationPhrase:
        "",

      reason:
        "NO_APPROVAL_DRY_RUN",
    });

  const wrongPhrase =
    await callRoute({
      ...base,

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        "PROMOTE",

      reason:
        "WRONG_PHRASE_DRY_RUN",
    });

  const correctPhrase =
    await callRoute({
      ...base,

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,

      reason:
        "CORRECT_PHRASE_NO_EVIDENCE_DRY_RUN",
    });

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

  function getReason(
    result: {
      status: number;
      payload: unknown;
    },
  ) {
    if (
      !result.payload ||
      typeof result.payload !==
        "object"
    ) {
      return null;
    }

    const payload =
      result.payload as
        Record<string, unknown>;

    const preflight =
      payload.preflight;

    if (
      !preflight ||
      typeof preflight !==
        "object"
    ) {
      return null;
    }

    return (
      preflight as
        Record<string, unknown>
    ).reason ?? null;
  }

  function getAllowed(
    result: {
      status: number;
      payload: unknown;
    },
  ) {
    if (
      !result.payload ||
      typeof result.payload !==
        "object"
    ) {
      return null;
    }

    const payload =
      result.payload as
        Record<string, unknown>;

    const preflight =
      payload.preflight;

    if (
      !preflight ||
      typeof preflight !==
        "object"
    ) {
      return null;
    }

    return (
      preflight as
        Record<string, unknown>
    ).allowed ?? null;
  }

  function getDryRun(
    result: {
      status: number;
      payload: unknown;
    },
  ) {
    if (
      !result.payload ||
      typeof result.payload !==
        "object"
    ) {
      return null;
    }

    return (
      result.payload as
        Record<string, unknown>
    ).dryRun ?? null;
  }

  const checks = {
    noApprovalHttp200:
      noApproval.status ===
      200,

    noApprovalDryRunEcho:
      getDryRun(
        noApproval,
      ) ===
      true,

    noApprovalBlocked:
      getAllowed(
        noApproval,
      ) ===
        false &&
      getReason(
        noApproval,
      ) ===
        "MANUAL_APPROVAL_REQUIRED",

    wrongPhraseHttp200:
      wrongPhrase.status ===
      200,

    wrongPhraseDryRunEcho:
      getDryRun(
        wrongPhrase,
      ) ===
      true,

    wrongPhraseBlocked:
      getAllowed(
        wrongPhrase,
      ) ===
        false &&
      getReason(
        wrongPhrase,
      ) ===
        "EXPLICIT_CONFIRMATION_REQUIRED",

    correctPhraseHttp200:
      correctPhrase.status ===
      200,

    correctPhraseDryRunEcho:
      getDryRun(
        correctPhrase,
      ) ===
      true,

    correctPhraseStillBlockedWithoutCanonicalEvidence:
      getAllowed(
        correctPhrase,
      ) ===
        false &&
      getReason(
        correctPhrase,
      ) ===
        "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    modelStageUnchanged:
      modelAfter
        .promotion_stage ===
      model
        .promotion_stage,

    modelStageTimestampUnchanged:
      modelAfter
        .promotion_stage_updated_at ===
      model
        .promotion_stage_updated_at,

    noPromotionEventsCreated:
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
        ? "MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_VERIFIED"
        : "MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_FAILED",

    model: {
      id:
        model.id,

      purpose:
        model.purpose,

      legacyStatus:
        model.status,

      promotionStage:
        model.promotion_stage,

      promotionStageUpdatedAt:
        model
          .promotion_stage_updated_at,
    },

    contract: {
      endpoint:
        "/api/models/promotion/apply",

      method:
        "POST",

      dryRun:
        true,

      requiredConfirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,

      expectedBlockingOrder: [
        "MANUAL_APPROVAL_REQUIRED",
        "EXPLICIT_CONFIRMATION_REQUIRED",
        "CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
      ],
    },

    cases: {
      noApproval,
      wrongPhrase,
      correctPhrase,
    },

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
      routeHandlerExecuted:
        true,

      dryRunOnly:
        true,

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
        ? "KEEP_SHADOW_WAIT_FOR_FIRST_REAL_POST_SHADOW_SIGNAL_AND_CANONICAL_LIFECYCLE"
        : "STOP_AND_INSPECT_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT",
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
            "MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
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
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
