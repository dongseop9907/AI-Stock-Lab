const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-policy-blocked-source-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst candidates = [\n  \"lib/market/market-regime-v7-policy.ts\",\n  \"lib/market/market-regime-policy-v7.ts\",\n];\n\nconst target = candidates.find((rel) =>\n  fs.existsSync(path.resolve(root, rel))\n);\n\nif (!target) {\n  throw new Error(\"V7_POLICY_SOURCE_NOT_FOUND\");\n}\n\nconst abs = path.resolve(root, target);\nconst source = fs.readFileSync(abs, \"utf8\");\nconst lines = source.split(/\\r?\\n/);\n\nconst anchors = [\n  \"evaluateMarketRegimeV7Policy\",\n  \"BLOCK_BREADTH_OR_HIGH_VOL\",\n  \"blocked\",\n  \"breadth\",\n  \"vol\",\n  \"reason\",\n];\n\nconst hits = [];\n\nfor (let i = 0; i < lines.length; i += 1) {\n  const text = lines[i];\n\n  const matched =\n    anchors.filter((anchor) =>\n      text.includes(anchor)\n    );\n\n  if (matched.length === 0) {\n    continue;\n  }\n\n  hits.push({\n    line: i + 1,\n    matched,\n    text: text.trim().slice(0, 240),\n  });\n}\n\nconst relevant =\n  hits.filter((hit) =>\n    hit.matched.includes(\"blocked\") ||\n    hit.matched.includes(\"BLOCK_BREADTH_OR_HIGH_VOL\") ||\n    hit.matched.includes(\"evaluateMarketRegimeV7Policy\")\n  );\n\nconst compact =\n  relevant.slice(0, 18);\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_POLICY_BLOCKED_SOURCE_PROBE_V1_COMPLETE\",\n  policyFile: target,\n  compact,\n  allHits: hits,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n    ordersCreated: 0,\n    positionsChanged: 0,\n  },\n  fullDetails:\n    \"logs/market-regime-v7-policy-blocked-source-probe-v1.json\",\n  nextGate:\n    \"CONFIRM_BLOCKED_BOOLEAN_INVERSION_AND_PATCH_WITH_REGRESSION_TEST\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: output.status,\n      policyFile: output.policyFile,\n      blockedSurface: compact,\n      nextGate: output.nextGate,\n      details: output.fullDetails,\n    },\n    null,\n    2,\n  ),\n);\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_POLICY_BLOCKED_SOURCE_PROBE_V1_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-policy-blocked-source-probe-v1.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_BLOCKED_SOURCE_PROBE"
}, null, 2));
