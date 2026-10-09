const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "model-promotion-manual-apply-route-dry-run-contract-v1.ts",
);

const source = "\nimport {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nimport {\n  POST,\n} from \"@/app/api/models/promotion/apply/route\";\n\nimport {\n  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,\n} from \"@/lib/models/model-promotion-manual-apply\";\n\nasync function countRows(\n  table: string,\n): Promise<number> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    count,\n    error,\n  } =\n    await supabase\n      .from(table)\n      .select(\"*\", {\n        count:\n          \"exact\",\n\n        head:\n          true,\n      });\n\n  if (error) {\n    throw new Error(\n      \"COUNT_FAILED:\" +\n      table +\n      \":\" +\n      error.message,\n    );\n  }\n\n  return count ?? 0;\n}\n\nasync function getControls() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"trading_system_controls\",\n      )\n      .select(\n        \"control_key,emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled\"\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (error) {\n    throw new Error(\n      \"CONTROL_READ_FAILED:\" +\n      error.message,\n    );\n  }\n\n  return data;\n}\n\nasync function callRoute(\n  body: Record<string, unknown>,\n) {\n  const request =\n    new Request(\n      \"http://localhost/api/models/promotion/apply\",\n      {\n        method:\n          \"POST\",\n\n        headers: {\n          \"content-type\":\n            \"application/json\",\n        },\n\n        body:\n          JSON.stringify(\n            body,\n          ),\n      },\n    );\n\n  const response =\n    await POST(\n      request,\n    );\n\n  let payload:\n    unknown =\n      null;\n\n  try {\n    payload =\n      await response.json();\n  } catch {\n    payload =\n      null;\n  }\n\n  return {\n    status:\n      response.status,\n\n    payload,\n  };\n}\n\nasync function main() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data: model,\n    error: modelError,\n  } =\n    await supabase\n      .from(\n        \"ai_model_versions\",\n      )\n      .select(\n        \"id,purpose,status,promotion_stage,promotion_stage_updated_at\"\n      )\n      .eq(\n        \"purpose\",\n        \"ENTRY_TIMING\",\n      )\n      .eq(\n        \"promotion_stage\",\n        \"SHADOW\",\n      )\n      .order(\n        \"promotion_stage_updated_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    modelError ||\n    !model\n  ) {\n    throw new Error(\n      \"ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND\",\n    );\n  }\n\n  const before = {\n    events:\n      await countRows(\n        \"model_promotion_events\",\n      ),\n\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n\n    controls:\n      await getControls(),\n  };\n\n  const base = {\n    modelId:\n      model.id,\n\n    toStage:\n      \"PAPER\",\n\n    actor:\n      \"MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1\",\n\n    dryRun:\n      true,\n  };\n\n  const noApproval =\n    await callRoute({\n      ...base,\n\n      manualApprovalConfirmed:\n        false,\n\n      confirmationPhrase:\n        \"\",\n\n      reason:\n        \"NO_APPROVAL_DRY_RUN\",\n    });\n\n  const wrongPhrase =\n    await callRoute({\n      ...base,\n\n      manualApprovalConfirmed:\n        true,\n\n      confirmationPhrase:\n        \"PROMOTE\",\n\n      reason:\n        \"WRONG_PHRASE_DRY_RUN\",\n    });\n\n  const correctPhrase =\n    await callRoute({\n      ...base,\n\n      manualApprovalConfirmed:\n        true,\n\n      confirmationPhrase:\n        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,\n\n      reason:\n        \"CORRECT_PHRASE_NO_EVIDENCE_DRY_RUN\",\n    });\n\n  const {\n    data: modelAfter,\n    error: modelAfterError,\n  } =\n    await supabase\n      .from(\n        \"ai_model_versions\",\n      )\n      .select(\n        \"id,promotion_stage,promotion_stage_updated_at\"\n      )\n      .eq(\n        \"id\",\n        model.id,\n      )\n      .single();\n\n  if (\n    modelAfterError ||\n    !modelAfter\n  ) {\n    throw new Error(\n      \"MODEL_AFTER_READ_FAILED\",\n    );\n  }\n\n  const after = {\n    events:\n      await countRows(\n        \"model_promotion_events\",\n      ),\n\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n\n    controls:\n      await getControls(),\n  };\n\n  function getReason(\n    result: {\n      status: number;\n      payload: unknown;\n    },\n  ) {\n    if (\n      !result.payload ||\n      typeof result.payload !==\n        \"object\"\n    ) {\n      return null;\n    }\n\n    const payload =\n      result.payload as\n        Record<string, unknown>;\n\n    const preflight =\n      payload.preflight;\n\n    if (\n      !preflight ||\n      typeof preflight !==\n        \"object\"\n    ) {\n      return null;\n    }\n\n    return (\n      preflight as\n        Record<string, unknown>\n    ).reason ?? null;\n  }\n\n  function getAllowed(\n    result: {\n      status: number;\n      payload: unknown;\n    },\n  ) {\n    if (\n      !result.payload ||\n      typeof result.payload !==\n        \"object\"\n    ) {\n      return null;\n    }\n\n    const payload =\n      result.payload as\n        Record<string, unknown>;\n\n    const preflight =\n      payload.preflight;\n\n    if (\n      !preflight ||\n      typeof preflight !==\n        \"object\"\n    ) {\n      return null;\n    }\n\n    return (\n      preflight as\n        Record<string, unknown>\n    ).allowed ?? null;\n  }\n\n  function getDryRun(\n    result: {\n      status: number;\n      payload: unknown;\n    },\n  ) {\n    if (\n      !result.payload ||\n      typeof result.payload !==\n        \"object\"\n    ) {\n      return null;\n    }\n\n    return (\n      result.payload as\n        Record<string, unknown>\n    ).dryRun ?? null;\n  }\n\n  const checks = {\n    noApprovalHttp200:\n      noApproval.status ===\n      200,\n\n    noApprovalDryRunEcho:\n      getDryRun(\n        noApproval,\n      ) ===\n      true,\n\n    noApprovalBlocked:\n      getAllowed(\n        noApproval,\n      ) ===\n        false &&\n      getReason(\n        noApproval,\n      ) ===\n        \"MANUAL_APPROVAL_REQUIRED\",\n\n    wrongPhraseHttp200:\n      wrongPhrase.status ===\n      200,\n\n    wrongPhraseDryRunEcho:\n      getDryRun(\n        wrongPhrase,\n      ) ===\n      true,\n\n    wrongPhraseBlocked:\n      getAllowed(\n        wrongPhrase,\n      ) ===\n        false &&\n      getReason(\n        wrongPhrase,\n      ) ===\n        \"EXPLICIT_CONFIRMATION_REQUIRED\",\n\n    correctPhraseHttp200:\n      correctPhrase.status ===\n      200,\n\n    correctPhraseDryRunEcho:\n      getDryRun(\n        correctPhrase,\n      ) ===\n      true,\n\n    correctPhraseStillBlockedWithoutCanonicalEvidence:\n      getAllowed(\n        correctPhrase,\n      ) ===\n        false &&\n      getReason(\n        correctPhrase,\n      ) ===\n        \"CANONICAL_OUTCOME_EVIDENCE_NOT_READY\",\n\n    modelStageUnchanged:\n      modelAfter\n        .promotion_stage ===\n      model\n        .promotion_stage,\n\n    modelStageTimestampUnchanged:\n      modelAfter\n        .promotion_stage_updated_at ===\n      model\n        .promotion_stage_updated_at,\n\n    noPromotionEventsCreated:\n      before.events ===\n      after.events,\n\n    noOrdersCreated:\n      before.orders ===\n      after.orders,\n\n    noPositionsChanged:\n      before.positions ===\n      after.positions,\n\n    controlsUnchanged:\n      JSON.stringify(\n        before.controls,\n      ) ===\n      JSON.stringify(\n        after.controls,\n      ),\n\n    realTradingStillOff:\n      after.controls\n        ?.real_order_enabled ===\n      false,\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  const report = {\n    status:\n      failed.length ===\n      0\n        ? \"MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_VERIFIED\"\n        : \"MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_FAILED\",\n\n    model: {\n      id:\n        model.id,\n\n      purpose:\n        model.purpose,\n\n      legacyStatus:\n        model.status,\n\n      promotionStage:\n        model.promotion_stage,\n\n      promotionStageUpdatedAt:\n        model\n          .promotion_stage_updated_at,\n    },\n\n    contract: {\n      endpoint:\n        \"/api/models/promotion/apply\",\n\n      method:\n        \"POST\",\n\n      dryRun:\n        true,\n\n      requiredConfirmationPhrase:\n        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,\n\n      expectedBlockingOrder: [\n        \"MANUAL_APPROVAL_REQUIRED\",\n        \"EXPLICIT_CONFIRMATION_REQUIRED\",\n        \"CANONICAL_OUTCOME_EVIDENCE_NOT_READY\"\n      ],\n    },\n\n    cases: {\n      noApproval,\n      wrongPhrase,\n      correctPhrase,\n    },\n\n    counts: {\n      promotionEvents:\n        String(\n          before.events,\n        ) +\n        \"->\" +\n        String(\n          after.events,\n        ),\n\n      orders:\n        String(\n          before.orders,\n        ) +\n        \"->\" +\n        String(\n          after.orders,\n        ),\n\n      positions:\n        String(\n          before.positions,\n        ) +\n        \"->\" +\n        String(\n          after.positions,\n        ),\n    },\n\n    controls: {\n      before:\n        before.controls,\n\n      after:\n        after.controls,\n    },\n\n    checks,\n\n    failed,\n\n    safety: {\n      routeHandlerExecuted:\n        true,\n\n      dryRunOnly:\n        true,\n\n      databaseWrites:\n        0,\n\n      promotionApplied:\n        false,\n\n      promotionEventsCreated:\n        after.events -\n        before.events,\n\n      ordersCreated:\n        after.orders -\n        before.orders,\n\n      positionsChanged:\n        after.positions -\n        before.positions,\n\n      controlsChanged:\n        JSON.stringify(\n          before.controls,\n        ) !==\n        JSON.stringify(\n          after.controls,\n        ),\n\n      realTradingEnabledByScript:\n        false,\n    },\n\n    nextGate:\n      failed.length ===\n      0\n        ? \"KEEP_SHADOW_WAIT_FOR_FIRST_REAL_POST_SHADOW_SIGNAL_AND_CANONICAL_LIFECYCLE\"\n        : \"STOP_AND_INSPECT_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT\",\n  };\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length ===\n    0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_FAILED\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            promotionApplied:\n              false,\n\n            orderCreation:\n              false,\n\n            positionChange:\n              false,\n\n            controlsChange:\n              false,\n\n            realTradingEnable:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      1;\n  },\n);\n";

fs.writeFileSync(
  target,
  source,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_INSTALLED",

      generatedFile:
        "scripts/model-promotion-manual-apply-route-dry-run-contract-v1.ts",

      mode:
        "API_ROUTE_HANDLER_DRY_RUN_ONLY",

      verification: [
        "NO_APPROVAL_BLOCKED",
        "WRONG_CONFIRMATION_PHRASE_BLOCKED",
        "CORRECT_PHRASE_STILL_BLOCKED_WITHOUT_CANONICAL_EVIDENCE",
        "MODEL_STAGE_UNCHANGED",
        "NO_PROMOTION_EVENT_WRITE",
        "NO_ORDER_CHANGE",
        "NO_POSITION_CHANGE",
        "CONTROLS_UNCHANGED",
        "REAL_TRADING_OFF"
      ],

      safety: {
        routeHandlerExecuted:
          true,

        dryRunOnly:
          true,

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

      nextAction:
        "RUN_ROUTE_DRY_RUN_CONTRACT",
    },
    null,
    2,
  ),
);
