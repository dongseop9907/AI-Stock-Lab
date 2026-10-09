const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-freshness-binding-signature-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/get-market-data-freshness-v7-7.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"FRESHNESS_SOURCE_NOT_FOUND\");\n}\n\nconst source = fs.readFileSync(abs, \"utf8\");\nconst lines = source.split(/\\r?\\n/);\n\nfunction around(anchor, before = 2, after = 12) {\n  const index = lines.findIndex((line) => line.includes(anchor));\n\n  if (index < 0) {\n    return {\n      anchor,\n      found: false,\n      line: null,\n      text: [],\n    };\n  }\n\n  const start = Math.max(0, index - before);\n  const end = Math.min(lines.length, index + after + 1);\n\n  return {\n    anchor,\n    found: true,\n    line: index + 1,\n    text: lines\n      .slice(start, end)\n      .map((text, offset) => ({\n        line: start + offset + 1,\n        text: text.slice(0, 240),\n      })),\n  };\n}\n\nconst anchors = [\n  \"interface TradingDayOverride\",\n  \"function weekday(\",\n  \"function isWeekday(\",\n  \"function isTradingDay(\",\n  \"function previousTradingDay(\",\n  \"function countTradingDaysAfter(\",\n  \"const expectedMarketDate =\",\n  \"const tradingDayOverrides =\",\n  \"const overrideByDate =\",\n];\n\nconst sections = anchors.map((anchor) => around(anchor));\n\nconst result = {\n  status: \"KRX_FRESHNESS_BINDING_SIGNATURE_PROBE_V1_COMPLETE\",\n  file: rel,\n  sections,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n  nextGate: \"BUILD_FRESHNESS_CANONICAL_BINDER_FROM_SIGNATURES\",\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/krx-freshness-binding-signature-probe-v1.json\",\n  ),\n  JSON.stringify(result, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\n/*\n * Compact output only: signatures and first few lines.\n */\nconsole.log(\n  JSON.stringify(\n    {\n      status: result.status,\n      file: result.file,\n      sections: sections.map((section) => ({\n        anchor: section.anchor,\n        found: section.found,\n        line: section.line,\n        text: section.text.slice(0, 8),\n      })),\n      fullDetails:\n        \"logs/krx-freshness-binding-signature-probe-v1.json\",\n      nextGate: result.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n", "utf8");

console.log(
  JSON.stringify(
    {
      status:
        "KRX_FRESHNESS_BINDING_SIGNATURE_PROBE_V1_INSTALLED",
      generatedFile:
        "scripts/krx-freshness-binding-signature-probe-v1.cjs",
      consoleOutputPolicy:
        "COMPACT_ONLY",
      nextAction:
        "RUN_SIGNATURE_PROBE"
    },
    null,
    2
  )
);
