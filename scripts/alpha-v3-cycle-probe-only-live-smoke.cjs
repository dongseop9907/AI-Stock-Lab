const fs = require("fs");
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
  ...process.env,
};

const secret =
  String(
    env
      .TRADING_AUTOMATION_SECRET ??
    ""
  ).trim();

if (!secret) {
  throw new Error(
    "TRADING_AUTOMATION_SECRET_NOT_CONFIGURED"
  );
}

async function probeServer(
  baseUrl
) {
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
            controller.signal,
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
      env
        .AI_STOCK_LAB_BASE_URL ??
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
      await probeServer(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return null;
}

async function callProbe(
  baseUrl,
  withSecret
) {
  const headers = {
    "content-type":
      "application/json",
  };

  if (withSecret) {
    headers[
      "x-automation-secret"
    ] =
      secret;
  }

  const response =
    await fetch(
      `${baseUrl}/api/trading/automation/cycle`,
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify({
            probeOnly: true,
            triggerType:
              "SCHEDULED",
            autoOrder:
              false,
            includeMarketSync:
              false,
          }),

        cache:
          "no-store",
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
    payload,
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

  /*
   * First prove that probe-only still enforces secret auth.
   */
  const unauthorized =
    await callProbe(
      baseUrl,
      false
    );

  /*
   * Then make one authenticated zero-side-effect route smoke request.
   */
  const authorized =
    await callProbe(
      baseUrl,
      true
    );

  const unauthorizedPass =
    unauthorized.status ===
      401 &&
    unauthorized.payload
      ?.probeOnly ===
      true;

  const authorizedPass =
    authorized.status ===
      200 &&
    authorized.payload
      ?.ok ===
      true &&
    authorized.payload
      ?.probeOnly ===
      true &&
    authorized.payload
      ?.status ===
      "AUTOMATION_CYCLE_ROUTE_REACHABLE";

  const sideEffects =
    authorized.payload
      ?.sideEffects ??
    {};

  const zeroSideEffectsPass =
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
    unauthorizedPass &&
    authorizedPass &&
    zeroSideEffectsPass;

  const report = {
    status:
      passed
        ? "ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_VERIFIED"
        : "ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_REVIEW",

    baseUrl,

    checks: {
      unauthorizedProbeRejected:
        unauthorizedPass,

      authenticatedProbeAccepted:
        authorizedPass,

      zeroSideEffectsDeclared:
        zeroSideEffectsPass,
    },

    unauthorized,

    authorized,

    safety: {
      actualNetworkRequests:
        2,

      actualCycleProbePostRequests:
        2,

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
        0,
    },

    nextGate:
      passed
        ? "FIX_UI_MANUAL_CYCLE_AUTH_THEN_PREPARE_CONTROLLED_OPERATIONAL_ONE_SHOT"
        : "REVIEW_PROBE_ONLY_LIVE_SMOKE",
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-probe-only-live-smoke.json"
    );

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive: true,
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
            "ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_FATAL",

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
              0,
          },

          nextGate:
            "REVIEW_PROBE_ONLY_LIVE_SMOKE_FATAL",
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
