const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  for (
    const rawLine of
      fs
        .readFileSync(
          file,
          "utf8"
        )
        .split(/\r?\n/)
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

const env = {
  ...parseEnvFile(
    path.resolve(
      root,
      ".env.local"
    )
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

async function get(
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
    headers.prefer =
      "count=exact";

    headers.range =
      "0-0";
  }

  const response =
    await fetch(
      supabaseUrl +
      pathname,
      {
        method:
          "GET",

        headers,

        cache:
          "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  let count =
    null;

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
          Number(
            match[1]
          );
      }
    }
  }

  return {
    ok:
      response.ok,

    status:
      response.status,

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

async function rpc(
  oldStatus,
  newStatus,
  isInsert
) {
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
            "application/json"
        },

        body:
          JSON.stringify({
            p_old_status:
              oldStatus,

            p_new_status:
              newStatus,

            p_is_insert:
              isInsert
          }),

        cache:
          "no-store"
      }
    );

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload:
      await parseResponse(
        response
      )
  };
}

async function main() {
  const [
    config,
    orders,
    approved,
    reservations,
    positions,
    invalidAudit
  ] =
    await Promise.all([
      get(
        "/rest/v1/paper_order_state_machine_config" +
        "?select=id,mode,version,updated_at" +
        "&id=eq.1" +
        "&limit=1"
      ),

      get(
        "/rest/v1/paper_order_requests?select=id",
        true
      ),

      get(
        "/rest/v1/paper_order_requests" +
        "?select=id&status=eq.RISK_APPROVED",
        true
      ),

      get(
        "/rest/v1/paper_order_requests" +
        "?select=id" +
        "&reserved_risk_amount=gt.0" +
        "&reserved_risk_released_at=is.null",
        true
      ),

      get(
        "/rest/v1/paper_positions?select=id",
        true
      ),

      get(
        "/rest/v1/paper_order_state_transition_audit" +
        "?select=id&allowed=eq.false",
        true
      )
    ]);

  const configRow =
    config.ok &&
    Array.isArray(
      config.payload
    )
      ? config.payload[0] ??
        null
      : null;

  const validatorChecks = [
    {
      name:
        "RISK_APPROVED_TO_FILLED_ALLOWED",

      result:
        await rpc(
          "RISK_APPROVED",
          "FILLED",
          false
        ),

      expectedAllowed:
        true,

      expectedReason:
        "TRANSITION_ALLOWED"
    },

    {
      name:
        "RISK_APPROVED_TO_EXPIRED_ALLOWED",

      result:
        await rpc(
          "RISK_APPROVED",
          "EXPIRED",
          false
        ),

      expectedAllowed:
        true,

      expectedReason:
        "TRANSITION_ALLOWED"
    },

    {
      name:
        "RISK_APPROVED_TO_CANCELLED_REJECTED",

      result:
        await rpc(
          "RISK_APPROVED",
          "CANCELLED",
          false
        ),

      expectedAllowed:
        false,

      expectedReason:
        "TRANSITION_NOT_ALLOWED"
    },

    {
      name:
        "FILLED_TO_EXPIRED_REJECTED",

      result:
        await rpc(
          "FILLED",
          "EXPIRED",
          false
        ),

      expectedAllowed:
        false,

      expectedReason:
        "TERMINAL_STATE_CANNOT_TRANSITION"
    }
  ];

  const validatorPassed =
    validatorChecks.every(
      (item) =>
        item.result.ok ===
          true &&
        item.result.payload
          ?.allowed ===
          item.expectedAllowed &&
        item.result.payload
          ?.reason ===
          item.expectedReason
    );

  const checks = {
    configReadable:
      config.ok ===
        true,

    modeIsStrict:
      configRow?.mode ===
        "STRICT",

    versionCorrect:
      configRow?.version ===
        "ALPHA_V3_ORDER_STATE_MACHINE_V1",

    paperOrdersRemainZero:
      orders.ok ===
        true &&
      orders.count ===
        0,

    riskApprovedRemainZero:
      approved.ok ===
        true &&
      approved.count ===
        0,

    activeReservationsRemainZero:
      reservations.ok ===
        true &&
      reservations.count ===
        0,

    paperPositionsRemainZero:
      positions.ok ===
        true &&
      positions.count ===
        0,

    invalidAuditRowsRemainZero:
      invalidAudit.ok ===
        true &&
      invalidAudit.count ===
        0,

    validatorContractStillCorrect:
      validatorPassed
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

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_VERIFIED"
        : "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_REVIEW",

    checks,
    failed,

    config:
      configRow,

    counts: {
      paperOrders:
        orders.count,

      riskApproved:
        approved.count,

      activeReservations:
        reservations.count,

      paperPositions:
        positions.count,

      invalidAuditRows:
        invalidAudit.count
    },

    validatorChecks:
      validatorChecks.map(
        (item) => ({
          name:
            item.name,

          passed:
            item.result.ok ===
              true &&
            item.result.payload
              ?.allowed ===
              item.expectedAllowed &&
            item.result.payload
              ?.reason ===
              item.expectedReason,

          expected: {
            allowed:
              item.expectedAllowed,

            reason:
              item.expectedReason
          },

          observed:
            item.result
        })
      ),

    enforcement: {
      mode:
        configRow?.mode ??
        null,

      invalidTransitionsBlockedByTrigger:
        configRow?.mode ===
          "STRICT",

      productionTriggerWriteTestPerformed:
        false,

      reason:
        "No production paper order row was created solely for verification. Trigger blocking is activated by the already-verified trigger function when config mode is STRICT."
    },

    safety: {
      databaseReads:
        6,

      validatorRpcCalls:
        4,

      validatorRpcWrites:
        0,

      paperOrderWrites:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0
    },

    nextGate:
      failed.length === 0
        ? "RUN_STRICT_MODE_NO_ORDER_OPERATIONAL_COMPATIBILITY"
        : "REVIEW_STRICT_ACTIVATION"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-order-state-strict-activation-v1-db-verify.json"
    );

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive:
        true
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

  if (
    failed.length >
      0
  ) {
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
            "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_VERIFY_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            paperOrderWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0
          },

          nextGate:
            "REVIEW_STRICT_ACTIVATION_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
