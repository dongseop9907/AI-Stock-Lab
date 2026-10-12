const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-order-state-machine-source-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(
    target
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst scanRoots = [\n  \"app\",\n  \"lib\",\n  \"supabase/migrations\"\n];\n\nconst excludedDirs = new Set([\n  \"node_modules\",\n  \".next\",\n  \".git\",\n  \"logs\",\n  \"dist\",\n  \"build\"\n]);\n\nconst allowedExt = new Set([\n  \".ts\",\n  \".tsx\",\n  \".js\",\n  \".cjs\",\n  \".mjs\",\n  \".sql\"\n]);\n\nfunction walk(dir) {\n  const abs =\n    path.resolve(root, dir);\n\n  if (!fs.existsSync(abs)) {\n    return [];\n  }\n\n  const out = [];\n\n  for (\n    const entry of\n      fs.readdirSync(\n        abs,\n        {\n          withFileTypes: true\n        }\n      )\n  ) {\n    if (\n      entry.isDirectory() &&\n      excludedDirs.has(\n        entry.name\n      )\n    ) {\n      continue;\n    }\n\n    const full =\n      path.join(\n        abs,\n        entry.name\n      );\n\n    if (entry.isDirectory()) {\n      out.push(\n        ...walk(\n          path.relative(\n            root,\n            full\n          )\n        )\n      );\n\n      continue;\n    }\n\n    if (\n      allowedExt.has(\n        path.extname(\n          entry.name\n        )\n      )\n    ) {\n      out.push(\n        full\n      );\n    }\n  }\n\n  return out;\n}\n\nfunction lineOf(\n  text,\n  index\n) {\n  return text\n    .slice(\n      0,\n      Math.max(\n        0,\n        index\n      )\n    )\n    .split(\"\\n\")\n    .length;\n}\n\nfunction excerpt(\n  lines,\n  line,\n  radius = 5\n) {\n  const start =\n    Math.max(\n      1,\n      line - radius\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      line + radius\n    );\n\n  return {\n    startLine: start,\n    endLine: end,\n    text:\n      lines\n        .slice(\n          start - 1,\n          end\n        )\n        .map(\n          (\n            value,\n            index\n          ) =>\n            `${start + index}: ${value}`\n        )\n        .join(\"\\n\")\n  };\n}\n\nconst files =\n  scanRoots\n    .flatMap(\n      walk\n    );\n\nconst references = [];\n\nconst statusTokens =\n  new Set();\n\nconst transitionHints = [];\n\nconst terminalTokens =\n  new Set([\n    \"FILLED\",\n    \"CANCELLED\",\n    \"CANCELED\",\n    \"EXPIRED\",\n    \"FAILED\",\n    \"REJECTED\",\n    \"RISK_REJECTED\",\n    \"CLOSED\"\n  ]);\n\nconst tokenRegex =\n  /[\"']([A-Z][A-Z0-9_]{2,40})[\"']/g;\n\nfor (\n  const abs of\n    files\n) {\n  const text =\n    fs.readFileSync(\n      abs,\n      \"utf8\"\n    )\n      .replace(\n        /\\r\\n/g,\n        \"\\n\"\n      );\n\n  const rel =\n    path.relative(\n      root,\n      abs\n    )\n      .replace(\n        /\\\\/g,\n        \"/\"\n      );\n\n  if (\n    !text.includes(\n      \"paper_order_requests\"\n    ) &&\n    !text.includes(\n      \"RISK_APPROVED\"\n    ) &&\n    !text.includes(\n      \"RISK_REJECTED\"\n    ) &&\n    !text.includes(\n      \"execute_paper_buy_order\"\n    )\n  ) {\n    continue;\n  }\n\n  const lines =\n    text.split(\"\\n\");\n\n  references.push({\n    file:\n      rel,\n\n    lineCount:\n      lines.length,\n\n    hasPaperOrderRequests:\n      text.includes(\n        \"paper_order_requests\"\n      ),\n\n    hasExecutePaperBuyOrder:\n      text.includes(\n        \"execute_paper_buy_order\"\n      ),\n\n    hasCommittedRiskRpc:\n      text.includes(\n        \"create_paper_buy_order_with_committed_risk_v3\"\n      ),\n\n    hasStatusUpdate:\n      /\\.update\\s*\\(\\s*\\{[\\s\\S]{0,500}?status\\s*:/m.test(\n        text\n      ) ||\n      /\\bstatus\\s*=\\s*['\"][A-Z_]+['\"]/m.test(\n        text\n      )\n  });\n\n  for (\n    const match of\n      text.matchAll(\n        tokenRegex\n      )\n  ) {\n    const token =\n      match[1];\n\n    if (\n      token.includes(\n        \"ORDER\"\n      ) ||\n      token.includes(\n        \"RISK\"\n      ) ||\n      terminalTokens.has(\n        token\n      ) ||\n      [\n        \"PENDING\",\n        \"CREATED\",\n        \"APPROVED\",\n        \"SUBMITTED\",\n        \"EXECUTING\",\n        \"PARTIALLY_FILLED\",\n        \"FILLED\",\n        \"OPEN\"\n      ].includes(\n        token\n      )\n    ) {\n      statusTokens.add(\n        token\n      );\n    }\n  }\n\n  const patterns = [\n    {\n      kind:\n        \"TS_STATUS_UPDATE\",\n      regex:\n        /\\.update\\s*\\(\\s*\\{[\\s\\S]{0,600}?status\\s*:\\s*[\"']([A-Z][A-Z0-9_]+)[\"'][\\s\\S]{0,600}?\\}\\s*\\)/gm\n    },\n    {\n      kind:\n        \"TS_STATUS_FILTER\",\n      regex:\n        /\\.eq\\s*\\(\\s*[\"']status[\"']\\s*,\\s*[\"']([A-Z][A-Z0-9_]+)[\"']\\s*\\)/gm\n    },\n    {\n      kind:\n        \"SQL_STATUS_ASSIGN\",\n      regex:\n        /\\bstatus\\s*=\\s*['\"]([A-Z][A-Z0-9_]+)['\"]/gm\n    },\n    {\n      kind:\n        \"SQL_STATUS_IN\",\n      regex:\n        /\\bstatus\\s+in\\s*\\(([^)]+)\\)/gim\n    },\n    {\n      kind:\n        \"RPC_REFERENCE\",\n      regex:\n        /\\b(create_paper_buy_order_with_committed_risk_v3|execute_paper_buy_order(?:_v\\d+)?)\\b/gm\n    }\n  ];\n\n  for (\n    const pattern of\n      patterns\n  ) {\n    for (\n      const match of\n        text.matchAll(\n          pattern.regex\n        )\n    ) {\n      const index =\n        match.index ??\n        0;\n\n      const line =\n        lineOf(\n          text,\n          index\n        );\n\n      transitionHints.push({\n        file:\n          rel,\n\n        kind:\n          pattern.kind,\n\n        line,\n\n        value:\n          match[1] ??\n          match[0],\n\n        excerpt:\n          excerpt(\n            lines,\n            line,\n            6\n          )\n      });\n    }\n  }\n}\n\nconst knownStates =\n  [...statusTokens]\n    .filter(\n      (token) =>\n        ![\n          \"ORDER\",\n          \"ORDERS\",\n          \"ORDER_STATUS\",\n          \"RISK\",\n          \"RISK_MANAGER\",\n          \"RISK_LIMIT\"\n        ].includes(\n          token\n        )\n    )\n    .sort();\n\nconst likelyOrderStates =\n  knownStates.filter(\n    (token) =>\n      [\n        \"PENDING\",\n        \"CREATED\",\n        \"RISK_APPROVED\",\n        \"RISK_REJECTED\",\n        \"APPROVED\",\n        \"SUBMITTED\",\n        \"EXECUTING\",\n        \"PARTIALLY_FILLED\",\n        \"FILLED\",\n        \"REJECTED\",\n        \"CANCELLED\",\n        \"CANCELED\",\n        \"EXPIRED\",\n        \"FAILED\",\n        \"CLOSED\",\n        \"OPEN\"\n      ].includes(\n        token\n      )\n  );\n\nconst directStatusUpdates =\n  transitionHints.filter(\n    (item) =>\n      item.kind ===\n        \"TS_STATUS_UPDATE\" ||\n      item.kind ===\n        \"SQL_STATUS_ASSIGN\"\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_ORDER_STATE_MACHINE_SOURCE_PROBE_COMPLETE\",\n\n  scan: {\n    roots:\n      scanRoots,\n\n    scannedFileCount:\n      files.length,\n\n    relevantFileCount:\n      references.length\n  },\n\n  summary: {\n    likelyOrderStates,\n\n    terminalStatesObserved:\n      likelyOrderStates.filter(\n        (state) =>\n          terminalTokens.has(\n            state\n          )\n      ),\n\n    directStatusUpdateCount:\n      directStatusUpdates.length,\n\n    transitionHintCount:\n      transitionHints.length,\n\n    relevantFiles:\n      references.map(\n        (item) =>\n          item.file\n      )\n  },\n\n  references,\n\n  transitionHints,\n\n  recommendedNextStep:\n    \"BUILD_CANONICAL_ORDER_STATE_MACHINE_CONTRACT_THEN_PATCH_WRITERS\",\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0\n  }\n};\n\nconst logsDir =\n  path.resolve(\n    root,\n    \"logs\"\n  );\n\nfs.mkdirSync(\n  logsDir,\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.join(\n    logsDir,\n    \"alpha-v3-order-state-machine-source-probe.json\"\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      scan:\n        report.scan,\n\n      summary:\n        report.summary,\n\n      safety:\n        report.safety,\n\n      logFile:\n        \"logs/alpha-v3-order-state-machine-source-probe.json\",\n\n      nextGate:\n        report.recommendedNextStep\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ORDER_STATE_MACHINE_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-order-state-machine-source-probe.cjs",

      purpose:
        "MAP_EXISTING_ORDER_STATES_TRANSITIONS_AND_WRITERS_BEFORE_PATCHING",

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "RUN_ORDER_STATE_MACHINE_SOURCE_PROBE"
    },
    null,
    2
  )
);
