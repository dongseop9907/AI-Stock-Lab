
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

const ROOT = process.cwd();

const TARGET_FILES = {
  stateMachine:
    "lib/models/model-promotion-state-machine.ts",

  promotionGate:
    "lib/models/model-promotion-gate.ts",

  decisionService:
    "lib/models/model-promotion-decision-service.ts",

  automationRun:
    "app/api/trading/automation/run/route.ts",

  automationCycle:
    "app/api/trading/automation/cycle/route.ts",

  automationManual:
    "app/api/trading/automation/manual/route.ts",
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

function walk(
  dir: string,
): string[] {
  if (
    !fs.existsSync(dir)
  ) {
    return [];
  }

  const result:
    string[] = [];

  for (
    const entry
    of fs.readdirSync(
      dir,
      {
        withFileTypes:
          true,
      },
    )
  ) {
    const full =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      if (
        entry.name ===
          "node_modules" ||
        entry.name ===
          ".next" ||
        entry.name ===
          ".git"
      ) {
        continue;
      }

      result.push(
        ...walk(full),
      );

      continue;
    }

    if (
      !entry.isFile()
    ) {
      continue;
    }

    if (
      !/\.(ts|tsx)$/.test(
        entry.name,
      )
    ) {
      continue;
    }

    result.push(
      full,
    );
  }

  return result;
}

function relative(
  full: string,
): string {
  return path
    .relative(
      ROOT,
      full,
    )
    .replace(
      /\\/g,
      "/",
    );
}

function linesMatching(
  text: string,
  patterns: RegExp[],
) {
  return text
    .split(/\r?\n/)
    .map(
      (
        line,
        index,
      ) => ({
        line:
          index + 1,

        text:
          line.trim(),
      }),
    )
    .filter(
      ({ text }) =>
        patterns.some(
          (pattern) =>
            pattern.test(
              text,
            ),
        ),
    )
    .slice(
      0,
      120,
    );
}

function exportedFunctionNames(
  text: string,
): string[] {
  const names =
    new Set<string>();

  const patterns = [
    /export\s+async\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
  ];

  for (
    const pattern
    of patterns
  ) {
    let match:
      RegExpExecArray |
      null;

    while (
      (
        match =
          pattern.exec(text)
      )
    ) {
      names.add(
        match[1],
      );
    }
  }

  return [
    ...names,
  ];
}

function hasDirectStageMutation(
  text: string,
): boolean {
  const compact =
    text.replace(
      /\s+/g,
      " ",
    );

  return (
    /\.from\s*\(\s*["']ai_model_versions["']\s*,?\s*\)[\s\S]{0,1200}\.update\s*\(\s*\{[\s\S]{0,900}promotion_stage\s*:/.test(
      text,
    ) ||
    /promotion_stage\s*:\s*[A-Za-z0-9_"']+[\s\S]{0,900}\.eq\s*\(\s*["']id["']/.test(
      compact,
    )
  );
}

function applyLikeNames(
  names: string[],
): string[] {
  return names.filter(
    (name) =>
      /(apply|promot|transition|set|update).*(stage|promotion)|(?:stage|promotion).*(apply|promot|transition|set|update)/i.test(
        name,
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
  const stateMachine =
    read(
      TARGET_FILES
        .stateMachine,
    );

  const promotionGate =
    read(
      TARGET_FILES
        .promotionGate,
    );

  const decisionService =
    read(
      TARGET_FILES
        .decisionService,
    );

  const automationFiles = [
    TARGET_FILES
      .automationRun,

    TARGET_FILES
      .automationCycle,

    TARGET_FILES
      .automationManual,
  ];

  const automationSources =
    automationFiles.map(
      (file) => ({
        file,
        source:
          read(file),
      }),
    );

  const allFiles = [
    ...walk(
      path.join(
        ROOT,
        "lib",
      ),
    ),

    ...walk(
      path.join(
        ROOT,
        "app",
      ),
    ),
  ];

  const promotionRelevant =
    allFiles
      .map(
        (full) => {
          const source =
            fs.readFileSync(
              full,
              "utf8",
            );

          return {
            file:
              relative(full),

            source,
          };
        },
      )
      .filter(
        ({ source }) =>
          /promotion_stage|model_promotion_events|ModelPromotionStage|promotion stage/i.test(
            source,
          ),
      );

  const directStageMutationFiles =
    promotionRelevant
      .filter(
        ({ source }) =>
          hasDirectStageMutation(
            source,
          ),
      )
      .map(
        ({ file, source }) => ({
          file,

          lines:
            linesMatching(
              source,
              [
                /ai_model_versions/,
                /\.update\s*\(/,
                /promotion_stage/,
                /promotion_stage_updated_at/,
                /promotion_stage_reason/,
              ],
            ),
        }),
      );

  const stateMachineExports =
    exportedFunctionNames(
      stateMachine,
    );

  const stateMachineApplyLike =
    applyLikeNames(
      stateMachineExports,
    );

  const gateExports =
    exportedFunctionNames(
      promotionGate,
    );

  const decisionExports =
    exportedFunctionNames(
      decisionService,
    );

  const automationReferencesStateMachine =
    automationSources
      .filter(
        ({ source }) =>
          source.includes(
            "model-promotion-state-machine",
          ) ||
          stateMachineApplyLike.some(
            (name) =>
              source.includes(
                name,
              ),
          ),
      )
      .map(
        ({ file, source }) => ({
          file,

          lines:
            linesMatching(
              source,
              [
                /model-promotion-state-machine/,
                /promotion_stage/,
                /promotion/i,
              ],
            ),
        }),
      );

  const automationDirectStageMutation =
    automationSources
      .filter(
        ({ source }) =>
          hasDirectStageMutation(
            source,
          ),
      )
      .map(
        ({ file, source }) => ({
          file,

          lines:
            linesMatching(
              source,
              [
                /ai_model_versions/,
                /\.update\s*\(/,
                /promotion_stage/,
              ],
            ),
        }),
      );

  const stateMachineSupportsShadowToPaper =
    stateMachine.includes(
      "SHADOW",
    ) &&
    stateMachine.includes(
      "PAPER",
    );

  const stateMachineHasTransitionEvaluation =
    /transition|allowed|requiresManualApproval/i.test(
      stateMachine,
    );

  const gateHasPaperStage =
    promotionGate.includes(
      "PAPER",
    );

  const decisionIsRecommendationOnly =
    decisionService.includes(
      "recommendationOnly",
    ) &&
    decisionService.includes(
      "promotionStageChanged",
    );

  const before = {
    promotionEvents:
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
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  const after = {
    promotionEvents:
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

  const controlsUnchanged =
    JSON.stringify(
      before.controls,
    ) ===
    JSON.stringify(
      after.controls,
    );

  const checks = {
    stateMachineExists:
      stateMachine.length >
      0,

    promotionGateExists:
      promotionGate.length >
      0,

    decisionServiceExists:
      decisionService.length >
      0,

    stateMachineSupportsShadowToPaper,

    stateMachineHasTransitionEvaluation,

    gateHasPaperStage,

    decisionServiceIsRecommendationOnly:
      decisionIsRecommendationOnly,

    noAutomationDirectStageMutation:
      automationDirectStageMutation
        .length ===
      0,

    noAutomationPromotionApplyReference:
      automationReferencesStateMachine
        .length ===
      0,

    currentModelStillShadow:
      model.promotion_stage ===
      "SHADOW",

    auditCreatedNoPromotionEvent:
      before.promotionEvents ===
      after.promotionEvents,

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    controlsUnchanged,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const required = [
    "stateMachineExists",
    "promotionGateExists",
    "decisionServiceExists",
    "stateMachineSupportsShadowToPaper",
    "stateMachineHasTransitionEvaluation",
    "gateHasPaperStage",
    "decisionServiceIsRecommendationOnly",
    "noAutomationDirectStageMutation",
    "noAutomationPromotionApplyReference",
    "currentModelStillShadow",
    "auditCreatedNoPromotionEvent",
    "noOrdersCreated",
    "noPositionsChanged",
    "controlsUnchanged",
    "realTradingStillOff",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const report = {
    status:
      failed.length ===
      0
        ? "MODEL_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_V1_VERIFIED"
        : "MODEL_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_V1_NEEDS_REVIEW",

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

    source: {
      files:
        TARGET_FILES,

      stateMachine: {
        exports:
          stateMachineExports,

        applyLikeExports:
          stateMachineApplyLike,

        relevantLines:
          linesMatching(
            stateMachine,
            [
              /SHADOW/,
              /PAPER/,
              /transition/i,
              /allowed/i,
              /requiresManualApproval/i,
              /promotion_stage/,
              /\.update\s*\(/,
            ],
          ),
      },

      promotionGate: {
        exports:
          gateExports,

        relevantLines:
          linesMatching(
            promotionGate,
            [
              /SHADOW/,
              /PAPER/,
              /promotion/i,
              /stage/i,
            ],
          ),
      },

      decisionService: {
        exports:
          decisionExports,

        relevantLines:
          linesMatching(
            decisionService,
            [
              /recommendationOnly/,
              /promotionStageChanged/,
              /SHADOW_PAPER/,
              /recordModelPromotionRecommendation/,
            ],
          ),
      },

      scannedSourceFiles:
        allFiles.length,

      promotionRelevantFiles:
        promotionRelevant
          .length,

      directStageMutationFiles,

      automationReferencesStateMachine,

      automationDirectStageMutation,
    },

    checks,

    failed,

    counts: {
      promotionEvents:
        String(
          before.promotionEvents,
        ) +
        "->" +
        String(
          after.promotionEvents,
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

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      promotionApplyExecuted:
        false,

      sourceFilesModified:
        0,

      promotionEventsCreated:
        after.promotionEvents -
        before.promotionEvents,

      ordersCreated:
        after.orders -
        before.orders,

      positionsChanged:
        after.positions -
        before.positions,

      controlsChanged:
        !controlsUnchanged,

      realTradingEnabledByScript:
        false,
    },

    interpretation: {
      directMutationSurfaceCount:
        directStageMutationFiles
          .length,

      automationApplyReferenceCount:
        automationReferencesStateMachine
          .length,

      note:
        directStageMutationFiles
          .length ===
        0
          ? "No runtime source in app/lib directly updates ai_model_versions.promotion_stage. Promotion remains recommendation-only until an explicit apply surface is implemented."
          : "One or more explicit stage mutation surfaces exist. Review listed files before any PAPER apply test.",
    },

    nextGate:
      failed.length ===
      0
        ? (
            directStageMutationFiles
              .length ===
            0
              ? "DESIGN_EXPLICIT_MANUAL_PAPER_PROMOTION_APPLY_SURFACE_FAIL_CLOSED"
              : "AUDIT_EXACT_DISCOVERED_STAGE_MUTATION_SURFACE_BEFORE_ANY_APPLY_TEST"
          )
        : "TRACE_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_FAILURE",
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
      "model-paper-promotion-apply-boundary-audit-v1.json",
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
            "MODEL_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            promotionApplyExecuted:
              false,

            sourceFilesModified:
              0,

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
