const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-block-expression-probe-v2.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/market-regime-v7-policy.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"POLICY_FILE_NOT_FOUND\");\n}\n\nconst source = fs.readFileSync(abs, \"utf8\");\nconst lines = source.split(/\\r?\\n/);\n\nfunction statementContaining(startNeedle) {\n  const start = lines.findIndex((line) =>\n    line.includes(startNeedle)\n  );\n\n  if (start < 0) {\n    return null;\n  }\n\n  const picked = [];\n  for (let i = start; i < lines.length; i += 1) {\n    picked.push(lines[i].trim());\n\n    if (lines[i].includes(\";\")) {\n      break;\n    }\n\n    if (picked.length >= 12) {\n      break;\n    }\n  }\n\n  return {\n    startLine: start + 1,\n    text: picked.join(\" \").replace(/\\s+/g, \" \").trim(),\n  };\n}\n\nfunction caseBlock(caseNeedle) {\n  const start = lines.findIndex((line) =>\n    line.includes(caseNeedle)\n  );\n\n  if (start < 0) {\n    return null;\n  }\n\n  const picked = [];\n\n  for (let i = start; i < lines.length; i += 1) {\n    const trimmed = lines[i].trim();\n\n    if (\n      i > start &&\n      (\n        trimmed.startsWith(\"case \") ||\n        trimmed.startsWith(\"default:\")\n      )\n    ) {\n      break;\n    }\n\n    picked.push(trimmed);\n\n    if (picked.length >= 16) {\n      break;\n    }\n  }\n\n  return {\n    startLine: start + 1,\n    text: picked.join(\" \").replace(/\\s+/g, \" \").trim(),\n  };\n}\n\nconst blockedInit =\n  statementContaining(\"let blocked =\");\n\nconst targetCase =\n  caseBlock('case \"BLOCK_BREADTH_OR_HIGH_VOL\":');\n\nconst nearbyInputs =\n  lines\n    .map((text, index) => ({\n      line: index + 1,\n      text: text.trim(),\n    }))\n    .filter((row) =>\n      row.line >= 90 &&\n      row.line <= 145 &&\n      (\n        /breadth/i.test(row.text) ||\n        /vol/i.test(row.text) ||\n        /regime/i.test(row.text)\n      )\n    )\n    .slice(0, 12);\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_BLOCK_EXPRESSION_PROBE_V2_COMPLETE\",\n  policyFile: rel,\n  blockedInit,\n  targetCase,\n  nearbyInputs,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n  },\n  nextGate:\n    \"CONFIRM_EXACT_BOOLEAN_INVERSION_THEN_PATCH\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/market-regime-v7-block-expression-probe-v2.json\"\n  ),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: output.status,\n      blockedInit: output.blockedInit,\n      targetCase: output.targetCase,\n      nearbyInputs: output.nearbyInputs,\n      nextGate: output.nextGate,\n    },\n    null,\n    2\n  )\n);\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_BLOCK_EXPRESSION_PROBE_V2_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-block-expression-probe-v2.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_BLOCK_EXPRESSION_PROBE"
}, null, 2));
