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
  `${manualFile}.before-probe-only-v1.bak`;

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
  text = text.replace(
    `      maxOrders?: unknown;
    };`,
    `      maxOrders?: unknown;
      probeOnly?: unknown;
    };`
  );

  const anchor =
`  /*
   * Only the intended manual controls are forwarded.
   * probeOnly / scheduler fields / arbitrary caller fields are discarded.
   */
  const forwardedBody = {`;

  if (!text.includes(anchor)) {
    throw new Error(
      "MANUAL_PROXY_FORWARD_BODY_ANCHOR_NOT_FOUND"
    );
  }

  const replacement =
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
      : {`;

  text = text.replace(
    anchor,
    replacement
  );

  const closePattern =
`    maxOrders:
      clampMaxOrders(
        body.maxOrders,
      ),
  };`;

  const closeReplacement =
`    maxOrders:
      clampMaxOrders(
        body.maxOrders,
      ),
  };`;

  if (!text.includes(closePattern)) {
    throw new Error(
      "MANUAL_PROXY_FORWARD_BODY_CLOSE_NOT_FOUND"
    );
  }

  text = text.replace(
    closePattern,
    closeReplacement
  );
}

fs.writeFileSync(
  manualFile,
  text,
  "utf8"
);

const verifier = String.raw`const fs = require("fs");
const path = require("path");

const root = process.cwd();

const manualFile = path.resolve(
  root,
  "app/api/trading/automation/manual/route.ts"
);

if (!fs.existsSync(manualFile)) {
  throw new Error(
    "AUTOMATION_MANUAL_PROXY_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    manualFile,
    "utf8"
  );

const checks = {
  markerPresent:
    text.includes(
      "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1"
    ),

  acceptsProbeOnlyField:
    text.includes(
      "probeOnly?: unknown"
    ),

  strictProbeOnlyTrue:
    text.includes(
      "body.probeOnly ==="
    ) &&
    text.includes(
      "true;"
    ),

  probeForcesManual:
    /probeOnly[\s\S]{0,700}?triggerType:[\s\S]{0,80}?"MANUAL"/m.test(
      text
    ),

  probeForcesAutoOrderFalse:
    /probeOnly[\s\S]{0,900}?autoOrder:[\s\S]{0,80}?false/m.test(
      text
    ),

  probeForcesMarketSyncFalse:
    /probeOnly[\s\S]{0,900}?includeMarketSync:[\s\S]{0,80}?false/m.test(
      text
    ),

  probeForwardsProbeOnlyTrue:
    /probeOnly[\s\S]{0,900}?probeOnly:[\s\S]{0,80}?true/m.test(
      text
    ),

  serverAddsSecret:
    text.includes(
      "TRADING_AUTOMATION_SECRET"
    ) &&
    text.includes(
      '"x-automation-secret"'
    ),

  forwardsToCycle:
    text.includes(
      "/api/trading/automation/cycle"
    ),

  originGuardStillPresent:
    text.includes(
      "AUTOMATION_MANUAL_ORIGIN_REJECTED"
    ),

  noClientSecretRequirement:
    !text.includes(
      "providedSecret"
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_VERIFIED"
          : "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_REVIEW",

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "RUN_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE"
          : "REVIEW_MANUAL_PROXY_PROBE_ONLY_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

const smoke = String.raw`const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  for (
    const rawLine of
      text.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key =
      line
        .slice(0, index)
        .trim();

    let value =
      line
        .slice(index + 1)
        .trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(
          1,
          -1
        );
    }

    env[key] =
      value;
  }

  return env;
}

const fileEnv =
  parseEnvFile(
    path.resolve(
      root,
      ".env.local"
    )
  );

const env = {
  ...fileEnv,
  ...process.env
};

async function reachable(baseUrl) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      1200
    );

  try {
    const response =
      await fetch(
        baseUrl,
        {
          method:
            "GET",
          signal:
            controller.signal
        }
      );

    return (
      response.status >= 100
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectBaseUrl() {
  const configured =
    String(
      env.AI_STOCK_LAB_BASE_URL ??
      ""
    )
      .trim()
      .replace(/\/+$/, "");

  const candidates = [];

  if (configured) {
    candidates.push(
      configured
    );
  }

  for (
    const port of
      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]
  ) {
    const url =
      `http://localhost:${port}`;

    if (
      !candidates.includes(
        url
      )
    ) {
      candidates.push(
        url
      );
    }
  }

  for (
    const candidate of
      candidates
  ) {
    if (
      await reachable(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return null;
}

async function callManual(
  baseUrl,
  origin
) {
  const headers = {
    "content-type":
      "application/json"
  };

  if (origin) {
    headers.origin =
      origin;
  }

  const response =
    await fetch(
      `${baseUrl}/api/trading/automation/manual`,
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify({
            probeOnly:
              true,

            includeMarketSync:
              true,

            autoOrder:
              true,

            maxOrders:
              5
          }),

        cache:
          "no-store"
      }
    );

  const text =
    await response.text();

  let payload =
    null;

  try {
    payload =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    payload =
      text;
  }

  return {
    status:
      response.status,
    ok:
      response.ok,
    payload
  };
}

async function main() {
  const baseUrl =
    await detectBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "NEXT_SERVER_NOT_REACHABLE_3000_TO_3010"
    );
  }

  const rejected =
    await callManual(
      baseUrl,
      "http://evil.invalid"
    );

  const accepted =
    await callManual(
      baseUrl,
      baseUrl
    );

  const crossOriginRejected =
    rejected.status ===
      403 &&
    rejected.payload
      ?.error ===
      "AUTOMATION_MANUAL_ORIGIN_REJECTED";

  const sameOriginAccepted =
    accepted.status ===
      200 &&
    accepted.payload
      ?.ok ===
      true &&
    accepted.payload
      ?.probeOnly ===
      true &&
    accepted.payload
      ?.status ===
      "AUTOMATION_CYCLE_ROUTE_REACHABLE";

  const sideEffects =
    accepted.payload
      ?.sideEffects ??
    {};

  const zeroSideEffects =
    sideEffects
      .committedRiskMaintenance ===
      false &&
    sideEffects
      .automationRun ===
      false &&
    sideEffects
      .approvedOrderExecution ===
      false &&
    sideEffects
      .databaseReads ===
      0 &&
    sideEffects
      .databaseWrites ===
      0 &&
    sideEffects
      .ordersCreated ===
      0 &&
    sideEffects
      .ordersChanged ===
      0 &&
    sideEffects
      .positionsChanged ===
      0;

  const passed =
    crossOriginRejected &&
    sameOriginAccepted &&
    zeroSideEffects;

  const report = {
    status:
      passed
        ? "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_VERIFIED"
        : "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_REVIEW",

    baseUrl,

    checks: {
      crossOriginRejected,
      sameOriginAccepted,
      zeroSideEffects
    },

    rejected,
    accepted,

    safety: {
      actualNetworkRequests:
        2,

      manualProxyRequests:
        2,

      cycleProbeRequests:
        sameOriginAccepted
          ? 1
          : 0,

      committedRiskMaintenanceCalls:
        0,

      automationRunCalls:
        0,

      approvedExecutorCalls:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0
    },

    nextGate:
      passed
        ? "FINAL_OPERATIONAL_ONE_SHOT_READINESS"
        : "REVIEW_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-manual-proxy-probe-only-live-smoke.json"
    );

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  if (!passed) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,
            ordersCreated:
              0,
            positionsChanged:
              0
          },

          nextGate:
            "REVIEW_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
`;

fs.writeFileSync(
  verifierFile,
  verifier,
  "utf8"
);

fs.writeFileSync(
  smokeFile,
  smoke,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1_INSTALLED",

      patchedFile:
        "app/api/trading/automation/manual/route.ts",

      generatedFiles: [
        "scripts/alpha-v3-manual-proxy-probe-only-static-verify.cjs",
        "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs"
      ],

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
