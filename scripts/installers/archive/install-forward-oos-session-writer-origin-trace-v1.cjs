const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "forward-oos-session-writer-origin-trace-v1.ts"
  );

const source = String.raw`import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT =
  process.cwd();

const TARGET_FILE =
  "logs/alpha-v3-forward-top1-sessions.json";

const SEARCH_ROOTS = [
  "scripts",
  "lib",
  "app",
] as const;

const LOG_ROOT =
  path.join(
    ROOT,
    "logs",
  );

type JsonRecord =
  Record<string, unknown>;

function asRecord(
  value: unknown,
): JsonRecord | null {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as JsonRecord
    : null;
}

function stringOrNull(
  value: unknown,
) {
  return typeof value === "string"
    ? value
    : null;
}

function sha256(
  text: string,
) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function rel(
  absolute: string,
) {
  return path
    .relative(
      ROOT,
      absolute,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function walk(
  absolute: string,
  out: string[] = [],
) {
  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return out;
  }

  for (
    const entry of
    fs.readdirSync(
      absolute,
      {
        withFileTypes:
          true,
      },
    )
  ) {
    if (
      [
        "node_modules",
        ".next",
        ".git",
        "backups",
      ].includes(
        entry.name,
      )
    ) {
      continue;
    }

    const full =
      path.join(
        absolute,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      walk(
        full,
        out,
      );

      continue;
    }

    if (
      /\.(ts|tsx|js|cjs|mjs|json)$/.test(
        entry.name,
      )
    ) {
      out.push(
        full,
      );
    }
  }

  return out;
}

function sourceMatches() {
  const exact =
    TARGET_FILE;

  const base =
    path.basename(
      TARGET_FILE,
    );

  const matches:
    Array<{
      file: string;
      line: number;
      text: string;
      context: string[];
      classification:
        "WRITE_PATH" |
        "READ_PATH" |
        "REFERENCE_ONLY";
    }> =
    [];

  for (
    const root of
    SEARCH_ROOTS
  ) {
    for (
      const file of
      walk(
        path.join(
          ROOT,
          root,
        ),
      )
    ) {
      const text =
        fs.readFileSync(
          file,
          "utf8",
        );

      if (
        !text.includes(
          exact,
        ) &&
        !text.includes(
          base,
        )
      ) {
        continue;
      }

      const lines =
        text.split(
          /\r?\n/,
        );

      lines.forEach(
        (
          line,
          index,
        ) => {
          if (
            !line.includes(
              exact,
            ) &&
            !line.includes(
              base,
            )
          ) {
            return;
          }

          const start =
            Math.max(
              0,
              index - 8,
            );

          const end =
            Math.min(
              lines.length,
              index + 9,
            );

          const context =
            lines.slice(
              start,
              end,
            );

          const joined =
            context
              .join(
                "\n",
              )
              .toLowerCase();

          const writeSignals = [
            "writefilesync",
            "writefile(",
            "appendfilesync",
            "appendfile(",
            "persist",
            "save",
            "sessions.push",
            "json.stringify",
          ];

          const readSignals = [
            "readfilesync",
            "readfile(",
            "existsync",
            "load",
          ];

          const classification =
            writeSignals.some(
              signal =>
                joined.includes(
                  signal,
                ),
            )
              ? "WRITE_PATH"
              : (
                  readSignals.some(
                    signal =>
                      joined.includes(
                        signal,
                      ),
                  )
                    ? "READ_PATH"
                    : "REFERENCE_ONLY"
                );

          matches.push({
            file:
              rel(
                file,
              ),

            line:
              index + 1,

            text:
              line.trim(),

            context:
              context.map(
                (
                  value,
                  offset,
                ) =>
                  `${start + offset + 1}: ${value}`,
              ),

            classification,
          });
        },
      );
    }
  }

  return matches;
}

function loadTarget() {
  const absolute =
    path.join(
      ROOT,
      TARGET_FILE,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return null;
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const stat =
    fs.statSync(
      absolute,
    );

  let parsed:
    unknown =
    null;

  try {
    parsed =
      JSON.parse(
        text,
      );
  } catch {
    parsed =
      null;
  }

  const root =
    asRecord(
      parsed,
    );

  const sessions =
    Array.isArray(
      parsed,
    )
      ? parsed
      : (
          root &&
          Array.isArray(
            root.sessions,
          )
            ? root.sessions
            : []
        );

  const first =
    asRecord(
      sessions[0],
    );

  return {
    file:
      TARGET_FILE,

    mtime:
      stat.mtime.toISOString(),

    size:
      stat.size,

    hash:
      sha256(
        text,
      ),

    sessionCount:
      sessions.length,

    firstSession: first
      ? {
          sourceTradingDate:
            stringOrNull(
              first
                .sourceTradingDate,
            ),

          targetSessionDate:
            stringOrNull(
              first
                .targetSessionDate,
            ),

          capturedAt:
            stringOrNull(
              first
                .capturedAt,
            ),

          stockCode:
            stringOrNull(
              asRecord(
                first.top1,
              )
                ?.stockCode,
            ),
        }
      : null,
  };
}

function interestingLogFiles(
  target:
    ReturnType<
      typeof loadTarget
    >,
) {
  if (
    !target ||
    !target.firstSession ||
    !fs.existsSync(
      LOG_ROOT,
    )
  ) {
    return [];
  }

  const needles =
    [
      target
        .firstSession
        .capturedAt,
      target
        .firstSession
        .sourceTradingDate,
      target
        .firstSession
        .targetSessionDate,
      target
        .firstSession
        .stockCode,
    ]
      .filter(
        (
          value,
        ): value is string =>
          Boolean(
            value,
          ),
      );

  const results:
    Array<{
      file: string;
      mtime: string;
      size: number;
      hash: string;
      matchedNeedles: string[];
      hints: string[];
    }> =
    [];

  for (
    const entry of
    fs.readdirSync(
      LOG_ROOT,
      {
        withFileTypes:
          true,
      },
    )
  ) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(
        ".json",
      ) ||
      entry.name ===
        path.basename(
          TARGET_FILE,
        )
    ) {
      continue;
    }

    const lower =
      entry.name.toLowerCase();

    if (
      ![
        "forward",
        "producer",
        "evidence",
        "session",
        "capture",
      ].some(
        marker =>
          lower.includes(
            marker,
          ),
      )
    ) {
      continue;
    }

    const full =
      path.join(
        LOG_ROOT,
        entry.name,
      );

    const text =
      fs.readFileSync(
        full,
        "utf8",
      );

    const matchedNeedles =
      needles.filter(
        needle =>
          text.includes(
            needle,
          ),
      );

    if (
      matchedNeedles.length ===
      0
    ) {
      continue;
    }

    const stat =
      fs.statSync(
        full,
      );

    const hints: string[] =
      [];

    for (
      const marker of [
        "DRY_RUN",
        "CONTROLLED_NORMAL",
        "PROBE",
        "TEST",
        "SYNTHETIC",
        "MOCK",
        "executed",
        "sessionCount",
        "newSessions",
      ]
    ) {
      if (
        text.includes(
          marker,
        )
      ) {
        hints.push(
          marker,
        );
      }
    }

    results.push({
      file:
        rel(
          full,
        ),

      mtime:
        stat.mtime.toISOString(),

      size:
        stat.size,

      hash:
        sha256(
          text,
        ),

      matchedNeedles,

      hints,
    });
  }

  return results
    .sort(
      (
        left,
        right,
      ) =>
        left.mtime.localeCompare(
          right.mtime,
        ),
    );
}

function packageReferences() {
  const packagePath =
    path.join(
      ROOT,
      "package.json",
    );

  if (
    !fs.existsSync(
      packagePath,
    )
  ) {
    return [];
  }

  const pkg =
    JSON.parse(
      fs.readFileSync(
        packagePath,
        "utf8",
      ),
    ) as {
      scripts?:
        Record<
          string,
          string
        >;
    };

  const source =
    sourceMatches();

  const likelyWriterFiles =
    new Set(
      source
        .filter(
          match =>
            match.classification ===
            "WRITE_PATH",
        )
        .map(
          match =>
            match.file,
        ),
    );

  return Object
    .entries(
      pkg.scripts ??
        {},
    )
    .filter(
      (
        [
          ,
          command,
        ],
      ) =>
        Array
          .from(
            likelyWriterFiles,
          )
          .some(
            writer =>
              command.includes(
                path.basename(
                  writer,
                ),
              ) ||
              command.includes(
                writer,
              ),
          ),
    )
    .map(
      (
        [
          name,
          command,
        ],
      ) => ({
        name,
        command,
      }),
    );
}

function classifyOrigin(
  writers:
    ReturnType<
      typeof sourceMatches
    >,
  logs:
    ReturnType<
      typeof interestingLogFiles
    >,
) {
  const writePaths =
    writers.filter(
      row =>
        row.classification ===
        "WRITE_PATH",
    );

  if (
    writePaths.length ===
      1 &&
    logs.length >
      0
  ) {
    return {
      status:
        "LIKELY_WRITER_IDENTIFIED",

      confidence:
        "MEDIUM",

      reason:
        "Exactly one source write path references the target session file and correlated logs exist.",
    };
  }

  if (
    writePaths.length ===
      1
  ) {
    return {
      status:
        "LIKELY_WRITER_IDENTIFIED",

      confidence:
        "MEDIUM_LOW",

      reason:
        "Exactly one source write path references the target session file, but no corroborating log was found.",
    };
  }

  if (
    writePaths.length >
      1
  ) {
    return {
      status:
        "MULTIPLE_WRITER_CANDIDATES",

      confidence:
        "LOW",

      reason:
        "More than one source write path can produce the target session file.",
    };
  }

  return {
    status:
      "WRITER_NOT_IDENTIFIED",

    confidence:
      "LOW",

    reason:
      "No source write path referencing the exact target file was found.",
  };
}

function main() {
  const target =
    loadTarget();

  const references =
    sourceMatches();

  const relatedLogs =
    interestingLogFiles(
      target,
    );

  const writePaths =
    references.filter(
      row =>
        row.classification ===
        "WRITE_PATH",
    );

  const readPaths =
    references.filter(
      row =>
        row.classification ===
        "READ_PATH",
    );

  const referenceOnly =
    references.filter(
      row =>
        row.classification ===
        "REFERENCE_ONLY",
    );

  const report = {
    status:
      "AI_STOCK_LAB_FORWARD_OOS_SESSION_WRITER_ORIGIN_TRACE_V1_COMPLETE",

    target,

    sourceReferences: {
      total:
        references.length,

      writePaths,
      readPaths,
      referenceOnly,
    },

    packageScriptReferences:
      packageReferences(),

    correlatedLogs:
      relatedLogs,

    originAssessment:
      classifyOrigin(
        references,
        relatedLogs,
      ),

    decision: {
      currentSessionCanBePromotedToRealEvidence:
        false,

      reason:
        "This trace identifies origin evidence only. A session remains non-countable until its writer and execution mode are proven to be controlled real-forward.",

      mutation:
        "NONE",
    },

    safety: {
      readOnly:
        true,

      filesWritten:
        0,

      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    nextGate:
      "CLASSIFY_EXISTING_SESSION_OR_EXCLUDE_IT_FROM_REAL_FORWARD_EVIDENCE",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode = 0;
}

main();
`;

fs.writeFileSync(
  TARGET,
  source,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_SESSION_WRITER_ORIGIN_TRACE_V1_INSTALLED",

      generatedFile:
        "scripts/forward-oos-session-writer-origin-trace-v1.ts",

      probe: {
        exactTargetFileReferenceScan:
          true,

        writePathClassification:
          true,

        correlatedLogScan:
          true,

        packageScriptReferenceScan:
          true,

        mutation:
          "NONE",
      },

      safety: {
        probeExecution:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionExecuted:
          false,

        realTradingEnabled:
          false,
      },

      nextAction:
        "RUN_READ_ONLY_WRITER_ORIGIN_TRACE",
    },
    null,
    2
  )
);

process.exitCode = 0;
