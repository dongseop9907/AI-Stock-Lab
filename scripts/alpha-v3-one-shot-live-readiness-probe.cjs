const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputFile = path.resolve(
  root,
  "logs/alpha-v3-one-shot-live-readiness-probe.json"
);

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  const text = fs.readFileSync(
    file,
    "utf8"
  );

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const idx =
      line.indexOf("=");

    if (idx <= 0) {
      continue;
    }

    const key =
      line
        .slice(0, idx)
        .trim();

    let value =
      line
        .slice(idx + 1)
        .trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value =
        value.slice(1, -1);
    }

    env[key] =
      value;
  }

  return env;
}

const envFile =
  path.resolve(
    root,
    ".env.local"
  );

const fileEnv =
  parseEnvFile(
    envFile
  );

const env = {
  ...fileEnv,
  ...process.env,
};

function nonEmpty(name) {
  return Boolean(
    String(
      env[name] ?? ""
    ).trim()
  );
}

async function probeUrl(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      1500
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          signal:
            controller.signal,
          redirect:
            "manual",
        }
      );

    return {
      reachable: true,
      status:
        response.status,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(
      timeout
    );
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

  const attempts = [];

  for (const candidate of candidates) {
    const result =
      await probeUrl(
        candidate
      );

    attempts.push({
      url:
        candidate,
      ...result,
    });

    if (
      result.reachable
    ) {
      return {
        baseUrl:
          candidate,
        attempts,
      };
    }
  }

  return {
    baseUrl:
      null,
    attempts,
  };
}

async function readApprovedOrders() {
  const supabaseUrl =
    String(
      env.NEXT_PUBLIC_SUPABASE_URL ??
      env.SUPABASE_URL ??
      ""
    )
      .trim()
      .replace(/\/+$/, "");

  const serviceRoleKey =
    String(
      env.SUPABASE_SERVICE_ROLE_KEY ??
      ""
    ).trim();

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return {
      available:
        false,

      reason:
        "SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING",

      count:
        null,

      sample:
        [],
    };
  }

  const params =
    new URLSearchParams({
      select:
        "id,status,side,account_id,stock_code,requested_quantity,entry_price,stop_price,reserved_risk_amount,reserved_risk_at,created_at",

      status:
        "eq.RISK_APPROVED",

      side:
        "eq.BUY",

      order:
        "created_at.asc",

      limit:
        "20",
    });

  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/paper_order_requests?${params.toString()}`,
      {
        method:
          "GET",

        headers: {
          apikey:
            serviceRoleKey,

          Authorization:
            `Bearer ${serviceRoleKey}`,
        },

        cache:
          "no-store",
      }
    );

  const text =
    await response.text();

  let payload;

  try {
    payload =
      text
        ? JSON.parse(text)
        : [];
  } catch {
    payload =
      text;
  }

  if (!response.ok) {
    return {
      available:
        false,

      reason:
        `SUPABASE_READ_FAILED:${response.status}`,

      count:
        null,

      sample:
        [],

      detail:
        typeof payload === "string"
          ? payload.slice(0, 500)
          : payload,
    };
  }

  const rows =
    Array.isArray(payload)
      ? payload
      : [];

  return {
    available:
      true,

    reason:
      null,

    count:
      rows.length,

    sample:
      rows.map(
        (row) => ({
          id:
            row.id,

          stockCode:
            row.stock_code,

          requestedQuantity:
            row.requested_quantity,

          entryPrice:
            row.entry_price,

          stopPrice:
            row.stop_price,

          reservedRiskAmount:
            row.reserved_risk_amount,

          reservedRiskAt:
            row.reserved_risk_at,

          createdAt:
            row.created_at,
        })
      ),
  };
}

async function main() {
  const server =
    await detectBaseUrl();

  const approvedOrders =
    await readApprovedOrders();

  const routeFile =
    path.resolve(
      root,
      "app/api/trading/automation/cycle/route.ts"
    );

  const schedulerFile =
    path.resolve(
      root,
      "scripts/alpha-v3-automation-cycle-scheduler.ts"
    );

  const secretConfigured =
    nonEmpty(
      "TRADING_AUTOMATION_SECRET"
    );

  const cycleRouteExists =
    fs.existsSync(
      routeFile
    );

  const schedulerExists =
    fs.existsSync(
      schedulerFile
    );

  const safeForOneShot =
    Boolean(
      server.baseUrl &&
      secretConfigured &&
      cycleRouteExists &&
      schedulerExists &&
      approvedOrders.available &&
      approvedOrders.count === 0
    );

  const requiresExplicitOrderExecutionAwareness =
    Boolean(
      approvedOrders.available &&
      Number(
        approvedOrders.count
      ) > 0
    );

  const report = {
    status:
      "ALPHA_V3_ONE_SHOT_LIVE_READINESS_PROBE_COMPLETE",

    server,

    configuration: {
      envLocalExists:
        fs.existsSync(
          envFile
        ),

      tradingAutomationSecretConfigured:
        secretConfigured,

      aiStockLabBaseUrlConfigured:
        nonEmpty(
          "AI_STOCK_LAB_BASE_URL"
        ),

      detectedBaseUrl:
        server.baseUrl,

      cycleRouteExists,

      schedulerExists,
    },

    approvedPaperBuyOrders:
      approvedOrders,

    decision: {
      safeForOneShotWithoutExistingApprovedOrderExecution:
        safeForOneShot,

      requiresExplicitOrderExecutionAwareness,

      nextGate:
        !server.baseUrl
          ? "START_NEXT_SERVER_THEN_RERUN_READINESS_PROBE"
          : !secretConfigured
            ? "CONFIGURE_TRADING_AUTOMATION_SECRET"
            : !approvedOrders.available
              ? "REVIEW_READ_ONLY_SUPABASE_ACCESS"
              : approvedOrders.count > 0
                ? "REVIEW_PENDING_APPROVED_PAPER_ORDERS_BEFORE_ONE_SHOT"
                : "RUN_ONE_SHOT_LIVE_ROUTE_SMOKE_TEST",
    },

    safety: {
      databaseReads:
        approvedOrders.available
          ? 1
          : 0,

      databaseWrites:
        0,

      cyclePostRequests:
        0,

      productionOrdersCreated:
        0,

      productionOrdersChanged:
        0,

      productionPositionsChanged:
        0,
    },

    outputFile:
      "logs/alpha-v3-one-shot-live-readiness-probe.json",
  };

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
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_ONE_SHOT_LIVE_READINESS_PROBE_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            cyclePostRequests:
              0,

            productionOrdersCreated:
              0,

            productionPositionsChanged:
              0,
          },

          nextGate:
            "REVIEW_ONE_SHOT_LIVE_READINESS_PROBE_FATAL",
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
