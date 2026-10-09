const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/model-order-purpose-gate-regression-v1.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true },
);

fs.writeFileSync(
  target,
  "import {\n  resolveOrderModel,\n} from \"../lib/models/resolve-order-model\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst TEST_MODEL_ID =\n  \"4ad531c1-021e-4787-9e32-ec91600ba740\";\n\nconst ENTRY_MODEL_ID =\n  \"3045646b-599b-41cd-9650-43e539fb7a95\";\n\nasync function countRows(\n  table: string,\n): Promise<number> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    count,\n    error,\n  } =\n    await supabase\n      .from(table)\n      .select(\"*\", {\n        count: \"exact\",\n        head: true,\n      });\n\n  if (error) {\n    throw new Error(\n      `COUNT_FAILED:${table}:${error.message}`,\n    );\n  }\n\n  return count ?? 0;\n}\n\nasync function readControls() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"trading_system_controls\",\n      )\n      .select(\n        \"emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled\",\n      )\n      .eq(\n        \"control_key\",\n        \"global\",\n      )\n      .single();\n\n  if (\n    error ||\n    !data\n  ) {\n    throw new Error(\n      `CONTROL_READ_FAILED:${\n        error?.message ??\n        \"NOT_FOUND\"\n      }`,\n    );\n  }\n\n  return data;\n}\n\nasync function readModels() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"ai_model_versions\",\n      )\n      .select(\n        \"id,model_name,purpose,status,promotion_stage\",\n      )\n      .in(\n        \"id\",\n        [\n          TEST_MODEL_ID,\n          ENTRY_MODEL_ID,\n        ],\n      );\n\n  if (error) {\n    throw new Error(\n      `MODEL_READ_FAILED:${error.message}`,\n    );\n  }\n\n  return data ?? [];\n}\n\nfunction sameControls(\n  a: any,\n  b: any,\n) {\n  return (\n    a?.emergency_stop ===\n      b?.emergency_stop &&\n    a?.automation_enabled ===\n      b?.automation_enabled &&\n    a?.paper_order_enabled ===\n      b?.paper_order_enabled &&\n    a?.real_order_enabled ===\n      b?.real_order_enabled\n  );\n}\n\nasync function main() {\n  const models =\n    await readModels();\n\n  const testModel =\n    models.find(\n      (row) =>\n        row.id ===\n        TEST_MODEL_ID,\n    );\n\n  const entryModel =\n    models.find(\n      (row) =>\n        row.id ===\n        ENTRY_MODEL_ID,\n    );\n\n  if (!testModel) {\n    throw new Error(\n      \"TEST_MODEL_NOT_FOUND\",\n    );\n  }\n\n  if (!entryModel) {\n    throw new Error(\n      \"ENTRY_MODEL_NOT_FOUND\",\n    );\n  }\n\n  if (\n    testModel.purpose !==\n      \"TEST\"\n  ) {\n    throw new Error(\n      `EXPECTED_TEST_PURPOSE:${testModel.purpose}`,\n    );\n  }\n\n  if (\n    testModel.promotion_stage !==\n      \"PAPER\"\n  ) {\n    throw new Error(\n      `EXPECTED_TEST_MODEL_PAPER_STAGE:${testModel.promotion_stage}`,\n    );\n  }\n\n  const beforeControls =\n    await readControls();\n\n  const [\n    beforeOrders,\n    beforePositions,\n    beforeEvents,\n  ] =\n    await Promise.all([\n      countRows(\n        \"paper_order_requests\",\n      ),\n      countRows(\n        \"paper_positions\",\n      ),\n      countRows(\n        \"model_promotion_events\",\n      ),\n    ]);\n\n  let blocked = false;\n  let blockMessage:\n    string | null = null;\n\n  try {\n    await resolveOrderModel(\n      TEST_MODEL_ID,\n      \"PAPER\",\n    );\n  } catch (error) {\n    blocked = true;\n    blockMessage =\n      error instanceof Error\n        ? error.message\n        : String(error);\n  }\n\n  const afterControls =\n    await readControls();\n\n  const [\n    afterOrders,\n    afterPositions,\n    afterEvents,\n  ] =\n    await Promise.all([\n      countRows(\n        \"paper_order_requests\",\n      ),\n      countRows(\n        \"paper_positions\",\n      ),\n      countRows(\n        \"model_promotion_events\",\n      ),\n    ]);\n\n  const checks = {\n    testModelPurposeIsTest:\n      testModel.purpose ===\n        \"TEST\",\n\n    testModelPromotionStageIsPaper:\n      testModel.promotion_stage ===\n        \"PAPER\",\n\n    resolverBlocksTestPurpose:\n      blocked ===\n        true,\n\n    noOrdersCreated:\n      afterOrders ===\n        beforeOrders,\n\n    noPositionsChanged:\n      afterPositions ===\n        beforePositions,\n\n    promotionEventsUnchanged:\n      afterEvents ===\n        beforeEvents,\n\n    controlsUnchanged:\n      sameControls(\n        beforeControls,\n        afterControls,\n      ),\n\n    realTradingStillOff:\n      afterControls.real_order_enabled ===\n        false,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, ok]) => !ok,\n      )\n      .map(\n        ([name]) => name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_VERIFIED\"\n            : \"MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_FAILED\",\n\n        testModel: {\n          id:\n            testModel.id,\n          name:\n            testModel.model_name,\n          purpose:\n            testModel.purpose,\n          legacyStatus:\n            testModel.status,\n          promotionStage:\n            testModel.promotion_stage,\n        },\n\n        resolver: {\n          tradingMode:\n            \"PAPER\",\n          blocked,\n          blockMessage,\n        },\n\n        counts: {\n          orders:\n            `${beforeOrders}->${afterOrders}`,\n          positions:\n            `${beforePositions}->${afterPositions}`,\n          promotionEvents:\n            `${beforeEvents}->${afterEvents}`,\n        },\n\n        controls: {\n          before:\n            beforeControls,\n          after:\n            afterControls,\n        },\n\n        checks,\n        failed,\n\n        safety: {\n          databaseWrites:\n            0,\n          ordersCreated:\n            afterOrders -\n            beforeOrders,\n          positionsChanged:\n            afterPositions -\n            beforePositions,\n          controlsChanged:\n            !sameControls(\n              beforeControls,\n              afterControls,\n            ),\n          realTradingChanged:\n            false,\n        },\n\n        nextGate:\n          failed.length === 0\n            ? \"PURPOSE_GATE_ALREADY_HARDENED_CONTINUE_SHADOW_EVIDENCE_LIFECYCLE\"\n            : \"PATCH_RESOLVE_ORDER_MODEL_TO_REQUIRE_ENTRY_TIMING_PURPOSE\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n      0\n  ) {\n    process.exitCode = 1;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_FAILED\",\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n          safety: {\n            databaseWrites:\n              0,\n            realTradingChanged:\n              false,\n          },\n          nextGate:\n            \"STOP_AND_DIAGNOSE_PURPOSE_GATE\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_INSTALLED",
      generatedFile:
        "scripts/model-order-purpose-gate-regression-v1.ts",
      mode:
        "READ_ONLY_RESOLVER_REGRESSION",
      target: {
        modelId:
          "4ad531c1-021e-4787-9e32-ec91600ba740",
        purpose:
          "TEST",
        promotionStage:
          "PAPER",
        tradingMode:
          "PAPER"
      },
      invariant:
        "TEST_PURPOSE_MODEL_MUST_BE_BLOCKED_EVEN_IF_PROMOTION_STAGE_IS_PAPER",
      safety: {
        databaseWrites:
          0,
        orderCreation:
          false,
        positionChange:
          false,
        promotionChange:
          false,
        controlsChange:
          false,
        realTradingEnable:
          false
      },
      nextAction:
        "RUN_PURPOSE_GATE_REGRESSION"
    },
    null,
    2,
  ),
);
