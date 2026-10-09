const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
  "scripts/alpha-v3-market-data-maintenance-scheduler.ts",
];

function around(lines, needle, before = 4, after = 12) {
  const index = lines.findIndex((line) => line.includes(needle));

  if (index < 0) {
    return {
      needle,
      found: false,
      line: null,
      text: [],
    };
  }

  const start = Math.max(0, index - before);
  const end = Math.min(lines.length, index + after + 1);

  return {
    needle,
    found: true,
    line: index + 1,
    text: lines
      .slice(start, end)
      .map((text, offset) => ({
        line: start + offset + 1,
        text: text.slice(0, 220),
      })),
  };
}

const needles = [
  "clock.weekday === 0",
  "clock.weekday === 6",
  "expected_market_date",
  "expectedMarketDate",
  "getMarketDataFreshnessV77",
  "WEEKDAY",
  "getUTCDay(",
  "getDay(",
];

const results = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    results.push({
      file: rel,
      exists: false,
      matches: [],
    });
    continue;
  }

  const source = fs.readFileSync(abs, "utf8");
  const lines = source.split(/\r?\n/);

  results.push({
    file: rel,
    exists: true,
    matches: needles
      .map((needle) => around(lines, needle))
      .filter((item) => item.found),
  });
}

const independentWeekdayLogic =
  results
    .flatMap((row) =>
      row.matches.map((match) => ({
        file: row.file,
        ...match,
      })),
    )
    .filter((item) =>
      item.needle === "clock.weekday === 0" ||
      item.needle === "clock.weekday === 6" ||
      item.needle === "getUTCDay(" ||
      item.needle === "getDay(",
    );

const result = {
  status:
    "KRX_MAINTENANCE_SUPERVISOR_CALENDAR_PROBE_V1_COMPLETE",

  results,

  summary: {
    independentWeekdayLogicCount:
      independentWeekdayLogic.length,

    independentWeekdayLogic:
      independentWeekdayLogic.map((item) => ({
        file: item.file,
        needle: item.needle,
        line: item.line,
      })),

    recommendation:
      independentWeekdayLogic.length > 0
        ? "REVIEW_AND_BIND_ONLY_IF_LOGIC_CONTROLS_MAINTENANCE_EXECUTION"
        : "NO_ADDITIONAL_CALENDAR_BINDING_REQUIRED",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    schedulerChanged: false,
    realTradingChanged: false,
  },

  fullDetails:
    "logs/krx-maintenance-supervisor-calendar-probe-v1.json",

  nextGate:
    "DECIDE_SUPERVISOR_BINDING_THEN_MARK_KRX_CALENDAR_V1_COMPLETE",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, result.fullDetails),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: result.status,
      summary: result.summary,
      files: result.results.map((row) => ({
        file: row.file,
        exists: row.exists,
        matches: row.matches.map((m) => ({
          needle: m.needle,
          line: m.line,
        })),
      })),
      safety: result.safety,
      fullDetails: result.fullDetails,
      nextGate: result.nextGate,
    },
    null,
    2,
  ),
);
