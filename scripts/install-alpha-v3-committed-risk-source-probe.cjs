const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-committed-risk-source-probe.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT = process.cwd();\nconst VERSION = \"ALPHA_V3_COMMITTED_RISK_SOURCE_PROBE_V1\";\nconst OUTPUT = path.resolve(\n  ROOT,\n  \"logs/alpha-v3-committed-risk-source-probe.json\",\n);\n\nconst SEARCH_ROOTS = [\n  \"app\",\n  \"lib\",\n  \"src\",\n  \"scripts\",\n  \"supabase\",\n  \"migrations\",\n  \"db\",\n];\n\nconst TERMS = [\n  \"paper_order_requests\",\n  \"paper_trade\",\n  \"RISK_APPROVED\",\n  \"REQUESTED\",\n  \"SUBMITTED\",\n  \"PARTIAL_FILLED\",\n  \"FILLED\",\n  \"REJECTED\",\n  \"CANCELLED\",\n  \"CANCELED\",\n  \"EXPIRED\",\n  \"FAILED\",\n  \"aggregateOpenRisk\",\n  \"currentAggregateOpenRisk\",\n  \"maxAggregateOpenRiskRate\",\n  \"proposedTradeRiskAmount\",\n  \"reservedRisk\",\n  \"committedRisk\",\n  \"riskReservation\",\n  \"rpc(\",\n  \".rpc(\",\n];\n\nfunction walk(dir: string, out: string[]) {\n  if (!fs.existsSync(dir)) return;\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const full = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      if (\n        entry.name === \"node_modules\" ||\n        entry.name === \".next\" ||\n        entry.name === \".git\" ||\n        entry.name === \"dist\" ||\n        entry.name === \"coverage\"\n      ) {\n        continue;\n      }\n\n      walk(full, out);\n      continue;\n    }\n\n    if (\n      !/\\.(?:ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)\n    ) {\n      continue;\n    }\n\n    out.push(full);\n  }\n}\n\nfunction rel(file: string) {\n  return path.relative(ROOT, file).replace(/\\\\/g, \"/\");\n}\n\nfunction extractStatuses(text: string) {\n  const values = [\n    ...text.matchAll(\n      /[\"'`](REQUESTED|RISK_APPROVED|SUBMITTED|PARTIAL_FILLED|FILLED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|PENDING|APPROVED|OPEN|CLOSED)[\"'`]/g,\n    ),\n  ].map((m) => m[1]);\n\n  return [...new Set(values)].sort();\n}\n\nfunction extractRpcNames(text: string) {\n  const values = [\n    ...text.matchAll(\n      /\\.rpc\\(\\s*[\"'`]([^\"'`]+)[\"'`]/g,\n    ),\n  ].map((m) => m[1]);\n\n  return [...new Set(values)].sort();\n}\n\nfunction lineHits(lines: string[], terms: string[]) {\n  const hits: Array<{\n    line: number;\n    term: string;\n    text: string;\n  }> = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    for (const term of terms) {\n      if (\n        lines[i]\n          .toLowerCase()\n          .includes(\n            term.toLowerCase(),\n          )\n      ) {\n        hits.push({\n          line: i + 1,\n          term,\n          text: lines[i].trim(),\n        });\n\n        break;\n      }\n    }\n  }\n\n  return hits.slice(0, 200);\n}\n\nconst files: string[] = [];\n\nfor (const root of SEARCH_ROOTS) {\n  walk(\n    path.resolve(ROOT, root),\n    files,\n  );\n}\n\nconst matchedFiles = [];\n\nfor (const file of files) {\n  const text = fs.readFileSync(file, \"utf8\").replace(/\\r\\n/g, \"\\n\");\n\n  if (\n    !TERMS.some((term) =>\n      text\n        .toLowerCase()\n        .includes(\n          term.toLowerCase(),\n        ),\n    )\n  ) {\n    continue;\n  }\n\n  const lines = text.split(\"\\n\");\n\n  matchedFiles.push({\n    file: rel(file),\n    lineCount: lines.length,\n    statuses: extractStatuses(text),\n    rpcNames: extractRpcNames(text),\n    hits: lineHits(lines, TERMS),\n  });\n}\n\nconst orderFiles = matchedFiles.filter((row) =>\n  /order|paper|trade/i.test(row.file) ||\n  row.hits.some((hit) =>\n    /paper_order_requests/i.test(hit.text),\n  ),\n);\n\nconst riskFiles = matchedFiles.filter((row) =>\n  /risk/i.test(row.file) ||\n  row.hits.some((hit) =>\n    /aggregateOpenRisk|maxAggregateOpenRiskRate|proposedTradeRiskAmount/i.test(\n      hit.text,\n    ),\n  ),\n);\n\nconst schemaFiles = matchedFiles.filter((row) =>\n  /\\.sql$/i.test(row.file) ||\n  /migration|schema|supabase/i.test(row.file),\n);\n\nconst allStatuses = [\n  ...new Set(\n    matchedFiles.flatMap((row) => row.statuses),\n  ),\n].sort();\n\nconst allRpcNames = [\n  ...new Set(\n    matchedFiles.flatMap((row) => row.rpcNames),\n  ),\n].sort();\n\nconst hasPaperOrderTable = matchedFiles.some((row) =>\n  row.hits.some((hit) =>\n    /paper_order_requests/i.test(hit.text),\n  ),\n);\n\nconst hasReservationTerms = matchedFiles.some((row) =>\n  row.hits.some((hit) =>\n    /reservedRisk|committedRisk|riskReservation/i.test(hit.text),\n  ),\n);\n\nconst hasAggregateOpenRisk = matchedFiles.some((row) =>\n  row.hits.some((hit) =>\n    /aggregateOpenRisk|currentAggregateOpenRisk|maxAggregateOpenRiskRate/i.test(\n      hit.text,\n    ),\n  ),\n);\n\nconst report = {\n  status:\n    \"ALPHA_V3_COMMITTED_RISK_SOURCE_PROBE_COMPLETE\",\n\n  version:\n    VERSION,\n\n  scannedFileCount:\n    files.length,\n\n  matchedFileCount:\n    matchedFiles.length,\n\n  signals: {\n    hasPaperOrderTable,\n    hasAggregateOpenRisk,\n    hasReservationTerms,\n    statuses: allStatuses,\n    rpcNames: allRpcNames,\n  },\n\n  candidateFiles: {\n    orderFiles: orderFiles.map((row) => row.file).slice(0, 30),\n    riskFiles: riskFiles.map((row) => row.file).slice(0, 30),\n    schemaFiles: schemaFiles.map((row) => row.file).slice(0, 30),\n  },\n\n  details: {\n    orderFiles,\n    riskFiles,\n    schemaFiles,\n  },\n\n  requiredNextDesign: {\n    formula:\n      \"OPEN_POSITION_STOP_RISK + ACTIVE_BUY_RESERVED_RISK <= equity * maxAggregateOpenRiskRate\",\n\n    mustReserveAt:\n      \"risk approval\",\n\n    mustReleaseAt: [\n      \"REJECTED\",\n      \"CANCELLED/CANCELED\",\n      \"EXPIRED\",\n      \"FAILED\",\n    ],\n\n    filledBehavior:\n      \"reserved risk transfers into open-position risk without double counting\",\n\n    concurrency:\n      \"reservation and approval must be atomic / serialized\",\n\n    idempotency:\n      \"same order request must not reserve risk twice\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  nextGate:\n    hasPaperOrderTable && hasAggregateOpenRisk\n      ? \"BUILD_COMMITTED_RISK_RESERVATION_FROM_CONFIRMED_SCHEMA\"\n      : \"TRACE_MISSING_ORDER_OR_RISK_SOURCE\",\n\n  outputFile:\n    \"logs/alpha-v3-committed-risk-source-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(OUTPUT),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  OUTPUT,\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      hasPaperOrderTable:\n        report.signals.hasPaperOrderTable,\n      hasAggregateOpenRisk:\n        report.signals.hasAggregateOpenRisk,\n      hasReservationTerms:\n        report.signals.hasReservationTerms,\n      statuses:\n        report.signals.statuses,\n      rpcNames:\n        report.signals.rpcNames,\n      orderFiles:\n        report.candidateFiles.orderFiles,\n      riskFiles:\n        report.candidateFiles.riskFiles,\n      schemaFiles:\n        report.candidateFiles.schemaFiles,\n      nextGate:\n        report.nextGate,\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_SOURCE_PROBE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-committed-risk-source-probe.ts",

      outputMode:
        "CONSOLE_SUMMARY_ONLY",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_COMMITTED_RISK_SOURCE_PROBE"
    },
    null,
    2
  )
);
