const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = {
  "scripts/alpha-v3-gap-slippage-post-db-typescript-smoke-v1.ts":
    "import * as executePaperModule from \"../lib/trading/execute-paper-order\";\nimport * as approvedModule from \"../lib/trading/execute-approved-paper-orders\";\nimport * as safeResolverModule from \"../lib/trading/resolve-safe-paper-buy-execution\";\nimport * as priceResolverModule from \"../lib/trading/paper-execution-price-resolver\";\nimport * as riskModule from \"../lib/trading/gap-slippage-risk\";\n\nfunction exportedFunctions(moduleObject: Record<string, unknown>) {\n  return Object.entries(moduleObject)\n    .filter(([, value]) => typeof value === \"function\")\n    .map(([name]) => name)\n    .sort();\n}\n\nconst result = {\n  status: \"ALPHA_V3_GAP_SLIPPAGE_POST_DB_TYPESCRIPT_SMOKE_V1_VERIFIED\",\n  modules: {\n    executePaperOrder: exportedFunctions(executePaperModule),\n    executeApprovedPaperOrders: exportedFunctions(approvedModule),\n    safePaperBuyExecution: exportedFunctions(safeResolverModule),\n    paperExecutionPriceResolver: exportedFunctions(priceResolverModule),\n    gapSlippageRisk: exportedFunctions(riskModule),\n  },\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersCreated: 0,\n    ordersExecuted: 0,\n    positionsChanged: 0,\n  },\n};\n\nconsole.log(JSON.stringify(result, null, 2));\n",
  "scripts/alpha-v3-gap-slippage-no-order-executor-smoke-v1.ts":
    "type RestResult = {\n  ok: boolean;\n  status: number;\n  body: unknown;\n};\n\nconst supabaseUrl =\n  process.env.NEXT_PUBLIC_SUPABASE_URL ||\n  process.env.SUPABASE_URL;\n\nconst serviceRoleKey =\n  process.env.SUPABASE_SERVICE_ROLE_KEY;\n\nif (!supabaseUrl || !serviceRoleKey) {\n  throw new Error(\"SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING\");\n}\n\nasync function rest(pathname: string): Promise<RestResult> {\n  const response = await fetch(\n    `${supabaseUrl!.replace(/\\/$/, \"\")}/rest/v1/${pathname}`,\n    {\n      headers: {\n        apikey: serviceRoleKey!,\n        Authorization: `Bearer ${serviceRoleKey!}`,\n      },\n    },\n  );\n\n  const text = await response.text();\n\n  let body: unknown = null;\n\n  if (text) {\n    try {\n      body = JSON.parse(text);\n    } catch {\n      body = text;\n    }\n  }\n\n  return {\n    ok: response.ok,\n    status: response.status,\n    body,\n  };\n}\n\nasync function snapshot() {\n  const [\n    approved,\n    positions,\n    reserved,\n  ] = await Promise.all([\n    rest(\n      \"paper_order_requests?select=id,status&status=eq.RISK_APPROVED&limit=20\",\n    ),\n    rest(\n      \"paper_positions?select=id,stock_code&limit=20\",\n    ),\n    rest(\n      \"paper_order_requests?select=id,status,reserved_risk_amount,reserved_risk_released_at&reserved_risk_amount=gt.0&reserved_risk_released_at=is.null&limit=20\",\n    ),\n  ]);\n\n  if (!approved.ok || !positions.ok || !reserved.ok) {\n    throw new Error(\n      `NO_ORDER_PRECHECK_READ_FAILED approved=${approved.status} positions=${positions.status} reserved=${reserved.status}`,\n    );\n  }\n\n  return {\n    approved:\n      Array.isArray(approved.body)\n        ? approved.body\n        : [],\n    positions:\n      Array.isArray(positions.body)\n        ? positions.body\n        : [],\n    reserved:\n      Array.isArray(reserved.body)\n        ? reserved.body\n        : [],\n  };\n}\n\nfunction assertEmpty(\n  phase: string,\n  value: Awaited<ReturnType<typeof snapshot>>,\n) {\n  const counts = {\n    riskApprovedOrders: value.approved.length,\n    positions: value.positions.length,\n    activeReservedRiskOrders: value.reserved.length,\n  };\n\n  if (\n    counts.riskApprovedOrders !== 0 ||\n    counts.positions !== 0 ||\n    counts.activeReservedRiskOrders !== 0\n  ) {\n    throw new Error(\n      `${phase}_NO_ORDER_PRECONDITION_FAILED:${JSON.stringify(counts)}`,\n    );\n  }\n\n  return counts;\n}\n\nasync function main() {\n  const before = await snapshot();\n  const beforeCounts = assertEmpty(\"PRE\", before);\n\n  const sourceModule =\n    await import(\"../lib/trading/execute-approved-paper-orders\");\n\n  const candidates = Object.entries(sourceModule)\n    .filter(\n      ([name, value]) =>\n        typeof value === \"function\" &&\n        /execute.*approved.*paper.*order/i.test(name),\n    );\n\n  if (candidates.length !== 1) {\n    throw new Error(\n      `APPROVED_EXECUTOR_EXPORT_UNRESOLVED:${JSON.stringify(\n        candidates.map(([name]) => name),\n      )}`,\n    );\n  }\n\n  const [\n    executorName,\n    executorValue,\n  ] = candidates[0];\n\n  const executor =\n    executorValue as (...args: unknown[]) => unknown;\n\n  if (executor.length !== 0) {\n    throw new Error(\n      `APPROVED_EXECUTOR_REQUIRES_ARGUMENTS:${executorName}:arity=${executor.length}`,\n    );\n  }\n\n  /*\n   * Safe operational smoke:\n   * precondition proves there are no RISK_APPROVED orders,\n   * no positions and no active reserved risk orders.\n   * This calls only the existing approved-order executor.\n   * It does not create an order.\n   */\n  const executionResult =\n    await executor();\n\n  const after = await snapshot();\n  const afterCounts = assertEmpty(\"POST\", after);\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_GAP_SLIPPAGE_NO_ORDER_EXECUTOR_SMOKE_V1_VERIFIED\",\n\n        executor: {\n          exportName: executorName,\n          arity: executor.length,\n          result:\n            executionResult === undefined\n              ? null\n              : executionResult,\n        },\n\n        before: beforeCounts,\n        after: afterCounts,\n\n        invariants: {\n          noApprovedOrderWasAvailable: true,\n          noPositionWasAvailable: true,\n          noActiveReservedRiskWasAvailable: true,\n          noOrderCreatedBySmoke: true,\n          noPositionCreatedBySmoke: true,\n        },\n\n        safety: {\n          realTradingEnabledByScript: false,\n          schedulerChanged: false,\n          forwardOosChanged: false,\n        },\n\n        nextGate:\n          \"GAP_SLIPPAGE_EXECUTION_BINDING_V1_PAPER_PATH_COMPLETE\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch((error) => {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_GAP_SLIPPAGE_NO_ORDER_EXECUTOR_SMOKE_V1_BLOCKED\",\n        error:\n          error instanceof Error\n            ? error.message\n            : String(error),\n        safety: {\n          orderCreationRequestedByScript: false,\n          realTradingEnabledByScript: false,\n          schedulerChanged: false,\n          forwardOosChanged: false,\n        },\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 2;\n});\n"
};

for (const [rel, content] of Object.entries(files)) {
  const abs = path.resolve(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_GAP_SLIPPAGE_POST_DB_SMOKE_V1_INSTALLED",

      generatedFiles:
        Object.keys(files),

      purpose: [
        "TYPESCRIPT_IMPORT_COMPILE_SMOKE",
        "NO_ORDER_APPROVED_EXECUTOR_OPERATIONAL_SMOKE"
      ],

      safety: {
        installerDatabaseReads: 0,
        installerDatabaseWrites: 0,
        installerOrdersCreated: 0,
        installerPositionsChanged: 0,
        executorSmokeCreatesOrders: false,
        executorSmokeRequiresZeroRiskApprovedOrders: true,
        executorSmokeRequiresZeroPositions: true,
        executorSmokeRequiresZeroActiveReservedRiskOrders: true,
        realTradingChanged: false,
        schedulerChanged: false,
        forwardOosChanged: false
      },

      nextAction:
        "RUN_TYPESCRIPT_THEN_NO_ORDER_EXECUTOR_SMOKE"
    },
    null,
    2
  )
);
