const fs = require("fs");
const path = require("path");

const root = process.cwd();

const logRel =
  "logs/model-promotion-exact-writer-probe-v1.json";

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

function walk(dir, acc = []) {
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
      skipDirs.has(entry.name)
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

function context(
  text,
  index,
  radius = 6,
) {
  const lines =
    text.split(/\r?\n/);

  const line =
    lineNumber(
      text,
      index,
    );

  const start =
    Math.max(
      1,
      line - radius,
    );

  const end =
    Math.min(
      lines.length,
      line + radius,
    );

  return {
    line,
    startLine:
      start,
    endLine:
      end,
    text:
      lines
        .slice(
          start - 1,
          end,
        )
        .join("\n"),
  };
}

function extractStatusLiterals(
  text,
) {
  const statuses =
    new Set();

  const patterns = [
    /status\s*[:=]\s*["']([A-Z_]+)["']/g,
    /\.eq\(\s*["']status["']\s*,\s*["']([A-Z_]+)["']\s*\)/g,
    /\bstatus\s+in\s*\(([^)]+)\)/gi,
  ];

  for (
    const pattern of
    patterns
  ) {
    let match;

    while (
      (match =
        pattern.exec(text))
    ) {
      if (
        pattern ===
        patterns[2]
      ) {
        const literals =
          match[1]
            .match(
              /["']([A-Z_]+)["']/g,
            ) ??
          [];

        for (
          const literal of
          literals
        ) {
          statuses.add(
            literal.replace(
              /["']/g,
              "",
            ),
          );
        }
      } else {
        statuses.add(
          match[1],
        );
      }
    }
  }

  return [
    ...statuses,
  ].sort();
}

function findAll(
  text,
  regex,
  max = 30,
) {
  const results = [];

  let match;

  regex.lastIndex = 0;

  while (
    (match =
      regex.exec(text)) &&
    results.length <
      max
  ) {
    results.push({
      index:
        match.index,
      match:
        match[0],
      groups:
        match
          .slice(1),
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

function isLikelyWriter(
  text,
) {
  if (
    !/\.from\(\s*["']ai_model_versions["']\s*\)/.test(
      text,
    )
  ) {
    return false;
  }

  return (
    /\.update\s*\(/.test(
      text,
    ) ||
    /\.upsert\s*\(/.test(
      text,
    ) ||
    /\.insert\s*\(/.test(
      text,
    ) ||
    /\.rpc\s*\(/.test(
      text,
    )
  );
}

function writerEvidence(
  text,
) {
  const anchors = [];

  const regexes = [
    /\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,1200}?\.update\s*\(\s*\{[\s\S]{0,600}?\bstatus\s*:/g,
    /\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,1200}?\.insert\s*\(\s*\{[\s\S]{0,600}?\bstatus\s*:/g,
    /\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,1200}?\.upsert\s*\(\s*\{[\s\S]{0,600}?\bstatus\s*:/g,
    /update\s+public\.ai_model_versions[\s\S]{0,800}?\bstatus\s*=/gi,
    /insert\s+into\s+public\.ai_model_versions[\s\S]{0,800}?\bstatus\b/gi,
  ];

  for (
    const regex of
    regexes
  ) {
    for (
      const hit of
      findAll(
        text,
        regex,
        20,
      )
    ) {
      anchors.push(
        context(
          text,
          hit.index,
          8,
        ),
      );
    }
  }

  return anchors;
}

function transitionEvidence(
  text,
) {
  const anchors = [];

  const regexes = [
    /status\s*!==\s*["'][A-Z_]+["'][\s\S]{0,400}?status\s*!==\s*["'][A-Z_]+["']/g,
    /\.eq\(\s*["']status["']\s*,\s*["'][A-Z_]+["']\s*\)/g,
    /approved_at/g,
    /rejected_at/g,
    /retired_at/g,
    /promot[a-z_]*/gi,
  ];

  for (
    const regex of
    regexes
  ) {
    for (
      const hit of
      findAll(
        text,
        regex,
        20,
      )
    ) {
      anchors.push(
        context(
          text,
          hit.index,
          5,
        ),
      );
    }
  }

  return anchors;
}

function sqlConstraintEvidence(
  text,
) {
  const anchors = [];

  const regexes = [
    /create\s+table[\s\S]{0,2500}?ai_model_versions[\s\S]{0,2500}?check\s*\([^;]*status[^;]*\)/gi,
    /alter\s+table\s+public\.ai_model_versions[\s\S]{0,1500}?check\s*\([^;]*status[^;]*\)/gi,
    /constraint\s+[a-zA-Z0-9_]+[\s\S]{0,1000}?status[\s\S]{0,1000}?check/gi,
  ];

  for (
    const regex of
    regexes
  ) {
    for (
      const hit of
      findAll(
        text,
        regex,
        10,
      )
    ) {
      anchors.push(
        context(
          text,
          hit.index,
          12,
        ),
      );
    }
  }

  return anchors;
}

function typeEvidence(
  text,
) {
  const anchors = [];

  const regexes = [
    /type\s+[A-Za-z0-9_]*Model[A-Za-z0-9_]*Status[\s\S]{0,800}?;/g,
    /status\s*:\s*["'][A-Z_]+["']\s*\|[\s\S]{0,700}?;/g,
  ];

  for (
    const regex of
    regexes
  ) {
    for (
      const hit of
      findAll(
        text,
        regex,
        10,
      )
    ) {
      anchors.push(
        context(
          text,
          hit.index,
          10,
        ),
      );
    }
  }

  return anchors;
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
    const name of
    names
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

async function fetchOpenApi(
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

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

function schemaColumns(
  openApi,
  name,
) {
  if (!openApi) {
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

async function readModels(
  url,
  key,
  columns,
) {
  if (
    !url ||
    !key ||
    columns.length ===
      0
  ) {
    return [];
  }

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
      columns,
    );

  const selected =
    preferred.filter(
      (column) =>
        available.has(
          column,
        ),
    );

  const query =
    encodeURIComponent(
      selected.join(
        ",",
      ),
    );

  const response =
    await fetch(
      `${url}/rest/v1/ai_model_versions?select=${query}&limit=100`,
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

  if (!response.ok) {
    return [];
  }

  return await response.json();
}

async function main() {
  const files =
    walk(
      root,
    );

  const writers = [];
  const transitionReaders = [];
  const constraints = [];
  const typeDefs = [];
  const allStatusLiterals =
    new Set();

  for (
    const file of
    files
  ) {
    const text =
      read(
        file,
      );

    if (
      !text ||
      !/ai_model_versions|ModelStatus|approved_at|CANDIDATE|APPROVED|REJECTED|RETIRED|SHADOW|LIMITED_LIVE|PRODUCTION|DEGRADED|DISABLED/.test(
        text,
      )
    ) {
      continue;
    }

    for (
      const status of
      extractStatusLiterals(
        text,
      )
    ) {
      allStatusLiterals.add(
        status,
      );
    }

    const writer =
      isLikelyWriter(
        text,
      )
        ? writerEvidence(
            text,
          )
        : [];

    if (
      writer.length >
      0
    ) {
      writers.push({
        file:
          rel(file),
        statusLiterals:
          extractStatusLiterals(
            text,
          ),
        evidence:
          writer,
      });
    }

    if (
      /\.from\(\s*["']ai_model_versions["']\s*\)/.test(
        text,
      ) ||
      /public\.ai_model_versions/.test(
        text,
      )
    ) {
      const transitions =
        transitionEvidence(
          text,
        );

      if (
        transitions.length >
        0
      ) {
        transitionReaders.push({
          file:
            rel(file),
          statusLiterals:
            extractStatusLiterals(
              text,
            ),
          evidence:
            transitions,
        });
      }
    }

    if (
      path.extname(
        file,
      ).toLowerCase() ===
        ".sql"
    ) {
      const evidence =
        sqlConstraintEvidence(
          text,
        );

      if (
        evidence.length >
        0
      ) {
        constraints.push({
          file:
            rel(file),
          statusLiterals:
            extractStatusLiterals(
              text,
            ),
          evidence,
        });
      }
    }

    const types =
      typeEvidence(
        text,
      );

    if (
      types.length >
      0
    ) {
      typeDefs.push({
        file:
          rel(file),
        statusLiterals:
          extractStatusLiterals(
            text,
          ),
        evidence:
          types,
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
    await fetchOpenApi(
      url,
      key,
    );

  const modelColumns =
    schemaColumns(
      openApi,
      "ai_model_versions",
    );

  const modelRows =
    await readModels(
      url,
      key,
      modelColumns,
    );

  const dbStatuses =
    [
      ...new Set(
        modelRows
          .map(
            (row) =>
              row.status,
          )
          .filter(
            Boolean,
          ),
      ),
    ].sort();

  const sourceStatuses =
    [
      ...allStatusLiterals,
    ].sort();

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

  const legacyStatuses = [
    "APPROVED",
    "REJECTED",
    "RETIRED",
  ];

  const exactTargetStageCoverage =
    Object.fromEntries(
      targetStages.map(
        (stage) => [
          stage,
          writers.some(
            (writer) =>
              writer
                .statusLiterals
                .includes(
                  stage,
                ),
          ) ||
          constraints.some(
            (item) =>
              item
                .statusLiterals
                .includes(
                  stage,
                ),
          ),
        ],
      ),
    );

  const result = {
    status:
      "MODEL_PROMOTION_EXACT_WRITER_PROBE_V1_COMPLETE",

    scan: {
      files:
        files.length,
      writerFiles:
        writers.length,
      transitionReaderFiles:
        transitionReaders
          .length,
      constraintFiles:
        constraints.length,
      typeDefinitionFiles:
        typeDefs.length,
    },

    sourceStatuses,
    dbStatuses,

    targetStages,
    legacyStatuses,

    exactTargetStageCoverage,

    modelRegistry: {
      columns:
        modelColumns,
      rows:
        modelRows,
    },

    writers:
      writers.map(
        (item) => ({
          file:
            item.file,
          statusLiterals:
            item.statusLiterals,
          evidenceLines:
            item.evidence.map(
              (e) =>
                e.line,
            ),
        }),
      ),

    constraints:
      constraints.map(
        (item) => ({
          file:
            item.file,
          statusLiterals:
            item.statusLiterals,
          evidenceLines:
            item.evidence.map(
              (e) =>
                e.line,
            ),
        }),
      ),

    types:
      typeDefs.map(
        (item) => ({
          file:
            item.file,
          statusLiterals:
            item.statusLiterals,
          evidenceLines:
            item.evidence.map(
              (e) =>
                e.line,
            ),
        }),
      ),

    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      sourceFilesModified:
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
      "DESIGN_COMPATIBLE_PROMOTION_STATE_MACHINE_WITH_LEGACY_STATUS_MIGRATION",

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
        writerDetails:
          writers,
        transitionReaderDetails:
          transitionReaders,
        constraintDetails:
          constraints,
        typeDetails:
          typeDefs,
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
        scan:
          result.scan,
        sourceStatuses:
          result.sourceStatuses,
        dbStatuses:
          result.dbStatuses,
        exactTargetStageCoverage:
          result.exactTargetStageCoverage,
        writers:
          result.writers,
        constraints:
          result.constraints,
        types:
          result.types,
        modelRows:
          modelRows.map(
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
          ),
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
            "MODEL_PROMOTION_EXACT_WRITER_PROBE_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites:
              0,
            sourceFilesModified:
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
