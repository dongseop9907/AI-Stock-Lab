const fs = require("fs");
const path = require("path");

const root = process.cwd();
const logRel =
  "logs/model-promotion-evidence-source-audit-v1.json";

const skipDirs =
  new Set([
    "node_modules",
    ".git",
    ".next",
    "logs",
    "output",
    "dist",
    "build",
    ".turbo",
  ]);

const codeExts =
  new Set([
    ".ts",
    ".tsx",
    ".js",
    ".cjs",
    ".mjs",
    ".sql",
    ".json",
  ]);

function walk(
  dir,
  acc = [],
) {
  for (
    const entry of
    fs.readdirSync(
      dir,
      {
        withFileTypes: true,
      },
    )
  ) {
    if (
      entry.isDirectory() &&
      skipDirs.has(
        entry.name,
      )
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      walk(
        full,
        acc,
      );
      continue;
    }

    if (
      !codeExts.has(
        path.extname(
          entry.name,
        ).toLowerCase(),
      )
    ) {
      continue;
    }

    acc.push(full);
  }

  return acc;
}

function rel(file) {
  return path
    .relative(
      root,
      file,
    )
    .replace(
      /\\/g,
      "/",
    );
}

function read(file) {
  try {
    return fs.readFileSync(
      file,
      "utf8",
    );
  } catch {
    return "";
  }
}

function lineNumber(
  text,
  index,
) {
  return (
    text
      .slice(
        0,
        index,
      )
      .split(/\r?\n/)
      .length
  );
}

function findMatches(
  text,
  regex,
  max = 15,
) {
  const out = [];
  regex.lastIndex = 0;

  let match;

  while (
    (match = regex.exec(text)) &&
    out.length < max
  ) {
    out.push({
      line:
        lineNumber(
          text,
          match.index,
        ),
      text:
        match[0]
          .replace(
            /\s+/g,
            " ",
          )
          .slice(
            0,
            220,
          ),
    });

    if (
      match.index ===
      regex.lastIndex
    ) {
      regex.lastIndex +=
        1;
    }
  }

  return out;
}

function firstEnv(
  names,
) {
  for (
    const name of names
  ) {
    const value =
      process.env[name];

    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function normalizeUrl(value) {
  return String(value)
    .replace(
      /\/+$/,
      "",
    );
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
          apikey:
            key,
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
    .some(
      (key) =>
        key ===
          `/${name}` ||
        key.endsWith(
          `/${name}`,
        ),
    );
}

function schemaColumns(
  openApi,
  name,
) {
  const schemas =
    openApi?.definitions ??
    openApi?.components
      ?.schemas ??
    {};

  const direct =
    schemas[name];

  if (
    direct?.properties
  ) {
    return Object.keys(
      direct.properties,
    );
  }

  for (
    const [
      schemaName,
      schema,
    ] of Object.entries(
      schemas,
    )
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
    return {
      available:
        false,
      status:
        response.status,
      count:
        null,
      error:
        text.slice(
          0,
          300,
        ),
    };
  }

  const range =
    response.headers.get(
      "content-range",
    ) ?? "";

  const match =
    /\/(\d+|\*)$/.exec(
      range,
    );

  return {
    available:
      true,
    status:
      response.status,
    count:
      match &&
      match[1] !==
        "*"
        ? Number(match[1])
        : null,
    error:
      null,
  };
}

async function readSample(
  url,
  key,
  table,
  columns,
  limit = 5,
) {
  if (
    columns.length ===
      0
  ) {
    return [];
  }

  const preferred =
    columns.filter(
      (column) =>
        [
          "id",
          "model_id",
          "model_version_id",
          "stock_code",
          "status",
          "promotion_stage",
          "signal_status",
          "trade_status",
          "sample_size",
          "trade_count",
          "win_rate",
          "profit_factor",
          "max_drawdown",
          "max_drawdown_rate",
          "net_pnl",
          "realized_pnl",
          "return_rate",
          "stop_quality_score",
          "score",
          "confidence",
          "captured_at",
          "evaluated_at",
          "created_at",
          "updated_at",
          "observed_at",
        ].includes(
          column,
        ),
    )
    .slice(
      0,
      12,
    );

  if (
    preferred.length ===
      0
  ) {
    return [];
  }

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=${encodeURIComponent(
        preferred.join(","),
      )}&limit=${limit}`,
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
    return [{
      _error:
        `${response.status}:${text.slice(0, 250)}`,
    }];
  }

  return JSON.parse(text);
}

async function main() {
  const files =
    walk(root);

  const patterns = {
    shadow:
      /\b(shadow_signal|shadowSignals|shadow_signals|entry_shadow|captureShadow|evaluateShadow|SHADOW)\b/gi,

    metrics:
      /\b(model_metrics|ai_model_metrics|profit_factor|win_rate|max_drawdown|stop_quality_score|refresh.*metrics|getModelPerformance|model performance)\b/gi,

    paper:
      /\b(paper_trade_history|paper_order_requests|paper_positions|realized_pnl|trade_count|win_rate|profit_factor)\b/gi,

    forward:
      /\b(forward_oos|forward-top1|TRUE_FORWARD|qualified observations|paired positive|targetSessionDate|sourceTradingDate)\b/gi,

    walkForward:
      /\b(walk[-_ ]?forward|purged.*walk|oos|out[-_ ]of[-_ ]sample)\b/gi,

    promotion:
      /\b(model_promotion|promotion_stage|CANDIDATE|PAPER|LIMITED_LIVE|PRODUCTION)\b/gi,
  };

  const sourceEvidence = [];

  for (
    const file of files
  ) {
    const text =
      read(file);

    if (!text) {
      continue;
    }

    const hits = {};

    for (
      const [
        name,
        regex,
      ] of Object.entries(
        patterns,
      )
    ) {
      const matches =
        findMatches(
          text,
          new RegExp(
            regex.source,
            regex.flags,
          ),
          12,
        );

      if (
        matches.length >
          0
      ) {
        hits[name] =
          matches;
      }
    }

    if (
      Object.keys(hits)
        .length >
      0
    ) {
      sourceEvidence.push({
        file:
          rel(file),
        hits,
      });
    }
  }

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

  if (
    !urlRaw ||
    !key
  ) {
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

  const candidates = [
    "ai_model_versions",
    "model_metrics",
    "ai_model_metrics",
    "shadow_signals",
    "entry_shadow_signals",
    "entry_signal_shadow",
    "entry_signal_shadows",
    "entry_signals",
    "paper_trade_history",
    "paper_order_requests",
    "paper_positions",
    "trade_exit_evaluations",
    "paper_trade_evaluations",
    "model_promotion_events",
    "trading_system_controls",
  ];

  const db = {};

  for (
    const table of
    candidates
  ) {
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

    const count =
      present
        ? await countRows(
            url,
            key,
            table,
          )
        : {
            available:
              false,
            count:
              null,
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
        count.count ??
        null,
      sample,
    };
  }

  const sourceFilesByCategory =
    Object.fromEntries(
      Object.keys(patterns)
        .map(
          (category) => [
            category,
            sourceEvidence
              .filter(
                (item) =>
                  item.hits[
                    category
                  ],
              )
              .map(
                (item) =>
                  item.file,
              )
              .slice(
                0,
                40,
              ),
          ],
        ),
    );

  const evidenceContract = {
    candidateToShadow: {
      likelySources: [
        "historical/walk-forward validation source files",
        "model performance metrics",
        "data quality / forward contract artifacts",
      ],
      automaticallyApply:
        false,
      recommendationOnly:
        true,
    },

    shadowToPaper: {
      likelySources: [
        "shadow signal tracking",
        "shadow evaluation results",
        "model performance metrics",
      ],
      automaticallyApply:
        false,
      recommendationOnly:
        true,
    },

    paperToLimitedLive: {
      likelySources: [
        "paper_trade_history",
        "paper execution realism",
        "risk / drawdown / profit factor metrics",
        "forward OOS evidence",
      ],
      automaticallyApply:
        false,
      manualApprovalRequired:
        true,
    },

    limitedLiveToProduction: {
      likelySources: [
        "future limited-live execution evidence",
        "live slippage / failure / drawdown controls",
      ],
      automaticallyApply:
        false,
      manualApprovalRequired:
        true,
      currentlyExecutable:
        false,
    },
  };

  const result = {
    status:
      "MODEL_PROMOTION_EVIDENCE_SOURCE_AUDIT_V1_COMPLETE",

    scanned: {
      sourceFiles:
        files.length,
      relevantFiles:
        sourceEvidence.length,
    },

    sourceFilesByCategory,

    db,

    evidenceContract,

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
      "DEFINE_PROMOTION_EVIDENCE_CONTRACT_FROM_EXISTING_METRICS_WITHOUT_OOS_RETUNING",

    details:
      logRel,
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
      logRel,
    ),
    JSON.stringify(
      {
        ...result,
        sourceEvidence,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const dbSummary =
    Object.fromEntries(
      Object.entries(db)
        .filter(
          ([, value]) =>
            value.present,
        )
        .map(
          ([name, value]) => [
            name,
            {
              count:
                value.count,
              columns:
                value.columns,
              sample:
                value.sample,
            },
          ],
        ),
    );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,
        scanned:
          result.scanned,
        sourceFilesByCategory:
          result.sourceFilesByCategory,
        db:
          dbSummary,
        evidenceContract:
          result.evidenceContract,
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
            "MODEL_PROMOTION_EVIDENCE_SOURCE_AUDIT_V1_FAILED",
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
