const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-data-freshness-capture-pipeline-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst searchRoots = [\n  \"app\",\n  \"lib\",\n  \"scripts\",\n  \"supabase/migrations\"\n];\n\nconst keywords = [\n  \"market_data_freshness_observations\",\n  \"market_data_quality_gate_observations\",\n  \"market_eod_sync_runs\",\n  \"market_exchange_calendar_overrides\",\n  \"expected_market_date\",\n  \"expectedMarketDate\",\n  \"business_weekday_lag\",\n  \"businessWeekdayLag\",\n  \"usable_for_shadow_comparison\",\n  \"usableForShadowComparison\",\n  \"usable_for_forward_shadow\",\n  \"usableForForwardShadow\",\n  \"FAIL_FRESHNESS\",\n  \"freshness_status\",\n  \"freshnessStatus\",\n  \"production_applied\",\n  \"productionApplied\",\n  \"holiday\",\n  \"calendar\",\n  \"KOSPI\",\n  \"KOSDAQ\"\n];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) {\n    return [];\n  }\n\n  const out = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      if (\n        entry.name === \"node_modules\" ||\n        entry.name === \".next\" ||\n        entry.name === \".git\"\n      ) {\n        continue;\n      }\n\n      out.push(...walk(abs));\n      continue;\n    }\n\n    if (\n      entry.isFile() &&\n      /\\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)\n    ) {\n      out.push(abs);\n    }\n  }\n\n  return out;\n}\n\nfunction rel(abs) {\n  return path\n    .relative(root, abs)\n    .replace(/\\\\/g, \"/\");\n}\n\nfunction excerpt(text, lineIndex, radius = 6) {\n  const lines = text.split(/\\r?\\n/);\n  const start = Math.max(0, lineIndex - radius);\n  const end = Math.min(lines.length, lineIndex + radius + 1);\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, index) =>\n        `${start + index + 1}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nfunction uniq(values) {\n  return [...new Set(values.filter(Boolean))];\n}\n\nconst files = [];\n\nfor (const rootRel of searchRoots) {\n  files.push(\n    ...walk(\n      path.resolve(root, rootRel)\n    )\n  );\n}\n\nconst findings = [];\n\nfor (const abs of files) {\n  const text =\n    fs.readFileSync(abs, \"utf8\");\n\n  if (\n    !keywords.some(\n      (keyword) =>\n        text.toLowerCase().includes(\n          keyword.toLowerCase()\n        )\n    )\n  ) {\n    continue;\n  }\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const matched =\n      keywords.filter(\n        (keyword) =>\n          lines[i]\n            .toLowerCase()\n            .includes(\n              keyword.toLowerCase()\n            )\n      );\n\n    if (matched.length > 0) {\n      hits.push({\n        line: i + 1,\n        matched,\n        excerpt:\n          excerpt(\n            text,\n            i,\n            5\n          )\n      });\n    }\n  }\n\n  const tableWrites =\n    uniq([\n      ...[\n        ...text.matchAll(\n          /\\.from\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)[\\s\\S]{0,900}\\.(?:insert|upsert|update)\\s*\\(/g\n        )\n      ].map(\n        (match) => match[1]\n      ),\n\n      ...[\n        ...text.matchAll(\n          /\\binsert\\s+into\\s+(?:public\\.)?([A-Za-z0-9_]+)/gi\n        )\n      ].map(\n        (match) => match[1]\n      )\n    ]);\n\n  const tableReads =\n    uniq([\n      ...[\n        ...text.matchAll(\n          /\\.from\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)[\\s\\S]{0,900}\\.(?:select|order|limit|maybeSingle|single)\\s*\\(/g\n        )\n      ].map(\n        (match) => match[1]\n      ),\n\n      ...[\n        ...text.matchAll(\n          /\\bfrom\\s+(?:public\\.)?([A-Za-z0-9_]+)/gi\n        )\n      ].map(\n        (match) => match[1]\n      )\n    ]);\n\n  const routeSignals = {\n    hasPOST:\n      /export\\s+async\\s+function\\s+POST\\b/.test(text),\n\n    hasGET:\n      /export\\s+async\\s+function\\s+GET\\b/.test(text),\n\n    fetchCalls:\n      (\n        text.match(\n          /\\bfetch\\s*\\(/g\n        ) || []\n      ).length,\n\n    cronMentions:\n      (\n        text.match(\n          /\\bcron\\b|\\bschedule\\b|\\bscheduler\\b/gi\n        ) || []\n      ).length,\n\n    dateMentions:\n      (\n        text.match(\n          /expectedMarketDate|expected_market_date|businessWeekdayLag|business_weekday_lag|Asia\\/Seoul|KST|holiday|calendar/gi\n        ) || []\n      ).length\n  };\n\n  findings.push({\n    file:\n      rel(abs),\n\n    tableWrites,\n    tableReads,\n    routeSignals,\n    hits\n  });\n}\n\nconst directWriters = {\n  freshness:\n    findings\n      .filter(\n        (item) =>\n          item.tableWrites.includes(\n            \"market_data_freshness_observations\"\n          )\n      )\n      .map(\n        (item) => item.file\n      ),\n\n  qualityGate:\n    findings\n      .filter(\n        (item) =>\n          item.tableWrites.includes(\n            \"market_data_quality_gate_observations\"\n          )\n      )\n      .map(\n        (item) => item.file\n      ),\n\n  eodSync:\n    findings\n      .filter(\n        (item) =>\n          item.tableWrites.includes(\n            \"market_eod_sync_runs\"\n          )\n      )\n      .map(\n        (item) => item.file\n      )\n};\n\nconst likelyPipelineFiles =\n  findings\n    .filter(\n      (item) =>\n        /freshness|quality-gate|quality_gate|eod|calendar|sync|capture/i.test(\n          item.file\n        ) ||\n        item.tableWrites.length > 0\n    )\n    .map(\n      (item) => ({\n        file:\n          item.file,\n\n        tableWrites:\n          item.tableWrites,\n\n        tableReads:\n          item.tableReads,\n\n        routeSignals:\n          item.routeSignals\n      })\n    );\n\nconst expectedDateFiles =\n  findings\n    .filter(\n      (item) =>\n        item.hits.some(\n          (hit) =>\n            hit.matched.some(\n              (keyword) =>\n                /expectedMarketDate|expected_market_date|businessWeekdayLag|business_weekday_lag|holiday|calendar/i.test(\n                  keyword\n                )\n            )\n        )\n    )\n    .map(\n      (item) => item.file\n    );\n\nconst report = {\n  status:\n    \"ALPHA_V3_DATA_FRESHNESS_CAPTURE_PIPELINE_PROBE_V1_COMPLETE\",\n\n  summary: {\n    scannedFileCount:\n      files.length,\n\n    relevantFileCount:\n      findings.length,\n\n    freshnessWriterCount:\n      directWriters.freshness.length,\n\n    qualityGateWriterCount:\n      directWriters.qualityGate.length,\n\n    eodSyncWriterCount:\n      directWriters.eodSync.length,\n\n    expectedDateLogicFileCount:\n      expectedDateFiles.length\n  },\n\n  directWriters,\n  expectedDateFiles,\n  likelyPipelineFiles,\n  findings,\n\n  questions: {\n    freshnessWriterFound:\n      directWriters.freshness.length > 0,\n\n    qualityGateWriterFound:\n      directWriters.qualityGate.length > 0,\n\n    eodSyncWriterFound:\n      directWriters.eodSync.length > 0,\n\n    expectedDateLogicFound:\n      expectedDateFiles.length > 0,\n\n    schedulerOrCronMentionFound:\n      findings.some(\n        (item) =>\n          item.routeSignals.cronMentions > 0\n      )\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-data-freshness-capture-pipeline-probe-v1.json\",\n\n  nextGate:\n    \"CLASSIFY_STALE_ROOT_CAUSE_AND_HARDEN_CAPTURE_PIPELINE_V1\"\n};\n\nconst logAbs =\n  path.resolve(\n    root,\n    report.logFile\n  );\n\nfs.mkdirSync(\n  path.dirname(logAbs),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logAbs,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      summary:\n        report.summary,\n\n      directWriters:\n        report.directWriters,\n\n      expectedDateFiles:\n        report.expectedDateFiles.slice(0, 20),\n\n      likelyPipelineFiles:\n        report.likelyPipelineFiles.slice(0, 25),\n\n      questions:\n        report.questions,\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_CAPTURE_PIPELINE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-data-freshness-capture-pipeline-probe-v1.cjs",

      purpose:
        "TRACE_FRESHNESS_QUALITY_EOD_DATE_AND_SCHEDULER_PATHS_WITHOUT_DB_OR_NETWORK",

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
        "RUN_CAPTURE_PIPELINE_PROBE"
    },
    null,
    2
  )
);
