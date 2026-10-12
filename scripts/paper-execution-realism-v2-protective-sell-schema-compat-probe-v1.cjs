const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const detailsRel =
  "logs/paper-execution-realism-v2-protective-sell-schema-compat-probe-v1.json";

function requiredEnv(names) {
  for (const name of names) {
    const value = process.env[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  throw new Error(
    `ENV_REQUIRED:${names.join("|")}`,
  );
}

function normalizeUrl(value) {
  return String(value)
    .replace(/\/+$/, "");
}

async function fetchOpenApi(
  url,
  key,
) {
  const response =
    await fetch(
      `${url}/rest/v1/`,
      {
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/openapi+json, application/json",
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `OPENAPI_READ_FAILED:${response.status}:${text.slice(0, 500)}`,
    );
  }

  return JSON.parse(text);
}

function hasPath(
  openApi,
  name,
) {
  const paths =
    openApi?.paths ?? {};

  return Object.keys(paths)
    .some((key) =>
      key === `/${name}` ||
      key.endsWith(`/${name}`),
    );
}

function getSchemaProperties(
  openApi,
  name,
) {
  const schemas =
    openApi?.definitions ??
    openApi?.components?.schemas ??
    {};

  const direct =
    schemas[name];

  if (
    direct &&
    typeof direct === "object"
  ) {
    return Object.keys(
      direct.properties ?? {},
    );
  }

  for (
    const [
      schemaName,
      schema,
    ] of Object.entries(schemas)
  ) {
    if (
      schemaName
        .toLowerCase()
        .endsWith(
          name.toLowerCase(),
        )
    ) {
      return Object.keys(
        schema?.properties ?? {},
      );
    }
  }

  return [];
}

function parseInsertColumns(
  sql,
  tableName,
) {
  const re =
    new RegExp(
      `insert\\s+into\\s+public\\.${tableName}\\s*\\(([\\s\\S]*?)\\)\\s*values`,
      "ig",
    );

  const results = [];

  let match;

  while (
    (match = re.exec(sql))
  ) {
    results.push(
      match[1]
        .split(",")
        .map((x) =>
          x.trim()
            .replace(/"/g, ""),
        )
        .filter(Boolean),
    );
  }

  return results;
}

function relationReferences(
  sql,
) {
  const names =
    new Set();

  const patterns = [
    /\bfrom\s+public\.([a-zA-Z0-9_]+)/ig,
    /\bjoin\s+public\.([a-zA-Z0-9_]+)/ig,
    /\bupdate\s+public\.([a-zA-Z0-9_]+)/ig,
    /\binsert\s+into\s+public\.([a-zA-Z0-9_]+)/ig,
    /\bdelete\s+from\s+public\.([a-zA-Z0-9_]+)/ig,
  ];

  for (const re of patterns) {
    let match;

    while (
      (match = re.exec(sql))
    ) {
      names.add(
        match[1],
      );
    }
  }

  return [
    ...names,
  ].sort();
}

async function countIfPresent(
  url,
  key,
  table,
  present,
) {
  if (!present) {
    return {
      present:
        false,
      count:
        null,
      readable:
        false,
      status:
        null,
    };
  }

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=*&limit=1`,
      {
        headers: {
          apikey:
            key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
          Prefer:
            "count=exact",
          Range:
            "0-0",
        },
      },
    );

  const text =
    await response.text();

  const range =
    response.headers.get(
      "content-range",
    ) ?? "";

  const match =
    /\/(\d+|\*)$/.exec(
      range,
    );

  return {
    present:
      true,
    readable:
      response.ok,
    status:
      response.status,
    count:
      match &&
      match[1] !== "*"
        ? Number(match[1])
        : null,
    error:
      response.ok
        ? null
        : text.slice(0, 500),
  };
}

async function main() {
  const migrationAbs =
    path.resolve(
      root,
      migrationRel,
    );

  if (
    !fs.existsSync(
      migrationAbs,
    )
  ) {
    throw new Error(
      `MIGRATION_MISSING:${migrationRel}`,
    );
  }

  const sql =
    fs.readFileSync(
      migrationAbs,
      "utf8",
    );

  const url =
    normalizeUrl(
      requiredEnv([
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_URL",
      ]),
    );

  const key =
    requiredEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const candidates = [
    "paper_orders",
    "trade_orders",
    "paper_positions",
    "paper_accounts",
    "paper_trades",
    "trade_history",
    "paper_trade_history",
    "paper_protective_execution_fills_v2",
  ];

  const schema = {};

  for (const name of candidates) {
    const present =
      hasPath(
        openApi,
        name,
      );

    schema[name] = {
      present,
      columns:
        getSchemaProperties(
          openApi,
          name,
        ),
      probe:
        await countIfPresent(
          url,
          key,
          name,
          present,
        ),
    };
  }

  const refs =
    relationReferences(
      sql,
    );

  const paperOrderInserts =
    parseInsertColumns(
      sql,
      "paper_orders",
    );

  const tradeOrderInserts =
    parseInsertColumns(
      sql,
      "trade_orders",
    );

  const paperOrderReferenced =
    refs.includes(
      "paper_orders",
    );

  const tradeOrderPresent =
    schema.trade_orders
      .present;

  const paperOrderPresent =
    schema.paper_orders
      .present;

  const requiredPaperOrderColumns =
    [
      ...new Set(
        paperOrderInserts
          .flat(),
      ),
    ];

  const tradeOrderColumns =
    new Set(
      schema.trade_orders
        .columns,
    );

  const missingIfMappedToTradeOrders =
    requiredPaperOrderColumns
      .filter(
        (column) =>
          !tradeOrderColumns
            .has(column),
      );

  const directRenameCompatible =
    paperOrderReferenced &&
    !paperOrderPresent &&
    tradeOrderPresent &&
    requiredPaperOrderColumns
      .length > 0 &&
    missingIfMappedToTradeOrders
      .length === 0;

  const unresolvedRelationRefs =
    refs.filter(
      (name) =>
        !schema[name]?.present &&
        name !==
          "paper_protective_execution_fills_v2",
    );

  const result = {
    status:
      "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_SCHEMA_COMPAT_PROBE_V1_COMPLETE",

    migration: {
      file:
        migrationRel,
      relationReferences:
        refs,
      paperOrderInserts,
      tradeOrderInserts,
    },

    currentSchema: {
      paper_orders:
        schema.paper_orders,
      trade_orders:
        schema.trade_orders,
      paper_positions:
        schema.paper_positions,
      paper_accounts:
        schema.paper_accounts,
      paper_trades:
        schema.paper_trades,
      trade_history:
        schema.trade_history,
      paper_trade_history:
        schema.paper_trade_history,
      protectiveFillAudit:
        schema.paper_protective_execution_fills_v2,
    },

    compatibility: {
      paperOrderReferenced,
      paperOrderPresent,
      tradeOrderPresent,
      requiredPaperOrderColumns,
      missingIfMappedToTradeOrders,
      directRenameCompatible,
      unresolvedRelationRefs,
    },

    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      controlsChanged:
        false,
      realTradingChanged:
        false,
    },

    nextGate:
      directRenameCompatible
        ? "PATCH_MIGRATION_PAPER_ORDERS_TO_TRADE_ORDERS_THEN_RERUN_PREFLIGHT"
        : (
            paperOrderReferenced &&
            !paperOrderPresent
          )
          ? "STOP_AND_PATCH_SCHEMA_MAPPING_EXPLICITLY"
          : "RERUN_DB_PREFLIGHT_WITH_ACTUAL_SCHEMA",

    details:
      detailsRel,
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      detailsRel,
    ),
    JSON.stringify(
      {
        ...result,
        allCandidateSchemas:
          schema,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,
        migration: {
          relationReferences:
            refs,
          paperOrderInsertCount:
            paperOrderInserts.length,
          tradeOrderInsertCount:
            tradeOrderInserts.length,
        },
        schema: {
          paper_orders:
            paperOrderPresent,
          trade_orders:
            tradeOrderPresent,
          paper_positions:
            schema.paper_positions.present,
          paper_accounts:
            schema.paper_accounts.present,
        },
        compatibility:
          result.compatibility,
        safety:
          result.safety,
        nextGate:
          result.nextGate,
        details:
          result.details,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_SCHEMA_COMPAT_PROBE_V1_FAILED",
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
            controlsChanged:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE_BEFORE_APPLY",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
