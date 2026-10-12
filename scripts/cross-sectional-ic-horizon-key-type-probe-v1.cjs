const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "alpha-v1-cross-sectional-ic-regime-timing.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_KEY_TYPE_PROBE_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_SOURCE_NOT_FOUND");
  return;
}

const source = fs.readFileSync(TARGET, "utf8");
const lines = source.split(/\r?\n/);

function snippet(center, before = 28, after = 36) {
  const start = Math.max(0, center - 1 - before);
  const end = Math.min(lines.length, center + after);

  return lines.slice(start, end).map((text, offset) => ({
    line: start + offset + 1,
    text,
  }));
}

function findMatches(needle) {
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) {
      out.push({
        line: i + 1,
        snippet: snippet(i + 1),
      });
    }
  }

  return out;
}

const report = {
  status:
    "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_KEY_TYPE_PROBE_V1_COMPLETE",

  buildError: {
    file:
      "scripts/alpha-v1-cross-sectional-ic-regime-timing.ts",
    line: 612,
    expression: "row[h]",
    problem:
      "h is inferred as string, but row only exposes date/regime/r1/r3/r5",
  },

  sourceContext: {
    rowHUses:
      findMatches("row[h]"),

    horizonsDefinitions: [
      ...findMatches("HORIZONS"),
      ...findMatches("horizons"),
      ...findMatches("[\"r1\""),
      ...findMatches("'r1'"),
    ],

    loopDefinitions: [
      ...findMatches("for (const h"),
      ...findMatches(".map((h"),
      ...findMatches(".map(\n"),
    ],

    rowShape: [
      ...findMatches("regime:"),
      ...findMatches("r1:"),
      ...findMatches("r3:"),
      ...findMatches("r5:"),
    ],

    nearbyLine612:
      snippet(612, 50, 60),
  },

  decisionRules: {
    preferred:
      "if h semantically represents only r1/r3/r5, type it as a literal union or derive from an as const tuple",

    alternative:
      "if h can include other keys, narrow before indexing",

    forbidden: [
      "DO_NOT_ADD_STRING_INDEX_SIGNATURE_TO_THE_ROW_TYPE",
      "DO_NOT_CAST_row_AS_ANY",
      "DO_NOT_CAST_h_AS_ANY",
      "DO_NOT_CHANGE_IC_OR_REGIME_CALCULATION",
    ],
  },

  safety: {
    sourceOnly: true,
    filesModified: 0,
    scriptExecuted: false,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextGate:
    "PATCH_HORIZON_KEY_TO_LITERAL_UNION_WITHOUT_CHANGING_IC_LOGIC",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "cross-sectional-ic-horizon-key-type-probe-v1.json"
  ),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exitCode = 0;
