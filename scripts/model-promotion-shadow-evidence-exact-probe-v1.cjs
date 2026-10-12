const fs = require("fs");
const path = require("path");

const root = process.cwd();
const logRel =
  "logs/model-promotion-shadow-evidence-exact-probe-v1.json";

const entryFiles = [
  "app/api/signals/shadow/capture/route.ts",
  "app/api/signals/shadow/evaluate/route.ts",
];

function readRequired(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  return fs.readFileSync(
    abs,
    "utf8",
  );
}

function rel(file) {
  return path
    .relative(root, file)
    .replace(/\\/g, "/");
}

function lineNumber(text, index) {
  return (
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length
  );
}

function extractImports(text) {
  const imports = [];
  const regex =
    /from\s+["'](@\/[^"']+)["']/g;

  let match;

  while (
    (match = regex.exec(text))
  ) {
    imports.push(match[1]);
  }

  return [
    ...new Set(imports),
  ];
}

function resolveAliasImport(spec) {
  if (!spec.startsWith("@/")) {
    return null;
  }

  const base =
    path.resolve(
      root,
      spec.slice(2),
    );

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.cjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractFromTables(text) {
  const out = [];
  const regex =
    /\.from\(\s*["']([^"']+)["']\s*\)/g;

  let match;

  while (
    (match = regex.exec(text))
  ) {
    out.push({
      table: match[1],
      line: lineNumber(
        text,
        match.index,
      ),
    });
  }

  return out;
}

function extractRpcs(text) {
  const out = [];
  const regex =
    /\.rpc\(\s*["']([^"']+)["']/g;

  let match;

  while (
    (match = regex.exec(text))
  ) {
    out.push({
      rpc: match[1],
      line: lineNumber(
        text,
        match.index,
      ),
    });
  }

  return out;
}

function extractTerms(text, terms) {
  const found = [];

  for (const term of terms) {
    const regex =
      new RegExp(
        term,
        "gi",
      );

    let match;

    while (
      (match = regex.exec(text)) &&
      found.length < 40
    ) {
      found.push({
        term,
        line:
          lineNumber(
            text,
            match.index,
          ),
      });
    }
  }

  return found;
}

function firstEnv(names) {
  for (const name of names) {
    const value =
      process.env[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function normalizeUrl(value) {
  return String(value)
    .replace(/\/+$/, "");
}

async function fetchOpenApi(url, key) {
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

function hasPath(openApi, name) {
  const paths =
    openApi?.paths ?? {};

  return Object.keys(paths)
    .some(
      (key) =>
        key === `/${name}` ||
        key.endsWith(
          `/${name}`,
        ),
    );
}

function schemaColumns(openApi, name) {
  const schemas =
    openApi?.definitions ??
    openApi?.components?.schemas ??
    {};

  const direct =
    schemas[name];

  if (direct?.properties) {
    return Object.keys(
      direct.properties,
    );
  }

  for (
    const [schemaName, schema]
    of Object.entries(schemas)
  ) {
    if (
      schemaName
        .toLowerCase()
        .endsWith(
          name.toLowerCase(),
        ) &&
      schema?.properties
    ) {
      return Object.keys(
        schema.properties,
      );
    }
  }

  return [];
}

async function countRows(
  url,
  key,
  table,
) {
  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=*&limit=1`,
      {
        headers: {
          apikey: key,
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

  if (!response.ok) {
    return null;
  }

  const range =
    response.headers.get(
      "content-range",
    ) ?? "";

  const match =
    /\/(\d+|\*)$/.exec(range);

  return (
    match &&
    match[1] !== "*"
  )
    ? Number(match[1])
    : null;
}

async function readSample(
  url,
  key,
  table,
  columns,
) {
  const preferred =
    [
      "id",
      "model_id",
      "signal_id",
      "stock_code",
      "status",
      "verdict",
      "quality_score",
      "entry_price",
      "stop_price",
      "return_1d",
      "return_3d",
      "return_5d",
      "realized_return",
      "evaluation_stage",
      "captured_at",
      "evaluated_at",
      "created_at",
      "updated_at",
    ]
      .filter(
        (column) =>
          columns.includes(
            column,
          ),
      )
      .slice(0, 12);

  if (preferred.length === 0) {
    return [];
  }

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=${encodeURIComponent(
        preferred.join(","),
      )}&limit=5`,
      {
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    return [];
  }

  return JSON.parse(text);
}

async function readModelEvidence(
  url,
  key,
) {
  const response =
    await fetch(
      `${url}/rest/v1/ai_model_versions?select=id,model_name,model_version,status,promotion_stage,validation_trade_count,metrics,metrics_source,metrics_calculated_at&order=created_at.asc`,
      {
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `MODEL_EVIDENCE_READ_FAILED:${response.status}:${text.slice(0, 500)}`,
    );
  }

  return JSON.parse(text);
}

function readForwardFiles() {
  const candidates = [
    "logs/alpha-v3-forward-top1-sessions.json",
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
    "logs/alpha-v3-true-forward-oos-summary.json",
    "logs/alpha-v3-true-forward-oos-evaluator-v1.json",
  ];

  const result = [];

  for (const relPath of candidates) {
    const abs =
      path.resolve(
        root,
        relPath,
      );

    if (!fs.existsSync(abs)) {
      result.push({
        file: relPath,
        exists: false,
      });
      continue;
    }

    try {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            abs,
            "utf8",
          ),
        );

      result.push({
        file: relPath,
        exists: true,
        topLevelKeys:
          parsed &&
          typeof parsed === "object"
            ? Object.keys(parsed).slice(0, 30)
            : [],
        preview:
          parsed,
      });
    } catch (error) {
      result.push({
        file: relPath,
        exists: true,
        parseError:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return result;
}

async function main() {
  const queue = [
    ...entryFiles,
  ];

  const visited =
    new Set();

  const source = [];

  while (
    queue.length > 0 &&
    visited.size < 25
  ) {
    const current =
      queue.shift();

    if (
      !current ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);

    const text =
      readRequired(current);

    const imports =
      extractImports(text);

    const internalImports = [];

    for (const spec of imports) {
      const resolved =
        resolveAliasImport(spec);

      if (!resolved) {
        continue;
      }

      const resolvedRel =
        rel(resolved);

      internalImports.push(
        resolvedRel,
      );

      if (
        (
          /shadow/i.test(
            resolvedRel,
          ) ||
          /entry-signal/i.test(
            resolvedRel,
          ) ||
          /model/i.test(
            resolvedRel,
          )
        ) &&
        !visited.has(
          resolvedRel,
        )
      ) {
        queue.push(
          resolvedRel,
        );
      }
    }

    source.push({
      file:
        current,
      tables:
        extractFromTables(
          text,
        ),
      rpcs:
        extractRpcs(
          text,
        ),
      terms:
        extractTerms(
          text,
          [
            "model_id",
            "signal_id",
            "shadow",
            "evaluation",
            "return_1d",
            "return_3d",
            "return_5d",
            "verdict",
            "quality_score",
          ],
        ),
      imports:
        internalImports,
    });
  }

  const tableNames =
    [
      ...new Set(
        source.flatMap(
          (item) =>
            item.tables.map(
              (entry) =>
                entry.table,
            ),
        ),
      ),
    ].sort();

  const rpcNames =
    [
      ...new Set(
        source.flatMap(
          (item) =>
            item.rpcs.map(
              (entry) =>
                entry.rpc,
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
    normalizeUrl(
      urlRaw,
    );

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const dbTables = {};

  for (const table of tableNames) {
    const present =
      hasPath(
        openApi,
        table,
      );

    const columns =
      present
        ? schemaColumns(
            openApi,
            table,
          )
        : [];

    dbTables[table] = {
      present,
      columns,
      count:
        present
          ? await countRows(
              url,
              key,
              table,
            )
          : null,
      sample:
        present
          ? await readSample(
              url,
              key,
              table,
              columns,
            )
          : [],
    };
  }

  const rpcExposure =
    Object.fromEntries(
      rpcNames.map(
        (rpc) => [
          rpc,
          hasPath(
            openApi,
            `rpc/${rpc}`,
          ) ||
          hasPath(
            openApi,
            rpc,
          ),
        ],
      ),
    );

  const models =
    await readModelEvidence(
      url,
      key,
    );

  const forwardFiles =
    readForwardFiles();

  const modelIdLinkedTables =
    Object.entries(
      dbTables,
    )
      .filter(
        ([, info]) =>
          info.present &&
          info.columns.includes(
            "model_id",
          ),
      )
      .map(
        ([name, info]) => ({
          table:
            name,
          count:
            info.count,
          columns:
            info.columns,
        }),
      );

  const likelyShadowEvidenceTables =
    modelIdLinkedTables.filter(
      (item) =>
        /shadow|signal|evaluation/i.test(
          item.table,
        ),
    );

  const result = {
    status:
      "MODEL_PROMOTION_SHADOW_EVIDENCE_EXACT_PROBE_V1_COMPLETE",

    source: {
      visitedFiles:
        [...visited],
      tableNames,
      rpcNames,
    },

    db: {
      tables:
        dbTables,
      rpcExposure,
      modelIdLinkedTables,
      likelyShadowEvidenceTables,
    },

    models:
      models.map(
        (model) => ({
          id:
            model.id,
          name:
            model.model_name,
          version:
            model.model_version,
          status:
            model.status,
          promotionStage:
            model.promotion_stage,
          validationTradeCount:
            model.validation_trade_count,
          metrics:
            model.metrics,
          metricsSource:
            model.metrics_source,
          metricsCalculatedAt:
            model.metrics_calculated_at,
        }),
      ),

    forward: {
      files:
        forwardFiles.map(
          (item) => ({
            file:
              item.file,
            exists:
              item.exists,
            topLevelKeys:
              item.topLevelKeys ??
              [],
            parseError:
              item.parseError ??
              null,
          }),
        ),
    },

    safety: {
      sourceFilesModified:
        0,
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
      likelyShadowEvidenceTables.length >
        0
        ? "BUILD_RECOMMENDATION_ONLY_PROMOTION_DECISION_SERVICE_FROM_EXACT_EVIDENCE"
        : "DEFINE_SHADOW_EVIDENCE_ADAPTER_FROM_CONFIRMED_SOURCE_STORAGE",

    details:
      logRel,
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      logRel,
    ),
    JSON.stringify(
      {
        ...result,
        sourceDetails:
          source,
        forwardFiles,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
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
            "MODEL_PROMOTION_SHADOW_EVIDENCE_EXACT_PROBE_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            sourceFilesModified:
              0,
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
            "STOP_AND_DIAGNOSE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
