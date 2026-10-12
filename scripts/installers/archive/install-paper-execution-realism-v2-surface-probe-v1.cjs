const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/paper-execution-realism-v2-surface-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst roots = [\n  \"lib/trading\",\n  \"app/api\",\n  \"scripts\",\n  \"supabase/migrations\",\n];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) return [];\n  const out = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      out.push(...walk(abs));\n    } else if (/\\.(ts|tsx|js|cjs|sql)$/i.test(entry.name)) {\n      out.push(abs);\n    }\n  }\n\n  return out;\n}\n\nconst terms = [\n  \"executionPrice\",\n  \"execution_price\",\n  \"slippage\",\n  \"spread\",\n  \"bid\",\n  \"ask\",\n  \"orderbook\",\n  \"order_book\",\n  \"partial fill\",\n  \"partial_fill\",\n  \"filled_quantity\",\n  \"approved_quantity\",\n  \"liquidity\",\n  \"volume\",\n  \"market impact\",\n  \"market_impact\",\n  \"commission\",\n  \"fee\",\n  \"tax\",\n  \"transaction_cost\",\n  \"paper execution\",\n  \"PAPER_EXECUTION\",\n];\n\nconst files = roots\n  .flatMap((r) => walk(path.resolve(root, r)));\n\nconst scored = [];\n\nfor (const abs of files) {\n  const rel = path.relative(root, abs).replaceAll(\"\\\\\", \"/\");\n\n  if (\n    rel.includes(\"install-\") ||\n    rel.includes(\"fix-\") ||\n    rel.includes(\"probe\") ||\n    rel.includes(\"contract-test\") ||\n    rel.includes(\"static-verify\")\n  ) {\n    continue;\n  }\n\n  let src;\n  try {\n    src = fs.readFileSync(abs, \"utf8\");\n  } catch {\n    continue;\n  }\n\n  const lines = src.split(/\\r?\\n/);\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const lower = lines[i].toLowerCase();\n\n    const matched = terms.filter((term) =>\n      lower.includes(term.toLowerCase())\n    );\n\n    if (!matched.length) continue;\n\n    hits.push({\n      line: i + 1,\n      matched,\n      text: lines[i].trim().slice(0, 220),\n    });\n  }\n\n  if (hits.length) {\n    scored.push({\n      file: rel,\n      hitCount: hits.length,\n      hits,\n    });\n  }\n}\n\nscored.sort((a, b) => b.hitCount - a.hitCount);\n\nconst candidates =\n  scored.slice(0, 14);\n\nconst capability = {\n  executionPriceModel:\n    scored.some((x) =>\n      /paper-execution-price|execution.*price/i.test(x.file)\n    ),\n  slippageModel:\n    scored.some((x) =>\n      x.hits.some((h) =>\n        h.matched.some((m) => /slippage/i.test(m))\n      )\n    ),\n  spreadModel:\n    scored.some((x) =>\n      x.hits.some((h) =>\n        h.matched.some((m) => /spread|bid|ask|orderbook|order_book/i.test(m))\n      )\n    ),\n  partialFillModel:\n    scored.some((x) =>\n      x.hits.some((h) =>\n        h.matched.some((m) => /partial.fill|filled_quantity/i.test(m))\n      )\n    ),\n  liquidityModel:\n    scored.some((x) =>\n      x.hits.some((h) =>\n        h.matched.some((m) => /liquidity|volume|market impact|market_impact/i.test(m))\n      )\n    ),\n  transactionCostModel:\n    scored.some((x) =>\n      x.hits.some((h) =>\n        h.matched.some((m) => /commission|fee|tax|transaction_cost/i.test(m))\n      )\n    ),\n};\n\nconst output = {\n  status:\n    \"PAPER_EXECUTION_REALISM_V2_SURFACE_PROBE_V1_COMPLETE\",\n\n  capability,\n\n  candidates:\n    candidates.map((x) => ({\n      file: x.file,\n      hitCount: x.hitCount,\n      lines: x.hits.slice(0, 8),\n    })),\n\n  auditQuestions: [\n    \"Is PAPER execution price derived only from requested/last price, or from spread/orderbook?\",\n    \"Can fills be partial based on available liquidity?\",\n    \"Is market impact modeled as order size grows?\",\n    \"Are commissions, fees, and sell taxes reflected in realized PnL?\",\n    \"Are stale/missing quote surfaces handled fail-closed?\"\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    sourceFilesModified: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    realTradingChanged: false\n  },\n\n  fullDetails:\n    \"logs/paper-execution-realism-v2-surface-probe-v1.json\",\n\n  nextGate:\n    \"MAP_CURRENT_PAPER_EXECUTION_MODEL_AND_IDENTIFY_REALISM_GAPS\"\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  capability: output.capability,\n  candidates: output.candidates,\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "PAPER_EXECUTION_REALISM_V2_SURFACE_PROBE_V1_INSTALLED",
  generatedFile:
    "scripts/paper-execution-realism-v2-surface-probe-v1.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },
  nextAction:
    "RUN_PAPER_EXECUTION_REALISM_V2_SURFACE_PROBE"
}, null, 2));
