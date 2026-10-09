
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const SEARCH_ROOTS = [
  "app",
  "lib",
];

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
]);

function walk(dir: string): string[] {
  const absolute = path.join(ROOT, dir);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of fs.readdirSync(absolute, {
    withFileTypes: true,
  })) {
    const full = path.join(absolute, entry.name);

    if (
      entry.name === "node_modules" ||
      entry.name === ".next"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      result.push(
        ...walk(
          path.relative(ROOT, full),
        ),
      );
      continue;
    }

    if (
      EXTENSIONS.has(
        path.extname(entry.name),
      )
    ) {
      result.push(full);
    }
  }

  return result;
}

function relative(file: string): string {
  return path
    .relative(ROOT, file)
    .replaceAll("\\", "/");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractTables(text: string): string[] {
  const tables: string[] = [];

  const regex =
    /\.from\s*\(\s*["'\x60]([^"'\x60]+)["'\x60]\s*\)/g;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    tables.push(match[1]);
  }

  return unique(tables);
}

function matchingLines(
  text: string,
  patterns: RegExp[],
) {
  const lines = text.split(/\r?\n/);

  return lines
    .map((line, index) => ({
      line: index + 1,
      text: line.trim(),
    }))
    .filter(({ text }) =>
      patterns.some((pattern) =>
        pattern.test(text),
      ),
    )
    .slice(0, 40);
}

const files =
  SEARCH_ROOTS.flatMap(walk);

const candidates = files
  .map((file) => {
    const text = fs.readFileSync(
      file,
      "utf8",
    );

    const lower = text.toLowerCase();

    const shadow =
      lower.includes("shadow");

    const outcome =
      lower.includes("outcome");

    const evaluation =
      lower.includes("evaluate") ||
      lower.includes("evaluation");

    const returnFields =
      /return_?1d/i.test(text) ||
      /return_?3d/i.test(text) ||
      /return_?5d/i.test(text);

    const pending =
      /PENDING/i.test(text);

    const completed =
      /COMPLETED/i.test(text);

    const persistence =
      /\.update\s*\(/.test(text) ||
      /\.upsert\s*\(/.test(text) ||
      /\.insert\s*\(/.test(text);

    const route =
      relative(file).includes("/api/");

    let score = 0;

    if (shadow) score += 4;
    if (outcome) score += 4;
    if (evaluation) score += 3;
    if (returnFields) score += 5;
    if (pending) score += 2;
    if (completed) score += 2;
    if (persistence) score += 4;
    if (route) score += 1;

    return {
      file: relative(file),
      score,
      flags: {
        shadow,
        outcome,
        evaluation,
        returnFields,
        pending,
        completed,
        persistence,
        route,
      },
      tables: extractTables(text),
      lines: matchingLines(
        text,
        [
          /shadow/i,
          /outcome/i,
          /return_?1d/i,
          /return_?3d/i,
          /return_?5d/i,
          /PENDING/,
          /COMPLETED/,
          /\.update\s*\(/,
          /\.upsert\s*\(/,
          /\.insert\s*\(/,
        ],
      ),
    };
  })
  .filter((item) =>
    item.score >= 8,
  )
  .sort(
    (a, b) =>
      b.score - a.score ||
      a.file.localeCompare(b.file),
  )
  .slice(0, 30);

const evaluatorEntrypoints =
  candidates
    .filter((item) =>
      item.flags.shadow &&
      item.flags.evaluation,
    )
    .map((item) => item.file);

const persistenceSites =
  candidates
    .filter((item) =>
      item.flags.persistence &&
      (
        item.flags.shadow ||
        item.flags.outcome
      ),
    )
    .map((item) => ({
      file: item.file,
      tables: item.tables,
      flags: item.flags,
      lines: item.lines,
    }));

const targetTables =
  unique(
    persistenceSites.flatMap(
      (site) => site.tables,
    ),
  );

const returnFieldSites =
  candidates
    .filter((item) =>
      item.flags.returnFields,
    )
    .map((item) => ({
      file: item.file,
      tables: item.tables,
      lines: item.lines.filter(
        (line) =>
          /return_?1d|return_?3d|return_?5d/i
            .test(line.text),
      ),
    }));

const statusTransitionSites =
  candidates
    .filter((item) =>
      item.flags.pending ||
      item.flags.completed,
    )
    .map((item) => ({
      file: item.file,
      pending: item.flags.pending,
      completed: item.flags.completed,
      lines: item.lines.filter(
        (line) =>
          /PENDING|COMPLETED/.test(line.text),
      ),
    }));

const checks = {
  evaluatorEntrypointFound:
    evaluatorEntrypoints.length > 0,

  persistenceSiteFound:
    persistenceSites.length > 0,

  returnFieldsFound:
    returnFieldSites.length > 0,

  statusLifecycleFound:
    statusTransitionSites.some(
      (item) =>
        item.pending ||
        item.completed,
    ),

  noDatabaseWrites:
    true,

  noOrdersCreated:
    true,

  noPositionsChanged:
    true,

  realTradingUnchanged:
    true,
};

const failed =
  Object.entries(checks)
    .filter(
      ([key, value]) =>
        !value &&
        ![
          "noDatabaseWrites",
          "noOrdersCreated",
          "noPositionsChanged",
          "realTradingUnchanged",
        ].includes(key),
    )
    .map(([key]) => key);

const report = {
  status:
    failed.length === 0
      ? "MODEL_SHADOW_REAL_EVALUATOR_PERSISTENCE_SHAPE_PROBE_V1_COMPLETE"
      : "MODEL_SHADOW_REAL_EVALUATOR_PERSISTENCE_SHAPE_PROBE_V1_INCONCLUSIVE",

  scannedFiles: files.length,

  evaluatorEntrypoints,

  persistenceSites,

  targetTables,

  returnFieldSites,

  statusTransitionSites,

  checks,

  failed,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionChange: false,
    controlsChange: false,
    realTradingChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "BIND_REAL_EVALUATOR_PERSISTENCE_TO_CANONICAL_SHADOW_OUTCOME_OR_VERIFY_ALREADY_BOUND"
      : "INSPECT_SHADOW_EVALUATOR_SOURCE_FROM_PROBE_RESULTS",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "model-shadow-real-evaluator-persistence-shape-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ),
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
