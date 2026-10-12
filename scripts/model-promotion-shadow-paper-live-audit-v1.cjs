const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const logRel =
  "logs/model-promotion-shadow-paper-live-audit-v1.json";

const targetStages = [
  "EXPERIMENTAL",
  "CANDIDATE",
  "SHADOW",
  "PAPER",
  "LIMITED_LIVE",
  "PRODUCTION",
  "DEGRADED",
  "DISABLED",
];

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

    acc.push(
      full,
    );
  }

  return acc;
}

function rel(
  file,
) {
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

function safeRead(
  file,
) {
  try {
    return fs.readFileSync(
      file,
      "utf8",
    );
  } catch {
    return "";
  }
}

function lineOf(
  text,
  index,
) {
  return (
    text
      .slice(
        0,
        index,
      )
      .split(
        /\r?\n/,
      )
      .length
  );
}

function compactMatches(
  text,
  regex,
  max = 12,
) {
  const results = [];

  let match;

  regex.lastIndex =
    0;

  while (
    (match =
      regex.exec(text)) &&
    results.length <
      max
  ) {
    results.push({
      line:
        lineOf(
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
            180,
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

  return results;
}

function normalizeUrl(
  value,
) {
  return String(value)
    .replace(
      /\/+$/,
      "",
    );
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

async function readOpenApi(
  url,
  key,
) {
  if (
    !url ||
    !key
  ) {
    return null;
  }

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

  if (
    !response.ok
  ) {
    return {
      error:
        `OPENAPI_${response.status}`,
    };
  }

  return await response.json();
}

function hasPath(
  openApi,
  name,
) {
  if (
    !openApi ||
    openApi.error
  ) {
    return false;
  }

  const paths =
    openApi.paths ??
    {};

  return Object.keys(
    paths,
  ).some(
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
  if (
    !openApi ||
    openApi.error
  ) {
    return [];
  }

  const schemas =
    openApi.definitions ??
    openApi.components
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

async function readRows(
  url,
  key,
  table,
  columns,
  limit = 20,
) {
  if (
    !url ||
    !key ||
    columns.length ===
      0
  ) {
    return [];
  }

  const select =
    encodeURIComponent(
      columns.join(
        ",",
      ),
    );

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=${select}&limit=${limit}`,
      {
        headers: {
          apikey:
            key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
        },
      },
    );

  if (
    !response.ok
  ) {
    return [{
      _error:
        `READ_${table}_${response.status}`,
    }];
  }

  return await response.json();
}

async function main() {
  const files =
    walk(
      root,
    );

  const relevant = [];

  const statusUsage =
    Object.fromEntries(
      targetStages.map(
        (stage) => [
          stage,
          [],
        ],
      ),
    );

  const patterns = {
    modelVersion:
      /\bai_model_versions\b/gi,
    modelMetric:
      /\b(model_metrics|metrics\/refresh|refreshModel|profitFactor|maxDrawdown|stopQualityScore)\b/gi,
    shadow:
      /\b(shadow|shadow_signal|signals\/shadow)\b/gi,
    paper:
      /\b(paper_order|paper_trade|paper_position|PAPER)\b/gi,
    live:
      /\b(real_order_enabled|live_order|submit.*live|LIMITED_LIVE|PRODUCTION)\b/gi,
    promotion:
      /\b(promot|promotion|approve|approved_at|champion|challenger|DEGRADED|DISABLED)\b/gi,
  };

  for (
    const file of files
  ) {
    const text =
      safeRead(
        file,
      );

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
        compactMatches(
          text,
          new RegExp(
            regex.source,
            regex.flags,
          ),
          8,
        );

      if (
        matches.length >
        0
      ) {
        hits[name] =
          matches;
      }
    }

    for (
      const stage of
      targetStages
    ) {
      const re =
        new RegExp(
          `\\b${stage}\\b`,
          "g",
        );

      const matches =
        compactMatches(
          text,
          re,
          10,
        );

      if (
        matches.length >
        0
      ) {
        statusUsage[
          stage
        ].push({
          file:
            rel(file),
          matches,
        });
      }
    }

    if (
      Object.keys(hits)
        .length >
      0
    ) {
      relevant.push({
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

  const url =
    urlRaw
      ? normalizeUrl(
          urlRaw,
        )
      : null;

  const openApi =
    await readOpenApi(
      url,
      key,
    );

  const candidateTables = [
    "ai_model_versions",
    "model_metrics",
    "ai_model_metrics",
    "shadow_signals",
    "entry_shadow_signals",
    "paper_order_requests",
    "paper_trade_history",
    "trading_system_controls",
  ];

  const dbSchema = {};

  for (
    const table of
    candidateTables
  ) {
    dbSchema[table] = {
      present:
        hasPath(
          openApi,
          table,
        ),
      columns:
        schemaColumns(
          openApi,
          table,
        ),
    };
  }

  let modelRows = [];

  if (
    dbSchema
      .ai_model_versions
      .present
  ) {
    const preferred = [
      "id",
      "model_name",
      "model_version",
      "purpose",
      "status",
      "created_at",
      "approved_at",
    ];

    const available =
      new Set(
        dbSchema
          .ai_model_versions
          .columns,
      );

    const selectColumns =
      preferred.filter(
        (column) =>
          available.has(
            column,
          ),
      );

    modelRows =
      await readRows(
        url,
        key,
        "ai_model_versions",
        selectColumns,
        50,
      );
  }

  let controls = [];

  if (
    dbSchema
      .trading_system_controls
      .present
  ) {
    const preferred = [
      "control_key",
      "emergency_stop",
      "automation_enabled",
      "paper_order_enabled",
      "real_order_enabled",
    ];

    const available =
      new Set(
        dbSchema
          .trading_system_controls
          .columns,
      );

    const selectColumns =
      preferred.filter(
        (column) =>
          available.has(
            column,
          ),
      );

    controls =
      await readRows(
        url,
        key,
        "trading_system_controls",
        selectColumns,
        10,
      );
  }

  const stagePresence =
    Object.fromEntries(
      targetStages.map(
        (stage) => [
          stage,
          statusUsage[
            stage
          ].length >
            0,
        ],
      ),
    );

  const existingCore = {
    modelRegistry:
      dbSchema
        .ai_model_versions
        .present,

    candidateStatus:
      stagePresence
        .CANDIDATE,

    shadowInfrastructure:
      relevant.some(
        (item) =>
          item.hits
            .shadow,
      ),

    paperInfrastructure:
      dbSchema
        .paper_order_requests
        .present &&
      dbSchema
        .paper_trade_history
        .present,

    metricsInfrastructure:
      relevant.some(
        (item) =>
          item.hits
            .modelMetric,
      ),

    liveGateControl:
      dbSchema
        .trading_system_controls
        .columns
        .includes(
          "real_order_enabled",
        ),

    explicitPromotionCode:
      relevant.some(
        (item) =>
          item.hits
            .promotion,
      ),
  };

  const missingExplicitStages =
    targetStages.filter(
      (stage) =>
        !stagePresence[
          stage
        ],
    );

  const likelyGaps = [];

  if (
    !stagePresence
      .SHADOW
  ) {
    likelyGaps.push(
      "MODEL_STATUS_SHADOW_NOT_EXPLICIT",
    );
  }

  if (
    !stagePresence
      .PAPER
  ) {
    likelyGaps.push(
      "MODEL_STATUS_PAPER_NOT_EXPLICIT",
    );
  }

  if (
    !stagePresence
      .LIMITED_LIVE
  ) {
    likelyGaps.push(
      "MODEL_STATUS_LIMITED_LIVE_NOT_EXPLICIT",
    );
  }

  if (
    !stagePresence
      .PRODUCTION
  ) {
    likelyGaps.push(
      "MODEL_STATUS_PRODUCTION_NOT_EXPLICIT",
    );
  }

  if (
    !stagePresence
      .DEGRADED
  ) {
    likelyGaps.push(
      "MODEL_STATUS_DEGRADED_NOT_EXPLICIT",
    );
  }

  if (
    !stagePresence
      .DISABLED
  ) {
    likelyGaps.push(
      "MODEL_STATUS_DISABLED_NOT_EXPLICIT",
    );
  }

  if (
    !existingCore
      .liveGateControl
  ) {
    likelyGaps.push(
      "REAL_ORDER_ENABLE_GATE_NOT_FOUND",
    );
  }

  const result = {
    status:
      "MODEL_PROMOTION_SHADOW_PAPER_LIVE_AUDIT_V1_COMPLETE",

    scanned: {
      files:
        files.length,
      relevantFiles:
        relevant.length,
    },

    targetStages,

    stagePresence,

    existingCore,

    db: {
      schema:
        dbSchema,
      modelRows,
      controls,
    },

    likelyGaps,

    missingExplicitStages,

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
      "DESIGN_EXPLICIT_MODEL_PROMOTION_STATE_MACHINE_FROM_EXISTING_SURFACES",

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
        relevant,
        statusUsage,
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
        scanned:
          result.scanned,
        stagePresence:
          result.stagePresence,
        existingCore:
          result.existingCore,
        modelRows:
          Array.isArray(
            modelRows,
          )
            ? modelRows
                .slice(
                  0,
                  10,
                )
                .map(
                  (row) => ({
                    id:
                      row.id,
                    name:
                      row.model_name,
                    version:
                      row.model_version,
                    purpose:
                      row.purpose,
                    status:
                      row.status,
                  }),
                )
            : [],
        controls:
          controls,
        likelyGaps:
          result.likelyGaps,
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
            "MODEL_PROMOTION_SHADOW_PAPER_LIVE_AUDIT_V1_FAILED",
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
