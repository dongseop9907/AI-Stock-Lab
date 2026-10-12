const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-data-freshness-binding-detail-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  {\n    file: \"lib/trading/generate-entry-signals.ts\",\n    anchors: [\n      \"export async function generateEntrySignals\",\n      \"assertKillSwitchAllows\",\n      \"createPaperBuyOrder\",\n      \"const supabase\"\n    ]\n  },\n  {\n    file: \"lib/trading/paper-order-service.ts\",\n    anchors: [\n      \"export async function createPaperBuyOrder\",\n      \"assertKillSwitchAllows\",\n      \"const supabase\",\n      \"create_paper_buy_order_with_committed_risk_v3\"\n    ]\n  },\n  {\n    file: \"lib/trading/execute-approved-paper-orders.ts\",\n    anchors: [\n      \"export async function executeApprovedPaperOrders\",\n      \"assertKillSwitchAllows\",\n      \"const supabase\",\n      \"executePaperOrder\"\n    ]\n  },\n  {\n    file: \"lib/trading/execute-paper-order.ts\",\n    anchors: [\n      \"export async function executePaperOrder\",\n      \"assertKillSwitchAllows\",\n      \"const supabase\",\n      \"execute_paper_buy_order\"\n    ]\n  },\n  {\n    file: \"app/api/trading/automation/run/route.ts\",\n    anchors: [\n      \"export async function POST\",\n      \"const autoOrder\",\n      \"generateEntrySignals\",\n      \"emergencyStop\",\n      \"paperOrderEnabled\"\n    ]\n  }\n];\n\nfunction excerpt(lines, index, before = 8, after = 14) {\n  const start = Math.max(0, index - before);\n  const end = Math.min(lines.length, index + after + 1);\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, offset) =>\n        `${start + offset + 1}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_DATA_FRESHNESS_BINDING_DETAIL_PROBE_V1_COMPLETE\",\n  files: [],\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n  logFile:\n    \"logs/alpha-v3-data-freshness-binding-detail-probe-v1.json\",\n  nextGate:\n    \"PATCH_CANONICAL_FRESHNESS_GUARD_TO_PRODUCTION_PATHS_V1\"\n};\n\nfor (const target of targets) {\n  const abs = path.resolve(root, target.file);\n\n  if (!fs.existsSync(abs)) {\n    report.files.push({\n      file: target.file,\n      exists: false,\n      anchors: []\n    });\n    continue;\n  }\n\n  const text = fs.readFileSync(abs, \"utf8\");\n  const lines = text.split(/\\r?\\n/);\n\n  const anchorResults = [];\n\n  for (const anchor of target.anchors) {\n    const index =\n      lines.findIndex(\n        (line) => line.includes(anchor)\n      );\n\n    anchorResults.push({\n      anchor,\n      line:\n        index >= 0\n          ? index + 1\n          : null,\n      excerpt:\n        index >= 0\n          ? excerpt(lines, index)\n          : null\n    });\n  }\n\n  report.files.push({\n    file: target.file,\n    exists: true,\n    anchors: anchorResults\n  });\n}\n\nconst logAbs =\n  path.resolve(root, report.logFile);\n\nfs.mkdirSync(\n  path.dirname(logAbs),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logAbs,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      files:\n        report.files.map(\n          (item) => ({\n            file: item.file,\n            anchors:\n              item.anchors.map(\n                (a) => ({\n                  anchor: a.anchor,\n                  line: a.line\n                })\n              )\n          })\n        ),\n      logFile: report.logFile,\n      nextGate: report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_BINDING_DETAIL_PROBE_V1_INSTALLED",
      generatedFile:
        "scripts/alpha-v3-data-freshness-binding-detail-probe-v1.cjs",
      consolePolicy:
        "SUMMARY_ONLY_FULL_EXCERPTS_IN_LOG",
      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },
      nextAction:
        "RUN_BINDING_DETAIL_PROBE"
    },
    null,
    2
  )
);
