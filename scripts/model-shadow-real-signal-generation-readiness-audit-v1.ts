
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  resolveEntryModel,
} from "@/lib/trading/generate-entry-signals";

const ROOT = process.cwd();

const FILES = {
  generator:
    "lib/trading/generate-entry-signals.ts",

  entryRoute:
    "app/api/signals/entry/generate/route.ts",

  automationRoute:
    "app/api/trading/automation/run/route.ts",
};

function read(
  relativePath: string,
): string {
  const full =
    path.join(
      ROOT,
      relativePath,
    );

  if (
    !fs.existsSync(full)
  ) {
    return "";
  }

  return fs.readFileSync(
    full,
    "utf8",
  );
}

function around(
  text: string,
  needle: string,
  radius = 1800,
): string | null {
  const index =
    text.indexOf(
      needle,
    );

  if (
    index < 0
  ) {
    return null;
  }

  return text.slice(
    Math.max(
      0,
      index - radius,
    ),
    Math.min(
      text.length,
      index +
        needle.length +
        radius,
    ),
  );
}

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

async function safeResolve(
  modelId?: string,
) {
  try {
    const model =
      await resolveEntryModel(
        modelId,
      );

    return {
      ok: true as const,

      model: {
        id:
          model.id,

        name:
          model.model_name,

        version:
          model.model_version,

        purpose:
          model.purpose,

        status:
          model.status,
      },

      error:
        null,
    };
  } catch (error) {
    return {
      ok: false as const,

      model:
        null,

      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: shadowModel,
    error: modelError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
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
    !shadowModel
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  const before = {
    signals:
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

  const explicitResolution =
    await safeResolve(
      shadowModel.id,
    );

  const defaultResolution =
    await safeResolve();

  const generatorSource =
    read(
      FILES.generator,
    );

  const entryRouteSource =
    read(
      FILES.entryRoute,
    );

  const automationSource =
    read(
      FILES.automationRoute,
    );

  const automationEntryContext =
    around(
      automationSource,
      "/api/signals/entry/generate",
    );

  const entryRouteGeneratorContext =
    around(
      entryRouteSource,
      "generateEntrySignals",
    );

  const generatorUsesInputModelId =
    generatorSource.includes(
      "resolveEntryModel"
    ) &&
    (
      generatorSource.includes(
        "input.modelId"
      ) ||
      generatorSource.includes(
        "modelId: input.modelId"
      )
    );

  const explicitResolverPathExists =
    generatorSource.includes(
      "if (modelId)"
    ) &&
    generatorSource.includes(
      '"ai_model_versions"'
    ) &&
    generatorSource.includes(
      '"ENTRY_TIMING"'
    );

  const entryRouteAcceptsModelId =
    entryRouteGeneratorContext !==
      null &&
    /modelId/.test(
      entryRouteGeneratorContext,
    );

  const automationCallsEntryGenerate =
    automationEntryContext !==
      null;

  const automationPassesModelId =
    automationEntryContext !==
      null &&
    /modelId/.test(
      automationEntryContext,
    );

  const explicitResolvesShadowModel =
    explicitResolution.ok &&
    explicitResolution.model?.id ===
      shadowModel.id &&
    explicitResolution.model
      ?.purpose ===
      "ENTRY_TIMING";

  const defaultResolvesShadowModel =
    defaultResolution.ok &&
    defaultResolution.model?.id ===
      shadowModel.id;

  const automationHasUsableModelBinding =
    automationPassesModelId ||
    defaultResolvesShadowModel;

  const after = {
    signals:
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

  const controlsUnchanged =
    JSON.stringify(
      before.controls,
    ) ===
    JSON.stringify(
      after.controls,
    );

  const countsUnchanged =
    before.signals ===
      after.signals &&
    before.canonicalRows ===
      after.canonicalRows &&
    before.orders ===
      after.orders &&
    before.positions ===
      after.positions &&
    before.promotionEvents ===
      after.promotionEvents;

  const checks = {
    entryTimingShadowModelFound:
      shadowModel.purpose ===
        "ENTRY_TIMING" &&
      shadowModel.promotion_stage ===
        "SHADOW",

    generatorUsesInputModelId,

    explicitResolverPathExists,

    explicitShadowModelResolves:
      explicitResolvesShadowModel,

    entryRouteAcceptsModelId,

    automationCallsEntryGenerate,

    automationHasUsableModelBinding,

    probeMadeNoChanges:
      countsUnchanged,

    controlsUnchanged,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const required = [
    "entryTimingShadowModelFound",
    "generatorUsesInputModelId",
    "explicitResolverPathExists",
    "explicitShadowModelResolves",
    "entryRouteAcceptsModelId",
    "automationCallsEntryGenerate",
    "automationHasUsableModelBinding",
    "probeMadeNoChanges",
    "controlsUnchanged",
    "realTradingStillOff",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const bindingProblemOnly =
    explicitResolvesShadowModel &&
    automationCallsEntryGenerate &&
    !automationHasUsableModelBinding;

  const status =
    failed.length === 0
      ? "MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_VERIFIED"
      : bindingProblemOnly
        ? "MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_MODEL_BINDING_GAP"
        : "MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_FAILED";

  const report = {
    status,

    shadowModel: {
      id:
        shadowModel.id,

      name:
        shadowModel.model_name,

      version:
        shadowModel.model_version,

      purpose:
        shadowModel.purpose,

      legacyStatus:
        shadowModel.status,

      promotionStage:
        shadowModel.promotion_stage,

      shadowStartedAt:
        shadowModel
          .promotion_stage_updated_at,
    },

    resolver: {
      explicit:
        explicitResolution,

      default:
        defaultResolution,

      explicitResolvesShadowModel,

      defaultResolvesShadowModel,
    },

    sourceBinding: {
      files:
        FILES,

      generatorUsesInputModelId,

      explicitResolverPathExists,

      entryRouteAcceptsModelId,

      automationCallsEntryGenerate,

      automationPassesModelId,

      automationHasUsableModelBinding,

      automationEntryContext,

      entryRouteGeneratorContext,
    },

    counts: {
      signals:
        String(
          before.signals,
        ) +
        "->" +
        String(
          after.signals,
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

      signalGenerationExecuted:
        false,

      syntheticSignalCreated:
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
      failed.length === 0
        ? "KEEP_SHADOW_AND_WAIT_FOR_REAL_SIGNAL_WHILE_CONTINUING_INDEPENDENT_GOVERNANCE_WORK"
        : bindingProblemOnly
          ? "BIND_AUTOMATION_ENTRY_GENERATION_TO_CURRENT_ENTRY_TIMING_SHADOW_MODEL"
          : "INSPECT_REAL_SIGNAL_GENERATION_READINESS_FAILURE",
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
      "model-shadow-real-signal-generation-readiness-audit-v1.json",
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
            "MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            signalGenerationExecuted:
              false,

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
