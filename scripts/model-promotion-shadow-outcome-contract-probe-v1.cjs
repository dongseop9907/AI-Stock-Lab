const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceFiles = [
  "lib/trading/capture-shadow-signals.ts",
  "lib/trading/evaluate-shadow-signals.ts",
];

const detailsRel =
  "logs/model-promotion-shadow-outcome-contract-probe-v1.json";

function readRequired(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  return fs.readFileSync(abs, "utf8");
}

function lineNumber(text, index) {
  return text
    .slice(0, index)
    .split(/\r?\n/)
    .length;
}

function extractFromCalls(text) {
  const regex =
    /\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  const out = [];
  let match;

  while ((match = regex.exec(text))) {
    out.push({
      table: match[1],
      line: lineNumber(text, match.index),
    });
  }

  return out;
}

function extractRpcCalls(text) {
  const regex =
    /\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/g;

  const out = [];
  let match;

  while ((match = regex.exec(text))) {
    out.push({
      rpc: match[1],
      line: lineNumber(text, match.index),
    });
  }

  return out;
}

function extractSelects(text) {
  const regex =
    /\.select\s*\(\s*`([\s\S]*?)`\s*\)/g;

  const out = [];
  let match;

  while ((match = regex.exec(text))) {
    const columns =
      match[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

    out.push({
      line: lineNumber(text, match.index),
      columns,
    });
  }

  return out;
}

function extractMutationBlocks(text) {
  const patterns = [
    {
      kind: "insert",
      regex:
        /\.insert\s*\(\s*(\{[\s\S]*?\})\s*\)/g,
    },
    {
      kind: "update",
      regex:
        /\.update\s*\(\s*(\{[\s\S]*?\})\s*\)/g,
    },
    {
      kind: "upsert",
      regex:
        /\.upsert\s*\(\s*(\{[\s\S]*?\})\s*(?:,|\))/g,
    },
  ];

  const out = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text))) {
      const keys = [
        ...new Set(
          [...match[1].matchAll(
            /(?:^|[,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/gm,
          )].map((m) => m[1]),
        ),
      ];

      out.push({
        kind: pattern.kind,
        line: lineNumber(text, match.index),
        keys,
        preview:
          match[1]
            .replace(/\s+/g, " ")
            .slice(0, 500),
      });
    }
  }

  return out;
}

function extractStatusLiterals(text) {
  const statuses = [
    ...new Set(
      [
        ...text.matchAll(
          /["'`](PENDING|ACTIVE|COMPLETED|PARTIAL|EXPIRED|INVALID|GENERATED|ORDER_CREATED|SKIPPED|FAILED|EVALUATED|OPEN|CLOSED)["'`]/g,
        ),
      ].map((m) => m[1]),
    ),
  ];

  return statuses.sort();
}

function extractOutcomeTerms(text) {
  const terms = [
    "evaluation_status",
    "return_1d",
    "return_3d",
    "return_5d",
    "max_return_1d",
    "max_return_3d",
    "max_return_5d",
    "min_return_1d",
    "min_return_3d",
    "min_return_5d",
    "entry_open_price",
    "entry_price",
    "outcome",
    "evaluated_at",
    "expires_at",
    "signal_id",
    "model_id",
    "shadow",
  ];

  const found = [];

  for (const term of terms) {
    const regex =
      new RegExp(`\\b${term}\\b`, "gi");

    let match;

    while (
      (match = regex.exec(text)) &&
      found.length < 100
    ) {
      found.push({
        term,
        line: lineNumber(text, match.index),
      });
    }
  }

  return found;
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

async function fetchOpenApi(url, key) {
  const response =
    await fetch(
      `${url}/rest/v1/`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
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

function hasPath(openApi, name) {
  const paths = openApi?.paths ?? {};

  return Object.keys(paths).some(
    (key) =>
      key === `/${name}` ||
      key.endsWith(`/${name}`),
  );
}

function schemaColumns(openApi, name) {
  const schemas =
    openApi?.definitions ??
    openApi?.components?.schemas ??
    {};

  const direct = schemas[name];

  if (direct?.properties) {
    return Object.keys(direct.properties);
  }

  for (
    const [schemaName, schema]
    of Object.entries(schemas)
  ) {
    if (
      schemaName
        .toLowerCase()
        .endsWith(name.toLowerCase()) &&
      schema?.properties
    ) {
      return Object.keys(schema.properties);
    }
  }

  return [];
}

async function countRows(url, key, table) {
  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=*&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          Prefer: "count=exact",
          Range: "0-0",
        },
      },
    );

  const text = await response.text();

  if (!response.ok) {
    return {
      available: false,
      count: null,
      error:
        `${response.status}:${text.slice(0, 300)}`,
    };
  }

  const range =
    response.headers.get("content-range") ?? "";

  const match =
    /\/(\d+|\*)$/.exec(range);

  return {
    available: true,
    count:
      match && match[1] !== "*"
        ? Number(match[1])
        : null,
    error: null,
  };
}

async function readSample(
  url,
  key,
  table,
  columns,
) {
  const preferredOrder = [
    "id",
    "signal_id",
    "model_id",
    "stock_code",
    "status",
    "evaluation_status",
    "entry_open_price",
    "entry_price",
    "return_1d",
    "return_3d",
    "return_5d",
    "max_return_5d",
    "min_return_5d",
    "evaluated_at",
    "expires_at",
    "observed_at",
    "created_at",
    "updated_at",
  ];

  const selectColumns =
    preferredOrder.filter(
      (column) =>
        columns.includes(column),
    );

  if (selectColumns.length === 0) {
    return [];
  }

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=${encodeURIComponent(
        selectColumns.join(","),
      )}&limit=5`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      },
    );

  const text = await response.text();

  if (!response.ok) {
    return [{
      _error:
        `${response.status}:${text.slice(0, 300)}`,
    }];
  }

  return JSON.parse(text);
}

function discoverShadowMigrations() {
  const dir =
    path.resolve(
      root,
      "supabase/migrations",
    );

  if (!fs.existsSync(dir)) {
    return [];
  }

  const results = [];

  for (
    const name of
    fs.readdirSync(dir)
  ) {
    if (!name.endsWith(".sql")) {
      continue;
    }

    const abs =
      path.join(dir, name);

    const text =
      fs.readFileSync(abs, "utf8");

    if (
      /shadow/i.test(text) ||
      /return_1d|return_3d|return_5d|evaluation_status/i.test(text)
    ) {
      const tables = [
        ...new Set(
          [
            ...text.matchAll(
              /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-zA-Z0-9_]+)/gi,
            ),
          ].map((m) => m[1]),
        ),
      ];

      results.push({
        file:
          `supabase/migrations/${name}`,
        tables,
        hasEvaluationStatus:
          /evaluation_status/i.test(text),
        hasReturn1d:
          /return_1d/i.test(text),
        hasReturn3d:
          /return_3d/i.test(text),
        hasReturn5d:
          /return_5d/i.test(text),
      });
    }
  }

  return results;
}

async function main() {
  const source = [];

  for (const rel of sourceFiles) {
    const text =
      readRequired(rel);

    source.push({
      file: rel,
      lineCount:
        text.split(/\r?\n/).length,
      tables:
        extractFromCalls(text),
      rpcs:
        extractRpcCalls(text),
      selects:
        extractSelects(text),
      mutations:
        extractMutationBlocks(text),
      statuses:
        extractStatusLiterals(text),
      outcomeTerms:
        extractOutcomeTerms(text),
    });
  }

  const referencedTables = [
    ...new Set(
      source.flatMap(
        (item) =>
          item.tables.map(
            (entry) => entry.table,
          ),
      ),
    ),
  ].sort();

  const urlRaw =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const key =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  if (!urlRaw || !key) {
    throw new Error(
      "SUPABASE_ENV_MISSING",
    );
  }

  const url =
    urlRaw.replace(/\/+$/, "");

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const db = {};

  for (const table of referencedTables) {
    const present =
      hasPath(openApi, table);

    const columns =
      present
        ? schemaColumns(
            openApi,
            table,
          )
        : [];

    const count =
      present
        ? await countRows(
            url,
            key,
            table,
          )
        : {
            available: false,
            count: null,
            error: null,
          };

    const sample =
      present
        ? await readSample(
            url,
            key,
            table,
            columns,
          )
        : [];

    db[table] = {
      present,
      columns,
      count:
        count.count,
      sample,
      error:
        count.error,
    };
  }

  const migrations =
    discoverShadowMigrations();

  const canonicalCandidates =
    Object.entries(db)
      .filter(
        ([name, info]) =>
          info.present &&
          (
            /shadow/i.test(name) ||
            info.columns.includes(
              "evaluation_status",
            ) ||
            (
              info.columns.includes(
                "return_1d",
              ) &&
              info.columns.includes(
                "return_5d",
              )
            )
          ),
      )
      .map(
        ([name, info]) => ({
          table: name,
          count: info.count,
          outcomeColumns:
            info.columns.filter(
              (column) =>
                /evaluation|return_|entry_|signal_id|model_id|expires_at|evaluated_at/i.test(
                  column,
                ),
            ),
        }),
      );

  const result = {
    status:
      "MODEL_PROMOTION_SHADOW_OUTCOME_CONTRACT_PROBE_V1_COMPLETE",

    source: source.map(
      (item) => ({
        file: item.file,
        tables: item.tables,
        rpcs: item.rpcs,
        statuses: item.statuses,
        outcomeTerms:
          item.outcomeTerms,
        mutationSummary:
          item.mutations.map(
            (mutation) => ({
              kind:
                mutation.kind,
              line:
                mutation.line,
              keys:
                mutation.keys,
            }),
          ),
      }),
    ),

    referencedTables,
    db,
    shadowMigrations:
      migrations,

    canonicalCandidates,

    conclusion:
      canonicalCandidates.length > 0
        ? "CAN_BUILD_CANONICAL_SHADOW_OUTCOME_ADAPTER_FROM_EXISTING_STORAGE"
        : "NO_CONFIRMED_CANONICAL_SHADOW_OUTCOME_STORAGE_YET",

    safety: {
      sourceFilesModified:
        0,
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      promotionStageChanged:
        false,
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
      canonicalCandidates.length > 0
        ? "BUILD_SHADOW_OUTCOME_EVIDENCE_ADAPTER_AND_FAIL_CLOSED_PAPER_GATE"
        : "CREATE_CANONICAL_SHADOW_OUTCOME_STORAGE_BEFORE_PAPER_PROMOTION",

    details:
      detailsRel,
  };

  fs.mkdirSync(
    path.resolve(root, "logs"),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(root, detailsRel),
    JSON.stringify(
      {
        ...result,
        sourceDetails:
          source,
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
        referencedTables:
          result.referencedTables,
        db:
          Object.fromEntries(
            Object.entries(db).map(
              ([name, info]) => [
                name,
                {
                  present:
                    info.present,
                  count:
                    info.count,
                  outcomeColumns:
                    info.columns.filter(
                      (column) =>
                        /evaluation|return_|entry_|signal_id|model_id|expires_at|evaluated_at/i.test(
                          column,
                        ),
                    ),
                },
              ],
            ),
          ),
        canonicalCandidates:
          result.canonicalCandidates,
        conclusion:
          result.conclusion,
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
            "MODEL_PROMOTION_SHADOW_OUTCOME_CONTRACT_PROBE_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            sourceFilesModified:
              0,
            databaseWrites:
              0,
            promotionStageChanged:
              false,
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
            "STOP_AND_DIAGNOSE_SHADOW_OUTCOME_STORAGE",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
