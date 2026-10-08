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
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
  ) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key =
      line.slice(0, index).trim();

    let value =
      line.slice(index + 1).trim();

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

const url = String(
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL ||
  ""
).trim().replace(/\/+$/, "");

const key = String(
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

if (!url || !key) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
  );
}

async function main() {
  const response = await fetch(
    url +
    "/rest/v1/trading_system_controls" +
    "?select=control_key,emergency_stop" +
    "&control_key=eq.global&limit=1",
    {
      method: "GET",
      headers: {
        apikey: key,
        authorization:
          "Bearer " + key
      },
      cache: "no-store"
    }
  );

  const text = await response.text();

  let payload;

  try {
    payload = text
      ? JSON.parse(text)
      : null;
  } catch {
    payload = { raw: text };
  }

  if (
    !response.ok ||
    !Array.isArray(payload)
  ) {
    throw new Error(
      "KILL_SWITCH_BASELINE_READ_FAILED " +
      JSON.stringify(payload)
    );
  }

  if (payload.length !== 1) {
    throw new Error(
      "KILL_SWITCH_BASELINE_EXPECTED_SINGLE_CONTROL_ROW actual=" +
      String(payload.length)
    );
  }

  const baseline = {
    capturedAt:
      new Date().toISOString(),

    controlId:
      String(payload[0].control_key),

    emergencyStop:
      Boolean(payload[0].emergency_stop)
  };

  const outputFile = path.resolve(
    root,
    "logs/alpha-v3-kill-switch-db-foundation-v1-baseline.json"
  );

  fs.mkdirSync(
    path.dirname(outputFile),
    { recursive: true }
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      baseline,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_KILL_SWITCH_DB_FOUNDATION_V1_BASELINE_CAPTURED",

        baseline,

        databaseWrites: 0,

        nextGate:
          "APPLY_KILL_SWITCH_FOUNDATION_MIGRATION"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_KILL_SWITCH_DB_FOUNDATION_V1_BASELINE_FATAL",

        error:
          error instanceof Error
            ? error.message
            : String(error),

        databaseWrites: 0
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
