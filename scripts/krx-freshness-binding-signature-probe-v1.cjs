const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/get-market-data-freshness-v7-7.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("FRESHNESS_SOURCE_NOT_FOUND");
}

const source = fs.readFileSync(abs, "utf8");
const lines = source.split(/\r?\n/);

function around(anchor, before = 2, after = 12) {
  const index = lines.findIndex((line) => line.includes(anchor));

  if (index < 0) {
    return {
      anchor,
      found: false,
      line: null,
      text: [],
    };
  }

  const start = Math.max(0, index - before);
  const end = Math.min(lines.length, index + after + 1);

  return {
    anchor,
    found: true,
    line: index + 1,
    text: lines
      .slice(start, end)
      .map((text, offset) => ({
        line: start + offset + 1,
        text: text.slice(0, 240),
      })),
  };
}

const anchors = [
  "interface TradingDayOverride",
  "function weekday(",
  "function isWeekday(",
  "function isTradingDay(",
  "function previousTradingDay(",
  "function countTradingDaysAfter(",
  "const expectedMarketDate =",
  "const tradingDayOverrides =",
  "const overrideByDate =",
];

const sections = anchors.map((anchor) => around(anchor));

const result = {
  status: "KRX_FRESHNESS_BINDING_SIGNATURE_PROBE_V1_COMPLETE",
  file: rel,
  sections,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },
  nextGate: "BUILD_FRESHNESS_CANONICAL_BINDER_FROM_SIGNATURES",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(
    root,
    "logs/krx-freshness-binding-signature-probe-v1.json",
  ),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

/*
 * Compact output only: signatures and first few lines.
 */
console.log(
  JSON.stringify(
    {
      status: result.status,
      file: result.file,
      sections: sections.map((section) => ({
        anchor: section.anchor,
        found: section.found,
        line: section.line,
        text: section.text.slice(0, 8),
      })),
      fullDetails:
        "logs/krx-freshness-binding-signature-probe-v1.json",
      nextGate: result.nextGate,
    },
    null,
    2,
  ),
);
