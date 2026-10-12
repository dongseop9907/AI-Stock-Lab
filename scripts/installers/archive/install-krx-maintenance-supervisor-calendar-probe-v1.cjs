const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-maintenance-supervisor-calendar-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts\",\n  \"scripts/alpha-v3-market-data-maintenance-scheduler.ts\",\n];\n\nfunction around(lines, needle, before = 4, after = 12) {\n  const index = lines.findIndex((line) => line.includes(needle));\n\n  if (index < 0) {\n    return {\n      needle,\n      found: false,\n      line: null,\n      text: [],\n    };\n  }\n\n  const start = Math.max(0, index - before);\n  const end = Math.min(lines.length, index + after + 1);\n\n  return {\n    needle,\n    found: true,\n    line: index + 1,\n    text: lines\n      .slice(start, end)\n      .map((text, offset) => ({\n        line: start + offset + 1,\n        text: text.slice(0, 220),\n      })),\n  };\n}\n\nconst needles = [\n  \"clock.weekday === 0\",\n  \"clock.weekday === 6\",\n  \"expected_market_date\",\n  \"expectedMarketDate\",\n  \"getMarketDataFreshnessV77\",\n  \"WEEKDAY\",\n  \"getUTCDay(\",\n  \"getDay(\",\n];\n\nconst results = [];\n\nfor (const rel of targets) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    results.push({\n      file: rel,\n      exists: false,\n      matches: [],\n    });\n    continue;\n  }\n\n  const source = fs.readFileSync(abs, \"utf8\");\n  const lines = source.split(/\\r?\\n/);\n\n  results.push({\n    file: rel,\n    exists: true,\n    matches: needles\n      .map((needle) => around(lines, needle))\n      .filter((item) => item.found),\n  });\n}\n\nconst independentWeekdayLogic =\n  results\n    .flatMap((row) =>\n      row.matches.map((match) => ({\n        file: row.file,\n        ...match,\n      })),\n    )\n    .filter((item) =>\n      item.needle === \"clock.weekday === 0\" ||\n      item.needle === \"clock.weekday === 6\" ||\n      item.needle === \"getUTCDay(\" ||\n      item.needle === \"getDay(\",\n    );\n\nconst result = {\n  status:\n    \"KRX_MAINTENANCE_SUPERVISOR_CALENDAR_PROBE_V1_COMPLETE\",\n\n  results,\n\n  summary: {\n    independentWeekdayLogicCount:\n      independentWeekdayLogic.length,\n\n    independentWeekdayLogic:\n      independentWeekdayLogic.map((item) => ({\n        file: item.file,\n        needle: item.needle,\n        line: item.line,\n      })),\n\n    recommendation:\n      independentWeekdayLogic.length > 0\n        ? \"REVIEW_AND_BIND_ONLY_IF_LOGIC_CONTROLS_MAINTENANCE_EXECUTION\"\n        : \"NO_ADDITIONAL_CALENDAR_BINDING_REQUIRED\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    schedulerChanged: false,\n    realTradingChanged: false,\n  },\n\n  fullDetails:\n    \"logs/krx-maintenance-supervisor-calendar-probe-v1.json\",\n\n  nextGate:\n    \"DECIDE_SUPERVISOR_BINDING_THEN_MARK_KRX_CALENDAR_V1_COMPLETE\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, result.fullDetails),\n  JSON.stringify(result, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: result.status,\n      summary: result.summary,\n      files: result.results.map((row) => ({\n        file: row.file,\n        exists: row.exists,\n        matches: row.matches.map((m) => ({\n          needle: m.needle,\n          line: m.line,\n        })),\n      })),\n      safety: result.safety,\n      fullDetails: result.fullDetails,\n      nextGate: result.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n", "utf8");

console.log(
  JSON.stringify(
    {
      status:
        "KRX_MAINTENANCE_SUPERVISOR_CALENDAR_PROBE_V1_INSTALLED",
      generatedFile:
        "scripts/krx-maintenance-supervisor-calendar-probe-v1.cjs",
      consoleOutputPolicy:
        "COMPACT_ONLY",
      nextAction:
        "RUN_MAINTENANCE_SUPERVISOR_CALENDAR_PROBE"
    },
    null,
    2
  )
);
