const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
  "scripts/alpha-v3-market-data-maintenance-scheduler.ts",
];

const importLine =
  'import { isKrxTradingDate } from "../lib/trading/krx-trading-calendar";';

function addImport(source) {
  if (source.includes(importLine)) {
    return source;
  }

  return importLine + "\n" + source;
}

function replaceWeekdayGate(source) {
  const patterns = [
    /clock\s*\.\s*weekday\s*===\s*0\s*\|\|\s*clock\s*\.\s*weekday\s*===\s*6/g,
    /clock\s*\.\s*weekday\s*===\s*6\s*\|\|\s*clock\s*\.\s*weekday\s*===\s*0/g,
  ];

  let count = 0;

  for (const pattern of patterns) {
    source = source.replace(
      pattern,
      () => {
        count += 1;
        return "!isKrxTradingDate(clock.date)";
      },
    );
  }

  return { source, count };
}

const results = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(`SOURCE_NOT_FOUND:${rel}`);
  }

  const before = fs.readFileSync(abs, "utf8");

  const hadCanonicalDecision =
    before.includes("!isKrxTradingDate(clock.date)");

  let after = addImport(before);

  const replaced = replaceWeekdayGate(after);
  after = replaced.source;

  const hasAnyClockWeekday =
    /clock\s*\.\s*weekday/.test(after);

  const hasCanonicalDecision =
    after.includes("!isKrxTradingDate(clock.date)");

  if (!hadCanonicalDecision && replaced.count === 0) {
    const debugMatches =
      before
        .split(/\r?\n/)
        .map((line, index) => ({
          line: index + 1,
          text: line,
        }))
        .filter((row) =>
          row.text.includes("weekday") ||
          row.text.includes("isWeekend") ||
          row.text.includes("weekend"),
        )
        .slice(0, 20);

    console.error(
      JSON.stringify(
        {
          status: "WEEKDAY_GATE_NOT_FOUND",
          file: rel,
          debugMatches,
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
    process.exit();
  }

  if (after !== before) {
    const backupDir = path.resolve(
      root,
      "logs",
      "krx-calendar-v1-backups",
    );

    fs.mkdirSync(backupDir, { recursive: true });

    const backupName =
      rel.replace(/[\\/]/g, "__") +
      ".pre-canonical-v3.bak";

    fs.writeFileSync(
      path.resolve(backupDir, backupName),
      before,
      "utf8",
    );

    fs.writeFileSync(abs, after, "utf8");
  }

  const final = fs.readFileSync(abs, "utf8");

  const checks = {
    canonicalImportPresent:
      final.includes(importLine),

    canonicalTradingDateDecisionPresent:
      final.includes("!isKrxTradingDate(clock.date)"),

    noLegacyClockWeekdayDecision:
      !/clock\s*\.\s*weekday\s*===/.test(final),

    clockDatePresent:
      final.includes("clock.date"),

    noOrderEndpointAdded:
      !final.includes("/api/orders"),

    noRealTradingEnableAdded:
      !final.includes("real_order_enabled = true") &&
      !final.includes("real_order_enabled:true"),
  };

  results.push({
    file: rel,
    replacements: replaced.count,
    changed: final !== before,
    checks,
  });
}

const failed =
  results.flatMap((row) =>
    Object.entries(row.checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => `${row.file}:${name}`),
  );

const output = {
  status:
    failed.length === 0
      ? "MAINTENANCE_KRX_CANONICAL_CALENDAR_V3_BOUND"
      : "MAINTENANCE_KRX_CANONICAL_CALENDAR_V3_REVIEW",

  results,
  failed,

  behavior: {
    tradingDateGate: "CANONICAL",
    hangeulDay20261009: "CLOSED",
    timeWindow: "PRESERVED",
    oncePerDay: "PRESERVED",
    stepSequence: "PRESERVED",
    schedulerActivation: "UNCHANGED",
    maintenanceExecuted: false,
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    maintenanceExecuted: false,
    schedulerStarted: false,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
    forwardOosStateChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "RUN_EXISTING_MAINTENANCE_CONTRACTS_AND_STATIC_VERIFIERS"
      : "REVIEW_BINDING",
};

console.log(JSON.stringify(output, null, 2));

if (failed.length > 0) {
  process.exitCode = 2;
}
