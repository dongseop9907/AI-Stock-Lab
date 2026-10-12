const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-data-freshness-production-path-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"app/api/market/regime/v7/freshness/capture/route.ts\",\n  \"app/api/market/regime/v7/quality-gate/capture/route.ts\",\n  \"app/api/signals/entry/generate/route.ts\",\n  \"app/api/trading/automation/run/route.ts\",\n  \"lib/trading/generate-entry-signals.ts\",\n  \"lib/trading/paper-order-service.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"lib/trading/kill-switch-guard.ts\"\n];\n\nfunction read(rel) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return null;\n  }\n\n  return fs.readFileSync(abs, \"utf8\");\n}\n\nfunction contexts(text, patterns, radius = 10) {\n  if (!text) return [];\n\n  const lines = text.split(/\\r?\\n/);\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n\n    if (\n      patterns.some(\n        (pattern) => pattern.test(line)\n      )\n    ) {\n      const start =\n        Math.max(0, i - radius);\n\n      const end =\n        Math.min(\n          lines.length,\n          i + radius + 1\n        );\n\n      hits.push({\n        line: i + 1,\n        excerpt:\n          lines\n            .slice(start, end)\n            .map(\n              (value, index) =>\n                `${start + index + 1}: ${value}`\n            )\n            .join(\"\\n\")\n      });\n    }\n  }\n\n  return hits;\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_PATH_PROBE_V1_COMPLETE\",\n\n  files: [],\n\n  summary: {\n    targetCount:\n      targets.length,\n\n    existingCount:\n      0,\n\n    missingCount:\n      0,\n\n    freshnessAwareCount:\n      0,\n\n    productionBlockingAwareCount:\n      0\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-data-freshness-production-path-probe-v1.json\",\n\n  nextGate:\n    \"DEFINE_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1\"\n};\n\nfor (const rel of targets) {\n  const text = read(rel);\n\n  const item = {\n    file: rel,\n    exists: Boolean(text),\n    flags: {\n      freshness:\n        Boolean(\n          text &&\n          /freshness|STALE|usableForShadowComparison|expectedMarketDate/i.test(\n            text\n          )\n        ),\n\n      qualityGate:\n        Boolean(\n          text &&\n          /quality-gate|qualityGate|FAIL_FRESHNESS|usableForForwardShadow/i.test(\n            text\n          )\n        ),\n\n      productionApplied:\n        Boolean(\n          text &&\n          /productionApplied|autoOrder|paperOrderEnabled|emergencyStop/i.test(\n            text\n          )\n        ),\n\n      newRiskWrite:\n        Boolean(\n          text &&\n          /createPaperBuyOrder|create_paper_buy_order|executePaperOrder|execute_paper_buy_order|RISK_APPROVED/i.test(\n            text\n          )\n        ),\n\n      staleBlocksNewRisk:\n        Boolean(\n          text &&\n          /STALE[\\s\\S]{0,500}(block|reject|deny|throw|return)/i.test(\n            text\n          )\n        )\n    },\n\n    contexts: contexts(\n      text,\n      [\n        /freshness/i,\n        /FAIL_FRESHNESS/i,\n        /productionApplied/i,\n        /usableForShadowComparison/i,\n        /usableForForwardShadow/i,\n        /autoOrder/i,\n        /createPaperBuyOrder/i,\n        /executePaperOrder/i\n      ],\n      8\n    )\n  };\n\n  report.files.push(item);\n\n  if (item.exists) {\n    report.summary.existingCount += 1;\n  } else {\n    report.summary.missingCount += 1;\n  }\n\n  if (\n    item.flags.freshness ||\n    item.flags.qualityGate\n  ) {\n    report.summary.freshnessAwareCount += 1;\n  }\n\n  if (\n    item.flags.productionApplied ||\n    item.flags.staleBlocksNewRisk\n  ) {\n    report.summary.productionBlockingAwareCount += 1;\n  }\n}\n\nconst logPath =\n  path.resolve(\n    root,\n    report.logFile\n  );\n\nfs.mkdirSync(\n  path.dirname(logPath),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logPath,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconst concise = {\n  status:\n    report.status,\n\n  summary:\n    report.summary,\n\n  likelyProductionGaps:\n    report.files\n      .filter(\n        (item) =>\n          item.exists &&\n          (\n            item.flags.newRiskWrite ||\n            item.flags.productionApplied\n          ) &&\n          !item.flags.staleBlocksNewRisk\n      )\n      .map(\n        (item) => item.file\n      ),\n\n  freshnessSources:\n    report.files\n      .filter(\n        (item) =>\n          item.exists &&\n          (\n            item.flags.freshness ||\n            item.flags.qualityGate\n          )\n      )\n      .map(\n        (item) => item.file\n      ),\n\n  logFile:\n    report.logFile,\n\n  nextGate:\n    report.nextGate\n};\n\nconsole.log(\n  JSON.stringify(\n    concise,\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_PATH_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-data-freshness-production-path-probe-v1.cjs",

      purpose:
        "MAP_CURRENT_FRESHNESS_SHADOW_AND_PRODUCTION_NEW_RISK_PATHS",

      consolePolicy:
        "SUMMARY_ONLY_FULL_CONTEXT_IN_LOG",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_DATA_FRESHNESS_PRODUCTION_PATH_PROBE"
    },
    null,
    2
  )
);
