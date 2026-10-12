import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const VERSION = "ALPHA_V3_RISK_V3_SOURCE_PROBE_V1";

const FILES = [
  "lib/trading/policy.ts",
  "lib/trading/risk-manager.ts",
  "lib/trading/types.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/get-trading-system-control.ts",
];

const TERMS = [
  "maxRiskPerTradeRate",
  "maxPositionRate",
  "maxPortfolioExposureRate",
  "maxSectorExposureRate",
  "maxOpenPositions",
  "maxDailyLossRate",
  "minStopDistanceRate",
  "maxStopDistanceRate",
  "dailyRealizedPnl",
  "currentInvestedAmount",
  "currentStockExposureAmount",
  "currentSectorExposureAmount",
  "openPositionCount",
  "tradingMode",
  "modelStatus",
];

function scan(relativePath: string) {
  const absolute = path.resolve(ROOT, relativePath);

  if (!fs.existsSync(absolute)) {
    return {
      file: relativePath,
      exists: false,
      lineCount: 0,
      matches: [],
    };
  }

  const text = fs.readFileSync(absolute, "utf8");
  const lines = text.split(/\r?\n/);

  const matches: Array<{
    term: string;
    line: number;
    text: string;
    context: string;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    for (const term of TERMS) {
      if (lines[i].includes(term)) {
        const start = Math.max(0, i - 3);
        const end = Math.min(lines.length, i + 4);

        matches.push({
          term,
          line: i + 1,
          text: lines[i],
          context: lines.slice(start, end).join("\n"),
        });

        break;
      }
    }

    if (matches.length >= 30) {
      break;
    }
  }

  return {
    file: relativePath,
    exists: true,
    lineCount: lines.length,
    matches,
  };
}

const output = {
  status: "ALPHA_V3_RISK_V3_SOURCE_PROBE_COMPLETE",
  version: VERSION,
  files: FILES.map(scan),
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },
  nextGate: "BUILD_ALPHA_V3_RISK_V3_BASELINE",
};

console.log(JSON.stringify(output, null, 2));
