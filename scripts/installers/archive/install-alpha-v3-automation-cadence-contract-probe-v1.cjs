const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-automation-cadence-contract-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst reportFile = path.resolve(\n  root,\n  \"logs/alpha-v3-automation-cadence-contract-probe.json\"\n);\n\nconst explicitTargets = [\n  \"app/api/trading/automation/run/route.ts\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n  \"app/api/orders/paper/execute/route.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"app/components/AutomationRunPanel.tsx\",\n  \"app/page.tsx\",\n  \"package.json\",\n  \"vercel.json\",\n  \".env.example\",\n  \".env.local.example\",\n  \"README.md\",\n];\n\nfunction walk(dir, depth = 0, maxDepth = 7) {\n  if (!fs.existsSync(dir) || depth > maxDepth) {\n    return [];\n  }\n\n  const rows = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (\n      [\n        \"node_modules\",\n        \".git\",\n        \".next\",\n        \"logs\",\n        \"backups\",\n      ].includes(entry.name)\n    ) {\n      continue;\n    }\n\n    const full = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      rows.push(...walk(full, depth + 1, maxDepth));\n    } else if (\n      /\\.(ts|tsx|js|cjs|mjs|json|yml|yaml|md|toml)$/i.test(entry.name)\n    ) {\n      rows.push(full);\n    }\n  }\n\n  return rows;\n}\n\nfunction read(rel) {\n  const file = path.resolve(root, rel);\n\n  if (!fs.existsSync(file)) {\n    return {\n      file: rel,\n      exists: false,\n      text: null,\n    };\n  }\n\n  return {\n    file: rel,\n    exists: true,\n    text: fs.readFileSync(file, \"utf8\"),\n  };\n}\n\nfunction rel(file) {\n  return path.relative(root, file).replace(/\\\\/g, \"/\");\n}\n\nfunction snippets(text, regex, radius = 8, max = 30) {\n  if (!text) {\n    return [];\n  }\n\n  const normalized =\n    text.replace(/\\r\\n/g, \"\\n\");\n\n  const lines =\n    normalized.split(\"\\n\");\n\n  const rows = [];\n  let match;\n\n  while (\n    (match = regex.exec(normalized)) &&\n    rows.length < max\n  ) {\n    const line =\n      normalized\n        .slice(0, match.index)\n        .split(\"\\n\")\n        .length;\n\n    const start =\n      Math.max(1, line - radius);\n\n    const end =\n      Math.min(lines.length, line + radius);\n\n    rows.push({\n      match: match[0],\n      line,\n      snippet:\n        lines\n          .slice(start - 1, end)\n          .map(\n            (value, offset) =>\n              `${start + offset}: ${value}`\n          )\n          .join(\"\\n\"),\n    });\n  }\n\n  return rows;\n}\n\nconst targets =\n  explicitTargets.map(read);\n\nconst directEvidence =\n  targets.map((row) => ({\n    file: row.file,\n    exists: row.exists,\n\n    routeShape: snippets(\n      row.text,\n      /export\\s+async\\s+function\\s+(GET|POST)|fetch\\s*\\(|axios|executeApprovedPaperOrders|executePaperOrder|RISK_APPROVED/gi,\n      8,\n      35\n    ),\n\n    cadenceOrTrigger: snippets(\n      row.text,\n      /setInterval|setTimeout|cron|schedule|manual|button|onClick|fetch\\s*\\(|process\\.env\\.[A-Z0-9_]+|NEXT_PUBLIC_[A-Z0-9_]+|interval|poll|refresh/gi,\n      8,\n      40\n    ),\n\n    limits: snippets(\n      row.text,\n      /\\.limit\\s*\\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\\.all|Promise\\.allSettled/gi,\n      7,\n      30\n    ),\n  }));\n\nconst allFiles =\n  walk(root);\n\nconst repoEvidence = [];\n\nconst repoRegex =\n  /\\/api\\/trading\\/automation\\/run|\\/api\\/orders\\/paper\\/execute-approved|executeApprovedPaperOrders|AUTOMATION_|CRON_|SCHEDULE_|POLL_|INTERVAL_|setInterval|setTimeout|vercel\\.json|schedule:/gi;\n\nfor (const file of allFiles) {\n  let text;\n\n  try {\n    text = fs.readFileSync(file, \"utf8\");\n  } catch {\n    continue;\n  }\n\n  if (!repoRegex.test(text)) {\n    repoRegex.lastIndex = 0;\n    continue;\n  }\n\n  repoRegex.lastIndex = 0;\n\n  const hits =\n    snippets(\n      text,\n      /\\/api\\/trading\\/automation\\/run|\\/api\\/orders\\/paper\\/execute-approved|executeApprovedPaperOrders|AUTOMATION_[A-Z0-9_]*|CRON_[A-Z0-9_]*|SCHEDULE_[A-Z0-9_]*|POLL_[A-Z0-9_]*|INTERVAL_[A-Z0-9_]*|setInterval|setTimeout|schedule:/gi,\n      7,\n      40\n    );\n\n  if (hits.length) {\n    repoEvidence.push({\n      file: rel(file),\n      hits,\n    });\n  }\n}\n\nconst envVars = new Set();\n\nfor (const row of [...directEvidence, ...repoEvidence]) {\n  const snippetsList =\n    row.cadenceOrTrigger ??\n    row.hits ??\n    [];\n\n  for (const hit of snippetsList) {\n    for (\n      const match of hit.snippet.matchAll(\n        /\\b(?:process\\.env\\.)?([A-Z][A-Z0-9_]{3,})\\b/g\n      )\n    ) {\n      const name = match[1];\n\n      if (\n        /AUTOMATION|CRON|SCHEDULE|POLL|INTERVAL|ORDER|EXECUT/i.test(name)\n      ) {\n        envVars.add(name);\n      }\n    }\n  }\n}\n\nconst hasVercelCron =\n  targets.some(\n    (row) =>\n      row.file === \"vercel.json\" &&\n      row.exists &&\n      /cron/i.test(row.text ?? \"\")\n  );\n\nconst hasWorkflowSchedule =\n  repoEvidence.some(\n    (row) =>\n      /\\.github\\/workflows\\//i.test(row.file) &&\n      row.hits.some(\n        (hit) =>\n          /schedule:/i.test(hit.match + \"\\n\" + hit.snippet)\n      )\n  );\n\nconst hasSetInterval =\n  repoEvidence.some(\n    (row) =>\n      row.hits.some(\n        (hit) =>\n          /setInterval/i.test(hit.match + \"\\n\" + hit.snippet)\n      )\n  );\n\nconst automationRouteReferenced =\n  repoEvidence\n    .filter(\n      (row) =>\n        row.hits.some(\n          (hit) =>\n            /\\/api\\/trading\\/automation\\/run/i.test(\n              hit.match + \"\\n\" + hit.snippet\n            )\n        )\n    )\n    .map((row) => row.file);\n\nconst executeApprovedReferenced =\n  repoEvidence\n    .filter(\n      (row) =>\n        row.hits.some(\n          (hit) =>\n            /\\/api\\/orders\\/paper\\/execute-approved|executeApprovedPaperOrders/i.test(\n              hit.match + \"\\n\" + hit.snippet\n            )\n        )\n    )\n    .map((row) => row.file);\n\nlet triggerModel =\n  \"UNRESOLVED\";\n\nif (hasVercelCron || hasWorkflowSchedule) {\n  triggerModel =\n    \"EXTERNAL_SCHEDULE_CONFIG_FOUND\";\n} else if (hasSetInterval) {\n  triggerModel =\n    \"IN_APP_INTERVAL_FOUND\";\n} else if (\n  automationRouteReferenced.some(\n    (file) =>\n      /AutomationRunPanel|page\\.tsx/i.test(file)\n  )\n) {\n  triggerModel =\n    \"UI_OR_MANUAL_ROUTE_TRIGGER_LIKELY\";\n}\n\nconst result = {\n  status:\n    \"ALPHA_V3_AUTOMATION_CADENCE_CONTRACT_PROBE_COMPLETE\",\n\n  directEvidence,\n\n  repoEvidence,\n\n  summary: {\n    triggerModel,\n    hasVercelCron,\n    hasWorkflowSchedule,\n    hasSetInterval,\n    cadenceEnvVars:\n      [...envVars].sort(),\n\n    automationRouteReferencedBy:\n      [...new Set(automationRouteReferenced)].sort(),\n\n    executeApprovedReferencedBy:\n      [...new Set(executeApprovedReferenced)].sort(),\n  },\n\n  decision: {\n    cadenceSourceResolved:\n      triggerModel !== \"UNRESOLVED\",\n\n    safeToChooseExpirySla:\n      triggerModel === \"EXTERNAL_SCHEDULE_CONFIG_FOUND\" ||\n      triggerModel === \"IN_APP_INTERVAL_FOUND\",\n\n    nextGate:\n      triggerModel === \"EXTERNAL_SCHEDULE_CONFIG_FOUND\" ||\n      triggerModel === \"IN_APP_INTERVAL_FOUND\"\n        ? \"DERIVE_EXPIRY_SLA_FROM_RESOLVED_TRIGGER_CADENCE\"\n        : \"DEFINE_EXPLICIT_AUTOMATION_CADENCE_BEFORE_MAINTENANCE_CALLER\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-automation-cadence-contract-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(reportFile),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(result, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: result.status,\n\n      summary:\n        result.summary,\n\n      directFiles:\n        result.directEvidence.map(\n          (row) => ({\n            file: row.file,\n            exists: row.exists,\n            routeShapeHits:\n              row.routeShape.length,\n            cadenceOrTriggerHits:\n              row.cadenceOrTrigger.length,\n            limitHits:\n              row.limits.length,\n          })\n        ),\n\n      repoEvidenceFiles:\n        result.repoEvidence.map(\n          (row) => row.file\n        ),\n\n      databaseWrites: 0,\n\n      nextGate:\n        result.decision.nextGate,\n\n      outputFile:\n        result.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTOMATION_CADENCE_CONTRACT_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-automation-cadence-contract-probe.cjs",

      purpose:
        "RESOLVE_MANUAL_VS_EXTERNAL_CRON_VS_IN_APP_INTERVAL_AND_EXECUTOR_CALL_GRAPH",

      databaseWrites:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0,

      nextAction:
        "RUN_AUTOMATION_CADENCE_CONTRACT_PROBE"
    },
    null,
    2
  )
);
