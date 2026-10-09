const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "lib/trading/data-freshness-canonical-reader.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
  "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
];

const needles = [
  "2026-10-05",
  "2026-10-09",
  "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
  "MANUAL_VERIFIED_KRX_CALENDAR",
  "targetSessionDate",
  "sourceTradingDate",
  "nextTrading",
  "tradingDay",
  "tradingDate",
  "weekday",
  "getDay(",
  "getUTCDay(",
  "addDays",
  "plusDays",
  "setUTCDate",
  "new Date(",
];

function snippets(text, needle, radius = 8) {
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(needle.toLowerCase())) {
      const start = Math.max(0, i - radius);
      const end = Math.min(lines.length, i + radius + 1);

      hits.push({
        line: i + 1,
        needle,
        context: lines
          .slice(start, end)
          .map((line, offset) => ({
            line: start + offset + 1,
            text: line.slice(0, 260),
          })),
      });
    }
  }

  return hits;
}

const files = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    files.push({
      file: rel,
      exists: false,
      hits: [],
    });
    continue;
  }

  const text = fs.readFileSync(abs, "utf8");
  const hits = [];

  for (const needle of needles) {
    hits.push(...snippets(text, needle));
  }

  files.push({
    file: rel,
    exists: true,
    lineCount: text.split(/\r?\n/).length,
    hits: hits.slice(0, 80),
  });
}

const canonical =
  files.find(
    (row) =>
      row.file ===
      "lib/trading/data-freshness-canonical-reader.ts",
  );

const producer =
  files.find(
    (row) =>
      row.file ===
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  );

const facts = {
  canonicalReaderExists:
    Boolean(canonical?.exists),

  producerExists:
    Boolean(producer?.exists),

  canonicalAlreadyHasOct09:
    canonical?.hits.some(
      (hit) =>
        hit.needle === "2026-10-09",
    ) ?? false,

  producerAlreadyHasOct09:
    producer?.hits.some(
      (hit) =>
        hit.needle === "2026-10-09",
    ) ?? false,

  canonicalHasVerifiedOverrideMode:
    canonical?.hits.some(
      (hit) =>
        hit.needle ===
        "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
    ) ?? false,

  producerHasTargetSessionDate:
    producer?.hits.some(
      (hit) =>
        hit.needle === "targetSessionDate",
    ) ?? false,
};

const report = {
  status:
    "ALPHA_V3_FORWARD_OOS_KRX_CALENDAR_BINDING_PROBE_V1_COMPLETE",

  facts,

  files,

  requiredPolicy: {
    exchange: "KRX",
    date20261009: "CLOSED_HANGEUL_DAY",
    expectedNextRegularSessionAfter20261008:
      "2026-10-12",
    weekendHandling: true,
    verifiedHolidayOverrideRequired: true,
    alphaThresholdChanged: false,
    entryPremiumCapChanged: false,
    historicalCutoffChanged: false,
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    forwardSessionsWritten: 0,
    productionChanged: false,
  },

  fullLogFile:
    "logs/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.json",

  nextGate:
    facts.canonicalReaderExists &&
    facts.producerExists
      ? "PATCH_CANONICAL_KRX_OVERRIDE_AND_FORWARD_TARGET_SESSION_RESOLVER"
      : "REVIEW_MISSING_CALENDAR_OR_PRODUCER_SURFACE",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, report.fullLogFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

function compactFile(row) {
  return {
    file: row.file,
    exists: row.exists,
    lineCount: row.lineCount ?? null,
    hits: row.hits
      .filter((hit) =>
        [
          "2026-10-05",
          "2026-10-09",
          "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
          "MANUAL_VERIFIED_KRX_CALENDAR",
          "targetSessionDate",
          "nextTrading",
          "weekday",
          "getDay(",
          "getUTCDay(",
          "addDays",
          "setUTCDate",
        ].includes(hit.needle),
      )
      .slice(0, 18),
  };
}

console.log(
  JSON.stringify(
    {
      status: report.status,
      facts,
      files: files.map(compactFile),
      requiredPolicy: report.requiredPolicy,
      safety: report.safety,
      fullLogFile: report.fullLogFile,
      nextGate: report.nextGate,
    },
    null,
    2,
  ),
);
