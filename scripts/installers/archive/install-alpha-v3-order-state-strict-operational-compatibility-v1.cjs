const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-order-state-strict-operational-compatibility-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text = fs.readFileSync(file, \"utf8\");\n\n  for (const rawLine of text.split(/\\r?\\n/)) {\n    const line = rawLine.trim();\n\n    if (!line || line.startsWith(\"#\")) {\n      continue;\n    }\n\n    const index = line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key = line.slice(0, index).trim();\n    let value = line.slice(index + 1).trim();\n\n    if (\n      (value.startsWith('\"') && value.endsWith('\"')) ||\n      (value.startsWith(\"'\") && value.endsWith(\"'\"))\n    ) {\n      value = value.slice(1, -1);\n    }\n\n    env[key] = value;\n  }\n\n  return env;\n}\n\nconst env = {\n  ...parseEnvFile(\n    path.resolve(root, \".env.local\")\n  ),\n  ...process.env\n};\n\nfunction trimBaseUrl(value) {\n  return String(value ?? \"\")\n    .trim()\n    .replace(/\\/+$/, \"\");\n}\n\nconst supabaseUrl = trimBaseUrl(\n  env.NEXT_PUBLIC_SUPABASE_URL ||\n  env.SUPABASE_URL\n);\n\nconst serviceRoleKey = String(\n  env.SUPABASE_SERVICE_ROLE_KEY ||\n  env.SUPABASE_SERVICE_KEY ||\n  \"\"\n).trim();\n\nasync function parseResponse(response) {\n  const text = await response.text();\n\n  try {\n    return text ? JSON.parse(text) : null;\n  } catch {\n    return { raw: text };\n  }\n}\n\nasync function fetchWithTimeout(\n  url,\n  options = {},\n  timeoutMs = 180000\n) {\n  const controller = new AbortController();\n\n  const timer = setTimeout(\n    () => controller.abort(),\n    timeoutMs\n  );\n\n  try {\n    return await fetch(\n      url,\n      {\n        ...options,\n        signal: controller.signal\n      }\n    );\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function reachable(baseUrl) {\n  try {\n    const response = await fetchWithTimeout(\n      baseUrl,\n      {\n        method: \"GET\",\n        cache: \"no-store\"\n      },\n      8000\n    );\n\n    return response.status >= 100;\n  } catch {\n    return false;\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured = trimBaseUrl(\n    env.AI_STOCK_LAB_BASE_URL\n  );\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(configured);\n  }\n\n  for (const port of [\n    3000,3001,3002,3003,3004,3005,\n    3006,3007,3008,3009,3010\n  ]) {\n    const url =\n      \"http://localhost:\" +\n      String(port);\n\n    if (!candidates.includes(url)) {\n      candidates.push(url);\n    }\n  }\n\n  for (\n    let attempt = 1;\n    attempt <= 3;\n    attempt += 1\n  ) {\n    for (const candidate of candidates) {\n      if (await reachable(candidate)) {\n        return candidate;\n      }\n    }\n\n    if (attempt < 3) {\n      await new Promise(\n        (resolve) =>\n          setTimeout(resolve, 750)\n      );\n    }\n  }\n\n  return null;\n}\n\nasync function supabaseGet(\n  pathname,\n  preferCount = false\n) {\n  const headers = {\n    apikey: serviceRoleKey,\n    authorization:\n      \"Bearer \" + serviceRoleKey\n  };\n\n  if (preferCount) {\n    headers.prefer = \"count=exact\";\n    headers.range = \"0-0\";\n  }\n\n  const response = await fetchWithTimeout(\n    supabaseUrl + pathname,\n    {\n      method: \"GET\",\n      headers,\n      cache: \"no-store\"\n    },\n    15000\n  );\n\n  const payload =\n    await parseResponse(response);\n\n  let count = null;\n\n  if (preferCount) {\n    const contentRange =\n      response.headers.get(\n        \"content-range\"\n      );\n\n    if (contentRange) {\n      const match =\n        contentRange.match(\n          /\\/(\\d+|\\*)$/\n        );\n\n      if (\n        match &&\n        match[1] !== \"*\"\n      ) {\n        count = Number(match[1]);\n      }\n    }\n  }\n\n  return {\n    ok: response.ok,\n    status: response.status,\n    count,\n    payload:\n      response.ok ? payload : null,\n    error:\n      response.ok ? null : payload\n  };\n}\n\nasync function countTable(\n  table,\n  query = \"select=id\"\n) {\n  return await supabaseGet(\n    \"/rest/v1/\" +\n    table +\n    \"?\" +\n    query,\n    true\n  );\n}\n\nasync function readConfig() {\n  const result = await supabaseGet(\n    \"/rest/v1/paper_order_state_machine_config\" +\n    \"?select=id,mode,version,updated_at\" +\n    \"&id=eq.1&limit=1\"\n  );\n\n  return {\n    ...result,\n    row:\n      result.ok &&\n      Array.isArray(result.payload)\n        ? result.payload[0] ?? null\n        : null\n  };\n}\n\nasync function snapshot() {\n  const [\n    config,\n    totalOrders,\n    approvedOrders,\n    activeReservations,\n    positions,\n    auditRows,\n    invalidAuditRows,\n    automationRuns\n  ] = await Promise.all([\n    readConfig(),\n\n    countTable(\n      \"paper_order_requests\"\n    ),\n\n    countTable(\n      \"paper_order_requests\",\n      \"select=id&status=eq.RISK_APPROVED\"\n    ),\n\n    countTable(\n      \"paper_order_requests\",\n      [\n        \"select=id\",\n        \"reserved_risk_amount=gt.0\",\n        \"reserved_risk_released_at=is.null\"\n      ].join(\"&\")\n    ),\n\n    countTable(\n      \"paper_positions\"\n    ),\n\n    countTable(\n      \"paper_order_state_transition_audit\"\n    ),\n\n    countTable(\n      \"paper_order_state_transition_audit\",\n      \"select=id&allowed=eq.false\"\n    ),\n\n    countTable(\n      \"trading_automation_runs\"\n    )\n  ]);\n\n  return {\n    config,\n    totalOrders,\n    approvedOrders,\n    activeReservations,\n    positions,\n    auditRows,\n    invalidAuditRows,\n    automationRuns\n  };\n}\n\nfunction knownCount(item) {\n  return (\n    item?.ok === true &&\n    Number.isInteger(item?.count)\n  );\n}\n\nfunction zeroCount(item) {\n  return (\n    knownCount(item) &&\n    item.count === 0\n  );\n}\n\nfunction delta(before, after) {\n  if (\n    !knownCount(before) ||\n    !knownCount(after)\n  ) {\n    return null;\n  }\n\n  return after.count - before.count;\n}\n\nasync function main() {\n  if (\n    !supabaseUrl ||\n    !serviceRoleKey\n  ) {\n    throw new Error(\n      \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\"\n    );\n  }\n\n  const baseUrl =\n    await detectBaseUrl();\n\n  if (!baseUrl) {\n    throw new Error(\n      \"NEXT_SERVER_NOT_REACHABLE_3000_TO_3010\"\n    );\n  }\n\n  const before = await snapshot();\n\n  const blockers = [];\n\n  if (\n    before.config.row?.mode !== \"STRICT\"\n  ) {\n    blockers.push(\n      \"ORDER_STATE_MACHINE_NOT_IN_STRICT_MODE\"\n    );\n  }\n\n  if (\n    before.config.row?.version !==\n      \"ALPHA_V3_ORDER_STATE_MACHINE_V1\"\n  ) {\n    blockers.push(\n      \"ORDER_STATE_MACHINE_VERSION_MISMATCH\"\n    );\n  }\n\n  if (!zeroCount(before.totalOrders)) {\n    blockers.push(\n      \"PAPER_ORDER_TABLE_NOT_EMPTY\"\n    );\n  }\n\n  if (!zeroCount(before.approvedOrders)) {\n    blockers.push(\n      \"RISK_APPROVED_ORDER_EXISTS\"\n    );\n  }\n\n  if (!zeroCount(before.activeReservations)) {\n    blockers.push(\n      \"ACTIVE_RESERVED_RISK_EXISTS\"\n    );\n  }\n\n  if (!zeroCount(before.positions)) {\n    blockers.push(\n      \"PAPER_POSITION_EXISTS\"\n    );\n  }\n\n  if (!zeroCount(before.invalidAuditRows)) {\n    blockers.push(\n      \"INVALID_TRANSITION_AUDIT_ROWS_EXIST\"\n    );\n  }\n\n  if (\n    !knownCount(before.auditRows) ||\n    !knownCount(before.automationRuns)\n  ) {\n    blockers.push(\n      \"PRE_SNAPSHOT_COUNT_NOT_VERIFIED\"\n    );\n  }\n\n  if (blockers.length > 0) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_ORDER_STATE_STRICT_OPERATIONAL_COMPATIBILITY_BLOCKED\",\n\n          baseUrl,\n          before,\n          blockers,\n\n          safety: {\n            operationalCycleRequests: 0,\n            ordersCreated: 0,\n            ordersChanged: 0,\n            positionsChanged: 0\n          },\n\n          nextGate:\n            \"RESOLVE_STRICT_OPERATIONAL_BLOCKERS\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode = 2;\n    return;\n  }\n\n  const requestBody = {\n    triggerType: \"MANUAL\",\n    includeMarketSync: false,\n    autoOrder: false,\n    maxOrders: 1\n  };\n\n  const startedAt =\n    new Date().toISOString();\n\n  let operationalResponse;\n\n  try {\n    const response =\n      await fetchWithTimeout(\n        baseUrl +\n        \"/api/trading/automation/manual\",\n        {\n          method: \"POST\",\n\n          headers: {\n            \"content-type\":\n              \"application/json; charset=utf-8\",\n\n            origin: baseUrl\n          },\n\n          body:\n            JSON.stringify(requestBody),\n\n          cache: \"no-store\"\n        },\n        180000\n      );\n\n    operationalResponse = {\n      status: response.status,\n      ok: response.ok,\n      payload:\n        await parseResponse(response)\n    };\n  } catch (error) {\n    operationalResponse = {\n      status: null,\n      ok: false,\n      payload: null,\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error)\n    };\n  }\n\n  const finishedAt =\n    new Date().toISOString();\n\n  const after = await snapshot();\n\n  const semanticStatus =\n    operationalResponse\n      ?.payload\n      ?.automationRun\n      ?.payload\n      ?.status ??\n    operationalResponse\n      ?.payload\n      ?.status ??\n    null;\n\n  const deltas = {\n    totalOrders:\n      delta(\n        before.totalOrders,\n        after.totalOrders\n      ),\n\n    approvedOrders:\n      delta(\n        before.approvedOrders,\n        after.approvedOrders\n      ),\n\n    activeReservations:\n      delta(\n        before.activeReservations,\n        after.activeReservations\n      ),\n\n    positions:\n      delta(\n        before.positions,\n        after.positions\n      ),\n\n    auditRows:\n      delta(\n        before.auditRows,\n        after.auditRows\n      ),\n\n    invalidAuditRows:\n      delta(\n        before.invalidAuditRows,\n        after.invalidAuditRows\n      ),\n\n    automationRuns:\n      delta(\n        before.automationRuns,\n        after.automationRuns\n      )\n  };\n\n  const checks = {\n    responseHttpSuccess:\n      operationalResponse.ok === true,\n\n    automationSemanticSuccess:\n      semanticStatus === \"SUCCESS\",\n\n    strictModeUnchanged:\n      after.config.row?.mode === \"STRICT\",\n\n    stateMachineVersionUnchanged:\n      after.config.row?.version ===\n        \"ALPHA_V3_ORDER_STATE_MACHINE_V1\",\n\n    noOrdersCreated:\n      zeroCount(after.totalOrders) &&\n      deltas.totalOrders === 0,\n\n    noApprovedOrdersCreated:\n      zeroCount(after.approvedOrders) &&\n      deltas.approvedOrders === 0,\n\n    noActiveReservations:\n      zeroCount(after.activeReservations) &&\n      deltas.activeReservations === 0,\n\n    noPositionsCreated:\n      zeroCount(after.positions) &&\n      deltas.positions === 0,\n\n    noOrderTransitionAuditRowsAdded:\n      deltas.auditRows === 0,\n\n    noInvalidTransitionAuditRowsAdded:\n      deltas.invalidAuditRows === 0,\n\n    automationRunRecorded:\n      deltas.automationRuns === 1\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, value]) => !value\n      )\n      .map(\n        ([key]) => key\n      );\n\n  const passed =\n    failed.length === 0;\n\n  const report = {\n    status:\n      passed\n        ? \"ALPHA_V3_ORDER_STATE_STRICT_OPERATIONAL_COMPATIBILITY_VERIFIED\"\n        : \"ALPHA_V3_ORDER_STATE_STRICT_OPERATIONAL_COMPATIBILITY_REVIEW\",\n\n    baseUrl,\n    startedAt,\n    finishedAt,\n    requestBody,\n\n    before,\n    operationalResponse,\n    after,\n\n    deltas,\n    checks,\n    failed,\n\n    interpretation: {\n      enforcementMode: \"STRICT\",\n\n      expectedOrderStateWrites: 0,\n\n      strictGuardActive:\n        after.config.row?.mode === \"STRICT\",\n\n      reason:\n        \"This is the final no-order production-cycle compatibility test for Order State Machine V1. It verifies the full automation pipeline remains operational while DB-level strict order-state enforcement is active.\"\n    },\n\n    safety: {\n      operationalCycleRequests: 1,\n      requestedAutoOrder: false,\n      requestedMarketSync: false,\n      expectedOrdersCreated: 0,\n      expectedPositionsChanged: 0\n    },\n\n    milestone:\n      passed\n        ? {\n            committedRiskLayer:\n              \"COMPLETE\",\n\n            orderStateMachineV1:\n              \"COMPLETE\",\n\n            nextMajorBuild:\n              \"KILL_SWITCH\"\n          }\n        : null,\n\n    nextGate:\n      passed\n        ? \"ORDER_STATE_MACHINE_V1_COMPLETE_START_KILL_SWITCH\"\n        : \"REVIEW_STRICT_OPERATIONAL_COMPATIBILITY\"\n  };\n\n  const outputFile = path.resolve(\n    root,\n    \"logs/alpha-v3-order-state-strict-operational-compatibility-v1.json\"\n  );\n\n  fs.mkdirSync(\n    path.dirname(outputFile),\n    { recursive: true }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (!passed) {\n    process.exitCode = 2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_ORDER_STATE_STRICT_OPERATIONAL_COMPATIBILITY_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          caution:\n            \"If failure occurred during the operational request, inspect current DB state before retrying.\",\n\n          nextGate:\n            \"REVIEW_STRICT_OPERATIONAL_COMPATIBILITY_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode = 2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ORDER_STATE_STRICT_OPERATIONAL_COMPATIBILITY_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-order-state-strict-operational-compatibility-v1.cjs",

      hardGuards: [
        "STATE_MACHINE_MODE_MUST_BE_STRICT",
        "STATE_MACHINE_VERSION_MUST_MATCH_V1",
        "PAPER_ORDER_TABLE_MUST_BE_EMPTY",
        "RISK_APPROVED_COUNT_MUST_BE_ZERO",
        "ACTIVE_RESERVED_RISK_COUNT_MUST_BE_ZERO",
        "PAPER_POSITION_COUNT_MUST_BE_ZERO",
        "INVALID_AUDIT_COUNT_MUST_BE_ZERO"
      ],

      operationalRequest: {
        path:
          "/api/trading/automation/manual",

        triggerType:
          "MANUAL",

        includeMarketSync:
          false,

        autoOrder:
          false,

        maxOrders:
          1
      },

      passCriteria: [
        "HTTP_SUCCESS",
        "AUTOMATION_STATUS_SUCCESS",
        "STRICT_MODE_UNCHANGED",
        "NO_ORDER_CREATED",
        "NO_POSITION_CREATED",
        "NO_RESERVED_RISK_CREATED",
        "ORDER_AUDIT_DELTA_ZERO",
        "INVALID_AUDIT_DELTA_ZERO",
        "AUTOMATION_RUN_DELTA_ONE"
      ],

      milestoneOnPass:
        "ORDER_STATE_MACHINE_V1_COMPLETE",

      nextMajorBuildOnPass:
        "KILL_SWITCH",

      nextAction:
        "RUN_STRICT_MODE_NO_ORDER_OPERATIONAL_COMPATIBILITY"
    },
    null,
    2
  )
);
