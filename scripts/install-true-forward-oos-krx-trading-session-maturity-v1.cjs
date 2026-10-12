const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-krx-trading-session-maturity-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-krx-trading-session-maturity-v1-static-verify.cjs"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [AUDIT, PACKAGE]) {
  if (!fs.existsSync(required)) {
    fail(
      "REQUIRED_FILE_MISSING",
      { required }
    );
    return;
  }
}

function findFunctionStart(
  source,
  name
) {
  const markers = [
    "export async function " + name + "(",
    "export function " + name + "(",
    "async function " + name + "(",
    "function " + name + "(",
  ];

  let best = -1;

  for (const marker of markers) {
    const index =
      source.indexOf(
        marker
      );

    if (
      index >= 0 &&
      (
        best < 0 ||
        index < best
      )
    ) {
      best = index;
    }
  }

  return best;
}

function extractFunction(
  source,
  name
) {
  const start =
    findFunctionStart(
      source,
      name
    );

  if (start < 0) {
    return null;
  }

  const braceStart =
    source.indexOf(
      "{",
      start
    );

  if (braceStart < 0) {
    return null;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = braceStart;
    i < source.length;
    i++
  ) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (
        ch === "*" &&
        next === "/"
      ) {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === "/" &&
      next === "/"
    ) {
      lineComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "/" &&
      next === "*"
    ) {
      blockComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "'" ||
      ch === '"' ||
      ch.charCodeAt(0) === 96
    ) {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(
          start,
          i + 1
        );
      }
    }
  }

  return source.slice(start);
}

let audit =
  fs.readFileSync(
    AUDIT,
    "utf8"
  );

const before =
  audit;

const addCalendarDaysBody =
  extractFunction(
    audit,
    "addCalendarDays"
  );

const buildMaturityBody =
  extractFunction(
    audit,
    "buildMaturitySchedule"
  );

if (!buildMaturityBody) {
  fail(
    "BUILD_MATURITY_SCHEDULE_NOT_FOUND"
  );
  return;
}

if (
  !buildMaturityBody.includes(
    "addCalendarDays"
  )
) {
  fail(
    "EXPECTED_CALENDAR_DAY_MATURITY_CALLS_NOT_FOUND",
    {
      note:
        "File may already be repaired or has drifted."
    }
  );
  return;
}

const calendarCallCount =
  (
    audit.match(
      /addCalendarDays\s*\(/g
    ) ||
    []
  ).length;

if (calendarCallCount !== 4) {
  fail(
    "UNEXPECTED_ADD_CALENDAR_DAYS_USAGE_COUNT",
    {
      calendarCallCount,
      expected:
        4,
    }
  );
  return;
}

const importLine =
  'import { nextKrxTradingDate } from "../lib/trading/krx-trading-calendar";';

if (
  !audit.includes(
    "nextKrxTradingDate"
  )
) {
  const pathImport =
    'import path from "node:path";';

  if (
    !audit.includes(
      pathImport
    )
  ) {
    fail(
      "NODE_PATH_IMPORT_ANCHOR_NOT_FOUND"
    );
    return;
  }

  audit =
    audit.replace(
      pathImport,
      pathImport +
      "\n\n" +
      importLine
    );
}

audit =
  audit.replaceAll(
    "addCalendarDays(",
    "addKrxTradingSessions("
  );

const renamedFunction =
  extractFunction(
    audit,
    "addKrxTradingSessions"
  );

if (!renamedFunction) {
  fail(
    "RENAMED_MATURITY_HELPER_NOT_FOUND"
  );
  return;
}

const krxHelper = `function addKrxTradingSessions(
  date: string,
  sessions: number,
) {
  if (
    !Number.isInteger(
      sessions,
    ) ||
    sessions < 0
  ) {
    throw new Error(
      "INVALID_KRX_MATURITY_SESSION_COUNT",
    );
  }

  let cursor =
    date;

  for (
    let i = 0;
    i < sessions;
    i += 1
  ) {
    cursor =
      nextKrxTradingDate(
        cursor,
      );
  }

  return cursor;
}`;

audit =
  audit.replace(
    renamedFunction,
    krxHelper
  );

fs.mkdirSync(
  BACKUP_DIR,
  { recursive: true }
);

const backup =
  path.join(
    BACKUP_DIR,
    "true-forward-oos-post-capture-maturity-audit-v1.before-krx-trading-session-maturity-v1.ts"
  );

if (
  !fs.existsSync(
    backup
  )
) {
  fs.writeFileSync(
    backup,
    before,
    "utf8"
  );
}

fs.writeFileSync(
  AUDIT,
  audit,
  "utf8"
);

const contractSource = `import assert from "node:assert/strict";

import {
  buildMaturitySchedule,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

function main() {
  const hangeulBoundaryBefore =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-07",

        targetSessionDate:
          "2026-10-08",

        capturedAt:
          "2026-10-08T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-09T12:00:00+09:00",
      ),
    );

  const hangeulBoundaryMature =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-07",

        targetSessionDate:
          "2026-10-08",

        capturedAt:
          "2026-10-08T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-12T12:00:00+09:00",
      ),
    );

  const friday =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-15",

        targetSessionDate:
          "2026-10-16",

        capturedAt:
          "2026-10-16T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-23T16:00:00+09:00",
      ),
    );

  const checks = {
    hangeulDaySkippedFor1D:
      hangeulBoundaryBefore
        .maturityDates["1D"] ===
        "2026-10-12",

    hangeulDayBoundaryNotReadyOnHoliday:
      hangeulBoundaryBefore
        .ready["1D"] ===
        false,

    hangeulDayBoundaryReadyOnNextOpen:
      hangeulBoundaryMature
        .ready["1D"] ===
        true,

    hangeulBoundary3D:
      hangeulBoundaryBefore
        .maturityDates["3D"] ===
        "2026-10-14",

    hangeulBoundary5D:
      hangeulBoundaryBefore
        .maturityDates["5D"] ===
        "2026-10-16",

    fridayWeekendSkipped1D:
      friday
        .maturityDates["1D"] ===
        "2026-10-19",

    fridayWeekendSkipped3D:
      friday
        .maturityDates["3D"] ===
        "2026-10-21",

    fridayWeekendSkipped5D:
      friday
        .maturityDates["5D"] ===
        "2026-10-23",

    fridayAllReadyBy5DDate:
      friday.ready["1D"] ===
        true &&
      friday.ready["3D"] ===
        true &&
      friday.ready["5D"] ===
        true,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks
    )
  ) {
    assert.equal(
      value,
      true,
      key
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          hangeulBoundaryBefore,
          hangeulBoundaryMature,
          friday,
        },

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          promotionExecuted:
            false,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_AND_RUN_CURRENT_MATURITY_AUDIT",
      },
      null,
      2,
    ),
  );
}

main();
`;

const staticSource = `const fs = require("fs");
const path = require("path");

const audit = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (!fs.existsSync(audit)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_FAILED",

    failed: [
      "auditFileExists"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const checks = {
    auditFileExists:
      true,

    nextKrxImported:
      source.includes(
        'nextKrxTradingDate'
      ) &&
      source.includes(
        '../lib/trading/krx-trading-calendar'
      ),

    krxSessionHelperExists:
      source.includes(
        "function addKrxTradingSessions("
      ),

    helperUsesNextKrxTradingDate:
      source.includes(
        "nextKrxTradingDate("
      ),

    calendarDayHelperRemoved:
      !source.includes(
        "function addCalendarDays("
      ),

    maturityNoLongerCallsCalendarDays:
      !source.includes(
        "addCalendarDays("
      ),

    maturityUsesKrxSessions:
      (
        source.match(
          /addKrxTradingSessions\\s*\\(/g
        ) ||
        []
      ).length ===
        4,

    oneThreeFiveHorizonsStillPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      maturityAuditExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_KRX_MATURITY_CONTRACT_AND_CURRENT_AUDIT"
        : "REPAIR_KRX_TRADING_SESSION_MATURITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

fs.writeFileSync(
  CONTRACT,
  contractSource,
  "utf8"
);

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

let pkg;

try {
  pkg =
    JSON.parse(
      fs.readFileSync(
        PACKAGE,
        "utf8"
      )
    );
} catch (error) {
  fail(
    "PACKAGE_JSON_PARSE_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        ),
    }
  );
  return;
}

pkg.scripts ||= {};

pkg.scripts[
  "test:true-forward-oos-krx-trading-session-maturity-static"
] =
  "node ./scripts/true-forward-oos-krx-trading-session-maturity-v1-static-verify.cjs";

pkg.scripts[
  "test:true-forward-oos-krx-trading-session-maturity"
] =
  "tsx --env-file=.env.local ./scripts/true-forward-oos-krx-trading-session-maturity-v1-contract-test.ts";

pkg.scripts[
  "forward-oos:post-capture-maturity-audit"
] =
  "tsx --env-file=.env.local ./scripts/true-forward-oos-post-capture-maturity-audit-v1.ts";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

const after =
  fs.readFileSync(
    AUDIT,
    "utf8"
  );

const installChecks = {
  nextKrxImportPresent:
    after.includes(
      importLine
    ),

  krxHelperPresent:
    after.includes(
      "function addKrxTradingSessions("
    ),

  calendarHelperAbsent:
    !after.includes(
      "function addCalendarDays("
    ),

  noCalendarMaturityCalls:
    !after.includes(
      "addCalendarDays("
    ),

  krxMaturityCallCount:
    (
      after.match(
        /addKrxTradingSessions\s*\(/g
      ) ||
      []
    ).length ===
      4,
};

const failed =
  Object.entries(
    installChecks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_INSTALLED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_INSTALL_FAILED",

  changedFile:
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",

  generatedFiles: [
    "scripts/true-forward-oos-krx-trading-session-maturity-v1-contract-test.ts",
    "scripts/true-forward-oos-krx-trading-session-maturity-v1-static-verify.cjs"
  ],

  backup:
    "scripts/backups/true-forward-oos-post-capture-maturity-audit-v1.before-krx-trading-session-maturity-v1.ts",

  repair: {
    oldSemantics:
      "target + 1/3/5 CALENDAR DAYS",

    newSemantics:
      "target + 1/3/5 KRX TRADING SESSIONS",

    krxApi:
      "nextKrxTradingDate(afterDate, overrides=[])",

    holidayBehavior:
      "VERIFIED KRX CLOSURES AND WEEKENDS ARE SKIPPED",

    collectorBehavior:
      "UNCHANGED",

    promotionBehavior:
      "UNCHANGED"
  },

  installChecks,

  safety: {
    installerExecutedMaturityAudit:
      false,

    installerExecutedCollector:
      false,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionExecuted:
      false,

    realTradingEnabled:
      false
  },

  failed,

  nextAction:
    failed.length === 0
      ? "RUN_STATIC_CONTRACT_CURRENT_AUDIT_AND_COLLECTOR_GATE"
      : "INSPECT_KRX_MATURITY_PATCH"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
