const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const cycleRel =
  "app/api/trading/automation/cycle/route.ts";

const panelRel =
  "app/components/AutomationRunPanel.tsx";

const manualRel =
  "app/api/trading/automation/manual/route.ts";

const tsconfigRel =
  "tsconfig.alpha-v3-production-cycle.json";

const cycleFile =
  path.resolve(
    root,
    cycleRel,
  );

const panelFile =
  path.resolve(
    root,
    panelRel,
  );

const manualFile =
  path.resolve(
    root,
    manualRel,
  );

const tsconfigFile =
  path.resolve(
    root,
    tsconfigRel,
  );

if (!fs.existsSync(cycleFile)) {
  throw new Error(
    "AUTOMATION_CYCLE_ROUTE_NOT_FOUND",
  );
}

if (!fs.existsSync(panelFile)) {
  throw new Error(
    "AUTOMATION_PANEL_NOT_FOUND",
  );
}

let cycle =
  fs.readFileSync(
    cycleFile,
    "utf8",
  );

let panel =
  fs.readFileSync(
    panelFile,
    "utf8",
  );

const cycleBackup =
  `${cycleFile}.before-single-executor-v1.bak`;

const panelBackup =
  `${panelFile}.before-ui-manual-proxy-v1.bak`;

if (!fs.existsSync(cycleBackup)) {
  fs.copyFileSync(
    cycleFile,
    cycleBackup,
  );
}

if (!fs.existsSync(panelBackup)) {
  fs.copyFileSync(
    panelFile,
    panelBackup,
  );
}

/*
 * 1. Remove the wrapper's second executor call.
 *    automation/run remains the sole approved-order execution owner.
 */
const executorAssignment =
  /approvedExecution\s*=\s*await\s+executeApprovedPaperOrders\s*\(\s*AUTOMATION_CYCLE_MAX_APPROVED_ORDERS\s*,?\s*\)\s*;/m;

if (
  executorAssignment.test(
    cycle,
  )
) {
  cycle =
    cycle.replace(
      executorAssignment,
      [
        "approvedExecution =",
        "      null;",
        "",
        "    /*",
        "     * Approved-order execution is owned by automation/run.",
        "     * Do not execute it a second time in the cycle wrapper.",
        "     */",
      ].join("\n"),
    );
} else if (
  /await\s+executeApprovedPaperOrders\s*\(/m.test(
    cycle,
  )
) {
  throw new Error(
    "UNEXPECTED_CYCLE_EXECUTOR_CALL_SHAPE",
  );
}

/*
 * 2. Treat HTTP 200 PARTIAL_FAILURE / FAILED as semantic failure.
 */
if (
  !cycle.includes(
    "automationSemanticFailure",
  )
) {
  const failureIfPattern =
    /if\s*\(\s*!automationResponse\.ok\s*\)\s*\{/m;

  if (
    !failureIfPattern.test(
      cycle,
    )
  ) {
    throw new Error(
      "AUTOMATION_HTTP_FAILURE_IF_NOT_FOUND",
    );
  }

  const semanticBlock = [
    "const automationPayloadRecord =",
    "      automationPayload &&",
    "      typeof automationPayload ===",
    '        "object" &&',
    "      !Array.isArray(",
    "        automationPayload,",
    "      )",
    "        ? (automationPayload as",
    "            Record<string, unknown>)",
    "        : null;",
    "",
    "    const automationSemanticFailure =",
    "      automationPayloadRecord?.ok ===",
    "        false ||",
    "      automationPayloadRecord?.status ===",
    '        "FAILED" ||',
    "      automationPayloadRecord?.status ===",
    '        "PARTIAL_FAILURE";',
    "",
    "    if (",
    "      !automationResponse.ok ||",
    "      automationSemanticFailure",
    "    ) {",
  ].join("\n");

  cycle =
    cycle.replace(
      failureIfPattern,
      semanticBlock,
    );
}

fs.writeFileSync(
  cycleFile,
  cycle,
  "utf8",
);

/*
 * 3. Add server-side manual proxy.
 */
fs.mkdirSync(
  path.dirname(
    manualFile,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  manualFile,
  "import {\n  NextRequest,\n  NextResponse,\n} from \"next/server\";\n\nexport const runtime =\n  \"nodejs\";\n\nexport const dynamic =\n  \"force-dynamic\";\n\nfunction parseBoolean(\n  value: unknown,\n  fallback: boolean,\n) {\n  if (\n    typeof value ===\n    \"boolean\"\n  ) {\n    return value;\n  }\n\n  if (\n    typeof value ===\n    \"string\"\n  ) {\n    const normalized =\n      value\n        .trim()\n        .toLowerCase();\n\n    if (\n      normalized === \"true\" ||\n      normalized === \"1\" ||\n      normalized === \"yes\" ||\n      normalized === \"on\"\n    ) {\n      return true;\n    }\n\n    if (\n      normalized === \"false\" ||\n      normalized === \"0\" ||\n      normalized === \"no\" ||\n      normalized === \"off\"\n    ) {\n      return false;\n    }\n  }\n\n  return fallback;\n}\n\nfunction clampMaxOrders(\n  value: unknown,\n) {\n  const parsed =\n    typeof value ===\n    \"number\"\n      ? value\n      : Number(\n          value,\n        );\n\n  if (\n    !Number.isFinite(\n      parsed,\n    )\n  ) {\n    return 1;\n  }\n\n  return Math.max(\n    1,\n    Math.min(\n      5,\n      Math.floor(\n        parsed,\n      ),\n    ),\n  );\n}\n\nfunction isAllowedManualOrigin(\n  request: NextRequest,\n) {\n  const requestUrl =\n    new URL(\n      request.url,\n    );\n\n  const origin =\n    request.headers\n      .get(\n        \"origin\",\n      )\n      ?.trim();\n\n  if (origin) {\n    return (\n      origin ===\n      requestUrl.origin\n    );\n  }\n\n  /*\n   * Browsers normally send Origin for this POST.\n   * No-Origin requests are allowed only for local development.\n   */\n  const hostname =\n    requestUrl.hostname\n      .toLowerCase();\n\n  return (\n    hostname ===\n      \"localhost\" ||\n    hostname ===\n      \"127.0.0.1\" ||\n    hostname ===\n      \"::1\"\n  );\n}\n\nexport async function POST(\n  request: NextRequest,\n) {\n  if (\n    !isAllowedManualOrigin(\n      request,\n    )\n  ) {\n    return NextResponse.json(\n      {\n        ok: false,\n        error:\n          \"AUTOMATION_MANUAL_ORIGIN_REJECTED\",\n      },\n      {\n        status: 403,\n      },\n    );\n  }\n\n  const secret =\n    process.env\n      .TRADING_AUTOMATION_SECRET\n      ?.trim() ??\n    \"\";\n\n  if (!secret) {\n    return NextResponse.json(\n      {\n        ok: false,\n        error:\n          \"TRADING_AUTOMATION_SECRET_NOT_CONFIGURED\",\n      },\n      {\n        status: 503,\n      },\n    );\n  }\n\n  const body =\n    (await request\n      .json()\n      .catch(\n        () => ({}),\n      )) as {\n      includeMarketSync?: unknown;\n      autoOrder?: unknown;\n      maxOrders?: unknown;\n    };\n\n  /*\n   * Only the intended manual controls are forwarded.\n   * probeOnly / scheduler fields / arbitrary caller fields are discarded.\n   */\n  const forwardedBody = {\n    triggerType:\n      \"MANUAL\",\n\n    includeMarketSync:\n      parseBoolean(\n        body.includeMarketSync,\n        true,\n      ),\n\n    autoOrder:\n      parseBoolean(\n        body.autoOrder,\n        false,\n      ),\n\n    maxOrders:\n      clampMaxOrders(\n        body.maxOrders,\n      ),\n  };\n\n  const origin =\n    new URL(\n      request.url,\n    ).origin;\n\n  const response =\n    await fetch(\n      `${origin}/api/trading/automation/cycle`,\n      {\n        method:\n          \"POST\",\n\n        headers: {\n          \"content-type\":\n            \"application/json; charset=utf-8\",\n\n          \"x-automation-secret\":\n            secret,\n        },\n\n        body:\n          JSON.stringify(\n            forwardedBody,\n          ),\n\n        cache:\n          \"no-store\",\n      },\n    );\n\n  const responseText =\n    await response.text();\n\n  return new NextResponse(\n    responseText,\n    {\n      status:\n        response.status,\n\n      headers: {\n        \"content-type\":\n          response.headers.get(\n            \"content-type\",\n          ) ??\n          \"application/json; charset=utf-8\",\n      },\n    },\n  );\n}\n",
  "utf8",
);

/*
 * 4. Browser calls the manual proxy, never the secret-protected cycle.
 */
panel =
  panel.replaceAll(
    "/api/trading/automation/cycle",
    "/api/trading/automation/manual",
  );

fs.writeFileSync(
  panelFile,
  panel,
  "utf8",
);

/*
 * 5. Include the new manual route in targeted production typecheck.
 */
if (fs.existsSync(tsconfigFile)) {
  const tsconfig =
    JSON.parse(
      fs.readFileSync(
        tsconfigFile,
        "utf8",
      ),
    );

  tsconfig.include =
    Array.isArray(
      tsconfig.include,
    )
      ? tsconfig.include
      : [];

  if (
    !tsconfig.include.includes(
      manualRel,
    )
  ) {
    tsconfig.include.push(
      manualRel,
    );
  }

  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify(
      tsconfig,
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

const scriptsDir =
  path.resolve(
    root,
    "scripts",
  );

fs.mkdirSync(
  scriptsDir,
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.join(
    scriptsDir,
    "alpha-v3-single-executor-and-ui-proxy-static-verify.cjs",
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nfunction read(rel) {\n  const file =\n    path.resolve(\n      root,\n      rel,\n    );\n\n  if (!fs.existsSync(file)) {\n    return \"\";\n  }\n\n  return fs.readFileSync(\n    file,\n    \"utf8\",\n  );\n}\n\nconst cycle =\n  read(\n    \"app/api/trading/automation/cycle/route.ts\",\n  );\n\nconst run =\n  read(\n    \"app/api/trading/automation/run/route.ts\",\n  );\n\nconst manual =\n  read(\n    \"app/api/trading/automation/manual/route.ts\",\n  );\n\nconst panel =\n  read(\n    \"app/components/AutomationRunPanel.tsx\",\n  );\n\nconst cycleExecutorCallPattern =\n  /await\\s+executeApprovedPaperOrders\\s*\\(/m;\n\nconst checks = {\n  innerRunOwnsApprovedExecution:\n    run.includes(\n      \"/api/orders/paper/execute-approved\",\n    ) &&\n    run.includes(\n      \"if (autoOrder)\",\n    ),\n\n  cycleNoSecondApprovedExecutorCall:\n    !cycleExecutorCallPattern.test(\n      cycle,\n    ),\n\n  cycleStillCallsAutomationRun:\n    cycle.includes(\n      \"/api/trading/automation/run\",\n    ),\n\n  cycleDetectsSemanticFailure:\n    cycle.includes(\n      \"automationSemanticFailure\",\n    ) &&\n    cycle.includes(\n      \"PARTIAL_FAILURE\",\n    ) &&\n    cycle.includes(\n      \"\\\"FAILED\\\"\",\n    ),\n\n  cycleSemanticFailureFailsClosed:\n    /!automationResponse\\.ok\\s*\\|\\|\\s*automationSemanticFailure/m.test(\n      cycle,\n    ),\n\n  cycleStillRunsPostMaintenance:\n    cycle.includes(\n      \"phase:\" +\n      \"\\n\" +\n      \"            \\\"POST_EXECUTION\\\"\",\n    ) ||\n    cycle.includes(\n      \"\\\"POST_EXECUTION\\\"\",\n    ),\n\n  probeOnlyStillPresent:\n    cycle.includes(\n      \"ALPHA_V3_PROBE_ONLY_V1\",\n    ),\n\n  manualProxyExists:\n    manual.length > 0,\n\n  manualProxyUsesServerSecret:\n    manual.includes(\n      \"TRADING_AUTOMATION_SECRET\",\n    ) &&\n    manual.includes(\n      \"\\\"x-automation-secret\\\"\",\n    ),\n\n  manualProxyForwardsToCycle:\n    manual.includes(\n      \"/api/trading/automation/cycle\",\n    ),\n\n  manualProxyForcesManualTrigger:\n    manual.includes(\n      \"triggerType:\" +\n      \"\\n\" +\n      \"      \\\"MANUAL\\\"\",\n    ) ||\n    manual.includes(\n      'triggerType: \"MANUAL\"',\n    ),\n\n  manualProxySanitizesControls:\n    manual.includes(\n      \"includeMarketSync\",\n    ) &&\n    manual.includes(\n      \"autoOrder\",\n    ) &&\n    manual.includes(\n      \"maxOrders\",\n    ) &&\n    !manual.includes(\n      \"probeOnly?:\",\n    ),\n\n  manualProxyChecksOrigin:\n    manual.includes(\n      \"AUTOMATION_MANUAL_ORIGIN_REJECTED\",\n    ),\n\n  panelCallsManualProxy:\n    panel.includes(\n      \"/api/trading/automation/manual\",\n    ),\n\n  panelNoLongerCallsCycleDirectly:\n    !panel.includes(\n      \"/api/trading/automation/cycle\",\n    ),\n\n  panelDoesNotExposeAutomationSecret:\n    !panel.includes(\n      \"TRADING_AUTOMATION_SECRET\",\n    ) &&\n    !panel.includes(\n      \"x-automation-secret\",\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value,\n    )\n    .map(\n      ([key]) =>\n        key,\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_SINGLE_EXECUTOR_AND_UI_PROXY_STATIC_VERIFIED\"\n          : \"ALPHA_V3_SINGLE_EXECUTOR_AND_UI_PROXY_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      contract: {\n        approvedExecutionOwner:\n          \"AUTOMATION_RUN_ONLY\",\n\n        autoOrderFalse:\n          \"NO_ORDER_CREATION_NO_APPROVED_EXECUTION\",\n\n        autoOrderTrue:\n          \"AUTOMATION_RUN_CREATES_AND_EXECUTES_APPROVED_ORDERS_ONCE\",\n\n        cycle:\n          \"PRE_MAINTENANCE -> AUTOMATION_RUN -> POST_MAINTENANCE\",\n\n        semanticFailure:\n          \"FAILED_OR_PARTIAL_FAILURE_IS_FAIL_CLOSED\",\n\n        ui:\n          \"BROWSER -> SERVER_MANUAL_PROXY -> SECRET_PROTECTED_CYCLE\",\n      },\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        cyclePostRequests: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_V2_MOCK_CONTRACT_TEST\"\n          : \"REVIEW_SINGLE_EXECUTOR_AND_UI_PROXY_PATCH\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode =\n    2;\n}\n",
  "utf8",
);

fs.writeFileSync(
  path.join(
    scriptsDir,
    "alpha-v3-single-executor-cycle-v2-contract-test.ts",
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport {\n  pathToFileURL,\n} from \"node:url\";\n\nconst root =\n  process.cwd();\n\nconst routeDir =\n  path.resolve(\n    root,\n    \"app/api/trading/automation/cycle\",\n  );\n\nconst routeFile =\n  path.join(\n    routeDir,\n    \"route.ts\",\n  );\n\nconst tempRoute =\n  path.join(\n    routeDir,\n    \"__alpha_v3_v2_contract_route.ts\",\n  );\n\nconst stateFile =\n  path.join(\n    routeDir,\n    \"__alpha_v3_v2_contract_state.ts\",\n  );\n\nconst maintenanceMockFile =\n  path.join(\n    routeDir,\n    \"__alpha_v3_v2_contract_maintenance_mock.ts\",\n  );\n\nconst executorMockFile =\n  path.join(\n    routeDir,\n    \"__alpha_v3_v2_contract_executor_mock.ts\",\n  );\n\nconst cleanupFiles = [\n  tempRoute,\n  stateFile,\n  maintenanceMockFile,\n  executorMockFile,\n];\n\ntype Scenario = {\n  name: string;\n  passed: boolean;\n  observed: unknown;\n};\n\nasync function main() {\n  if (!fs.existsSync(routeFile)) {\n    throw new Error(\n      \"AUTOMATION_CYCLE_ROUTE_NOT_FOUND\",\n    );\n  }\n\n  const original =\n    fs.readFileSync(\n      routeFile,\n      \"utf8\",\n    );\n\n  const transformed =\n    original\n      .replace(\n        \"@/lib/trading/run-committed-risk-maintenance\",\n        \"./__alpha_v3_v2_contract_maintenance_mock\",\n      )\n      .replace(\n        \"@/lib/trading/execute-approved-paper-orders\",\n        \"./__alpha_v3_v2_contract_executor_mock\",\n      );\n\n  fs.writeFileSync(\n    stateFile,\n    `\nexport const events: Array<{\n  type: string;\n  detail?: unknown;\n}> = [];\n\nexport function resetState() {\n  events.splice(0, events.length);\n}\n`,\n    \"utf8\",\n  );\n\n  fs.writeFileSync(\n    maintenanceMockFile,\n    `\nimport {\n  events,\n} from \"./__alpha_v3_v2_contract_state\";\n\nexport async function runCommittedRiskMaintenance(\n  input: {\n    phase: string;\n    runExpiry?: boolean;\n  },\n) {\n  events.push({\n    type: \"maintenance\",\n    detail: input,\n  });\n\n  return {\n    ok: true,\n    phase: input.phase,\n    expiry: input.runExpiry\n      ? { expiredCount: 0 }\n      : null,\n    reconciliation: {\n      releasedCount: 0,\n    },\n  };\n}\n`,\n    \"utf8\",\n  );\n\n  fs.writeFileSync(\n    executorMockFile,\n    `\nimport {\n  events,\n} from \"./__alpha_v3_v2_contract_state\";\n\nexport async function executeApprovedPaperOrders(\n  maxOrders = 5,\n) {\n  events.push({\n    type: \"cycle-executor\",\n    detail: {\n      maxOrders,\n    },\n  });\n\n  throw new Error(\n    \"CYCLE_EXECUTOR_MUST_NOT_BE_CALLED\",\n  );\n}\n`,\n    \"utf8\",\n  );\n\n  fs.writeFileSync(\n    tempRoute,\n    transformed,\n    \"utf8\",\n  );\n\n  const routeModule =\n    await import(\n      pathToFileURL(\n        tempRoute,\n      ).href +\n        `?v=${Date.now()}`\n    );\n\n  const stateModule =\n    await import(\n      pathToFileURL(\n        stateFile,\n      ).href\n    );\n\n  const {\n    POST,\n  } =\n    routeModule as {\n      POST:\n        (request: Request) =>\n          Promise<Response>;\n    };\n\n  const {\n    events,\n    resetState,\n  } =\n    stateModule as {\n      events:\n        Array<{\n          type: string;\n          detail?: unknown;\n        }>;\n\n      resetState:\n        () => void;\n    };\n\n  const originalFetch =\n    globalThis.fetch;\n\n  const originalSecret =\n    process.env\n      .TRADING_AUTOMATION_SECRET;\n\n  process.env\n    .TRADING_AUTOMATION_SECRET =\n    \"v2-contract-secret\";\n\n  let fetchStatus =\n    200;\n\n  let fetchPayload:\n    unknown = {\n      ok: true,\n      status: \"SUCCESS\",\n    };\n\n  globalThis.fetch =\n    (async (\n      input:\n        string | URL | Request,\n      init?: RequestInit,\n    ) => {\n      const url =\n        typeof input === \"string\"\n          ? input\n          : input instanceof URL\n            ? input.toString()\n            : input.url;\n\n      if (\n        !url.includes(\n          \"/api/trading/automation/run\",\n        )\n      ) {\n        throw new Error(\n          `UNEXPECTED_FETCH:${url}`,\n        );\n      }\n\n      events.push({\n        type: \"automation-run\",\n        detail: {\n          status:\n            fetchStatus,\n          body:\n            typeof init?.body ===\n            \"string\"\n              ? init.body\n              : null,\n        },\n      });\n\n      return new Response(\n        JSON.stringify(\n          fetchPayload,\n        ),\n        {\n          status:\n            fetchStatus,\n          headers: {\n            \"content-type\":\n              \"application/json\",\n          },\n        },\n      );\n    }) as typeof fetch;\n\n  function makeRequest(\n    body: Record<\n      string,\n      unknown\n    >,\n    secret =\n      \"v2-contract-secret\",\n  ) {\n    return new Request(\n      \"http://localhost/api/trading/automation/cycle\",\n      {\n        method: \"POST\",\n        headers: {\n          \"content-type\":\n            \"application/json\",\n          \"x-automation-secret\":\n            secret,\n        },\n        body:\n          JSON.stringify(\n            body,\n          ),\n      },\n    );\n  }\n\n  async function json(\n    response: Response,\n  ) {\n    return JSON.parse(\n      await response.text(),\n    );\n  }\n\n  const scenarios:\n    Scenario[] = [];\n\n  /*\n   * Success: wrapper executor must never run.\n   */\n  resetState();\n\n  fetchStatus = 200;\n  fetchPayload = {\n    ok: true,\n    status: \"SUCCESS\",\n  };\n\n  const successResponse =\n    await POST(\n      makeRequest({\n        triggerType:\n          \"MANUAL\",\n        autoOrder:\n          true,\n        maxOrders:\n          3,\n      }),\n    );\n\n  const successPayload =\n    await json(\n      successResponse,\n    );\n\n  const successTypes =\n    events.map(\n      (event) =>\n        event.type,\n    );\n\n  scenarios.push({\n    name:\n      \"SUCCESS_HAS_SINGLE_EXECUTOR_OWNER\",\n\n    passed:\n      successResponse.status ===\n        200 &&\n      successPayload?.ok ===\n        true &&\n      !successTypes.includes(\n        \"cycle-executor\",\n      ) &&\n      successTypes.join(\",\") ===\n        \"maintenance,automation-run,maintenance\",\n\n    observed: {\n      status:\n        successResponse.status,\n      payload:\n        successPayload,\n      events:\n        [...events],\n    },\n  });\n\n  /*\n   * HTTP 200 PARTIAL_FAILURE is semantically failed.\n   */\n  resetState();\n\n  fetchStatus = 200;\n  fetchPayload = {\n    ok: false,\n    status:\n      \"PARTIAL_FAILURE\",\n  };\n\n  const partialResponse =\n    await POST(\n      makeRequest({\n        triggerType:\n          \"SCHEDULED\",\n        autoOrder:\n          false,\n      }),\n    );\n\n  const partialPayload =\n    await json(\n      partialResponse,\n    );\n\n  const partialTypes =\n    events.map(\n      (event) =>\n        event.type,\n    );\n\n  scenarios.push({\n    name:\n      \"PARTIAL_FAILURE_HTTP_200_FAILS_CLOSED\",\n\n    passed:\n      partialResponse.status ===\n        500 &&\n      partialPayload?.ok ===\n        false &&\n      !partialTypes.includes(\n        \"cycle-executor\",\n      ) &&\n      partialTypes.join(\",\") ===\n        \"maintenance,automation-run,maintenance\",\n\n    observed: {\n      status:\n        partialResponse.status,\n      payload:\n        partialPayload,\n      events:\n        [...events],\n    },\n  });\n\n  /*\n   * HTTP failure also remains fail-closed.\n   */\n  resetState();\n\n  fetchStatus = 503;\n  fetchPayload = {\n    ok: false,\n    status:\n      \"FAILED\",\n  };\n\n  const httpFailureResponse =\n    await POST(\n      makeRequest({\n        triggerType:\n          \"SCHEDULED\",\n        autoOrder:\n          true,\n      }),\n    );\n\n  const httpFailurePayload =\n    await json(\n      httpFailureResponse,\n    );\n\n  const httpFailureTypes =\n    events.map(\n      (event) =>\n        event.type,\n    );\n\n  scenarios.push({\n    name:\n      \"HTTP_FAILURE_FAILS_CLOSED\",\n\n    passed:\n      httpFailureResponse.status ===\n        503 &&\n      httpFailurePayload?.ok ===\n        false &&\n      !httpFailureTypes.includes(\n        \"cycle-executor\",\n      ) &&\n      httpFailureTypes.join(\",\") ===\n        \"maintenance,automation-run,maintenance\",\n\n    observed: {\n      status:\n        httpFailureResponse.status,\n      payload:\n        httpFailurePayload,\n      events:\n        [...events],\n    },\n  });\n\n  /*\n   * Bad secret returns before every operational call.\n   */\n  resetState();\n\n  const unauthorizedResponse =\n    await POST(\n      makeRequest(\n        {\n          autoOrder:\n            false,\n        },\n        \"wrong-secret\",\n      ),\n    );\n\n  scenarios.push({\n    name:\n      \"UNAUTHORIZED_ZERO_OPERATIONAL_CALLS\",\n\n    passed:\n      unauthorizedResponse.status ===\n        401 &&\n      events.length ===\n        0,\n\n    observed: {\n      status:\n        unauthorizedResponse.status,\n      events:\n        [...events],\n    },\n  });\n\n  globalThis.fetch =\n    originalFetch;\n\n  if (\n    originalSecret ===\n    undefined\n  ) {\n    delete process.env\n      .TRADING_AUTOMATION_SECRET;\n  } else {\n    process.env\n      .TRADING_AUTOMATION_SECRET =\n      originalSecret;\n  }\n\n  const failed =\n    scenarios.filter(\n      (scenario) =>\n        !scenario.passed,\n    );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_VERIFIED\"\n            : \"ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_REVIEW\",\n\n        scenarios,\n\n        summary: {\n          scenarioCount:\n            scenarios.length,\n\n          passedCount:\n            scenarios.length -\n            failed.length,\n\n          failedCount:\n            failed.length,\n\n          cycleExecutorCallsExpected:\n            0,\n        },\n\n        safety: {\n          realDatabaseCalls:\n            0,\n          realNetworkCalls:\n            0,\n          realOrdersCreated:\n            0,\n          realOrdersChanged:\n            0,\n          realPositionsChanged:\n            0,\n        },\n\n        nextGate:\n          failed.length === 0\n            ? \"RUN_MANUAL_PROXY_PROBE_ONLY_SAFE_TEST\"\n            : \"REVIEW_SINGLE_EXECUTOR_CYCLE_V2\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length > 0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nvoid main()\n  .catch(\n    (error) => {\n      console.error(\n        JSON.stringify(\n          {\n            status:\n              \"ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_FATAL\",\n\n            error:\n              error instanceof Error\n                ? error.message\n                : String(\n                    error,\n                  ),\n          },\n          null,\n          2,\n        ),\n      );\n\n      process.exitCode =\n        2;\n    },\n  )\n  .finally(\n    () => {\n      for (\n        const file of\n          cleanupFiles\n      ) {\n        try {\n          fs.rmSync(\n            file,\n            {\n              force: true,\n            },\n          );\n        } catch {\n          // best-effort cleanup\n        }\n      }\n    },\n  );\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_SINGLE_EXECUTOR_AND_UI_PROXY_V1_INSTALLED",

      patchedFiles: [
        cycleRel,
        panelRel,
        tsconfigRel,
      ],

      generatedFiles: [
        manualRel,
        "scripts/alpha-v3-single-executor-and-ui-proxy-static-verify.cjs",
        "scripts/alpha-v3-single-executor-cycle-v2-contract-test.ts",
      ],

      contract: {
        approvedExecutionOwner:
          "AUTOMATION_RUN_ONLY",

        cycleWrapperApprovedExecutor:
          false,

        semanticFailureFailClosed:
          true,

        uiSecretExposure:
          false,

        uiManualPath:
          "/api/trading/automation/manual",
      },

      safety: {
        installerDatabaseWrites:
          0,
        installerNetworkCalls:
          0,
        installerOrdersCreated:
          0,
        installerPositionsChanged:
          0,
      },

      nextAction:
        "STATIC_VERIFY_TYPECHECK_AND_RUN_V2_MOCK_CONTRACT",
    },
    null,
    2,
  ),
);
