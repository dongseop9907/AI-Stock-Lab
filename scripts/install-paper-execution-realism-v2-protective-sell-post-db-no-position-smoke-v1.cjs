const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/paper-execution-realism-v2-protective-sell-post-db-no-position-smoke-v1.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true },
);

fs.writeFileSync(
  target,
  "import { createSupabaseServerClient } from \"../lib/supabase\";\nimport { checkAndExecuteStopLosses } from \"../lib/trading/check-stop-losses\";\nimport { updateTrailingStops } from \"../lib/trading/update-trailing-stops\";\n\nasync function countRows(\n  table: string,\n): Promise<number> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    count,\n    error,\n  } =\n    await supabase\n      .from(table)\n      .select(\"*\", {\n        count: \"exact\",\n        head: true,\n      });\n\n  if (error) {\n    throw new Error(\n      `COUNT_FAILED:${table}:${error.message}`,\n    );\n  }\n\n  return count ?? 0;\n}\n\nasync function readControl() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"trading_system_controls\",\n      )\n      .select(\n        \"emergency_stop,paper_order_enabled,real_order_enabled\",\n      )\n      .eq(\n        \"control_key\",\n        \"global\",\n      )\n      .maybeSingle();\n\n  if (error) {\n    throw new Error(\n      `CONTROL_READ_FAILED:${error.message}`,\n    );\n  }\n\n  if (!data) {\n    throw new Error(\n      \"CONTROL_ROW_MISSING\",\n    );\n  }\n\n  return data;\n}\n\nfunction sameControl(\n  a: any,\n  b: any,\n) {\n  return (\n    a.emergency_stop ===\n      b.emergency_stop &&\n    a.paper_order_enabled ===\n      b.paper_order_enabled &&\n    a.real_order_enabled ===\n      b.real_order_enabled\n  );\n}\n\nasync function main() {\n  const before = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n    protectiveAudit:\n      await countRows(\n        \"paper_protective_execution_fills_v2\",\n      ),\n    control:\n      await readControl(),\n  };\n\n  if (\n    before.positions !==\n      0\n  ) {\n    throw new Error(\n      `NO_POSITION_SMOKE_REQUIRES_ZERO_POSITIONS:${before.positions}`,\n    );\n  }\n\n  const stopLossResult =\n    await checkAndExecuteStopLosses();\n\n  const trailingResult =\n    await updateTrailingStops();\n\n  const after = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n    protectiveAudit:\n      await countRows(\n        \"paper_protective_execution_fills_v2\",\n      ),\n    control:\n      await readControl(),\n  };\n\n  const checks = {\n    startedWithZeroPositions:\n      before.positions ===\n      0,\n\n    stopLossCompleted:\n      stopLossResult !==\n      undefined,\n\n    trailingCompleted:\n      trailingResult !==\n      undefined,\n\n    noOrdersCreated:\n      after.orders ===\n      before.orders,\n\n    noPositionsCreated:\n      after.positions ===\n      before.positions,\n\n    noProtectiveFillsCreated:\n      after.protectiveAudit ===\n      before.protectiveAudit,\n\n    controlsUnchanged:\n      sameControl(\n        before.control,\n        after.control,\n      ),\n\n    realTradingStillOff:\n      after.control\n        .real_order_enabled ===\n      false,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, ok]) =>\n          !ok,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  const result = {\n    status:\n      failed.length ===\n        0\n        ? \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_VERIFIED\"\n        : \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_FAILED\",\n\n    services: {\n      stopLoss:\n        stopLossResult,\n      trailing:\n        trailingResult,\n    },\n\n    counts: {\n      orders:\n        `${before.orders}->${after.orders}`,\n      positions:\n        `${before.positions}->${after.positions}`,\n      protectiveAudit:\n        `${before.protectiveAudit}->${after.protectiveAudit}`,\n    },\n\n    checks,\n    failed,\n\n    control: {\n      emergency_stop:\n        after.control\n          .emergency_stop,\n      paper_order_enabled:\n        after.control\n          .paper_order_enabled,\n      real_order_enabled:\n        after.control\n          .real_order_enabled,\n    },\n\n    safety: {\n      ordersCreated:\n        after.orders -\n        before.orders,\n      positionsCreated:\n        after.positions -\n        before.positions,\n      protectiveFillsCreated:\n        after.protectiveAudit -\n        before.protectiveAudit,\n      realTradingEnabledByScript:\n        false,\n    },\n\n    nextGate:\n      failed.length ===\n        0\n        ? \"PAPER_EXECUTION_REALISM_V2_BUY_AND_PROTECTIVE_SELL_COMPLETE\"\n        : \"STOP_AND_DIAGNOSE\",\n  };\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n      0\n  ) {\n    process.exitCode =\n      1;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_FAILED\",\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n          safety: {\n            realTradingEnabledByScript:\n              false,\n          },\n          nextGate:\n            \"STOP_AND_DIAGNOSE\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      1;\n  },\n);\n",
  "utf8",
);

console.log(JSON.stringify({
  status:
    "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_INSTALLED",
  generatedFile:
    "scripts/paper-execution-realism-v2-protective-sell-post-db-no-position-smoke-v1.ts",
  mode:
    "LIVE_DB_READS_WITH_ZERO_POSITION_SERVICE_NO_OP",
  safety: {
    createsOrders: false,
    createsPositions: false,
    changesControls: false,
    changesRealTradingSetting: false
  },
  nextAction:
    "RUN_POST_DB_NO_POSITION_SMOKE_V1"
}, null, 2));
