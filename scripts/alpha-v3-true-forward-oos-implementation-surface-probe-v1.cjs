const fs = require("fs");
const path = require("path");

const root = process.cwd();

const candidates = [
  "scripts/alpha-v3-extended-entry-v3-replay-batcher.ts",
  "scripts/alpha-v3-extended-entry-v3-replay-batcher.cjs",
  "scripts/alpha-v3-extended-entry-v3-replay.ts",
  "scripts/alpha-v3-entry-v3-forward-shadow-oos.ts",
  "scripts/alpha-v3-true-entry-forward-oos-batcher-probe.ts",
  "lib/alpha/candidate-scoring.ts",
  "lib/research/evaluate-alpha-forward-outcomes-v9-1.ts",
  "logs/alpha-v3-extended-pricevolume-top1-history.json",
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  "alpha-v3-extended-entry-v3-replay-checkpoint.json",
  "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
  "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  "logs/alpha-v3-forward-top1-sessions.json",
];

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

function summarizeSource(rel, text) {
  const lines = text.split(/\r?\n/);

  const imports = [];
  const functions = [];
  const exports = [];
  const constants = [];
  const fileRefs = [];
  const scoreSignals = [];
  const dateSignals = [];
  const fillSignals = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^import\b|^const .*require\(/.test(trimmed)) {
      imports.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (
      /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) ||
      /^const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed)
    ) {
      functions.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (/^export\b/.test(trimmed)) {
      exports.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (/^const\s+[A-Z0-9_]+\s*=/.test(trimmed)) {
      constants.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (
      /alpha-v3-|\.json|checkpoint|history|forward/i.test(trimmed)
    ) {
      fileRefs.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (
      /correctedEntry|qualification|qualified|entryScore|effectiveScore|rawPriceVolumeScore/i.test(
        trimmed,
      )
    ) {
      scoreSignals.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (
      /sourceTradingDate|targetSessionDate|tradingDate|nextTrading|sessionDate|HORIZON/i.test(
        trimmed,
      )
    ) {
      dateSignals.push({
        line: i + 1,
        text: trimmed,
      });
    }

    if (
      /maxPremium|limitPrice|fillPrice|filled|INTRAMINUTE|OPEN_AT_OR_BELOW_LIMIT|r1|r3|r5/i.test(
        trimmed,
      )
    ) {
      fillSignals.push({
        line: i + 1,
        text: trimmed,
      });
    }
  }

  return {
    rel,
    lineCount: lines.length,
    imports: imports.slice(0, 80),
    functions: functions.slice(0, 120),
    exports: exports.slice(0, 80),
    constants: constants.slice(0, 120),
    fileRefs: fileRefs.slice(0, 140),
    scoreSignals: scoreSignals.slice(0, 160),
    dateSignals: dateSignals.slice(0, 160),
    fillSignals: fillSignals.slice(0, 160),
  };
}

function summarizeJson(rel, text) {
  let value;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      rel,
      parseError:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }

  const summary = {
    rel,
    type:
      Array.isArray(value)
        ? "array"
        : typeof value,
  };

  if (Array.isArray(value)) {
    summary.count = value.length;
    summary.firstKeys =
      value.length > 0 &&
      value[0] &&
      typeof value[0] === "object"
        ? Object.keys(value[0])
        : [];
    summary.last =
      value.length > 0
        ? value[value.length - 1]
        : null;
  } else if (value && typeof value === "object") {
    summary.keys = Object.keys(value);

    for (const key of [
      "version",
      "status",
      "historicalCutoff",
      "selectedCap",
      "entryScoreThreshold",
      "frozen",
      "counts",
      "decision",
    ]) {
      if (key in value) {
        summary[key] = value[key];
      }
    }

    for (const key of [
      "rows",
      "results",
      "sessions",
      "observations",
      "items",
    ]) {
      if (Array.isArray(value[key])) {
        summary[`${key}Count`] = value[key].length;
        summary[`${key}FirstKeys`] =
          value[key].length > 0 &&
          value[key][0] &&
          typeof value[key][0] === "object"
            ? Object.keys(value[key][0])
            : [];
        summary[`${key}Last`] =
          value[key].length > 0
            ? value[key][value[key].length - 1]
            : null;
      }
    }
  }

  return summary;
}

const inspected = candidates.map((rel) => {
  const text = read(rel);

  if (text === null) {
    return {
      rel,
      exists: false,
    };
  }

  const isJson = rel.endsWith(".json");

  return {
    rel,
    exists: true,
    kind: isJson ? "json" : "source",
    summary: isJson
      ? summarizeJson(rel, text)
      : summarizeSource(rel, text),
  };
});

const sourceFiles = inspected
  .filter((item) => item.exists && item.kind === "source")
  .map((item) => item.summary);

const jsonFiles = inspected
  .filter((item) => item.exists && item.kind === "json")
  .map((item) => item.summary);

const report = {
  status:
    "ALPHA_V3_TRUE_FORWARD_OOS_IMPLEMENTATION_SURFACE_PROBE_V1_COMPLETE",

  inspected,

  conclusions: {
    historicalCutoff:
      "2026-10-07",

    frozenEntryPremiumCap:
      0.01,

    frozenQualificationThreshold:
      0.66,

    retuningAllowed:
      false,

    forwardTop1FileExpected:
      "logs/alpha-v3-forward-top1-sessions.json",

    forwardEntryDatasetExpected:
      "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",

    implementationRule:
      "REUSE_EXISTING_BATCHER_AND_SCORING_LOGIC_WITHOUT_WRITING_HISTORICAL_CHECKPOINT",
  },

  sourceFiles,
  jsonFiles,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  logFile:
    "logs/alpha-v3-true-forward-oos-implementation-surface-probe-v1.json",

  nextGate:
    "BUILD_TRUE_FORWARD_TOP1_PRODUCER_AND_ENTRY_OOS_COLLECTOR_V1",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, report.logFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      files: inspected.map((item) => ({
        rel: item.rel,
        exists: item.exists,
        kind: item.kind ?? null,
      })),
      sourceFiles,
      jsonFiles,
      conclusions: report.conclusions,
      safety: report.safety,
      logFile: report.logFile,
      nextGate: report.nextGate,
    },
    null,
    2,
  ),
);
