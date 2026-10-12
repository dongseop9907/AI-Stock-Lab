const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

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

function trimBaseUrl(value) {
  return String(
    value ?? ""
  )
    .trim()
    .replace(/\/+$/, "");
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 15000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function reachable(baseUrl) {
  try {
    const response =
      await fetchWithTimeout(
        baseUrl,
        {
          method:
            "GET",
          cache:
            "no-store"
        },
        8000
      );

    return response.status >=
      100;
  } catch {
    return false;
  }
}

async function detectBaseUrl() {
  const configured =
    trimBaseUrl(
      env.AI_STOCK_LAB_BASE_URL
    );

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

async function parseResponse(
  response
) {
  const text =
    await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return {
      raw:
        text
    };
  }
}

function getSupabaseConfig() {
  const url =
    trimBaseUrl(
      env.NEXT_PUBLIC_SUPABASE_URL ||
      env.SUPABASE_URL
    );

  const serviceRoleKey =
    String(
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_KEY ||
      ""
    ).trim();

  return {
    url,
    serviceRoleKey
  };
}

async function supabaseCount(
  supabase,
  table,
  query = "select=id"
) {
  if (
    !supabase.url ||
    !supabase.serviceRoleKey
  ) {
    return {
      ok: false,
      count: null,
      status: null,
      error:
        "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    };
  }

  const url =
    supabase.url +
    "/rest/v1/" +
    table +
    "?" +
    query;

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method:
            "GET",

          headers: {
            apikey:
              supabase.serviceRoleKey,

            authorization:
              "Bearer " +
              supabase.serviceRoleKey,

            prefer:
              "count=exact",

            range:
              "0-0"
          },

          cache:
            "no-store"
        },
        10000
      );

    const contentRange =
      response.headers.get(
        "content-range"
      );

    let count =
      null;

    if (contentRange) {
      const match =
        contentRange.match(
          /\/(\d+|\*)$/
        );

      if (
        match &&
        match[1] !== "*"
      ) {
        count =
          Number(
            match[1]
          );
      }
    }

    const payload =
      await parseResponse(
        response
      );

    return {
      ok:
        response.ok,
      count,
      status:
        response.status,
      contentRange,
      error:
        response.ok
          ? null
          : payload
    };
  } catch (error) {
    return {
      ok: false,
      count: null,
      status: null,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function snapshot(
  supabase
) {
  const [
    riskApprovedOrders,
    activeReservations,
    paperPositions,
    automationRuns
  ] =
    await Promise.all([
      supabaseCount(
        supabase,
        "paper_order_requests",
        [
          "select=id",
          "status=eq.RISK_APPROVED"
        ].join("&")
      ),

      supabaseCount(
        supabase,
        "paper_order_requests",
        [
          "select=id",
          "reserved_risk_amount=gt.0",
          "reserved_risk_released_at=is.null"
        ].join("&")
      ),

      supabaseCount(
        supabase,
        "paper_positions",
        "select=id"
      ),

      supabaseCount(
        supabase,
        "trading_automation_runs",
        "select=id"
      )
    ]);

  return {
    riskApprovedOrders,
    activeReservations,
    paperPositions,
    automationRuns
  };
}

function countIsZero(result) {
  return (
    result.ok === true &&
    result.count === 0
  );
}

function countIsKnown(result) {
  return (
    result.ok === true &&
    Number.isInteger(
      result.count
    )
  );
}

async function main() {
  const baseUrl =
    await detectBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "NEXT_SERVER_NOT_REACHABLE_3000_TO_3010"
    );
  }

  const secretConfigured =
    Boolean(
      String(
        env.TRADING_AUTOMATION_SECRET ??
        ""
      ).trim()
    );

  if (!secretConfigured) {
    throw new Error(
      "TRADING_AUTOMATION_SECRET_NOT_CONFIGURED"
    );
  }

  const supabase =
    getSupabaseConfig();

  const before =
    await snapshot(
      supabase
    );

  const blockers = [];

  if (
    !countIsZero(
      before.riskApprovedOrders
    )
  ) {
    blockers.push(
      "RISK_APPROVED_ORDER_COUNT_NOT_ZERO"
    );
  }

  if (
    !countIsZero(
      before.activeReservations
    )
  ) {
    blockers.push(
      "ACTIVE_RESERVED_RISK_COUNT_NOT_ZERO"
    );
  }

  /*
   * First operational smoke is intentionally stricter than normal operation.
   * Existing paper positions could allow trailing-stop / stop-loss steps
   * to mutate position state even with autoOrder=false.
   */
  if (
    !countIsZero(
      before.paperPositions
    )
  ) {
    blockers.push(
      "PAPER_POSITION_COUNT_NOT_ZERO"
    );
  }

  if (
    !countIsKnown(
      before.automationRuns
    )
  ) {
    blockers.push(
      "AUTOMATION_RUN_COUNT_NOT_VERIFIED"
    );
  }

  if (
    blockers.length > 0
  ) {
    const blockedReport = {
      status:
        "ALPHA_V3_CONTROLLED_NO_ORDER_ONE_SHOT_BLOCKED",

      baseUrl,
      before,
      blockers,

      safety: {
        operationalCycleRequests:
          0,

        databaseWritesFromCycle:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextGate:
        "RESOLVE_ONE_SHOT_BLOCKERS"
    };

    console.log(
      JSON.stringify(
        blockedReport,
        null,
        2
      )
    );

    process.exitCode =
      2;

    return;
  }

  const requestBody = {
    triggerType:
      "MANUAL",

    includeMarketSync:
      false,

    autoOrder:
      false,

    maxOrders:
      1
  };

  const startedAt =
    new Date()
      .toISOString();

  let operationalResponse;

  try {
    const response =
      await fetchWithTimeout(
        baseUrl +
        "/api/trading/automation/manual",
        {
          method:
            "POST",

          headers: {
            "content-type":
              "application/json; charset=utf-8",

            origin:
              baseUrl
          },

          body:
            JSON.stringify(
              requestBody
            ),

          cache:
            "no-store"
        },
        180000
      );

    operationalResponse = {
      status:
        response.status,

      ok:
        response.ok,

      payload:
        await parseResponse(
          response
        )
    };
  } catch (error) {
    operationalResponse = {
      status:
        null,

      ok:
        false,

      payload:
        null,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  const finishedAt =
    new Date()
      .toISOString();

  const after =
    await snapshot(
      supabase
    );

  const responseStatus =
    operationalResponse
      ?.payload
      ?.automationRun
      ?.payload
      ?.status ??
    operationalResponse
      ?.payload
      ?.status ??
    null;

  const runCountDelta =
    (
      countIsKnown(
        before.automationRuns
      ) &&
      countIsKnown(
        after.automationRuns
      )
    )
      ? after.automationRuns.count -
        before.automationRuns.count
      : null;

  const checks = {
    responseHttpSuccess:
      operationalResponse.ok ===
        true,

    automationSemanticSuccess:
      responseStatus ===
        "SUCCESS",

    riskApprovedOrdersRemainZero:
      countIsZero(
        after.riskApprovedOrders
      ),

    activeReservationsRemainZero:
      countIsZero(
        after.activeReservations
      ),

    paperPositionsRemainZero:
      countIsZero(
        after.paperPositions
      ),

    automationRunRecorded:
      runCountDelta ===
        1
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          !value
      )
      .map(
        ([key]) =>
          key
      );

  const passed =
    failed.length ===
      0;

  const report = {
    status:
      passed
        ? "ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_VERIFIED"
        : "ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_REVIEW",

    baseUrl,
    startedAt,
    finishedAt,

    requestBody,

    before,
    operationalResponse,
    after,

    checks,
    failed,

    deltas: {
      automationRunCount:
        runCountDelta,

      riskApprovedOrders:
        (
          countIsKnown(
            before.riskApprovedOrders
          ) &&
          countIsKnown(
            after.riskApprovedOrders
          )
        )
          ? after.riskApprovedOrders.count -
            before.riskApprovedOrders.count
          : null,

      activeReservations:
        (
          countIsKnown(
            before.activeReservations
          ) &&
          countIsKnown(
            after.activeReservations
          )
        )
          ? after.activeReservations.count -
            before.activeReservations.count
          : null,

      paperPositions:
        (
          countIsKnown(
            before.paperPositions
          ) &&
          countIsKnown(
            after.paperPositions
          )
        )
          ? after.paperPositions.count -
            before.paperPositions.count
          : null
    },

    safety: {
      operationalCycleRequests:
        1,

      requestedAutoOrder:
        false,

      requestedMarketSync:
        false,

      expectedOrderCreation:
        false,

      expectedApprovedExecution:
        false,

      expectedPositionMutation:
        false,

      databaseWritesExpected:
        "AUTOMATION_RUN_LOGS_AND_NON_ORDER_PIPELINE_DATA_ONLY"
    },

    nextGate:
      passed
        ? "COMMITTED_RISK_OPERATIONAL_LAYER_COMPLETE_PREPARE_ORDER_STATE_MACHINE"
        : "REVIEW_FIRST_OPERATIONAL_ONE_SHOT"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-controlled-no-order-operational-one-shot.json"
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
            "ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          caution:
            "REQUEST_MAY_OR_MAY_NOT_HAVE_REACHED_SERVER_IF_FAILURE_OCCURRED_DURING_OPERATIONAL_CALL",

          nextGate:
            "REVIEW_FIRST_OPERATIONAL_ONE_SHOT_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
