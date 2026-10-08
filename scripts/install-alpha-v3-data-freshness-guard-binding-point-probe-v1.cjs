const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-data-freshness-guard-binding-point-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  {\n    file: \"lib/trading/generate-entry-signals.ts\",\n    labels: [\n      /export\\s+async\\s+function\\s+generateEntrySignals/,\n      /createSupabase/i,\n      /supabase/i,\n      /autoOrder/i,\n      /createPaperBuyOrder/i\n    ]\n  },\n  {\n    file: \"lib/trading/paper-order-service.ts\",\n    labels: [\n      /export\\s+async\\s+function/i,\n      /createSupabase/i,\n      /supabase/i,\n      /create_paper_buy_order_with_committed_risk_v3/i,\n      /\\.rpc\\(/i\n    ]\n  },\n  {\n    file: \"lib/trading/execute-approved-paper-orders.ts\",\n    labels: [\n      /export\\s+async\\s+function/i,\n      /createSupabase/i,\n      /supabase/i,\n      /executePaperOrder/i,\n      /RISK_APPROVED/i\n    ]\n  },\n  {\n    file: \"lib/trading/execute-paper-order.ts\",\n    labels: [\n      /export\\s+async\\s+function/i,\n      /createSupabase/i,\n      /supabase/i,\n      /execute_paper_buy_order/i,\n      /\\.rpc\\(/i\n    ]\n  },\n  {\n    file: \"app/api/trading/automation/run/route.ts\",\n    labels: [\n      /generateEntrySignals/i,\n      /autoOrder/i,\n      /emergencyStop/i,\n      /paperOrderEnabled/i\n    ]\n  }\n];\n\nfunction excerpt(text, lineIndex, radius = 7) {\n  const lines = text.split(/\\r?\\n/);\n  const start = Math.max(0, lineIndex - radius);\n  const end = Math.min(lines.length, lineIndex + radius + 1);\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, index) =>\n        `${start + index + 1}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_DATA_FRESHNESS_GUARD_BINDING_POINT_PROBE_V1_COMPLETE\",\n\n  files: [],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-data-freshness-guard-binding-point-probe-v1.json\",\n\n  nextGate:\n    \"PATCH_ENTRY_CREATE_FILL_WITH_CANONICAL_FRESHNESS_GUARD_V1\"\n};\n\nfor (const target of targets) {\n  const abs =\n    path.resolve(\n      root,\n      target.file\n    );\n\n  if (!fs.existsSync(abs)) {\n    report.files.push({\n      file: target.file,\n      exists: false,\n      hits: []\n    });\n\n    continue;\n  }\n\n  const text =\n    fs.readFileSync(\n      abs,\n      \"utf8\"\n    );\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const hits = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    const matched =\n      target.labels\n        .filter(\n          (pattern) =>\n            pattern.test(\n              lines[i]\n            )\n        )\n        .map(\n          (pattern) =>\n            String(pattern)\n        );\n\n    if (matched.length > 0) {\n      hits.push({\n        line: i + 1,\n        matched,\n        excerpt:\n          excerpt(\n            text,\n            i,\n            6\n          )\n      });\n    }\n  }\n\n  const imports =\n    lines\n      .filter(\n        (line) =>\n          /^\\s*import\\s/.test(\n            line\n          )\n      )\n      .slice(0, 40);\n\n  const functionDeclarations =\n    lines\n      .map(\n        (line, index) => ({\n          line: index + 1,\n          text: line.trim()\n        })\n      )\n      .filter(\n        (item) =>\n          /\\b(?:async\\s+)?function\\b|\\bexport\\s+async\\s+function\\b/.test(\n            item.text\n          )\n      )\n      .slice(0, 30);\n\n  const supabaseIdentifiers = [\n    ...new Set(\n      [\n        ...text.matchAll(\n          /\\b(?:const|let)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(?:await\\s+)?(?:createSupabase[A-Za-z0-9_$]*|getSupabase[A-Za-z0-9_$]*|supabase)/g\n        )\n      ].map(\n        (match) =>\n          match[1]\n      )\n    )\n  ];\n\n  report.files.push({\n    file: target.file,\n    exists: true,\n    imports,\n    functionDeclarations,\n    supabaseIdentifiers,\n    hits\n  });\n}\n\nfs.mkdirSync(\n  path.resolve(\n    root,\n    \"logs\"\n  ),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    report.logFile\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      bindingSummary:\n        report.files.map(\n          (item) => ({\n            file:\n              item.file,\n\n            exists:\n              item.exists,\n\n            supabaseIdentifiers:\n              item.supabaseIdentifiers ?? [],\n\n            functions:\n              (\n                item.functionDeclarations ?? []\n              ).slice(0, 8),\n\n            hitLines:\n              (\n                item.hits ?? []\n              )\n                .slice(0, 12)\n                .map(\n                  (hit) =>\n                    hit.line\n                )\n          })\n        ),\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_GUARD_BINDING_POINT_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-data-freshness-guard-binding-point-probe-v1.cjs",

      scope: [
        "ENTRY",
        "PAPER_BUY_CREATE",
        "APPROVED_BUY_EXECUTE",
        "SINGLE_BUY_EXECUTE",
        "AUTOMATION_BOUNDARY"
      ],

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
        "RUN_BINDING_POINT_PROBE"
    },
    null,
    2
  )
);
