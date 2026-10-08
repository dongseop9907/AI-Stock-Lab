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

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

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
        value.slice(1, -1);
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

const supabaseUrl =
  String(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

if (
  !supabaseUrl ||
  !serviceRoleKey
) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
  );
}

async function parseResponse(response) {
  const text =
    await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return {
      raw: text
    };
  }
}

async function get(pathname) {
  const response =
    await fetch(
      supabaseUrl +
      pathname,
      {
        method:
          "GET",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,
        },

        cache:
          "no-store",
      }
    );

  return {
    status:
      response.status,

    ok:
      response.ok,

    payload:
      await parseResponse(
        response
      ),
  };
}

async function rpc(oldStatus, newStatus, isInsert) {
  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/rpc/validate_paper_order_state_transition_v1",
      {
        method:
          "POST",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,

          "content-type":
            "application/json",
        },

        body:
          JSON.stringify({
            p_old_status:
              oldStatus,

            p_new_status:
              newStatus,

            p_is_insert:
              isInsert,
          }),

        cache:
          "no-store",
      }
    );

  return {
    status:
      response.status,

    ok:
      response.ok,

    payload:
      await parseResponse(
        response
      ),
  };
}

async function main() {
  const config =
    await get(
      "/rest/v1/paper_order_state_machine_config?select=id,mode,version&limit=1"
    );

  const auditRows =
    await get(
      "/rest/v1/paper_order_state_transition_audit?select=id,allowed,reason&limit=10"
    );

  const scenarios = [
    {
      name:
        "CREATE_RISK_APPROVED",
      args:
        [null, "RISK_APPROVED", true],
      expectedAllowed:
        true,
      expectedReason:
        "CREATE_ALLOWED",
    },
    {
      name:
        "CREATE_RISK_REJECTED",
      args:
        [null, "RISK_REJECTED", true],
      expectedAllowed:
        true,
      expectedReason:
        "CREATE_ALLOWED",
    },
    {
      name:
        "CREATE_FILLED",
      args:
        [null, "FILLED", true],
      expectedAllowed:
        true,
      expectedReason:
        "CREATE_ALLOWED",
    },
    {
      name:
        "CREATE_CANCELLED_BLOCK_CANDIDATE",
      args:
        [null, "CANCELLED", true],
      expectedAllowed:
        false,
      expectedReason:
        "CREATE_STATUS_NOT_ALLOWED",
    },
    {
      name:
        "RISK_APPROVED_TO_FILLED",
      args:
        ["RISK_APPROVED", "FILLED", false],
      expectedAllowed:
        true,
      expectedReason:
        "TRANSITION_ALLOWED",
    },
    {
      name:
        "RISK_APPROVED_TO_EXPIRED",
      args:
        ["RISK_APPROVED", "EXPIRED", false],
      expectedAllowed:
        true,
      expectedReason:
        "TRANSITION_ALLOWED",
    },
    {
      name:
        "RISK_APPROVED_TO_CANCELLED_NOT_ENABLED",
      args:
        ["RISK_APPROVED", "CANCELLED", false],
      expectedAllowed:
        false,
      expectedReason:
        "TRANSITION_NOT_ALLOWED",
    },
    {
      name:
        "FILLED_TO_EXPIRED_TERMINAL_BLOCK",
      args:
        ["FILLED", "EXPIRED", false],
      expectedAllowed:
        false,
      expectedReason:
        "TERMINAL_STATE_CANNOT_TRANSITION",
    },
    {
      name:
        "FILLED_RETRY_IDEMPOTENT",
      args:
        ["FILLED", "FILLED", false],
      expectedAllowed:
        true,
      expectedReason:
        "IDEMPOTENT_NOOP",
    },
    {
      name:
        "CANCELED_TO_CANCELLED_ALIAS_IDEMPOTENT",
      args:
        ["CANCELED", "CANCELLED", false],
      expectedAllowed:
        true,
      expectedReason:
        "IDEMPOTENT_NOOP",
    },
    {
      name:
        "APPROVED_UNSUPPORTED_FROM",
      args:
        ["APPROVED", "RISK_APPROVED", false],
      expectedAllowed:
        false,
      expectedReason:
        "UNSUPPORTED_FROM_STATUS",
    },
  ];

  const results = [];

  for (const scenario of scenarios) {
    const result =
      await rpc(
        ...scenario.args
      );

    const payload =
      result.payload;

    results.push({
      name:
        scenario.name,

      passed:
        result.ok === true &&
        payload?.allowed ===
          scenario.expectedAllowed &&
        payload?.reason ===
          scenario.expectedReason,

      expected: {
        allowed:
          scenario.expectedAllowed,
        reason:
          scenario.expectedReason,
      },

      observed: {
        httpStatus:
          result.status,
        ok:
          result.ok,
        payload,
      },
    });
  }

  const configRow =
    Array.isArray(
      config.payload
    )
      ? config.payload[0] ??
        null
      : null;

  const checks = {
    configReadable:
      config.ok === true,

    modeIsAudit:
      configRow?.mode ===
        "AUDIT",

    versionCorrect:
      configRow?.version ===
        "ALPHA_V3_ORDER_STATE_MACHINE_V1",

    auditTableReadable:
      auditRows.ok ===
        true,

    validatorScenariosPass:
      results.every(
        (item) =>
          item.passed
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

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_VERIFIED"
        : "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_REVIEW",

    checks,
    failed,

    config:
      configRow,

    currentAuditRowCountSample:
      Array.isArray(
        auditRows.payload
      )
        ? auditRows.payload.length
        : null,

    scenarios:
      results,

    enforcement: {
      mode:
        configRow?.mode ??
        null,

      invalidTransitionsBlocked:
        false,

      strictActivationPerformed:
        false,
    },

    safety: {
      validatorRpcCalls:
        scenarios.length,

      validatorRpcWrites:
        0,

      paperOrderWrites:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      failed.length === 0
        ? "RUN_AUDIT_MODE_OPERATIONAL_COMPATIBILITY_CHECK"
        : "REVIEW_DB_AUDIT_GUARD",
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-db-order-transition-audit-guard-v1-db-verify.json"
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

  if (failed.length > 0) {
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
            "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_VERIFY_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            paperOrderWrites: 0,
            ordersCreated: 0,
            positionsChanged: 0,
          },

          nextGate:
            "REVIEW_DB_AUDIT_GUARD_FATAL",
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
