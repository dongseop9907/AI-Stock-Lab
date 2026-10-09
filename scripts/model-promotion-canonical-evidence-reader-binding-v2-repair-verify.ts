
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  collectModelPromotionEvidence,
} from "@/lib/models/model-promotion-decision-service";

const ROOT = process.cwd();

const serviceFile =
  path.join(
    ROOT,
    "lib",
    "models",
    "model-promotion-decision-service.ts",
  );

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
        "id,purpose,promotion_stage"
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
      "SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  const before = {
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const evidence =
    await collectModelPromotionEvidence(
      model.id,
    );

  const after = {
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const source =
    fs.readFileSync(
      serviceFile,
      "utf8",
    );

  const readyValue =
    (
      evidence as
        Record<string, unknown>
    )
      .canonicalShadowOutcomeEvidenceReady;

  const checks = {
    modelIsEntryTimingShadow:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    collectorReturnsCanonicalReadiness:
      typeof readyValue ===
        "boolean",

    currentCanonicalReadinessIsFalse:
      readyValue === false,

    badModelIdPropertyReferenceRemoved:
      !source.includes(
        "modelId.canonicalShadowOutcomeEvidenceReady",
      ),

    failClosedConditionUsesAnd:
      source.includes(
        "transition.allowed"
      ) &&
      source.includes(
        "&& !"
      ) &&
      source.includes(
        ".canonicalShadowOutcomeEvidenceReady",
      ),

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    realTradingEnabledByScript:
      false,
  };

  const required = [
    "modelIsEntryTimingShadow",
    "collectorReturnsCanonicalReadiness",
    "currentCanonicalReadinessIsFalse",
    "badModelIdPropertyReferenceRemoved",
    "failClosedConditionUsesAnd",
    "noOrdersCreated",
    "noPositionsChanged",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const report = {
    status:
      failed.length === 0
        ? "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_VERIFIED"
        : "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_FAILED",

    model: {
      id:
        model.id,
      purpose:
        model.purpose,
      promotionStage:
        model.promotion_stage,
    },

    canonicalShadowOutcomeEvidenceReady:
      readyValue,

    checks,

    failed,

    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      ordersCreated:
        after.orders -
        before.orders,
      positionsChanged:
        after.positions -
        before.positions,
      promotionChange:
        false,
      controlsChange:
        false,
      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length === 0
        ? "RERUN_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION"
        : "STOP_AND_INSPECT_CANONICAL_READER_BINDING_REPAIR",
  };

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
            "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
