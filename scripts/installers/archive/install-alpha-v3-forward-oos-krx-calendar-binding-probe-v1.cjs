const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"lib/trading/data-freshness-canonical-reader.ts\",\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n  \"scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs\",\n  \"scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts\",\n];\n\nconst needles = [\n  \"2026-10-05\",\n  \"2026-10-09\",\n  \"WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES\",\n  \"MANUAL_VERIFIED_KRX_CALENDAR\",\n  \"targetSessionDate\",\n  \"sourceTradingDate\",\n  \"nextTrading\",\n  \"tradingDay\",\n  \"tradingDate\",\n  \"weekday\",\n  \"getDay(\",\n  \"getUTCDay(\",\n  \"addDays\",\n  \"plusDays\",\n  \"setUTCDate\",\n  \"new Date(\",\n];\n\nfunction snippets(text, needle, radius = 8) {\n  const lines = text.split(/\\r?\\n/);\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    if (lines[i].toLowerCase().includes(needle.toLowerCase())) {\n      const start = Math.max(0, i - radius);\n      const end = Math.min(lines.length, i + radius + 1);\n\n      hits.push({\n        line: i + 1,\n        needle,\n        context: lines\n          .slice(start, end)\n          .map((line, offset) => ({\n            line: start + offset + 1,\n            text: line.slice(0, 260),\n          })),\n      });\n    }\n  }\n\n  return hits;\n}\n\nconst files = [];\n\nfor (const rel of targets) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    files.push({\n      file: rel,\n      exists: false,\n      hits: [],\n    });\n    continue;\n  }\n\n  const text = fs.readFileSync(abs, \"utf8\");\n  const hits = [];\n\n  for (const needle of needles) {\n    hits.push(...snippets(text, needle));\n  }\n\n  files.push({\n    file: rel,\n    exists: true,\n    lineCount: text.split(/\\r?\\n/).length,\n    hits: hits.slice(0, 80),\n  });\n}\n\nconst canonical =\n  files.find(\n    (row) =>\n      row.file ===\n      \"lib/trading/data-freshness-canonical-reader.ts\",\n  );\n\nconst producer =\n  files.find(\n    (row) =>\n      row.file ===\n      \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n  );\n\nconst facts = {\n  canonicalReaderExists:\n    Boolean(canonical?.exists),\n\n  producerExists:\n    Boolean(producer?.exists),\n\n  canonicalAlreadyHasOct09:\n    canonical?.hits.some(\n      (hit) =>\n        hit.needle === \"2026-10-09\",\n    ) ?? false,\n\n  producerAlreadyHasOct09:\n    producer?.hits.some(\n      (hit) =>\n        hit.needle === \"2026-10-09\",\n    ) ?? false,\n\n  canonicalHasVerifiedOverrideMode:\n    canonical?.hits.some(\n      (hit) =>\n        hit.needle ===\n        \"WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES\",\n    ) ?? false,\n\n  producerHasTargetSessionDate:\n    producer?.hits.some(\n      (hit) =>\n        hit.needle === \"targetSessionDate\",\n    ) ?? false,\n};\n\nconst report = {\n  status:\n    \"ALPHA_V3_FORWARD_OOS_KRX_CALENDAR_BINDING_PROBE_V1_COMPLETE\",\n\n  facts,\n\n  files,\n\n  requiredPolicy: {\n    exchange: \"KRX\",\n    date20261009: \"CLOSED_HANGEUL_DAY\",\n    expectedNextRegularSessionAfter20261008:\n      \"2026-10-12\",\n    weekendHandling: true,\n    verifiedHolidayOverrideRequired: true,\n    alphaThresholdChanged: false,\n    entryPremiumCapChanged: false,\n    historicalCutoffChanged: false,\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    forwardSessionsWritten: 0,\n    productionChanged: false,\n  },\n\n  fullLogFile:\n    \"logs/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.json\",\n\n  nextGate:\n    facts.canonicalReaderExists &&\n    facts.producerExists\n      ? \"PATCH_CANONICAL_KRX_OVERRIDE_AND_FORWARD_TARGET_SESSION_RESOLVER\"\n      : \"REVIEW_MISSING_CALENDAR_OR_PRODUCER_SURFACE\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, report.fullLogFile),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nfunction compactFile(row) {\n  return {\n    file: row.file,\n    exists: row.exists,\n    lineCount: row.lineCount ?? null,\n    hits: row.hits\n      .filter((hit) =>\n        [\n          \"2026-10-05\",\n          \"2026-10-09\",\n          \"WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES\",\n          \"MANUAL_VERIFIED_KRX_CALENDAR\",\n          \"targetSessionDate\",\n          \"nextTrading\",\n          \"weekday\",\n          \"getDay(\",\n          \"getUTCDay(\",\n          \"addDays\",\n          \"setUTCDate\",\n        ].includes(hit.needle),\n      )\n      .slice(0, 18),\n  };\n}\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      facts,\n      files: files.map(compactFile),\n      requiredPolicy: report.requiredPolicy,\n      safety: report.safety,\n      fullLogFile: report.fullLogFile,\n      nextGate: report.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FORWARD_OOS_KRX_CALENDAR_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs",

      purpose:
        "LOCATE_CANONICAL_KRX_OVERRIDE_AND_FORWARD_TARGET_SESSION_DATE_SURFACES",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        forwardSessionsWritten: 0,
        productionChanged: false
      },

      nextAction:
        "RUN_FORWARD_OOS_KRX_CALENDAR_BINDING_PROBE"
    },
    null,
    2
  )
);
