const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-cycle-duplicate-executor-source-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst files = {\n  cycle:\n    \"app/api/trading/automation/cycle/route.ts\",\n  run:\n    \"app/api/trading/automation/run/route.ts\",\n  panel:\n    \"app/components/AutomationRunPanel.tsx\",\n};\n\nfunction read(rel) {\n  const abs =\n    path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return {\n      exists: false,\n      rel,\n      text: \"\",\n      lines: [],\n    };\n  }\n\n  const text =\n    fs.readFileSync(abs, \"utf8\")\n      .replace(/\\r\\n/g, \"\\n\");\n\n  return {\n    exists: true,\n    rel,\n    text,\n    lines:\n      text.split(\"\\n\"),\n  };\n}\n\nfunction lineNumber(text, index) {\n  if (index < 0) {\n    return null;\n  }\n\n  return text\n    .slice(0, index)\n    .split(\"\\n\")\n    .length;\n}\n\nfunction excerpt(item, line, radius = 18) {\n  if (!line) {\n    return null;\n  }\n\n  const start =\n    Math.max(1, line - radius);\n\n  const end =\n    Math.min(\n      item.lines.length,\n      line + radius,\n    );\n\n  return {\n    startLine: start,\n    endLine: end,\n    text:\n      item.lines\n        .slice(start - 1, end)\n        .map(\n          (value, index) =>\n            `${start + index}: ${value}`,\n        )\n        .join(\"\\n\"),\n  };\n}\n\nfunction occurrences(item, needle) {\n  const rows = [];\n  let cursor = 0;\n\n  while (true) {\n    const index =\n      item.text.indexOf(\n        needle,\n        cursor,\n      );\n\n    if (index < 0) {\n      break;\n    }\n\n    rows.push({\n      needle,\n      index,\n      line:\n        lineNumber(\n          item.text,\n          index,\n        ),\n      excerpt:\n        excerpt(\n          item,\n          lineNumber(\n            item.text,\n            index,\n          ),\n          22,\n        ),\n    });\n\n    cursor =\n      index +\n      needle.length;\n  }\n\n  return rows;\n}\n\nconst loaded =\n  Object.fromEntries(\n    Object.entries(files)\n      .map(\n        ([key, rel]) => [\n          key,\n          read(rel),\n        ],\n      ),\n  );\n\nconst cycleNeedles = [\n  \"request.clone()\",\n  \"/api/trading/automation/run\",\n  \"JSON.stringify(\",\n  \"executeApprovedPaperOrders(\",\n  \"maxApprovedOrdersPerCycle\",\n  \"probeOnly\",\n  \"x-automation-secret\",\n];\n\nconst runNeedles = [\n  \"autoOrder\",\n  \"if (autoOrder)\",\n  \"/api/orders/paper/execute-approved\",\n  \"/api/signals/entry/generate\",\n  \"interface AutomationRequest\",\n];\n\nconst panelNeedles = [\n  \"/api/trading/automation/cycle\",\n  \"autoOrder\",\n  \"includeMarketSync\",\n  \"maxOrders\",\n];\n\nconst findings = {\n  cycle:\n    Object.fromEntries(\n      cycleNeedles.map(\n        (needle) => [\n          needle,\n          occurrences(\n            loaded.cycle,\n            needle,\n          ),\n        ],\n      ),\n    ),\n\n  run:\n    Object.fromEntries(\n      runNeedles.map(\n        (needle) => [\n          needle,\n          occurrences(\n            loaded.run,\n            needle,\n          ),\n        ],\n      ),\n    ),\n\n  panel:\n    Object.fromEntries(\n      panelNeedles.map(\n        (needle) => [\n          needle,\n          occurrences(\n            loaded.panel,\n            needle,\n          ),\n        ],\n      ),\n    ),\n};\n\nconst runHasExecutor =\n  loaded.run.text.includes(\n    \"/api/orders/paper/execute-approved\",\n  );\n\nconst cycleHasExecutor =\n  loaded.cycle.text.includes(\n    \"executeApprovedPaperOrders(\",\n  );\n\nconst duplicateExecutorSurface =\n  runHasExecutor &&\n  cycleHasExecutor;\n\nconst cycleHasAutoOrderReference =\n  /\\bautoOrder\\b/.test(\n    loaded.cycle.text,\n  );\n\nconst panelCallsCycle =\n  loaded.panel.text.includes(\n    \"/api/trading/automation/cycle\",\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_CYCLE_DUPLICATE_EXECUTOR_SOURCE_PROBE_COMPLETE\",\n\n  files:\n    Object.fromEntries(\n      Object.entries(loaded)\n        .map(\n          ([key, item]) => [\n            key,\n            {\n              file: item.rel,\n              exists: item.exists,\n              lineCount:\n                item.lines.length,\n            },\n          ],\n        ),\n    ),\n\n  summary: {\n    runHasApprovedExecutorStep:\n      runHasExecutor,\n\n    cycleHasApprovedExecutorCall:\n      cycleHasExecutor,\n\n    duplicateExecutorSurface,\n\n    cycleReferencesAutoOrder:\n      cycleHasAutoOrderReference,\n\n    panelCallsCycle,\n\n    requiresPatchBeforeOperationalOneShot:\n      duplicateExecutorSurface,\n  },\n\n  findings,\n\n  recommendedContract: {\n    innerRunCreatesOrders:\n      \"autoOrder=true\",\n\n    innerRunExecutesApprovedOrders:\n      false,\n\n    cycleExecutesApprovedOrders:\n      \"exactly once when autoOrder=true\",\n\n    autoOrderFalse:\n      \"no order creation and no approved-order execution\",\n\n    ui:\n      \"call server-side manual proxy; never expose TRADING_AUTOMATION_SECRET to browser\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    cyclePostRequests: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n  },\n\n  nextGate:\n    duplicateExecutorSurface\n      ? \"PATCH_SINGLE_EXECUTOR_CONTRACT_AND_UI_SERVER_PROXY\"\n      : \"PATCH_UI_SERVER_PROXY_ONLY\",\n};\n\nconst outputFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-cycle-duplicate-executor-source-probe.json\",\n  );\n\nfs.mkdirSync(\n  path.dirname(outputFile),\n  {\n    recursive: true,\n  },\n);\n\nfs.writeFileSync(\n  outputFile,\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_CYCLE_DUPLICATE_EXECUTOR_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-cycle-duplicate-executor-source-probe.cjs",

      checks: [
        "INNER_AUTOMATION_APPROVED_EXECUTOR_STEP",
        "CYCLE_WRAPPER_APPROVED_EXECUTOR_CALL",
        "CYCLE_AUTO_ORDER_AWARENESS",
        "PANEL_CYCLE_CALL_SURFACE"
      ],

      databaseReads: 0,
      databaseWrites: 0,
      networkCalls: 0,
      cyclePostRequests: 0,
      ordersCreated: 0,
      ordersChanged: 0,
      positionsChanged: 0,

      nextAction:
        "RUN_DUPLICATE_EXECUTOR_SOURCE_PROBE"
    },
    null,
    2
  )
);
