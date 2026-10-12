const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/018_trading_system_controls.sql";

const controlLibRel =
  "lib/trading/get-trading-system-control.ts";

const controlRouteRel =
  "app/api/trading/system/control/route.ts";

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
      line.slice(0, index).trim();

    let value =
      line.slice(index + 1).trim();

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

function readText(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs
    .readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n");
}

function findContexts(text, patterns, radius = 6) {
  if (!text) {
    return [];
  }

  const lines =
    text.split("\n");

  const results = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      patterns.some(
        (pattern) =>
          pattern.test(lines[i])
      )
    ) {
      const start =
        Math.max(
          0,
          i - radius
        );

      const end =
        Math.min(
          lines.length,
          i + radius + 1
        );

      results.push({
        line:
          i + 1,

        text:
          lines
            .slice(start, end)
            .map(
              (value, index) =>
                `${start + index + 1}: ${value}`
            )
            .join("\n")
      });
    }
  }

  return results.slice(0, 30);
}

const migrationText =
  readText(migrationRel);

const controlLibText =
  readText(controlLibRel);

const controlRouteText =
  readText(controlRouteRel);

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

async function main() {
  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    );
  }

  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/trading_system_controls?select=*&limit=10",
      {
        method:
          "GET",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey
        },

        cache:
          "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  if (
    !response.ok ||
    !Array.isArray(payload)
  ) {
    throw new Error(
      "TRADING_SYSTEM_CONTROLS_READ_FAILED " +
      JSON.stringify(payload)
    );
  }

  const rowKeys =
    payload.map(
      (row) =>
        Object.keys(
          row ?? {}
        ).sort()
    );

  const candidateIdentityColumns = [
    "scope",
    "control_key",
    "key",
    "name",
    "singleton_key",
    "environment",
    "mode",
    "created_at",
    "updated_at"
  ];

  const identityCandidates =
    payload.length > 0
      ? candidateIdentityColumns
          .filter(
            (key) =>
              Object.prototype
                .hasOwnProperty.call(
                  payload[0],
                  key
                )
          )
          .map(
            (key) => ({
              column: key,
              values:
                payload.map(
                  (row) =>
                    row?.[key] ??
                    null
                )
            })
          )
      : [];

  const report = {
    status:
      "ALPHA_V3_TRADING_SYSTEM_CONTROLS_SCHEMA_PROBE_V1_COMPLETE",

    database: {
      httpStatus:
        response.status,

      rowCount:
        payload.length,

      rowKeys,

      rows:
        payload,

      identityCandidates
    },

    source: {
      migration: {
        file:
          migrationRel,

        exists:
          migrationText !== null,

        contexts:
          findContexts(
            migrationText,
            [
              /create\s+table/i,
              /primary\s+key/i,
              /unique/i,
              /trading_system_controls/i,
              /insert\s+into/i
            ],
            8
          )
      },

      controlLibrary: {
        file:
          controlLibRel,

        exists:
          controlLibText !== null,

        contexts:
          findContexts(
            controlLibText,
            [
              /trading_system_controls/i,
              /\.eq\s*\(/,
              /\.single\s*\(/,
              /\.maybeSingle\s*\(/,
              /\.limit\s*\(/,
              /\.order\s*\(/
            ],
            8
          )
      },

      controlRoute: {
        file:
          controlRouteRel,

        exists:
          controlRouteText !== null,

        contexts:
          findContexts(
            controlRouteText,
            [
              /trading_system_controls/i,
              /emergency_stop/i,
              /\.eq\s*\(/,
              /\.update\s*\(/
            ],
            8
          )
      }
    },

    diagnosis: {
      tableName:
        "trading_system_controls",

      idColumnPresent:
        payload.length > 0
          ? Object.prototype
              .hasOwnProperty.call(
                payload[0],
                "id"
              )
          : null,

      singletonRowCount:
        payload.length,

      nextQuestion:
        "USE_ACTUAL_SOURCE_SINGLETON_KEY_AND_ROW_SHAPE_TO_PATCH_01500_WITHOUT_GUESSING"
    },

    safety: {
      databaseReads:
        1,

      databaseWrites:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0
    },

    logFile:
      "logs/alpha-v3-trading-system-controls-schema-probe-v1.json",

    nextGate:
      "PATCH_KILL_SWITCH_FOUNDATION_TO_ACTUAL_CONTROL_SCHEMA"
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs"
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    path.resolve(
      root,
      report.logFile
    ),
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        database:
          report.database,

        sourceSummary: {
          migrationExists:
            report.source
              .migration
              .exists,

          migrationContextCount:
            report.source
              .migration
              .contexts
              .length,

          controlLibraryExists:
            report.source
              .controlLibrary
              .exists,

          controlLibraryContextCount:
            report.source
              .controlLibrary
              .contexts
              .length,

          controlRouteExists:
            report.source
              .controlRoute
              .exists,

          controlRouteContextCount:
            report.source
              .controlRoute
              .contexts
              .length
        },

        diagnosis:
          report.diagnosis,

        safety:
          report.safety,

        logFile:
          report.logFile,

        nextGate:
          report.nextGate
      },
      null,
      2
    )
  );

  console.log(
    "\n=== MIGRATION CONTEXTS ==="
  );

  for (
    const item of
      report.source
        .migration
        .contexts
  ) {
    console.log(
      "\n" +
      item.text
    );
  }

  console.log(
    "\n=== CONTROL LIBRARY CONTEXTS ==="
  );

  for (
    const item of
      report.source
        .controlLibrary
        .contexts
  ) {
    console.log(
      "\n" +
      item.text
    );
  }

  console.log(
    "\n=== CONTROL ROUTE CONTEXTS ==="
  );

  for (
    const item of
      report.source
        .controlRoute
        .contexts
  ) {
    console.log(
      "\n" +
      item.text
    );
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_TRADING_SYSTEM_CONTROLS_SCHEMA_PROBE_V1_FATAL",

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
            "REVIEW_CONTROL_SCHEMA_PROBE_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
