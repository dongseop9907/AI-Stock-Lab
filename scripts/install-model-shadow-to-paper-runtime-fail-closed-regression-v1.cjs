const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "model-shadow-to-paper-runtime-fail-closed-regression-v1.ts",
);

const source = String.raw`
import fs from "fs";
import path from "path";
import ts from "typescript";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  collectModelPromotionEvidence,
  evaluateModelPromotionRecommendation,
} from "@/lib/models/model-promotion-decision-service";

const ROOT = process.cwd();

const SERVICE_FILE =
  path.join(
    ROOT,
    "lib",
    "models",
    "model-promotion-decision-service.ts",
  );

function readServiceSource(): string {
  return fs.readFileSync(
    SERVICE_FILE,
    "utf8",
  );
}

function getFunctionParameterNames(
  source: string,
  functionName: string,
): string[] {
  const sf =
    ts.createSourceFile(
      SERVICE_FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  let found: string[] = [];

  function visit(
    node: ts.Node,
  ) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text ===
        functionName
    ) {
      found =
        node.parameters.map(
          (parameter) =>
            parameter.name.getText(
              sf,
            ),
        );

      return;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sf);

  return found;
}

function getFunctionSnippet(
  source: string,
  functionName: string,
): string | null {
  const sf =
    ts.createSourceFile(
      SERVICE_FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  let snippet:
    string | null =
      null;

  function visit(
    node: ts.Node,
  ) {
    if (
      snippet !== null
    ) {
      return;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text ===
        functionName
    ) {
      snippet =
        source.slice(
          node.getStart(sf),
          Math.min(
            node.end,
            node.getStart(sf) +
              7000,
          ),
        );

      return;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sf);

  return snippet;
}

function pickRuntimeArgs(
  parameterNames: string[],
  input: {
    modelId: string;
    promotionStage: string;
    evidence:
      unknown;
  },
): unknown[] {
  return parameterNames.map(
    (rawName) => {
      const name =
        rawName
          .replace(
            /[^A-Za-z0-9_]/g,
            "",
          )
          .toLowerCase();

      if (
        name.includes(
          "evidence",
        ) ||
        name.includes(
          "snapshot",
        )
      ) {
        return input.evidence;
      }

      if (
        name.includes(
          "modelid",
        ) ||
        name === "id"
      ) {
        return input.modelId;
      }

      if (
        name.includes(
          "stage",
        )
      ) {
        return input.promotionStage;
      }

      /*
       * Unknown optional argument:
       * pass undefined rather than fabricating data.
       */
      return undefined;
    },
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

  const before = {
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

  const evidence =
    await collectModelPromotionEvidence(
      model.id,
    );

  const canonicalReady =
    (
      evidence as
        Record<string, unknown>
    )
      .canonicalShadowOutcomeEvidenceReady;

  const source =
    readServiceSource();

  const parameterNames =
    getFunctionParameterNames(
      source,
      "evaluateModelPromotionRecommendation",
    );

  if (
    parameterNames.length === 0
  ) {
    throw new Error(
      "PROMOTION_RECOMMENDATION_PARAMETERS_NOT_FOUND",
    );
  }

  const runtimeArgs =
    pickRuntimeArgs(
      parameterNames,
      {
        modelId:
          model.id,

        promotionStage:
          model.promotion_stage,

        evidence,
      },
    );

  const recommendation =
    await Promise.resolve(
      (
        evaluateModelPromotionRecommendation as
          (...args: unknown[]) =>
            unknown
      )(
        ...runtimeArgs,
      ),
    );

  const recommendationJson =
    JSON.stringify(
      recommendation,
    );

  const hasCanonicalNotReadyReason =
    recommendationJson.includes(
      "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
    );

  const reportsPaperApplied =
    /"paperPromotionApplied"\s*:\s*true/i.test(
      recommendationJson,
    ) ||
    /"promotionApplied"\s*:\s*true/i.test(
      recommendationJson,
    ) ||
    /"applied"\s*:\s*true/i.test(
      recommendationJson,
    );

  const hasAllowedTrue =
    /"allowed"\s*:\s*true/i.test(
      recommendationJson,
    );

  const after = {
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

  const countsUnchanged =
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

  const checks = {
    entryTimingShadowModelFound:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    canonicalEvidenceReadyIsFalse:
      canonicalReady ===
        false,

    recommendationFunctionResolved:
      parameterNames.length >
        0,

    runtimeRecommendationReturned:
      recommendation !==
        undefined,

    canonicalNotReadyReasonReturned:
      hasCanonicalNotReadyReason,

    noAppliedPaperPromotionReported:
      !reportsPaperApplied,

    recommendationNotAllowed:
      !hasAllowedTrue,

    databaseCountsUnchanged:
      countsUnchanged,

    controlsUnchanged,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const required = [
    "entryTimingShadowModelFound",
    "canonicalEvidenceReadyIsFalse",
    "recommendationFunctionResolved",
    "runtimeRecommendationReturned",
    "canonicalNotReadyReasonReturned",
    "noAppliedPaperPromotionReported",
    "recommendationNotAllowed",
    "databaseCountsUnchanged",
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
      failed.length === 0
        ? "MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_VERIFIED"
        : "MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_FAILED",

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
        model
          .promotion_stage_updated_at,
    },

    evidence: {
      canonicalShadowOutcomeEvidenceReady:
        canonicalReady,

      raw:
        evidence,
    },

    runtime: {
      function:
        "evaluateModelPromotionRecommendation",

      parameterNames,

      argumentKinds:
        parameterNames.map(
          (
            parameter,
            index,
          ) => ({
            parameter,
            valueType:
              runtimeArgs[index] ===
                null
                ? "null"
                : typeof runtimeArgs[
                    index
                  ],
          }),
        ),

      recommendation,

      canonicalNotReadyReasonReturned:
        hasCanonicalNotReadyReason,

      reportsPaperApplied,

      hasAllowedTrue,

      sourceSnippet:
        getFunctionSnippet(
          source,
          "evaluateModelPromotionRecommendation",
        ),
    },

    counts: {
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

      recommendationRecorded:
        false,

      promotionApplied:
        false,

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

    nextGate:
      failed.length === 0
        ? "AUDIT_PROMOTION_RECOMMENDATION_RECORDING_IS_RECOMMENDATION_ONLY_AND_NON_PROMOTING"
        : "STOP_AND_INSPECT_RUNTIME_SHADOW_TO_PAPER_FAIL_CLOSED_GAP",
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
      "model-shadow-to-paper-runtime-fail-closed-regression-v1.json",
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
            "MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            recommendationRecorded:
              false,

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

    process.exitCode = 1;
  },
);
`;

fs.writeFileSync(
  target,
  source,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_INSTALLED",

      generatedFile:
        "scripts/model-shadow-to-paper-runtime-fail-closed-regression-v1.ts",

      mode:
        "READ_ONLY_RUNTIME_PROMOTION_RECOMMENDATION_REGRESSION",

      verification: [
        "COLLECT_REAL_PROMOTION_EVIDENCE",
        "CANONICAL_READY_FALSE",
        "EXECUTE_RECOMMENDATION_FUNCTION_ONLY",
        "CANONICAL_NOT_READY_REASON",
        "NO_PROMOTION_APPLY",
        "NO_RECOMMENDATION_RECORD_WRITE",
        "NO_ORDER_CHANGE",
        "NO_POSITION_CHANGE",
        "CONTROLS_UNCHANGED",
        "REAL_TRADING_OFF"
      ],

      safety: {
        databaseWrites:
          0,

        recommendationRecorded:
          false,

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
        "RUN_RUNTIME_FAIL_CLOSED_REGRESSION",
    },
    null,
    2,
  ),
);
