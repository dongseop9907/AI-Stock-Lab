const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-kill-switch-source-probe-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst roots = [\n  \"app\",\n  \"lib\",\n  \"supabase/migrations\",\n  \"scripts\"\n];\n\nconst excludeDirs = new Set([\n  \"node_modules\",\n  \".next\",\n  \".git\",\n  \"logs\",\n  \"dist\",\n  \"build\"\n]);\n\nconst interestingTerms = [\n  \"emergency_stop\",\n  \"emergencyStop\",\n  \"automation_enabled\",\n  \"automationEnabled\",\n  \"paper_order_enabled\",\n  \"paperOrderEnabled\",\n  \"real_order_enabled\",\n  \"realOrderEnabled\",\n  \"trading_system_control\",\n  \"getTradingSystemControl\",\n  \"executeApprovedPaperOrders\",\n  \"executePaperOrder\",\n  \"createPaperBuyOrder\",\n  \"createPaperBuyOrderWithCommittedRisk\",\n  \"execute_paper_buy_order\",\n  \"stop-loss\",\n  \"trailing-stop\",\n  \"automation/run\",\n  \"automation/cycle\",\n  \"automation/manual\",\n  \"scheduler\",\n  \"kill switch\",\n  \"kill_switch\",\n  \"KILL_SWITCH\"\n];\n\nfunction walk(dir, out = []) {\n  if (!fs.existsSync(dir)) {\n    return out;\n  }\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (excludeDirs.has(entry.name)) {\n      continue;\n    }\n\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      walk(abs, out);\n      continue;\n    }\n\n    if (\n      entry.isFile() &&\n      /\\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)\n    ) {\n      out.push(abs);\n    }\n  }\n\n  return out;\n}\n\nfunction lineOf(text, index) {\n  return text.slice(0, Math.max(0, index)).split(\"\\n\").length;\n}\n\nfunction excerpt(lines, line, radius = 5) {\n  const start = Math.max(1, line - radius);\n  const end = Math.min(lines.length, line + radius);\n\n  return {\n    startLine: start,\n    endLine: end,\n    text: lines\n      .slice(start - 1, end)\n      .map((value, i) => `${start + i}: ${value}`)\n      .join(\"\\n\")\n  };\n}\n\nfunction occurrences(text, term) {\n  const rows = [];\n  let cursor = 0;\n\n  while (true) {\n    const index = text.indexOf(term, cursor);\n\n    if (index < 0) {\n      break;\n    }\n\n    rows.push({\n      index,\n      line: lineOf(text, index)\n    });\n\n    cursor = index + term.length;\n  }\n\n  return rows;\n}\n\nconst files = roots\n  .flatMap((rel) => walk(path.resolve(root, rel)));\n\nconst findings = [];\nconst controlReaders = [];\nconst controlWriters = [];\nconst executionSurfaces = [];\nconst schedulerSurfaces = [];\nconst potentialBypasses = [];\n\nfor (const abs of files) {\n  const rel = path\n    .relative(root, abs)\n    .replace(/\\\\/g, \"/\");\n\n  const text = fs\n    .readFileSync(abs, \"utf8\")\n    .replace(/\\r\\n/g, \"\\n\");\n\n  const lines = text.split(\"\\n\");\n\n  const hits = [];\n\n  for (const term of interestingTerms) {\n    const found = occurrences(text, term);\n\n    for (const item of found) {\n      hits.push({\n        term,\n        line: item.line,\n        excerpt: excerpt(lines, item.line, 4)\n      });\n    }\n  }\n\n  if (hits.length === 0) {\n    continue;\n  }\n\n  findings.push({\n    file: rel,\n    hitCount: hits.length,\n    hits\n  });\n\n  const lower = text.toLowerCase();\n\n  const readsSystemControl =\n    text.includes(\"getTradingSystemControl\") ||\n    (\n      lower.includes(\"trading_system_control\") &&\n      (\n        lower.includes(\".select(\") ||\n        lower.includes(\"select \")\n      )\n    );\n\n  const writesSystemControl =\n    lower.includes(\"trading_system_control\") &&\n    (\n      lower.includes(\".update(\") ||\n      lower.includes(\".insert(\") ||\n      /update\\s+(?:public\\.)?trading_system_control/i.test(text) ||\n      /insert\\s+into\\s+(?:public\\.)?trading_system_control/i.test(text)\n    );\n\n  const isExecutionSurface =\n    text.includes(\"executeApprovedPaperOrders\") ||\n    text.includes(\"executePaperOrder\") ||\n    text.includes(\"execute_paper_buy_order\") ||\n    text.includes(\"createPaperBuyOrder\") ||\n    text.includes(\"createPaperBuyOrderWithCommittedRisk\");\n\n  const isSchedulerSurface =\n    lower.includes(\"scheduler\") ||\n    rel.includes(\"automation-cycle-scheduler\");\n\n  const hasEmergencyReference =\n    text.includes(\"emergencyStop\") ||\n    text.includes(\"emergency_stop\");\n\n  const hasOrderAction =\n    isExecutionSurface ||\n    lower.includes(\"autoorder\") ||\n    lower.includes(\"paperorderenabled\") ||\n    lower.includes(\"realorderenabled\");\n\n  if (readsSystemControl) {\n    controlReaders.push(rel);\n  }\n\n  if (writesSystemControl) {\n    controlWriters.push(rel);\n  }\n\n  if (isExecutionSurface) {\n    executionSurfaces.push({\n      file: rel,\n      hasEmergencyReference,\n      readsSystemControl,\n      hasAutomationEnabled:\n        text.includes(\"automationEnabled\") ||\n        text.includes(\"automation_enabled\"),\n      hasPaperOrderEnabled:\n        text.includes(\"paperOrderEnabled\") ||\n        text.includes(\"paper_order_enabled\"),\n      hasRealOrderEnabled:\n        text.includes(\"realOrderEnabled\") ||\n        text.includes(\"real_order_enabled\")\n    });\n  }\n\n  if (isSchedulerSurface) {\n    schedulerSurfaces.push({\n      file: rel,\n      hasEmergencyReference,\n      readsSystemControl,\n      hasOrderAction\n    });\n  }\n\n  if (\n    hasOrderAction &&\n    !hasEmergencyReference &&\n    !readsSystemControl\n  ) {\n    potentialBypasses.push({\n      file: rel,\n      reason:\n        \"ORDER_OR_EXECUTION_SURFACE_WITHOUT_VISIBLE_EMERGENCY_STOP_OR_SYSTEM_CONTROL_READ\"\n    });\n  }\n}\n\nfunction unique(values) {\n  return [...new Set(values)].sort();\n}\n\nconst summary = {\n  scannedFileCount:\n    files.length,\n\n  relevantFileCount:\n    findings.length,\n\n  controlReaders:\n    unique(controlReaders),\n\n  controlWriters:\n    unique(controlWriters),\n\n  executionSurfaces,\n\n  schedulerSurfaces,\n\n  potentialBypasses,\n\n  counts: {\n    controlReaderCount:\n      unique(controlReaders).length,\n\n    controlWriterCount:\n      unique(controlWriters).length,\n\n    executionSurfaceCount:\n      executionSurfaces.length,\n\n    schedulerSurfaceCount:\n      schedulerSurfaces.length,\n\n    potentialBypassCount:\n      potentialBypasses.length\n  }\n};\n\nconst report = {\n  status:\n    \"ALPHA_V3_KILL_SWITCH_SOURCE_PROBE_V1_COMPLETE\",\n\n  summary,\n\n  findings,\n\n  designQuestions: [\n    \"WHERE_IS_THE_SINGLE_AUTHORITATIVE_KILL_SWITCH_STATE_STORED\",\n    \"WHICH_PATHS_CREATE_OR_EXECUTE_ORDERS_WITHOUT_READING_CONTROL\",\n    \"DO_STOP_LOSS_AND_TRAILING_EXITS_STILL_RUN_WHEN_KILL_SWITCH_IS_ACTIVE\",\n    \"SHOULD_KILL_SWITCH_BLOCK_NEW_ENTRIES_ONLY_OR_ALL_NON_PROTECTIVE_ACTIONS\",\n    \"DOES_SCHEDULER_STOP_CALLING_CYCLES_OR_DO_CYCLES_FAIL_CLOSED\",\n    \"HOW_IS_MANUAL_RESET_AUTHORIZED_AND_AUDITED\",\n    \"WHAT_REASON_AND_ACTOR_METADATA_MUST_BE_PERSISTED\",\n    \"WHAT_AUTOMATIC_TRIGGERS_SHOULD_LATCH_THE_SWITCH\"\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-kill-switch-source-probe-v1.json\",\n\n  nextGate:\n    \"DEFINE_KILL_SWITCH_CONTRACT_FROM_EXISTING_CONTROL_AND_EXECUTION_SURFACES\"\n};\n\nconst logsDir =\n  path.resolve(root, \"logs\");\n\nfs.mkdirSync(\n  logsDir,\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.join(\n    logsDir,\n    \"alpha-v3-kill-switch-source-probe-v1.json\"\n  ),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      summary: report.summary,\n      designQuestions: report.designQuestions,\n      safety: report.safety,\n      logFile: report.logFile,\n      nextGate: report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-kill-switch-source-probe-v1.cjs",

      purpose:
        "MAP_EXISTING_EMERGENCY_STOP_SYSTEM_CONTROL_ORDER_EXECUTION_AND_SCHEDULER_SURFACES_BEFORE_KILL_SWITCH_DESIGN",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_KILL_SWITCH_SOURCE_PROBE"
    },
    null,
    2
  )
);
