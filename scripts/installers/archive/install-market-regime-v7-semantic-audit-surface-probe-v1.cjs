const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-semantic-audit-surface-probe-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst roots = [\n  \"lib\",\n  \"app\",\n  \"scripts\",\n  \"supabase/migrations\",\n];\n\nconst excludedNameFragments = [\n  \"install-\",\n  \"fix-\",\n  \"probe\",\n  \"static-verify\",\n  \"contract-test\",\n  \".bak\",\n];\n\nconst terms = [\n  \"BLOCK_BREADTH_OR_HIGH_VOL\",\n  \"v6_would_block\",\n  \"v7_would_block\",\n  \"v6WouldBlock\",\n  \"v7WouldBlock\",\n  \"decision_score\",\n  \"decisionScore\",\n  \"agreement_state\",\n  \"agreementState\",\n  \"V6_BLOCK_V7_ALLOW\",\n  \"V6_ALLOW_V7_BLOCK\",\n  \"positive5d\",\n  \"return5d\",\n  \"return_5d\",\n  \"is_correct\",\n  \"correctRate\",\n  \"v7CorrectRate\",\n  \"headToHead\",\n  \"would_block\",\n  \"wouldBlock\",\n];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) {\n    return [];\n  }\n\n  const out = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      if (\n        entry.name === \"node_modules\" ||\n        entry.name === \".next\" ||\n        entry.name === \".git\" ||\n        entry.name === \"logs\"\n      ) {\n        continue;\n      }\n\n      out.push(...walk(abs));\n      continue;\n    }\n\n    if (\n      !/\\.(ts|tsx|js|cjs|mjs|sql)$/i.test(entry.name)\n    ) {\n      continue;\n    }\n\n    const rel = path.relative(root, abs).replaceAll(\"\\\\\", \"/\");\n\n    if (\n      rel.startsWith(\"scripts/\") &&\n      excludedNameFragments.some((fragment) =>\n        entry.name.includes(fragment),\n      )\n    ) {\n      continue;\n    }\n\n    out.push({ abs, rel });\n  }\n\n  return out;\n}\n\nfunction lineContext(lines, index, radius = 3) {\n  const start = Math.max(0, index - radius);\n  const end = Math.min(lines.length, index + radius + 1);\n\n  return lines\n    .slice(start, end)\n    .map((text, offset) => ({\n      line: start + offset + 1,\n      text: text.slice(0, 260),\n    }));\n}\n\nconst files = roots.flatMap((rel) =>\n  walk(path.resolve(root, rel)),\n);\n\nconst hitsByFile = [];\n\nfor (const file of files) {\n  let source;\n\n  try {\n    source = fs.readFileSync(file.abs, \"utf8\");\n  } catch {\n    continue;\n  }\n\n  const lines = source.split(/\\r?\\n/);\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n\n    const matchedTerms =\n      terms.filter((term) =>\n        line.includes(term),\n      );\n\n    if (matchedTerms.length === 0) {\n      continue;\n    }\n\n    hits.push({\n      line: i + 1,\n      terms: matchedTerms,\n      text: line.slice(0, 280),\n    });\n  }\n\n  if (hits.length === 0) {\n    continue;\n  }\n\n  const score =\n    hits.reduce(\n      (sum, hit) =>\n        sum +\n        hit.terms.length,\n      0,\n    );\n\n  hitsByFile.push({\n    file: file.rel,\n    score,\n    hitCount: hits.length,\n    terms: [\n      ...new Set(\n        hits.flatMap((hit) => hit.terms),\n      ),\n    ],\n    hits,\n    lines,\n  });\n}\n\nhitsByFile.sort(\n  (a, b) =>\n    b.score - a.score ||\n    b.hitCount - a.hitCount ||\n    a.file.localeCompare(b.file),\n);\n\nconst top =\n  hitsByFile.slice(0, 12);\n\nconst compactFiles =\n  top.map((row) => {\n    const selected = [];\n\n    const priorityTerms = [\n      \"decision_score\",\n      \"decisionScore\",\n      \"is_correct\",\n      \"v7CorrectRate\",\n      \"V6_BLOCK_V7_ALLOW\",\n      \"V6_ALLOW_V7_BLOCK\",\n      \"BLOCK_BREADTH_OR_HIGH_VOL\",\n      \"v6_would_block\",\n      \"v7_would_block\",\n      \"agreement_state\",\n      \"positive5d\",\n      \"return5d\",\n      \"return_5d\",\n    ];\n\n    for (const term of priorityTerms) {\n      const hit =\n        row.hits.find((item) =>\n          item.terms.includes(term),\n        );\n\n      if (!hit) {\n        continue;\n      }\n\n      if (\n        selected.some((item) =>\n          Math.abs(item.line - hit.line) <= 2,\n        )\n      ) {\n        continue;\n      }\n\n      selected.push({\n        line: hit.line,\n        term,\n        context: lineContext(\n          row.lines,\n          hit.line - 1,\n          4,\n        ),\n      });\n\n      if (selected.length >= 5) {\n        break;\n      }\n    }\n\n    return {\n      file: row.file,\n      score: row.score,\n      hitCount: row.hitCount,\n      terms: row.terms,\n      selected,\n    };\n  });\n\nconst result = {\n  status:\n    \"MARKET_REGIME_V7_SEMANTIC_AUDIT_SURFACE_PROBE_V1_COMPLETE\",\n\n  hypothesis: [\n    \"V7_BLOCK_ALLOW_SEMANTIC_INVERSION\",\n    \"OUTCOME_SIGN_OR_CORRECTNESS_MAPPING_INVERSION\",\n    \"HEAD_TO_HEAD_WINNER_MAPPING_INVERSION\",\n    \"GENUINELY_BAD_V7_POLICY\",\n  ],\n\n  observedGovernanceEvidence: {\n    completedSample: 219,\n    disagreementSample: 193,\n    v6CorrectRate: 0.8767123287671232,\n    v7CorrectRate: 0.0045662100456621,\n    v6HeadToHeadWins: 192,\n    v7HeadToHeadWins: 1,\n    v7HeadToHeadWinRate: 0.0051813471502590676,\n  },\n\n  candidateFiles:\n    compactFiles,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    productionApplied: false,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-semantic-audit-surface-probe-v1.json\",\n\n  nextGate:\n    \"IDENTIFY_EXACT_V6_V7_DECISION_AND_OUTCOME_SEMANTICS_THEN_RUN_ROW_LEVEL_READ_ONLY_AUDIT\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nconst full = {\n  ...result,\n  allMatchedFiles:\n    hitsByFile.map((row) => ({\n      file: row.file,\n      score: row.score,\n      hitCount: row.hitCount,\n      terms: row.terms,\n      hits: row.hits.slice(0, 100),\n    })),\n};\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    result.fullDetails,\n  ),\n  JSON.stringify(full, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: result.status,\n      observedGovernanceEvidence:\n        result.observedGovernanceEvidence,\n      candidateFiles:\n        compactFiles.map((row) => ({\n          file: row.file,\n          score: row.score,\n          hitCount: row.hitCount,\n          terms: row.terms,\n          selected: row.selected.map((item) => ({\n            line: item.line,\n            term: item.term,\n            context: item.context,\n          })),\n        })),\n      safety: result.safety,\n      fullDetails: result.fullDetails,\n      nextGate: result.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "MARKET_REGIME_V7_SEMANTIC_AUDIT_SURFACE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/market-regime-v7-semantic-audit-surface-probe-v1.cjs",

      consoleOutputPolicy:
        "COMPACT_ACTIVE_SOURCE_ONLY",

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
        "RUN_SEMANTIC_AUDIT_SURFACE_PROBE"
    },
    null,
    2
  )
);
