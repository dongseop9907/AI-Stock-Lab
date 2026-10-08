const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-risk-v3-source-probe.ts"
);

const source = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT = process.cwd();\n\nconst VERSION = \"ALPHA_V3_RISK_V3_SOURCE_PROBE_V1\";\n\nconst FILES = [\n  \"lib/trading/policy.ts\",\n  \"lib/trading/risk-manager.ts\",\n  \"lib/trading/types.ts\",\n  \"lib/trading/paper-order-service.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"lib/trading/get-trading-system-control.ts\",\n];\n\nconst TERMS = [\n  \"maxRiskPerTradeRate\",\n  \"maxPositionRate\",\n  \"maxPortfolioExposureRate\",\n  \"maxSectorExposureRate\",\n  \"maxOpenPositions\",\n  \"maxDailyLossRate\",\n  \"minStopDistanceRate\",\n  \"maxStopDistanceRate\",\n  \"dailyRealizedPnl\",\n  \"currentInvestedAmount\",\n  \"currentStockExposureAmount\",\n  \"currentSectorExposureAmount\",\n  \"openPositionCount\",\n  \"tradingMode\",\n  \"modelStatus\",\n];\n\nfunction scan(relativePath: string) {\n  const absolute = path.resolve(ROOT, relativePath);\n\n  if (!fs.existsSync(absolute)) {\n    return {\n      file: relativePath,\n      exists: false,\n      lineCount: 0,\n      matches: [],\n    };\n  }\n\n  const text = fs.readFileSync(absolute, \"utf8\");\n  const lines = text.split(/\\r?\\n/);\n\n  const matches: Array<{\n    term: string;\n    line: number;\n    text: string;\n    context: string;\n  }> = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    for (const term of TERMS) {\n      if (lines[i].includes(term)) {\n        const start = Math.max(0, i - 3);\n        const end = Math.min(lines.length, i + 4);\n\n        matches.push({\n          term,\n          line: i + 1,\n          text: lines[i],\n          context: lines.slice(start, end).join(\"\\n\"),\n        });\n\n        break;\n      }\n    }\n\n    if (matches.length >= 30) {\n      break;\n    }\n  }\n\n  return {\n    file: relativePath,\n    exists: true,\n    lineCount: lines.length,\n    matches,\n  };\n}\n\nconst output = {\n  status: \"ALPHA_V3_RISK_V3_SOURCE_PROBE_COMPLETE\",\n  version: VERSION,\n  files: FILES.map(scan),\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    kisRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n  nextGate: \"BUILD_ALPHA_V3_RISK_V3_BASELINE\",\n};\n\nconsole.log(JSON.stringify(output, null, 2));\n";

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, source, "utf8");

console.log(JSON.stringify({
  status: "ALPHA_V3_RISK_V3_SOURCE_PROBE_INSTALLED",
  generatedFile: "scripts/alpha-v3-risk-v3-source-probe.ts",
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  nextAction: "RUN_ALPHA_V3_RISK_V3_SOURCE_PROBE"
}, null, 2));
