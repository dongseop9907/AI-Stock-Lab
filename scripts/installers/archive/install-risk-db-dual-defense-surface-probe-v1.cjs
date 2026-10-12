const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/risk-db-dual-defense-surface-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst roots = [\n  \"lib\",\n  \"app\",\n  \"scripts\",\n  \"supabase/migrations\",\n];\n\nconst includeExt = /\\.(ts|tsx|js|cjs|sql)$/i;\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) return [];\n  const out = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      out.push(...walk(abs));\n    } else if (includeExt.test(entry.name)) {\n      out.push(abs);\n    }\n  }\n\n  return out;\n}\n\nconst terms = [\n  \"aggregate committed risk\",\n  \"AGGREGATE_COMMITTED_RISK\",\n  \"reserved_risk\",\n  \"reservedRisk\",\n  \"risk_approved\",\n  \"RISK_APPROVED\",\n  \"advisory\",\n  \"pg_advisory\",\n  \"active_buy\",\n  \"open_position\",\n  \"stop_risk\",\n  \"maxRiskAmount\",\n  \"risk_amount\",\n  \"paper_orders\",\n  \"positions\",\n  \"trading_orders\",\n  \"emergency_stop\",\n];\n\nconst hits = [];\n\nfor (const abs of roots.flatMap((r) => walk(path.resolve(root, r)))) {\n  const rel = path.relative(root, abs).replaceAll(\"\\\\\", \"/\");\n\n  if (\n    rel.includes(\"install-\") ||\n    rel.includes(\"fix-\") ||\n    rel.includes(\"probe\") ||\n    rel.includes(\"contract-test\") ||\n    rel.includes(\"static-verify\")\n  ) {\n    continue;\n  }\n\n  let source;\n  try {\n    source = fs.readFileSync(abs, \"utf8\");\n  } catch {\n    continue;\n  }\n\n  const lines = source.split(/\\r?\\n/);\n\n  const matched = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const lower = lines[i].toLowerCase();\n\n    const found = terms.filter((term) =>\n      lower.includes(term.toLowerCase())\n    );\n\n    if (!found.length) continue;\n\n    matched.push({\n      line: i + 1,\n      terms: found,\n      text: lines[i].trim().slice(0, 240),\n    });\n  }\n\n  if (matched.length) {\n    hits.push({\n      file: rel,\n      hitCount: matched.length,\n      lines: matched.slice(0, 18),\n    });\n  }\n}\n\nhits.sort((a, b) => b.hitCount - a.hitCount);\n\nconst candidates = hits.slice(0, 12);\n\nconst output = {\n  status:\n    \"RISK_DB_DUAL_DEFENSE_SURFACE_PROBE_V1_COMPLETE\",\n\n  candidates,\n\n  auditQuestions: [\n    \"Which risk invariants are enforced only in TypeScript?\",\n    \"Which invariants are also enforced atomically in PostgreSQL?\",\n    \"Can direct DB writes bypass reserved-risk limits or order-state rules?\",\n    \"Are release transitions protected against double release?\",\n    \"Are active-order and open-position risk totals guarded transactionally?\"\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    sourceFilesModified: 0,\n    orderCreated: 0,\n    positionChanged: 0,\n    realTradingChanged: false\n  },\n\n  fullDetails:\n    \"logs/risk-db-dual-defense-surface-probe-v1.json\",\n\n  nextGate:\n    \"MAP_APP_RISK_INVARIANTS_TO_DB_CONSTRAINTS_AND_RPC_GUARDS\"\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  candidates: candidates.map((x) => ({\n    file: x.file,\n    hitCount: x.hitCount,\n    lines: x.lines.slice(0, 6),\n  })),\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "RISK_DB_DUAL_DEFENSE_SURFACE_PROBE_V1_INSTALLED",
  generatedFile:
    "scripts/risk-db-dual-defense-surface-probe-v1.cjs",
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
    "RUN_RISK_DB_DUAL_DEFENSE_SURFACE_PROBE"
}, null, 2));
