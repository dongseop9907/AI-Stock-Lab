const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-index-source-identity-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst scanRoots = [\n  \"lib/market\",\n  \"lib/trading\",\n  \"scripts\",\n];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) return [];\n  const found = [];\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n    if (entry.isDirectory()) found.push(...walk(abs));\n    else if (/\\.(ts|tsx|js|cjs)$/i.test(entry.name)) found.push(abs);\n  }\n  return found;\n}\n\nconst needles = [\n  \"kospi\",\n  \"kosdaq\",\n  \"KOSPI\",\n  \"KOSDAQ\",\n  \"indexCode\",\n  \"index_code\",\n  \"indexBars\",\n  \"index_bars\",\n  \"MarketRegimeIndex\",\n];\n\nconst hits = [];\n\nfor (const abs of scanRoots.flatMap((r) => walk(path.resolve(root, r)))) {\n  const rel = path.relative(root, abs).replaceAll(\"\\\\\", \"/\");\n\n  if (\n    rel.includes(\"install-\") ||\n    rel.includes(\"fix-\") ||\n    rel.includes(\"probe\") ||\n    rel.includes(\"contract-test\") ||\n    rel.includes(\"static-verify\")\n  ) continue;\n\n  let source;\n  try {\n    source = fs.readFileSync(abs, \"utf8\");\n  } catch {\n    continue;\n  }\n\n  const lines = source.split(/\\r?\\n/);\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const matched = needles.filter((needle) =>\n      lines[i].includes(needle)\n    );\n\n    if (!matched.length) continue;\n\n    hits.push({\n      file: rel,\n      line: i + 1,\n      matched,\n      text: lines[i].trim().slice(0, 260),\n    });\n  }\n}\n\nconst rankedFiles = [...new Set(\n  hits\n    .filter((hit) =>\n      hit.file.includes(\"market-regime\")\n    )\n    .map((hit) => hit.file)\n)];\n\nconst compact = hits\n  .filter((hit) =>\n    hit.file.includes(\"market-regime\") &&\n    (\n      /kospi|kosdaq/i.test(hit.text) ||\n      /index/i.test(hit.text)\n    )\n  )\n  .slice(0, 28);\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_INDEX_SOURCE_IDENTITY_PROBE_V1_COMPLETE\",\n\n  matchedFiles: rankedFiles,\n  sourceSurface: compact,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-index-source-identity-probe-v1.json\",\n\n  nextGate:\n    \"CONFIRM_KOSPI_KOSDAQ_SOURCE_CODES_AND_SERIES\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify({ ...output, allHits: hits }, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: output.status,\n      matchedFiles: output.matchedFiles,\n      sourceSurface: output.sourceSurface,\n      nextGate: output.nextGate,\n      details: output.fullDetails,\n    },\n    null,\n    2,\n  ),\n);\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_INDEX_SOURCE_IDENTITY_PROBE_V1_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-index-source-identity-probe-v1.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_INDEX_SOURCE_IDENTITY_PROBE"
}, null, 2));
