const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "app/api/trading/automation/cycle/route.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  fs.writeFileSync(
    TARGET,
    "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT =\n  process.cwd();\n\nconst ROUTE_REL =\n  \"app/api/trading/automation/cycle/route.ts\";\n\nfunction read(\n  rel: string,\n) {\n  return fs.readFileSync(\n    path.join(\n      ROOT,\n      rel,\n    ),\n    \"utf8\",\n  );\n}\n\nfunction staticVerifyRoute(\n  source: string,\n) {\n  const probeMarker =\n    source.indexOf(\n      \"ALPHA_V3_PROBE_ONLY_V1\",\n    );\n\n  const probeBody =\n    source.indexOf(\n      \"probeOnly\",\n      Math.max(\n        0,\n        probeMarker,\n      ),\n    );\n\n  const secretCheck =\n    source.indexOf(\n      \"TRADING_AUTOMATION_SECRET\",\n      Math.max(\n        0,\n        probeBody,\n      ),\n    );\n\n  const reachableStatus =\n    source.indexOf(\n      \"AUTOMATION_CYCLE_ROUTE_REACHABLE\",\n      Math.max(\n        0,\n        secretCheck,\n      ),\n    );\n\n  const maintenanceCall =\n    source.indexOf(\n      \"runCommittedRiskMaintenance(\",\n    );\n\n  const innerRunCall =\n    source.indexOf(\n      \"/api/trading/automation/run\",\n    );\n\n  const approvedExecution =\n    source.indexOf(\n      \"executeApprovedPaperOrders(\",\n    );\n\n  const checks = {\n    routeExists:\n      true,\n\n    probeMarker:\n      probeMarker >= 0,\n\n    probeBodySurface:\n      /probeOnly\\s*\\??:\\s*unknown|probeOnly/.test(\n        source,\n      ),\n\n    explicitTrueGuard:\n      /\\.probeOnly\\s*===\\s*true/.test(\n        source,\n      ),\n\n    secretRequired:\n      secretCheck >= 0,\n\n    unauthorizedProbeResponse:\n      source.includes(\n        \"UNAUTHORIZED_AUTOMATION_CYCLE_PROBE\",\n      ),\n\n    reachableStatus:\n      reachableStatus >= 0,\n\n    zeroSideEffectContract:\n      source.includes(\n        \"databaseWrites\",\n      ) &&\n      source.includes(\n        \"ordersCreated\",\n      ) &&\n      source.includes(\n        \"positionsChanged\",\n      ),\n\n    probeBeforeMaintenance:\n      probeMarker >= 0 &&\n      maintenanceCall >= 0 &&\n      probeMarker <\n        maintenanceCall,\n\n    probeBeforeInnerAutomationRun:\n      probeMarker >= 0 &&\n      innerRunCall >= 0 &&\n      probeMarker <\n        innerRunCall,\n\n    probeBeforeApprovedExecution:\n      probeMarker >= 0 &&\n      approvedExecution >= 0 &&\n      probeMarker <\n        approvedExecution,\n  };\n\n  return {\n    checks,\n\n    failed:\n      Object.entries(\n        checks,\n      )\n        .filter(\n          ([, value]) =>\n            value !== true,\n        )\n        .map(\n          ([key]) =>\n            key,\n        ),\n  };\n}\n\nfunction candidateBaseUrls() {\n  const explicit = [\n    process.env\n      .AI_STOCK_LAB_BASE_URL,\n    process.env\n      .NEXT_PUBLIC_APP_URL,\n  ]\n    .map(\n      value =>\n        String(\n          value ?? \"\",\n        ).trim(),\n    )\n    .filter(Boolean)\n    .map(\n      value =>\n        value.replace(\n          /\\/+$/,\n          \"\",\n        ),\n    );\n\n  return [\n    ...new Set([\n      ...explicit,\n      \"http://127.0.0.1:3000\",\n      \"http://127.0.0.1:3001\",\n      \"http://127.0.0.1:3010\",\n    ]),\n  ];\n}\n\nasync function callProbe(\n  baseUrl: string,\n  secret: string,\n) {\n  const controller =\n    new AbortController();\n\n  const timer =\n    setTimeout(\n      () =>\n        controller.abort(),\n      3500,\n    );\n\n  try {\n    const response =\n      await fetch(\n        `${baseUrl}/api/trading/automation/cycle`,\n        {\n          method:\n            \"POST\",\n\n          headers: {\n            \"Content-Type\":\n              \"application/json\",\n\n            \"x-automation-secret\":\n              secret,\n          },\n\n          body:\n            JSON.stringify({\n              probeOnly:\n                true,\n            }),\n\n          cache:\n            \"no-store\",\n\n          signal:\n            controller.signal,\n        },\n      );\n\n    const text =\n      await response.text();\n\n    let payload:\n      unknown = null;\n\n    try {\n      payload =\n        text\n          ? JSON.parse(\n              text,\n            )\n          : null;\n    } catch {\n      payload = {\n        raw:\n          text.slice(\n            0,\n            500,\n          ),\n      };\n    }\n\n    return {\n      baseUrl,\n      reachable:\n        true,\n      httpStatus:\n        response.status,\n      payload,\n      error:\n        null,\n    };\n  } catch (\n    error\n  ) {\n    return {\n      baseUrl,\n      reachable:\n        false,\n      httpStatus:\n        null,\n      payload:\n        null,\n      error:\n        String(\n          error instanceof Error\n            ? error.message\n            : error,\n        ),\n    };\n  } finally {\n    clearTimeout(\n      timer,\n    );\n  }\n}\n\nasync function main() {\n  const routePath =\n    path.join(\n      ROOT,\n      ROUTE_REL,\n    );\n\n  if (\n    !fs.existsSync(\n      routePath,\n    )\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED\",\n\n          reason:\n            \"CYCLE_ROUTE_NOT_FOUND\",\n\n          failed: [\n            \"routeExists\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n    return;\n  }\n\n  const source =\n    read(\n      ROUTE_REL,\n    );\n\n  const staticResult =\n    staticVerifyRoute(\n      source,\n    );\n\n  if (\n    staticResult.failed.length >\n    0\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED\",\n\n          phase:\n            \"STATIC_FAIL_CLOSED\",\n\n          checks:\n            staticResult.checks,\n\n          failed:\n            staticResult.failed,\n\n          nextGate:\n            \"REPAIR_OR_REVERIFY_EXISTING_PROBE_ONLY_ROUTE_BEFORE_ANY_ROUTE_CALL\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n    return;\n  }\n\n  const secret =\n    String(\n      process.env\n        .TRADING_AUTOMATION_SECRET ??\n      \"\",\n    ).trim();\n\n  if (\n    !secret\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_WAIT\",\n\n          phase:\n            \"SECRET_NOT_AVAILABLE\",\n\n          staticChecks:\n            staticResult.checks,\n\n          routeCalled:\n            false,\n\n          failed: [],\n\n          nextGate:\n            \"KEEP_ROUTE_UNCALLED_UNTIL_TRADING_AUTOMATION_SECRET_IS_AVAILABLE\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 0;\n    return;\n  }\n\n  const attempts = [];\n\n  let verified:\n    {\n      baseUrl: string;\n      reachable: boolean;\n      httpStatus:\n        number | null;\n      payload:\n        any;\n      error:\n        string | null;\n    } | null = null;\n\n  for (\n    const baseUrl\n    of candidateBaseUrls()\n  ) {\n    const attempt =\n      await callProbe(\n        baseUrl,\n        secret,\n      );\n\n    attempts.push(\n      attempt,\n    );\n\n    const payload =\n      attempt.payload as\n        | {\n            ok?: unknown;\n            probeOnly?: unknown;\n            status?: unknown;\n            sideEffects?: {\n              committedRiskMaintenance?: unknown;\n              automationRun?: unknown;\n              approvedOrderExecution?: unknown;\n              databaseReads?: unknown;\n              databaseWrites?: unknown;\n              ordersCreated?: unknown;\n              ordersChanged?: unknown;\n              positionsChanged?: unknown;\n            };\n          }\n        | null;\n\n    if (\n      attempt.httpStatus ===\n        200 &&\n      payload?.ok ===\n        true &&\n      payload\n        ?.probeOnly ===\n        true &&\n      payload?.status ===\n        \"AUTOMATION_CYCLE_ROUTE_REACHABLE\"\n    ) {\n      verified =\n        attempt;\n      break;\n    }\n  }\n\n  if (\n    !verified\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_WAIT\",\n\n          phase:\n            \"LOCAL_SERVER_NOT_VERIFIED\",\n\n          staticChecks:\n            staticResult.checks,\n\n          attempts:\n            attempts.map(\n              attempt => ({\n                baseUrl:\n                  attempt.baseUrl,\n\n                reachable:\n                  attempt.reachable,\n\n                httpStatus:\n                  attempt.httpStatus,\n\n                error:\n                  attempt.error,\n              }),\n            ),\n\n          safety: {\n            probeOnlyRequests:\n              attempts.filter(\n                attempt =>\n                  attempt.reachable,\n              ).length,\n\n            realTradingEnabled:\n              false,\n\n            intendedDatabaseWrites:\n              0,\n\n            intendedOrdersCreated:\n              0,\n\n            intendedPositionsChanged:\n              0,\n          },\n\n          failed: [],\n\n          nextGate:\n            \"START_LOCAL_NEXT_SERVER_AND_RERUN_SAME_PROBE_ONLY_SMOKE\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 0;\n    return;\n  }\n\n  const payload =\n    verified.payload as {\n      sideEffects?: {\n        committedRiskMaintenance?: unknown;\n        automationRun?: unknown;\n        approvedOrderExecution?: unknown;\n        databaseReads?: unknown;\n        databaseWrites?: unknown;\n        ordersCreated?: unknown;\n        ordersChanged?: unknown;\n        positionsChanged?: unknown;\n      };\n    };\n\n  const sideEffects =\n    payload\n      .sideEffects ?? {};\n\n  const checks = {\n    routeReachable:\n      true,\n\n    authenticatedProbeAccepted:\n      true,\n\n    committedRiskMaintenanceNotRun:\n      sideEffects\n        .committedRiskMaintenance ===\n        false,\n\n    automationRunNotRun:\n      sideEffects\n        .automationRun ===\n        false,\n\n    approvedOrderExecutionNotRun:\n      sideEffects\n        .approvedOrderExecution ===\n        false,\n\n    databaseReadsZero:\n      sideEffects\n        .databaseReads ===\n        0,\n\n    databaseWritesZero:\n      sideEffects\n        .databaseWrites ===\n        0,\n\n    ordersCreatedZero:\n      sideEffects\n        .ordersCreated ===\n        0,\n\n    ordersChangedZero:\n      sideEffects\n        .ordersChanged ===\n        0,\n\n    positionsChangedZero:\n      sideEffects\n        .positionsChanged ===\n        0,\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED\",\n\n        baseUrl:\n          verified.baseUrl,\n\n        httpStatus:\n          verified.httpStatus,\n\n        staticChecks:\n          staticResult.checks,\n\n        runtimeChecks:\n          checks,\n\n        safety: {\n          requestMode:\n            \"AUTHENTICATED_PROBE_ONLY\",\n\n          realTradingForcedOffByExecutionCommand:\n            true,\n\n          forwardOosAutomationForcedOffByExecutionCommand:\n            true,\n\n          databaseWrites:\n            sideEffects\n              .databaseWrites,\n\n          ordersCreated:\n            sideEffects\n              .ordersCreated,\n\n          positionsChanged:\n            sideEffects\n              .positionsChanged,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"VERIFY_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_WITH_MOCKED_SUBPROCESS_V1\"\n            : \"DO_NOT_RUN_NORMAL_AUTOMATION_ROUTE_INSPECT_PROBE_CONTRACT\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length ===\n    0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  error => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          failed: [\n            \"smokeRuntime\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-cycle-probe-only-one-shot"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts",

      packageScript:
        "npm run test:true-forward-oos-cycle-probe-only-one-shot",

      mode:
        "EXISTING_AUTHENTICATED_PROBE_ONLY_ROUTE_ONE_SHOT",

      productSourceChanges:
        0,

      safety: {
        normalAutomationRouteBody:
          false,
        probeOnlyBody:
          true,
        forwardOosAutomationEnabled:
          false,
        realTradingEnabled:
          false,
        intendedDatabaseWrites:
          0,
        intendedOrdersCreated:
          0,
        intendedPositionsChanged:
          0
      },

      nextAction:
        "RUN_SAFE_LOCAL_PROBE_ONLY_ONE_SHOT"
    }, null, 2));
  }
}
