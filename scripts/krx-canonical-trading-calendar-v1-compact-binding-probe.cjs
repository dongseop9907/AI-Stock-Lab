const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  {
    file: "lib/market/get-market-data-freshness-v7-7.ts",
    anchors: [
      "function weekday(",
      "function isWeekday(",
      "function isTradingDay(",
      "function previousTradingDay(",
      "const expectedMarketDate =",
      "market_exchange_calendar_overrides",
    ],
  },
  {
    file: "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
    anchors: [
      "interface CalendarOverrideRow",
      "function nextExpectedKrxOpenDateBase(",
      "export function nextExpectedKrxOpenDate(",
      "market_exchange_calendar_overrides",
      "const targetSessionDate =",
    ],
  },
  {
    file: "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
    anchors: [
      "clock.weekday === 0",
      "expected_market_date",
    ],
  },
];

function extractAround(lines, anchor, before = 4, after = 12) {
  const idx =
    lines.findIndex(
      (line) =>
        line.includes(anchor),
    );

  if (idx < 0) {
    return {
      anchor,
      found: false,
      lines: [],
    };
  }

  const start =
    Math.max(
      0,
      idx - before,
    );

  const end =
    Math.min(
      lines.length,
      idx + after + 1,
    );

  return {
    anchor,
    found: true,
    line: idx + 1,
    lines:
      lines
        .slice(start, end)
        .map(
          (text, offset) => ({
            line:
              start +
              offset +
              1,
            text:
              text.slice(0, 240),
          }),
        ),
  };
}

const details = [];

for (const target of targets) {
  const abs =
    path.resolve(
      root,
      target.file,
    );

  if (!fs.existsSync(abs)) {
    details.push({
      file:
        target.file,
      exists:
        false,
      anchors:
        [],
    });
    continue;
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const lines =
    text.split(/\r?\n/);

  details.push({
    file:
      target.file,

    exists:
      true,

    lineCount:
      lines.length,

    imports: lines
      .slice(0, 80)
      .filter(
        (line) =>
          /^\s*import\s/.test(line),
      )
      .slice(0, 20),

    anchors:
      target.anchors.map(
        (anchor) =>
          extractAround(
            lines,
            anchor,
          ),
      ),
  });
}

const result = {
  status:
    "KRX_CANONICAL_TRADING_CALENDAR_V1_COMPACT_BINDING_PROBE_COMPLETE",

  targets:
    details,

  intendedPatch: {
    create:
      "lib/trading/krx-trading-calendar.ts",

    bind: [
      "lib/market/get-market-data-freshness-v7-7.ts",
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
    ],

    supervisorPolicy:
      "REVIEW_ONLY_UNLESS_DUPLICATE_TRADING_DATE_DECISION_CONFIRMED",

    preserve: [
      "DB verified KRX overrides",
      "2026-10-09 Hangeul Day closure",
      "weekend closure",
      "unknown special closure fail-closed behavior",
      "Alpha V3 scoring",
      "Entry threshold 0.66",
      "Premium cap 0.01",
      "Historical cutoff 2026-10-07",
      "Forward OOS frozen session 2026-10-08|2026-10-12",
    ],
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
    forwardOosStateChanged: false,
  },

  logFile:
    "logs/krx-canonical-trading-calendar-v1-compact-binding-probe.json",

  nextGate:
    "BUILD_AND_BIND_KRX_CANONICAL_TRADING_CALENDAR_V1",
};

fs.mkdirSync(
  path.resolve(
    root,
    "logs",
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.resolve(
    root,
    result.logFile,
  ),
  JSON.stringify(
    result,
    null,
    2,
  ) + "\n",
  "utf8",
);

/*
 * Keep terminal output intentionally short.
 */
const compact = {
  status:
    result.status,

  files:
    details.map(
      (row) => ({
        file:
          row.file,

        exists:
          row.exists,

        anchors:
          (row.anchors ?? [])
            .map(
              (a) => ({
                anchor:
                  a.anchor,

                found:
                  a.found,

                line:
                  a.line ??
                  null,
              }),
            ),
      }),
    ),

  intendedPatch:
    result.intendedPatch,

  safety:
    result.safety,

  fullDetails:
    result.logFile,

  nextGate:
    result.nextGate,
};

console.log(
  JSON.stringify(
    compact,
    null,
    2,
  ),
);
