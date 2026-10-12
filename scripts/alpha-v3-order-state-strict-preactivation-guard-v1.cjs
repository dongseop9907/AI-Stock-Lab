const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  const text = fs.readFileSync(file, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const env = {
  ...parseEnvFile(
    path.resolve(root, ".env.local")
  ),
  ...process.env
};

function trimBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

const supabaseUrl = trimBaseUrl(
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL
);

const serviceRoleKey = String(
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

async function parseResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
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
      () => controller.abort(),
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

async function supabaseGet(
  pathname,
  preferCount = false
) {
  const headers = {
    apikey:
      serviceRoleKey,

    authorization:
      "Bearer " +
      serviceRoleKey
  };

  if (preferCount) {
    headers.prefer = "count=exact";
    headers.range = "0-0";
  }

  const response =
    await fetchWithTimeout(
      supabaseUrl + pathname,
      {
        method: "GET",
        headers,
        cache: "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  let count = null;

  if (preferCount) {
    const contentRange =
      response.headers.get(
        "content-range"
      );

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
          Number(match[1]);
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    count,
    payload:
      response.ok
        ? payload
        : null,
    error:
      response.ok
        ? null
        : payload
  };
}

async function countTable(
  table,
  query = "select=id"
) {
  return await supabaseGet(
    "/rest/v1/" +
    table +
    "?" +
    query,
    true
  );
}

async function readConfig() {
  const result =
    await supabaseGet(
      "/rest/v1/paper_order_state_machine_config" +
      "?select=id,mode,version,updated_at" +
      "&id=eq.1" +
      "&limit=1"
    );

  return {
    ...result,
    row:
      result.ok &&
      Array.isArray(result.payload)
        ? result.payload[0] ?? null
        : null
  };
}

async function readSystemControl(
  baseUrl
) {
  const response =
    await fetchWithTimeout(
      baseUrl +
      "/api/trading/system/control",
      {
        method: "GET",
        cache: "no-store"
      },
      10000
    );

  return {
    ok: response.ok,
    status: response.status,
    payload:
      await parseResponse(response)
  };
}

async function reachable(baseUrl) {
  try {
    const response =
      await fetchWithTimeout(
        baseUrl,
        {
          method: "GET",
          cache: "no-store"
        },
        8000
      );

    return response.status >= 100;
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
    candidates.push(configured);
  }

  for (const port of [
    3000,3001,3002,3003,3004,3005,
    3006,3007,3008,3009,3010
  ]) {
    const url =
      "http://localhost:" +
      String(port);

    if (!candidates.includes(url)) {
      candidates.push(url);
    }
  }

  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    for (const candidate of candidates) {
      if (await reachable(candidate)) {
        return candidate;
      }
    }

    if (attempt < 3) {
      await new Promise(
        (resolve) =>
          setTimeout(resolve, 750)
      );
    }
  }

  return null;
}

function knownCount(item) {
  return (
    item?.ok === true &&
    Number.isInteger(item?.count)
  );
}

function zeroCount(item) {
  return (
    knownCount(item) &&
    item.count === 0
  );
}

function scanProductionWriters() {
  const targets = [
    "lib/trading/paper-order-service.ts",
    "lib/trading/execute-approved-paper-orders.ts",
    "lib/trading/execute-paper-order.ts",
    "lib/trading/generate-entry-signals.ts",
    "app/api/orders/paper/route.ts",
    "app/api/orders/paper/execute/route.ts",
    "app/api/orders/paper/execute-approved/route.ts"
  ];

  const results = [];

  for (const rel of targets) {
    const abs =
      path.resolve(root, rel);

    if (!fs.existsSync(abs)) {
      results.push({
        file: rel,
        exists: false,
        directInsert: false,
        directUpdate: false
      });
      continue;
    }

    const text =
      fs.readFileSync(
        abs,
        "utf8"
      );

    const directInsert =
      /\.from\s*\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,1200}?\.insert\s*\(/m.test(
        text
      );

    const directUpdate =
      /\.from\s*\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,1600}?\.update\s*\(/m.test(
        text
      );

    results.push({
      file: rel,
      exists: true,
      directInsert,
      directUpdate,
      usesCommittedRiskCreate:
        text.includes(
          "createPaperBuyOrderWithCommittedRisk"
        ) ||
        text.includes(
          "create_paper_buy_order_with_committed_risk_v3"
        ),
      usesFillRpc:
        text.includes(
          "execute_paper_buy_order"
        )
    });
  }

  return {
    results,

    directWriterCount:
      results.filter(
        (item) =>
          item.directInsert ||
          item.directUpdate
      ).length,

    missingFiles:
      results
        .filter(
          (item) =>
            !item.exists
        )
        .map(
          (item) =>
            item.file
        )
  };
}

function checkMigrationVersionUniqueness() {
  const dir =
    path.resolve(
      root,
      "supabase/migrations"
    );

  const groups =
    new Map();

  for (
    const name of
      fs.readdirSync(dir)
  ) {
    const match =
      name.match(/^(\d+)_/);

    if (!match) {
      continue;
    }

    const version =
      match[1];

    const names =
      groups.get(version) ?? [];

    names.push(name);

    groups.set(version, names);
  }

  const duplicates =
    [...groups.entries()]
      .filter(
        ([, names]) =>
          names.length > 1
      )
      .map(
        ([version, names]) => ({
          version,
          names
        })
      );

  return {
    duplicates,

    auditMigrationPresent:
      fs.existsSync(
        path.resolve(
          root,
          "supabase/migrations/20261008001300_order_state_machine_audit_guard_v1.sql"
        )
      )
  };
}

async function main() {
  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    );
  }

  const baseUrl =
    await detectBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "NEXT_SERVER_NOT_REACHABLE_3000_TO_3010"
    );
  }

  const [
    config,
    totalOrders,
    approvedOrders,
    activeReservations,
    positions,
    auditRows,
    invalidAuditRows
  ] =
    await Promise.all([
      readConfig(),

      countTable(
        "paper_order_requests"
      ),

      countTable(
        "paper_order_requests",
        [
          "select=id",
          "status=eq.RISK_APPROVED"
        ].join("&")
      ),

      countTable(
        "paper_order_requests",
        [
          "select=id",
          "reserved_risk_amount=gt.0",
          "reserved_risk_released_at=is.null"
        ].join("&")
      ),

      countTable(
        "paper_positions"
      ),

      countTable(
        "paper_order_state_transition_audit"
      ),

      countTable(
        "paper_order_state_transition_audit",
        [
          "select=id",
          "allowed=eq.false"
        ].join("&")
      )
    ]);

  const systemControl =
    await readSystemControl(
      baseUrl
    );

  const controlPayload =
    systemControl.payload &&
    typeof systemControl.payload === "object"
      ? (
          systemControl.payload.control &&
          typeof systemControl.payload.control === "object"
            ? systemControl.payload.control
            : systemControl.payload
        )
      : {};

  const control = {
    automationEnabled:
      controlPayload.automationEnabled ??
      controlPayload.automation_enabled ??
      null,

    paperOrderEnabled:
      controlPayload.paperOrderEnabled ??
      controlPayload.paper_order_enabled ??
      null,

    realOrderEnabled:
      controlPayload.realOrderEnabled ??
      controlPayload.real_order_enabled ??
      null,

    emergencyStop:
      controlPayload.emergencyStop ??
      controlPayload.emergency_stop ??
      null,

    maxOrdersPerCycle:
      controlPayload.maxOrdersPerCycle ??
      controlPayload.max_orders_per_cycle ??
      null
  };

  const writerScan =
    scanProductionWriters();

  const migrationCheck =
    checkMigrationVersionUniqueness();

  const checks = {
    serverReachable:
      Boolean(baseUrl),

    configReadable:
      config.ok === true,

    modeStillAudit:
      config.row?.mode ===
        "AUDIT",

    versionCorrect:
      config.row?.version ===
        "ALPHA_V3_ORDER_STATE_MACHINE_V1",

    paperOrdersEmpty:
      zeroCount(totalOrders),

    riskApprovedEmpty:
      zeroCount(approvedOrders),

    activeReservationsEmpty:
      zeroCount(activeReservations),

    paperPositionsEmpty:
      zeroCount(positions),

    auditRowsReadable:
      knownCount(auditRows),

    invalidAuditRowsZero:
      zeroCount(invalidAuditRows),

    systemControlReadable:
      systemControl.ok === true,

    realOrderDisabled:
      control.realOrderEnabled !== true,

    emergencyStopDisabled:
      control.emergencyStop !== true,

    directOrderWritersZero:
      writerScan.directWriterCount === 0,

    productionWriterFilesPresent:
      writerScan.missingFiles.length === 0,

    migrationVersionsUnique:
      migrationCheck.duplicates.length === 0,

    auditMigration01300Present:
      migrationCheck.auditMigrationPresent === true
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

  const warnings = [];

  if (
    control.paperOrderEnabled !== true
  ) {
    warnings.push(
      "PAPER_ORDER_DISABLED"
    );
  }

  if (
    control.automationEnabled !== true
  ) {
    warnings.push(
      "AUTOMATION_DISABLED"
    );
  }

  if (
    Number.isInteger(
      control.maxOrdersPerCycle
    ) &&
    control.maxOrdersPerCycle > 1
  ) {
    warnings.push(
      "MAX_ORDERS_PER_CYCLE_ABOVE_ONE"
    );
  }

  const ready =
    failed.length === 0;

  const report = {
    status:
      ready
        ? "ALPHA_V3_ORDER_STATE_STRICT_PREACTIVATION_GUARD_V1_VERIFIED"
        : "ALPHA_V3_ORDER_STATE_STRICT_PREACTIVATION_GUARD_V1_BLOCKED",

    baseUrl,

    checks,
    failed,
    warnings,

    stateMachine: {
      config:
        config.row,

      auditRowCount:
        auditRows.count,

      invalidAuditRowCount:
        invalidAuditRows.count
    },

    currentTradingState: {
      totalOrders:
        totalOrders.count,

      riskApprovedOrders:
        approvedOrders.count,

      activeReservations:
        activeReservations.count,

      paperPositions:
        positions.count
    },

    systemControl: control,

    sourceBinding: {
      directWriterCount:
        writerScan.directWriterCount,

      missingFiles:
        writerScan.missingFiles,

      files:
        writerScan.results
    },

    migrations:
      migrationCheck,

    decision: {
      readyForStrictActivation:
        ready,

      strictActivationPerformed:
        false,

      requiredModeBeforeActivation:
        "AUDIT",

      targetMode:
        "STRICT"
    },

    safety: {
      databaseReads:
        7,

      databaseWrites:
        0,

      operationalCycleRequests:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0,

      strictModeActivation:
        false
    },

    nextGate:
      ready
        ? "CREATE_AND_APPLY_STRICT_MODE_ACTIVATION_V1"
        : "RESOLVE_STRICT_PREACTIVATION_BLOCKERS"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-order-state-strict-preactivation-guard-v1.json"
    );

  fs.mkdirSync(
    path.dirname(outputFile),
    { recursive: true }
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

  if (!ready) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_ORDER_STATE_STRICT_PREACTIVATION_GUARD_V1_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites: 0,
            strictModeActivation: false,
            ordersCreated: 0,
            positionsChanged: 0
          },

          nextGate:
            "REVIEW_STRICT_PREACTIVATION_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode = 2;
  }
);
