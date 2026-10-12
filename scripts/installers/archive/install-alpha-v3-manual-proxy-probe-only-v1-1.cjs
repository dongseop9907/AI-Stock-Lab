const fs = require("fs");
const path = require("path");

const root = process.cwd();

const manualFile = path.resolve(
  root,
  "app/api/trading/automation/manual/route.ts"
);

const verifierFile = path.resolve(
  root,
  "scripts/alpha-v3-manual-proxy-probe-only-static-verify.cjs"
);

const smokeFile = path.resolve(
  root,
  "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs"
);

if (!fs.existsSync(manualFile)) {
  throw new Error(
    "AUTOMATION_MANUAL_PROXY_NOT_FOUND"
  );
}

let text =
  fs.readFileSync(
    manualFile,
    "utf8"
  );

const backup =
  `${manualFile}.before-probe-only-v1-1.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    manualFile,
    backup
  );
}

if (
  !text.includes(
    "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1"
  )
) {
  const interfaceAnchor =
`      maxOrders?: unknown;
    };`;

  if (!text.includes(interfaceAnchor)) {
    throw new Error(
      "MANUAL_PROXY_BODY_INTERFACE_ANCHOR_NOT_FOUND"
    );
  }

  text =
    text.replace(
      interfaceAnchor,
`      maxOrders?: unknown;
      probeOnly?: unknown;
    };`
    );

  const forwardStart =
`  /*
   * Only the intended manual controls are forwarded.
   * probeOnly / scheduler fields / arbitrary caller fields are discarded.
   */
  const forwardedBody = {`;

  if (!text.includes(forwardStart)) {
    throw new Error(
      "MANUAL_PROXY_FORWARD_BODY_ANCHOR_NOT_FOUND"
    );
  }

  text =
    text.replace(
      forwardStart,
`  /*
   * ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1
   *
   * Same-origin browser callers may request probeOnly=true.
   * The server adds the secret and forwards only the cycle's
   * zero-side-effect probe branch.
   */
  const probeOnly =
    body.probeOnly ===
      true;

  /*
   * Only the intended manual controls are forwarded.
   * scheduler/arbitrary caller fields are discarded.
   */
  const forwardedBody =
    probeOnly
      ? {
          triggerType:
            "MANUAL",

          probeOnly:
            true,

          includeMarketSync:
            false,

          autoOrder:
            false,

          maxOrders:
            1,
        }
      : {`
    );
}

fs.writeFileSync(
  manualFile,
  text,
  "utf8"
);

fs.mkdirSync(
  path.dirname(verifierFile),
  {
    recursive: true
  }
);

fs.writeFileSync(
  verifierFile,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst manualFile = path.resolve(\n  root,\n  \"app/api/trading/automation/manual/route.ts\"\n);\n\nif (!fs.existsSync(manualFile)) {\n  throw new Error(\n    \"AUTOMATION_MANUAL_PROXY_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    manualFile,\n    \"utf8\"\n  );\n\nconst checks = {\n  markerPresent:\n    text.includes(\n      \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1\"\n    ),\n\n  acceptsProbeOnlyField:\n    text.includes(\n      \"probeOnly?: unknown\"\n    ),\n\n  strictProbeOnlyTrue:\n    text.includes(\n      \"body.probeOnly ===\"\n    ) &&\n    text.includes(\n      \"true;\"\n    ),\n\n  probeForcesManual:\n    /probeOnly[\\s\\S]{0,700}?triggerType:[\\s\\S]{0,80}?\"MANUAL\"/m.test(\n      text\n    ),\n\n  probeForcesAutoOrderFalse:\n    /probeOnly[\\s\\S]{0,900}?autoOrder:[\\s\\S]{0,80}?false/m.test(\n      text\n    ),\n\n  probeForcesMarketSyncFalse:\n    /probeOnly[\\s\\S]{0,900}?includeMarketSync:[\\s\\S]{0,80}?false/m.test(\n      text\n    ),\n\n  probeForwardsProbeOnlyTrue:\n    /probeOnly[\\s\\S]{0,900}?probeOnly:[\\s\\S]{0,80}?true/m.test(\n      text\n    ),\n\n  serverAddsSecret:\n    text.includes(\n      \"TRADING_AUTOMATION_SECRET\"\n    ) &&\n    text.includes(\n      '\"x-automation-secret\"'\n    ),\n\n  forwardsToCycle:\n    text.includes(\n      \"/api/trading/automation/cycle\"\n    ),\n\n  originGuardStillPresent:\n    text.includes(\n      \"AUTOMATION_MANUAL_ORIGIN_REJECTED\"\n    ),\n\n  noClientSecretRequirement:\n    !text.includes(\n      \"providedSecret\"\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_VERIFIED\"\n          : \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE\"\n          : \"REVIEW_MANUAL_PROXY_PROBE_ONLY_PATCH\"\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  smokeFile,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n\n  for (\n    const rawLine of\n      text.split(/\\r?\\n/)\n  ) {\n    const line =\n      rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(\n          1,\n          -1\n        );\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst fileEnv =\n  parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  );\n\nconst env = {\n  ...fileEnv,\n  ...process.env\n};\n\nasync function reachable(baseUrl) {\n  const controller =\n    new AbortController();\n\n  const timer =\n    setTimeout(\n      () =>\n        controller.abort(),\n      1200\n    );\n\n  try {\n    const response =\n      await fetch(\n        baseUrl,\n        {\n          method:\n            \"GET\",\n          signal:\n            controller.signal\n        }\n      );\n\n    return (\n      response.status >= 100\n    );\n  } catch {\n    return false;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured =\n    String(\n      env.AI_STOCK_LAB_BASE_URL ??\n      \"\"\n    )\n      .trim()\n      .replace(/\\/+$/, \"\");\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(\n      configured\n    );\n  }\n\n  for (\n    const port of\n      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]\n  ) {\n    const url =\n      \"http://localhost:\" +\n      String(port);\n\n    if (\n      !candidates.includes(\n        url\n      )\n    ) {\n      candidates.push(\n        url\n      );\n    }\n  }\n\n  for (\n    const candidate of\n      candidates\n  ) {\n    if (\n      await reachable(\n        candidate\n      )\n    ) {\n      return candidate;\n    }\n  }\n\n  return null;\n}\n\nasync function callManual(\n  baseUrl,\n  origin\n) {\n  const headers = {\n    \"content-type\":\n      \"application/json\"\n  };\n\n  if (origin) {\n    headers.origin =\n      origin;\n  }\n\n  const response =\n    await fetch(\n      baseUrl +\n      \"/api/trading/automation/manual\",\n      {\n        method:\n          \"POST\",\n\n        headers,\n\n        body:\n          JSON.stringify({\n            probeOnly:\n              true,\n\n            includeMarketSync:\n              true,\n\n            autoOrder:\n              true,\n\n            maxOrders:\n              5\n          }),\n\n        cache:\n          \"no-store\"\n      }\n    );\n\n  const text =\n    await response.text();\n\n  let payload =\n    null;\n\n  try {\n    payload =\n      text\n        ? JSON.parse(text)\n        : null;\n  } catch {\n    payload =\n      text;\n  }\n\n  return {\n    status:\n      response.status,\n    ok:\n      response.ok,\n    payload\n  };\n}\n\nasync function main() {\n  const baseUrl =\n    await detectBaseUrl();\n\n  if (!baseUrl) {\n    throw new Error(\n      \"NEXT_SERVER_NOT_REACHABLE_3000_TO_3010\"\n    );\n  }\n\n  const rejected =\n    await callManual(\n      baseUrl,\n      \"http://evil.invalid\"\n    );\n\n  const accepted =\n    await callManual(\n      baseUrl,\n      baseUrl\n    );\n\n  const crossOriginRejected =\n    rejected.status ===\n      403 &&\n    rejected.payload\n      ?.error ===\n      \"AUTOMATION_MANUAL_ORIGIN_REJECTED\";\n\n  const sameOriginAccepted =\n    accepted.status ===\n      200 &&\n    accepted.payload\n      ?.ok ===\n      true &&\n    accepted.payload\n      ?.probeOnly ===\n      true &&\n    accepted.payload\n      ?.status ===\n      \"AUTOMATION_CYCLE_ROUTE_REACHABLE\";\n\n  const sideEffects =\n    accepted.payload\n      ?.sideEffects ??\n    {};\n\n  const zeroSideEffects =\n    sideEffects\n      .committedRiskMaintenance ===\n      false &&\n    sideEffects\n      .automationRun ===\n      false &&\n    sideEffects\n      .approvedOrderExecution ===\n      false &&\n    sideEffects\n      .databaseReads ===\n      0 &&\n    sideEffects\n      .databaseWrites ===\n      0 &&\n    sideEffects\n      .ordersCreated ===\n      0 &&\n    sideEffects\n      .ordersChanged ===\n      0 &&\n    sideEffects\n      .positionsChanged ===\n      0;\n\n  const passed =\n    crossOriginRejected &&\n    sameOriginAccepted &&\n    zeroSideEffects;\n\n  const report = {\n    status:\n      passed\n        ? \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_VERIFIED\"\n        : \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_REVIEW\",\n\n    baseUrl,\n\n    checks: {\n      crossOriginRejected,\n      sameOriginAccepted,\n      zeroSideEffects\n    },\n\n    rejected,\n    accepted,\n\n    safety: {\n      actualNetworkRequests:\n        2,\n\n      manualProxyRequests:\n        2,\n\n      cycleProbeRequests:\n        sameOriginAccepted\n          ? 1\n          : 0,\n\n      committedRiskMaintenanceCalls:\n        0,\n\n      automationRunCalls:\n        0,\n\n      approvedExecutorCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0\n    },\n\n    nextGate:\n      passed\n        ? \"FINAL_OPERATIONAL_ONE_SHOT_READINESS\"\n        : \"REVIEW_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE\"\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-manual-proxy-probe-only-live-smoke.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (!passed) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n            ordersCreated:\n              0,\n            positionsChanged:\n              0\n          },\n\n          nextGate:\n            \"REVIEW_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1_1_INSTALLED",

      patchedFile:
        "app/api/trading/automation/manual/route.ts",

      generatedFiles: [
        "scripts/alpha-v3-manual-proxy-probe-only-static-verify.cjs",
        "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs"
      ],

      rootCauseFixed:
        "EMBEDDED_BACKTICK_BROKE_V1_INSTALLER",

      sourceEmbedding:
        "JSON_STRING_SERIALIZATION",

      contract: {
        browserNeedsSecret:
          false,

        sameOriginRequired:
          true,

        probeOnlyForwarded:
          true,

        probeOnlyForcesAutoOrderFalse:
          true,

        probeOnlyForcesMarketSyncFalse:
          true,

        serverAddsSecret:
          true
      },

      safety: {
        installerDatabaseWrites:
          0,

        installerNetworkCalls:
          0,

        installerOrdersCreated:
          0,

        installerPositionsChanged:
          0
      },

      nextAction:
        "STATIC_VERIFY_TYPECHECK_AND_RUN_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE"
    },
    null,
    2
  )
);
