
import fs from "fs";
import path from "path";
import ts from "typescript";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

const ROOT = process.cwd();

const SERVICE_RELATIVE =
  "lib/models/model-promotion-decision-service.ts";

const SERVICE_FILE =
  path.join(
    ROOT,
    SERVICE_RELATIVE,
  );

function readSource(): string {
  if (
    !fs.existsSync(
      SERVICE_FILE,
    )
  ) {
    throw new Error(
      "PROMOTION_DECISION_SERVICE_NOT_FOUND",
    );
  }

  return fs.readFileSync(
    SERVICE_FILE,
    "utf8",
  );
}

function getFunctionSource(
  source: string,
  functionName: string,
) {
  const sf =
    ts.createSourceFile(
      SERVICE_FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  let node:
    ts.FunctionDeclaration |
    null =
      null;

  function visit(
    current: ts.Node,
  ) {
    if (node) {
      return;
    }

    if (
      ts.isFunctionDeclaration(
        current,
      ) &&
      current.name?.text ===
        functionName
    ) {
      node = current;
      return;
    }

    ts.forEachChild(
      current,
      visit,
    );
  }

  visit(sf);

  if (
    !node ||
    !node.body
  ) {
    return null;
  }

  return {
    text:
      source.slice(
        node.getStart(sf),
        node.end,
      ),

    start:
      sf.getLineAndCharacterOfPosition(
        node.getStart(sf),
      ).line + 1,

    end:
      sf.getLineAndCharacterOfPosition(
        node.end,
      ).line + 1,
  };
}

function extractFromTables(
  text: string,
): string[] {
  const tables =
    new Set<string>();

  const regex =
    /\.from\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {
    tables.add(
      match[1],
    );
  }

  return [
    ...tables,
  ];
}

function extractMutationTables(
  text: string,
) {
  const result: Array<{
    table: string;
    mutation:
      | "insert"
      | "update"
      | "upsert"
      | "delete";
  }> = [];

  const regex =
    /\.from\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {
    result.push({
      table:
        match[1],

      mutation:
        match[2] as
          | "insert"
          | "update"
          | "upsert"
          | "delete",
    });
  }

  return result;
}

function matchingLines(
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
      80,
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

async function getModel() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
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
    error ||
    !data
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        error?.message ??
        "NO_MODEL"
      ),
    );
  }

  return data;
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
  const source =
    readSource();

  const recordFunction =
    getFunctionSource(
      source,
      "recordModelPromotionRecommendation",
    );

  if (
    !recordFunction
  ) {
    throw new Error(
      "RECORD_MODEL_PROMOTION_RECOMMENDATION_NOT_FOUND",
    );
  }

  const functionText =
    recordFunction.text;

  const referencedTables =
    extractFromTables(
      functionText,
    );

  const mutations =
    extractMutationTables(
      functionText,
    );

  const mutationTables =
    [
      ...new Set(
        mutations.map(
          (item) =>
            item.table,
        ),
      ),
    ];

  const model =
    await getModel();

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

    stage:
      model.promotion_stage,

    stageUpdatedAt:
      model
        .promotion_stage_updated_at,
  };

  const usesRecommendationEvaluator =
    functionText.includes(
      "evaluateModelPromotionRecommendation",
    );

  const targetsPromotionEvents =
    referencedTables.includes(
      "model_promotion_events",
    );

  const insertsPromotionEvent =
    mutations.some(
      (item) =>
        item.table ===
          "model_promotion_events" &&
        item.mutation ===
          "insert",
    );

  const mutatesModelVersion =
    mutations.some(
      (item) =>
        item.table ===
          "ai_model_versions",
    );

  const mutatesOrders =
    mutations.some(
      (item) =>
        item.table ===
          "paper_order_requests",
    );

  const mutatesPositions =
    mutations.some(
      (item) =>
        item.table ===
          "paper_positions",
    );

  const mutatesControls =
    mutations.some(
      (item) =>
        item.table ===
          "trading_system_controls",
    );

  const callsPromotionApplySurface =
    /apply[A-Za-z0-9_]*Promotion|promote[A-Za-z0-9_]*Model|transition[A-Za-z0-9_]*PromotionStage|update[A-Za-z0-9_]*PromotionStage/.test(
      functionText,
    );

  const recordsDecision =
    /\bdecision\b/.test(
      functionText,
    );

  const recordsEvidence =
    /\bevidence\b/.test(
      functionText,
    );

  const recordsReason =
    /\breason\b/.test(
      functionText,
    );

  const recordsActor =
    /\bactor\b/.test(
      functionText,
    );

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

  const {
    data: modelAfter,
    error:
      modelAfterError,
  } =
    await createSupabaseServerClient()
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
      "MODEL_AFTER_READ_FAILED:" +
      (
        modelAfterError
          ?.message ??
        "NO_MODEL"
      ),
    );
  }

  const checks = {
    recordFunctionFound:
      true,

    usesRecommendationEvaluator,

    targetsPromotionEvents,

    insertsPromotionEvent,

    doesNotMutateModelVersion:
      !mutatesModelVersion,

    doesNotMutateOrders:
      !mutatesOrders,

    doesNotMutatePositions:
      !mutatesPositions,

    doesNotMutateControls:
      !mutatesControls,

    doesNotCallPromotionApplySurface:
      !callsPromotionApplySurface,

    recordsDecision,

    recordsEvidence,

    recordsReason,

    recordsActor,

    auditCreatedNoPromotionEvent:
      before.promotionEvents ===
      after.promotionEvents,

    auditCreatedNoOrders:
      before.orders ===
      after.orders,

    auditChangedNoPositions:
      before.positions ===
      after.positions,

    modelStageUnchanged:
      before.stage ===
        modelAfter
          .promotion_stage &&
      before.stageUpdatedAt ===
        modelAfter
          .promotion_stage_updated_at,

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

  const required = [
    "recordFunctionFound",
    "usesRecommendationEvaluator",
    "targetsPromotionEvents",
    "insertsPromotionEvent",
    "doesNotMutateModelVersion",
    "doesNotMutateOrders",
    "doesNotMutatePositions",
    "doesNotMutateControls",
    "doesNotCallPromotionApplySurface",
    "recordsDecision",
    "recordsEvidence",
    "recordsReason",
    "recordsActor",
    "auditCreatedNoPromotionEvent",
    "auditCreatedNoOrders",
    "auditChangedNoPositions",
    "modelStageUnchanged",
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
        ? "MODEL_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_AUDIT_V1_VERIFIED"
        : "MODEL_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_AUDIT_V1_FAILED",

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
      file:
        SERVICE_RELATIVE,

      function:
        "recordModelPromotionRecommendation",

      lineRange: {
        start:
          recordFunction.start,

        end:
          recordFunction.end,
      },

      referencedTables,

      mutations,

      mutationTables,

      usesRecommendationEvaluator,

      callsPromotionApplySurface,

      relevantLines:
        matchingLines(
          functionText,
          [
            /evaluateModelPromotionRecommendation/,
            /model_promotion_events/,
            /\.insert\s*\(/,
            /\.update\s*\(/,
            /\.upsert\s*\(/,
            /\.delete\s*\(/,
            /decision/,
            /evidence/,
            /reason/,
            /actor/,
            /promotion_stage/,
          ],
        ),
    },

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

    modelStage: {
      before:
        before.stage,

      after:
        modelAfter
          .promotion_stage,

      updatedAtBefore:
        before.stageUpdatedAt,

      updatedAtAfter:
        modelAfter
          .promotion_stage_updated_at,
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
      mode:
        "READ_ONLY_SOURCE_AND_DB_AUDIT",

      databaseWrites:
        0,

      recordFunctionExecuted:
        false,

      promotionEventCreated:
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
      failed.length === 0
        ? "RUN_ISOLATED_BLOCKED_RECOMMENDATION_RECORD_POSITIVE_PATH_WITH_CLEANUP"
        : "STOP_AND_PATCH_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_GAP",
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
      "model-promotion-recommendation-recording-safety-audit-v1.json",
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
            "MODEL_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_AUDIT_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            recordFunctionExecuted:
              false,

            promotionEventCreated:
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
