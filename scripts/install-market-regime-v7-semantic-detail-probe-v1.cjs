const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-semantic-detail-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  {\n    file: \"lib/market/evaluate-regime-shadow-outcomes-v7-4.ts\",\n    anchors: [\n      \"function decisionScore(\",\n      \"const v6Score\",\n      \"const v7Score\",\n      \"disagreementWinner\",\n      \"v6_decision_score_5d\",\n      \"v7_decision_score_5d\",\n    ],\n  },\n  {\n    file: \"lib/market/market-regime-shadow-comparator-v7-3.ts\",\n    anchors: [\n      \"function\",\n      \"v6WouldBlock\",\n      \"v7WouldBlock\",\n      \"agreementState\",\n      \"BLOCK_BREADTH_OR_HIGH_VOL\",\n    ],\n  },\n  {\n    file: \"lib/market/get-regime-forward-evidence-v7-5.ts\",\n    anchors: [\n      \"correctRate\",\n      \"v6HeadToHeadWins\",\n      \"v7HeadToHeadWins\",\n      \"v7HeadToHeadWinRate\",\n      \"decisionScore\",\n    ],\n  },\n  {\n    file: \"lib/market/capture-market-regime-shadow-comparison-v7-3.ts\",\n    anchors: [\n      \"agreementState\",\n      \"v6_would_block\",\n      \"v7_would_block\",\n    ],\n  },\n];\n\nfunction around(lines, needle, before = 10, after = 28) {\n  const matches = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    if (!lines[i].includes(needle)) {\n      continue;\n    }\n\n    const start = Math.max(0, i - before);\n    const end = Math.min(lines.length, i + after + 1);\n\n    matches.push({\n      anchor: needle,\n      line: i + 1,\n      excerpt: lines\n        .slice(start, end)\n        .map((text, offset) => ({\n          line: start + offset + 1,\n          text: text.slice(0, 280),\n        })),\n    });\n\n    if (matches.length >= 3) {\n      break;\n    }\n  }\n\n  return matches;\n}\n\nfunction functionBlock(lines, functionNeedle) {\n  const startLineIndex = lines.findIndex((line) =>\n    line.includes(functionNeedle),\n  );\n\n  if (startLineIndex < 0) {\n    return null;\n  }\n\n  let text = \"\";\n  let depth = 0;\n  let started = false;\n  let inSingle = false;\n  let inDouble = false;\n  let inTemplate = false;\n  let escaped = false;\n\n  for (let i = startLineIndex; i < lines.length; i += 1) {\n    const line = lines[i];\n    text += line + \"\\n\";\n\n    for (let j = 0; j < line.length; j += 1) {\n      const ch = line[j];\n\n      if (escaped) {\n        escaped = false;\n        continue;\n      }\n\n      if (ch === \"\\\\\") {\n        escaped = true;\n        continue;\n      }\n\n      if (!inDouble && !inTemplate && ch === \"'\") {\n        inSingle = !inSingle;\n        continue;\n      }\n\n      if (!inSingle && !inTemplate && ch === '\"') {\n        inDouble = !inDouble;\n        continue;\n      }\n\n      if (!inSingle && !inDouble && ch === \"`\") {\n        inTemplate = !inTemplate;\n        continue;\n      }\n\n      if (inSingle || inDouble || inTemplate) {\n        continue;\n      }\n\n      if (ch === \"{\") {\n        depth += 1;\n        started = true;\n      } else if (ch === \"}\") {\n        depth -= 1;\n\n        if (started && depth === 0) {\n          return {\n            startLine: startLineIndex + 1,\n            endLine: i + 1,\n            text: text.trimEnd(),\n          };\n        }\n      }\n    }\n  }\n\n  return {\n    startLine: startLineIndex + 1,\n    endLine: null,\n    text: text.trimEnd(),\n  };\n}\n\nconst details = [];\n\nfor (const target of targets) {\n  const abs = path.resolve(root, target.file);\n\n  if (!fs.existsSync(abs)) {\n    details.push({\n      file: target.file,\n      exists: false,\n      sections: [],\n    });\n    continue;\n  }\n\n  const source = fs.readFileSync(abs, \"utf8\");\n  const lines = source.split(/\\r?\\n/);\n\n  const sections = target.anchors.flatMap((anchor) =>\n    around(lines, anchor),\n  );\n\n  const specialBlocks = [];\n\n  if (\n    target.file.endsWith(\"evaluate-regime-shadow-outcomes-v7-4.ts\")\n  ) {\n    const block = functionBlock(lines, \"function decisionScore(\");\n\n    if (block) {\n      specialBlocks.push({\n        name: \"decisionScore\",\n        ...block,\n      });\n    }\n  }\n\n  details.push({\n    file: target.file,\n    exists: true,\n    sections,\n    specialBlocks,\n  });\n}\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_SEMANTIC_DETAIL_PROBE_V1_COMPLETE\",\n\n  details,\n\n  auditQuestions: [\n    \"Does decisionScore reward BLOCK when return_5d is negative and ALLOW when return_5d is positive?\",\n    \"Are v6WouldBlock and v7WouldBlock stored with the same boolean meaning?\",\n    \"Do V6_BLOCK_V7_ALLOW and V6_ALLOW_V7_BLOCK match the actual booleans?\",\n    \"Does disagreementWinner choose the model with the larger decision score?\",\n    \"Does forward evidence count score > 0 as correct consistently for both models?\",\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n    ordersCreated: 0,\n    positionsChanged: 0,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-semantic-detail-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_ROW_LEVEL_READ_ONLY_SEMANTIC_RECALC_AUDIT\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconst compact = {\n  status: output.status,\n  details: details.map((entry) => ({\n    file: entry.file,\n    exists: entry.exists,\n    specialBlocks: entry.specialBlocks,\n    sections: entry.sections.map((section) => ({\n      anchor: section.anchor,\n      line: section.line,\n      excerpt: section.excerpt,\n    })),\n  })),\n  auditQuestions: output.auditQuestions,\n  safety: output.safety,\n  fullDetails: output.fullDetails,\n  nextGate: output.nextGate,\n};\n\nconsole.log(JSON.stringify(compact, null, 2));\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "MARKET_REGIME_V7_SEMANTIC_DETAIL_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/market-regime-v7-semantic-detail-probe-v1.cjs",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        sourceFilesModified: 0,
        regimePolicyChanged: false,
        forwardEvidenceChanged: false,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_SEMANTIC_DETAIL_PROBE"
    },
    null,
    2
  )
);
