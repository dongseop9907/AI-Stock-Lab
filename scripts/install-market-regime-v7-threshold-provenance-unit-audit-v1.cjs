const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-threshold-provenance-unit-audit-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst scanRoots = [\"lib/market\", \"lib/trading\", \"scripts\"];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) return [];\n  const out = [];\n  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, e.name);\n    if (e.isDirectory()) {\n      out.push(...walk(abs));\n    } else if (/\\.(ts|tsx|js|cjs)$/i.test(e.name)) {\n      out.push(abs);\n    }\n  }\n  return out;\n}\n\nconst needles = [\n  \"highVolatility20Min\",\n  \"realizedVolatility20\",\n  \"Math.sqrt(252\",\n  \"Math.sqrt(252)\",\n  \"sqrt(252\",\n  \"breadth20Max\",\n  \"BLOCK_BREADTH_OR_HIGH_VOL\",\n];\n\nconst hits = [];\n\nfor (const abs of scanRoots.flatMap(r => walk(path.resolve(root, r)))) {\n  const rel = path.relative(root, abs).replaceAll(\"\\\\\", \"/\");\n\n  if (\n    rel.includes(\"install-\") ||\n    rel.includes(\"fix-\") ||\n    rel.includes(\"probe\") ||\n    rel.includes(\"contract-test\") ||\n    rel.includes(\"static-verify\")\n  ) continue;\n\n  let src;\n  try { src = fs.readFileSync(abs, \"utf8\"); } catch { continue; }\n\n  const lines = src.split(/\\r?\\n/);\n\n  for (let i = 0; i < lines.length; i++) {\n    const matched = needles.filter(n => lines[i].includes(n));\n    if (!matched.length) continue;\n\n    hits.push({\n      file: rel,\n      line: i + 1,\n      matched,\n      text: lines[i].trim().slice(0, 240),\n    });\n  }\n}\n\nconst grouped = {};\nfor (const h of hits) {\n  (grouped[h.file] ??= []).push(h);\n}\n\nconst policyHits =\n  hits.filter(h =>\n    h.file === \"lib/market/market-regime-v7-policy.ts\"\n  );\n\nconst volatilityHits =\n  hits.filter(h =>\n    h.matched.some(x =>\n      x.includes(\"realizedVolatility20\") ||\n      x.includes(\"sqrt(252\") ||\n      x.includes(\"Math.sqrt(252\")\n    )\n  );\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_THRESHOLD_PROVENANCE_UNIT_AUDIT_V1_COMPLETE\",\n\n  policyThresholdSurface:\n    policyHits.slice(0, 16),\n\n  volatilityUnitSurface:\n    volatilityHits.slice(0, 20),\n\n  allMatchedFiles:\n    Object.keys(grouped),\n\n  questions: [\n    \"Is realizedVolatility20 annualized?\",\n    \"Does 0.30 mean 30% annualized volatility?\",\n    \"Was 0.30 defined before forward evidence?\",\n    \"Is breadth20 based on a five-stock universe and therefore quantized by 0.20?\"\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-threshold-provenance-unit-audit-v1.json\",\n\n  nextGate:\n    \"CLASSIFY_POLICY_SATURATION_AS_UNIT_BUG_OR_DESIGN_CALIBRATION_ISSUE\"\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify({ ...output, grouped }, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  policy: output.policyThresholdSurface.slice(0, 8),\n  volatility: output.volatilityUnitSurface.slice(0, 10),\n  matchedFiles: output.allMatchedFiles,\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_THRESHOLD_PROVENANCE_UNIT_AUDIT_V1_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-threshold-provenance-unit-audit-v1.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_THRESHOLD_PROVENANCE_UNIT_AUDIT"
}, null, 2));
