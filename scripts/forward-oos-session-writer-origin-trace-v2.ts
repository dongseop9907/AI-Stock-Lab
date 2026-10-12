import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();

const TARGET_FILE =
  "logs/alpha-v3-forward-top1-sessions.json";

const SEARCH_ROOTS = [
  "scripts",
  "lib",
  "app",
] as const;

type Match = {
  file: string;
  line: number;
  text: string;
  context: string[];
  classification:
    | "WRITE_PATH"
    | "READ_PATH"
    | "REFERENCE_ONLY";
};

function rel(
  absolute: string,
) {
  return path
    .relative(ROOT, absolute)
    .replaceAll("\\", "/");
}

function sha256(
  text: string,
) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function walk(
  dir: string,
  out: string[] = [],
) {
  if (!fs.existsSync(dir)) {
    return out;
  }

  for (
    const entry of
    fs.readdirSync(
      dir,
      { withFileTypes: true },
    )
  ) {
    if (
      [
        "node_modules",
        ".next",
        ".git",
        "backups",
      ].includes(entry.name)
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }

    if (
      /\.(ts|tsx|js|cjs|mjs|json)$/.test(
        entry.name,
      )
    ) {
      out.push(full);
    }
  }

  return out;
}

function classifyContext(
  context: string,
) {
  const lower =
    context.toLowerCase();

  const writeSignals = [
    "writefilesync",
    "writefile(",
    "appendfilesync",
    "appendfile(",
    "json.stringify",
    "sessions.push",
    "save",
    "persist",
  ];

  const readSignals = [
    "readfilesync",
    "readfile(",
    "existsync",
    "load",
  ];

  if (
    writeSignals.some(
      signal =>
        lower.includes(signal),
    )
  ) {
    return "WRITE_PATH" as const;
  }

  if (
    readSignals.some(
      signal =>
        lower.includes(signal),
    )
  ) {
    return "READ_PATH" as const;
  }

  return "REFERENCE_ONLY" as const;
}

function sourceMatches() {
  const exact =
    TARGET_FILE;

  const base =
    path.basename(TARGET_FILE);

  const matches: Match[] =
    [];

  for (
    const rootName of
    SEARCH_ROOTS
  ) {
    const root =
      path.join(
        ROOT,
        rootName,
      );

    for (
      const file of
      walk(root)
    ) {
      const text =
        fs.readFileSync(
          file,
          "utf8",
        );

      if (
        !text.includes(exact) &&
        !text.includes(base)
      ) {
        continue;
      }

      const lines =
        text.split(/\r?\n/);

      lines.forEach(
        (line, index) => {
          if (
            !line.includes(exact) &&
            !line.includes(base)
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

          matches.push({
            file:
              rel(file),

            line:
              index + 1,

            text:
              line.trim(),

            context:
              context.map(
                (value, offset) =>
                  String(
                    start +
                    offset +
                    1,
                  ) +
                  ": " +
                  value,
              ),

            classification:
              classifyContext(
                context.join("\n"),
              ),
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

  let parsed: unknown =
    null;

  try {
    parsed =
      JSON.parse(text);
  }
  catch {
    parsed =
      null;
  }

  let sessions: unknown[] =
    [];

  if (
    Array.isArray(
      parsed,
    )
  ) {
    sessions = parsed;
  }
  else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray(
      (
        parsed as Record<string, unknown>
      ).sessions,
    )
  ) {
    sessions =
      (
        parsed as Record<string, unknown>
      ).sessions as unknown[];
  }

  const first =
    sessions[0] &&
    typeof sessions[0] === "object" &&
    !Array.isArray(sessions[0])
      ? sessions[0] as
          Record<string, unknown>
      : null;

  const top1 =
    first &&
    first.top1 &&
    typeof first.top1 === "object" &&
    !Array.isArray(first.top1)
      ? first.top1 as
          Record<string, unknown>
      : null;

  return {
    file:
      TARGET_FILE,

    mtime:
      stat.mtime.toISOString(),

    size:
      stat.size,

    hash:
      sha256(text),

    sessionCount:
      sessions.length,

    firstSession:
      first
        ? {
            sourceTradingDate:
              typeof first
                .sourceTradingDate ===
                "string"
                ? first
                    .sourceTradingDate
                : null,

            targetSessionDate:
              typeof first
                .targetSessionDate ===
                "string"
                ? first
                    .targetSessionDate
                : null,

            capturedAt:
              typeof first
                .capturedAt ===
                "string"
                ? first
                    .capturedAt
                : null,

            stockCode:
              typeof top1
                ?.stockCode ===
                "string"
                ? top1
                    .stockCode
                : null,
          }
        : null,
  };
}

function correlatedLogs(
  target:
    ReturnType<
      typeof loadTarget
    >,
) {
  const logsDir =
    path.join(
      ROOT,
      "logs",
    );

  if (
    !target ||
    !target.firstSession ||
    !fs.existsSync(logsDir)
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
          Boolean(value),
      );

  const out: Array<{
    file: string;
    mtime: string;
    size: number;
    hash: string;
    matchedNeedles: string[];
    hints: string[];
  }> = [];

  for (
    const entry of
    fs.readdirSync(
      logsDir,
      { withFileTypes: true },
    )
  ) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name ===
        path.basename(TARGET_FILE)
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
          lower.includes(marker),
      )
    ) {
      continue;
    }

    const full =
      path.join(
        logsDir,
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
          text.includes(needle),
      );

    if (
      matchedNeedles.length ===
      0
    ) {
      continue;
    }

    const stat =
      fs.statSync(full);

    const hints =
      [
        "DRY_RUN",
        "CONTROLLED_NORMAL",
        "PROBE",
        "TEST",
        "SYNTHETIC",
        "MOCK",
        "executed",
        "sessionCount",
        "newSessions",
      ].filter(
        marker =>
          text.includes(marker),
      );

    out.push({
      file:
        rel(full),

      mtime:
        stat.mtime.toISOString(),

      size:
        stat.size,

      hash:
        sha256(text),

      matchedNeedles,

      hints,
    });
  }

  return out.sort(
    (left, right) =>
      left.mtime.localeCompare(
        right.mtime,
      ),
  );
}

function packageReferences(
  references: Match[],
) {
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

  const writers =
    references
      .filter(
        row =>
          row.classification ===
          "WRITE_PATH",
      )
      .map(
        row =>
          row.file,
      );

  return Object
    .entries(
      pkg.scripts ?? {},
    )
    .filter(
      ([, command]) =>
        writers.some(
          writer =>
            command.includes(writer) ||
            command.includes(
              path.basename(writer),
            ),
        ),
    )
    .map(
      ([name, command]) => ({
        name,
        command,
      }),
    );
}

function main() {
  const target =
    loadTarget();

  const references =
    sourceMatches();

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

  const logs =
    correlatedLogs(target);

  let originAssessment = {
    status:
      "WRITER_NOT_IDENTIFIED",
    confidence:
      "LOW",
    reason:
      "No source write path referencing the target file was identified.",
  };

  if (
    writePaths.length === 1 &&
    logs.length > 0
  ) {
    originAssessment = {
      status:
        "LIKELY_WRITER_IDENTIFIED",
      confidence:
        "MEDIUM",
      reason:
        "Exactly one source write path references the target file and correlated logs exist.",
    };
  }
  else if (
    writePaths.length === 1
  ) {
    originAssessment = {
      status:
        "LIKELY_WRITER_IDENTIFIED",
      confidence:
        "MEDIUM_LOW",
      reason:
        "Exactly one source write path references the target file, but no corroborating log was found.",
    };
  }
  else if (
    writePaths.length > 1
  ) {
    originAssessment = {
      status:
        "MULTIPLE_WRITER_CANDIDATES",
      confidence:
        "LOW",
      reason:
        "More than one source write path references the target file.",
    };
  }

  const report = {
    status:
      "AI_STOCK_LAB_FORWARD_OOS_SESSION_WRITER_ORIGIN_TRACE_V2_COMPLETE",

    target,

    sourceReferences: {
      total:
        references.length,
      writePaths,
      readPaths,
      referenceOnly,
    },

    packageScriptReferences:
      packageReferences(
        references,
      ),

    correlatedLogs:
      logs,

    originAssessment,

    decision: {
      currentSessionCanBePromotedToRealEvidence:
        false,

      reason:
        "This trace identifies writer provenance only. Existing session remains non-countable until controlled real-forward execution is proven.",

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
