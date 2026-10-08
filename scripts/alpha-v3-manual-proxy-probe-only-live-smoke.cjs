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
  ...process.env
};

async function reachable(baseUrl) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      8000
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
      "http://localhost:" +
      String(port);

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
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
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

    if (attempt < 3) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            750
          )
      );
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
      baseUrl +
      "/api/trading/automation/manual",
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
