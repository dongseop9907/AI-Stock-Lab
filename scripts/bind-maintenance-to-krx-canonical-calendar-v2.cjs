const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
  "scripts/alpha-v3-market-data-maintenance-scheduler.ts",
];

const importLine =
  'import { isKrxTradingDate } from "../lib/trading/krx-trading-calendar";';

function prependImportSafely(source) {
  if (source.includes(importLine)) {
    return source;
  }

  if (source.startsWith("#!")) {
    const nl = source.indexOf("\n");

    if (nl < 0) {
      throw new Error(
        "INVALID_SHEBANG_SOURCE",
      );
    }

    return (
      source.slice(0, nl + 1) +
      importLine +
      "\n" +
      source.slice(nl + 1)
    );
  }

  return (
    importLine +
    "\n" +
    source
  );
}

function replaceWeekendDecision(source) {
  const exactPatterns = [
    {
      re: /clock\.weekday\s*===\s*0\s*\|\|\s*clock\.weekday\s*===\s*6/g,
      replacement:
        "!isKrxTradingDate(clock.date)",
    },
    {
      re: /clock\.weekday\s*===\s*6\s*\|\|\s*clock\.weekday\s*===\s*0/g,
      replacement:
        "!isKrxTradingDate(clock.date)",
    },
  ];

  let count = 0;

  for (const item of exactPatterns) {
    source = source.replace(
      item.re,
      () => {
        count += 1;
        return item.replacement;
      },
    );
  }

  return {
    source,
    count,
  };
}

const results = [];

for (const rel of targets) {
  const abs =
    path.resolve(
      root,
      rel,
    );

  if (!fs.existsSync(abs)) {
    throw new Error(
      `SOURCE_NOT_FOUND:${rel}`,
    );
  }

  const before =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const alreadyBound =
    before.includes(
      importLine,
    ) &&
    before.includes(
      "!isKrxTradingDate(clock.date)",
    );

  let after =
    prependImportSafely(
      before,
    );

  const replaced =
    replaceWeekendDecision(
      after,
    );

  after =
    replaced.source;

  if (
    !alreadyBound &&
    replaced.count === 0
  ) {
    throw new Error(
      `WEEKEND_DECISION_NOT_FOUND:${rel}`,
    );
  }

  if (
    after !== before
  ) {
    const backupDir =
      path.resolve(
        root,
        "logs",
        "krx-calendar-v1-backups",
      );

    fs.mkdirSync(
      backupDir,
      {
        recursive:
          true,
      },
    );

    const backupName =
      rel.replace(
        /[\\/]/g,
        "__",
      ) +
      ".pre-canonical-v2.bak";

    fs.writeFileSync(
      path.resolve(
        backupDir,
        backupName,
      ),
      before,
      "utf8",
    );

    fs.writeFileSync(
      abs,
      after,
      "utf8",
    );
  }

  const final =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const oldWeekendLogicStillPresent =
    /clock\.weekday\s*===\s*[06]/.test(
      final,
    );

  const checks = {
    canonicalImportPresent:
      final.includes(
        importLine,
      ),

    canonicalTradingDateDecisionPresent:
      final.includes(
        "!isKrxTradingDate(clock.date)",
      ),

    oldWeekendDecisionRemoved:
      !oldWeekendLogicStillPresent,

    clockDateStillPresent:
      final.includes(
        "clock.date",
      ),

    noOrderSurfaceAdded:
      !final.includes(
        "/api/orders",
      ),

    noRealTradingEnableAdded:
      !final.includes(
        "real_order_enabled = true",
      ) &&
      !final.includes(
        "real_order_enabled:true",
      ),
  };

  results.push({
    file:
      rel,

    alreadyBound,

    replacements:
      replaced.count,

    changed:
      final !== before,

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
          ([, ok]) =>
            !ok,
        )
        .map(
          ([name]) =>
            `${row.file}:${name}`,
        ),
  );

const output = {
  status:
    failed.length === 0
      ? "MAINTENANCE_KRX_CANONICAL_CALENDAR_V2_BOUND"
      : "MAINTENANCE_KRX_CANONICAL_CALENDAR_V2_REVIEW",

  results,
  failed,

  behavior: {
    weekendAndVerifiedHolidayGate:
      "CANONICAL_KRX_CALENDAR",

    hangeulDay20261009:
      "CLOSED",

    timeWindow:
      "PRESERVED",

    oncePerDay:
      "PRESERVED",

    stepSequence:
      "PRESERVED",

    schedulerActivation:
      "UNCHANGED",

    maintenanceExecuted:
      false,
  },

  backups:
    "logs/krx-calendar-v1-backups/",

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
      ? "RUN_MAINTENANCE_CONTRACT_STATIC_REGRESSION"
      : "REVIEW_BINDING",
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
