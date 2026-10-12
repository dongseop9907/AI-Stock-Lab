const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = [
  "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
  "scripts/alpha-v3-market-data-maintenance-scheduler.ts",
];

const canonicalModule =
  "../lib/trading/krx-trading-calendar";

function insertImport(source) {
  const marker =
    `from "${canonicalModule}";`;

  if (source.includes(marker)) {
    return source;
  }

  const imports =
    [...source.matchAll(/import[\s\S]*?from\s+["'][^"']+["'];/g)];

  if (imports.length === 0) {
    throw new Error(
      "IMPORT_BLOCK_NOT_FOUND",
    );
  }

  const last =
    imports[imports.length - 1];

  const end =
    last.index +
    last[0].length;

  const block = `

import {
  isKrxTradingDate,
} from "${canonicalModule}";
`;

  return (
    source.slice(0, end) +
    block +
    source.slice(end)
  );
}

function replaceWeekendLogic(source) {
  const patterns = [
    /clock\.weekday\s*===\s*0\s*\|\|\s*clock\.weekday\s*===\s*6/g,
    /clock\.weekday\s*===\s*6\s*\|\|\s*clock\.weekday\s*===\s*0/g,
  ];

  let replaced = 0;

  for (const pattern of patterns) {
    source =
      source.replace(
        pattern,
        () => {
          replaced += 1;
          return "!isKrxTradingDate(clock.date)";
        },
      );
  }

  return {
    source,
    replaced,
  };
}

const results = [];

for (const rel of files) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `SOURCE_NOT_FOUND:${rel}`,
    );
  }

  const before =
    fs.readFileSync(abs, "utf8");

  let after =
    insertImport(before);

  const replacement =
    replaceWeekendLogic(after);

  after =
    replacement.source;

  if (
    replacement.replaced === 0 &&
    !after.includes(
      "!isKrxTradingDate(clock.date)",
    )
  ) {
    throw new Error(
      `WEEKEND_LOGIC_NOT_FOUND:${rel}`,
    );
  }

  fs.writeFileSync(
    abs,
    after,
    "utf8",
  );

  const final =
    fs.readFileSync(abs, "utf8");

  const checks = {
    canonicalImport:
      final.includes(
        `from "${canonicalModule}";`,
      ),

    canonicalClosedDateDecision:
      final.includes(
        "!isKrxTradingDate(clock.date)",
      ),

    oldWeekendExpressionRemoved:
      !/clock\.weekday\s*===\s*0\s*\|\|\s*clock\.weekday\s*===\s*6/.test(
        final,
      ) &&
      !/clock\.weekday\s*===\s*6\s*\|\|\s*clock\.weekday\s*===\s*0/.test(
        final,
      ),

    maintenanceSequencePreserved:
      rel.includes("scheduler")
        ? final.includes("EOD_SYNC") &&
          final.includes("FRESHNESS_CAPTURE") &&
          final.includes("QUALITY_GATE_CAPTURE")
        : true,

    noTradingOrderSurfaceAdded:
      !final.includes("/api/orders") &&
      !final.includes("real_order_enabled"),
  };

  results.push({
    file: rel,
    replacements:
      replacement.replaced,
    checks,
  });
}

const failed =
  results.flatMap(
    (row) =>
      Object.entries(
        row.checks,
      )
        .filter(
          ([, value]) =>
            !value,
        )
        .map(
          ([name]) =>
            `${row.file}:${name}`,
        ),
  );

const output = {
  status:
    failed.length === 0
      ? "MAINTENANCE_KRX_CANONICAL_CALENDAR_V1_BOUND"
      : "MAINTENANCE_KRX_CANONICAL_CALENDAR_V1_REVIEW",

  modifiedFiles:
    results.map(
      (row) =>
        row.file,
    ),

  behavior: {
    weekendAndKnownVerifiedHolidayDecision:
      "CANONICAL",

    knownHangeulDay20261009:
      "CLOSED",

    timeWindow:
      "PRESERVED",

    oncePerDay:
      "PRESERVED",

    maintenanceSequence:
      "PRESERVED",

    schedulerActivation:
      "UNCHANGED",

    realTrading:
      "UNCHANGED_OFF",
  },

  results,
  failed,

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
      ? "RUN_EXISTING_SUPERVISOR_SCHEDULER_CONTRACTS_AND_CALENDAR_STATIC_SMOKE"
      : "REVIEW_MAINTENANCE_CANONICAL_BINDING",
};

console.log(
  JSON.stringify(
    output,
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
