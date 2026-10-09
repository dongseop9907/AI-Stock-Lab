const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-canonical-trading-calendar-v1-compact-binding-probe.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  {\n    file: \"lib/market/get-market-data-freshness-v7-7.ts\",\n    anchors: [\n      \"function weekday(\",\n      \"function isWeekday(\",\n      \"function isTradingDay(\",\n      \"function previousTradingDay(\",\n      \"const expectedMarketDate =\",\n      \"market_exchange_calendar_overrides\",\n    ],\n  },\n  {\n    file: \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n    anchors: [\n      \"interface CalendarOverrideRow\",\n      \"function nextExpectedKrxOpenDateBase(\",\n      \"export function nextExpectedKrxOpenDate(\",\n      \"market_exchange_calendar_overrides\",\n      \"const targetSessionDate =\",\n    ],\n  },\n  {\n    file: \"scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts\",\n    anchors: [\n      \"clock.weekday === 0\",\n      \"expected_market_date\",\n    ],\n  },\n];\n\nfunction extractAround(lines, anchor, before = 4, after = 12) {\n  const idx =\n    lines.findIndex(\n      (line) =>\n        line.includes(anchor),\n    );\n\n  if (idx < 0) {\n    return {\n      anchor,\n      found: false,\n      lines: [],\n    };\n  }\n\n  const start =\n    Math.max(\n      0,\n      idx - before,\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      idx + after + 1,\n    );\n\n  return {\n    anchor,\n    found: true,\n    line: idx + 1,\n    lines:\n      lines\n        .slice(start, end)\n        .map(\n          (text, offset) => ({\n            line:\n              start +\n              offset +\n              1,\n            text:\n              text.slice(0, 240),\n          }),\n        ),\n  };\n}\n\nconst details = [];\n\nfor (const target of targets) {\n  const abs =\n    path.resolve(\n      root,\n      target.file,\n    );\n\n  if (!fs.existsSync(abs)) {\n    details.push({\n      file:\n        target.file,\n      exists:\n        false,\n      anchors:\n        [],\n    });\n    continue;\n  }\n\n  const text =\n    fs.readFileSync(\n      abs,\n      \"utf8\",\n    );\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  details.push({\n    file:\n      target.file,\n\n    exists:\n      true,\n\n    lineCount:\n      lines.length,\n\n    imports: lines\n      .slice(0, 80)\n      .filter(\n        (line) =>\n          /^\\s*import\\s/.test(line),\n      )\n      .slice(0, 20),\n\n    anchors:\n      target.anchors.map(\n        (anchor) =>\n          extractAround(\n            lines,\n            anchor,\n          ),\n      ),\n  });\n}\n\nconst result = {\n  status:\n    \"KRX_CANONICAL_TRADING_CALENDAR_V1_COMPACT_BINDING_PROBE_COMPLETE\",\n\n  targets:\n    details,\n\n  intendedPatch: {\n    create:\n      \"lib/trading/krx-trading-calendar.ts\",\n\n    bind: [\n      \"lib/market/get-market-data-freshness-v7-7.ts\",\n      \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n    ],\n\n    supervisorPolicy:\n      \"REVIEW_ONLY_UNLESS_DUPLICATE_TRADING_DATE_DECISION_CONFIRMED\",\n\n    preserve: [\n      \"DB verified KRX overrides\",\n      \"2026-10-09 Hangeul Day closure\",\n      \"weekend closure\",\n      \"unknown special closure fail-closed behavior\",\n      \"Alpha V3 scoring\",\n      \"Entry threshold 0.66\",\n      \"Premium cap 0.01\",\n      \"Historical cutoff 2026-10-07\",\n      \"Forward OOS frozen session 2026-10-08|2026-10-12\",\n    ],\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    schedulerChanged: false,\n    realTradingChanged: false,\n    forwardOosStateChanged: false,\n  },\n\n  logFile:\n    \"logs/krx-canonical-trading-calendar-v1-compact-binding-probe.json\",\n\n  nextGate:\n    \"BUILD_AND_BIND_KRX_CANONICAL_TRADING_CALENDAR_V1\",\n};\n\nfs.mkdirSync(\n  path.resolve(\n    root,\n    \"logs\",\n  ),\n  {\n    recursive: true,\n  },\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    result.logFile,\n  ),\n  JSON.stringify(\n    result,\n    null,\n    2,\n  ) + \"\\n\",\n  \"utf8\",\n);\n\n/*\n * Keep terminal output intentionally short.\n */\nconst compact = {\n  status:\n    result.status,\n\n  files:\n    details.map(\n      (row) => ({\n        file:\n          row.file,\n\n        exists:\n          row.exists,\n\n        anchors:\n          (row.anchors ?? [])\n            .map(\n              (a) => ({\n                anchor:\n                  a.anchor,\n\n                found:\n                  a.found,\n\n                line:\n                  a.line ??\n                  null,\n              }),\n            ),\n      }),\n    ),\n\n  intendedPatch:\n    result.intendedPatch,\n\n  safety:\n    result.safety,\n\n  fullDetails:\n    result.logFile,\n\n  nextGate:\n    result.nextGate,\n};\n\nconsole.log(\n  JSON.stringify(\n    compact,\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "KRX_CANONICAL_TRADING_CALENDAR_V1_COMPACT_BINDING_PROBE_INSTALLED",

      generatedFile:
        "scripts/krx-canonical-trading-calendar-v1-compact-binding-probe.cjs",

      consoleOutputPolicy:
        "COMPACT_ONLY_FULL_DETAILS_TO_LOG_FILE",

      nextAction:
        "RUN_COMPACT_BINDING_PROBE"
    },
    null,
    2
  )
);
