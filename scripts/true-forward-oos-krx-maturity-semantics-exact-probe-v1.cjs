const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const AUDIT_FILE =
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts";

const KRX_FILE =
  "lib/trading/krx-trading-calendar.ts";

function read(rel) {
  return fs.readFileSync(
    path.join(
      ROOT,
      rel,
    ),
    "utf8",
  );
}

function findFunctionStart(
  source,
  name,
) {
  const candidates = [
    "export async function " + name + "(",
    "export function " + name + "(",
    "async function " + name + "(",
    "function " + name + "(",
  ];

  let best = -1;

  for (const candidate of candidates) {
    const index =
      source.indexOf(
        candidate,
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
  name,
) {
  const start =
    findFunctionStart(
      source,
      name,
    );

  if (start < 0) {
    return null;
  }

  const braceStart =
    source.indexOf(
      "{",
      start,
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
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(
          start,
          i + 1,
        );
      }
    }
  }

  return source.slice(start);
}

function exportedFunctions(
  source,
) {
  const names = [];

  const patterns = [
    "export async function ",
    "export function ",
  ];

  for (const marker of patterns) {
    let offset = 0;

    while (offset < source.length) {
      const index =
        source.indexOf(
          marker,
          offset,
        );

      if (index < 0) {
        break;
      }

      const nameStart =
        index +
        marker.length;

      let nameEnd =
        nameStart;

      while (
        nameEnd < source.length &&
        /[A-Za-z0-9_$]/.test(
          source[nameEnd],
        )
      ) {
        nameEnd += 1;
      }

      const name =
        source.slice(
          nameStart,
          nameEnd,
        );

      if (
        name &&
        !names.includes(name)
      ) {
        names.push(name);
      }

      offset =
        Math.max(
          nameEnd + 1,
          index + marker.length,
        );
    }
  }

  return names;
}

const audit = read(AUDIT_FILE);
const krx = read(KRX_FILE);

const targetFunctions = [
  "buildMaturitySchedule",
  "buildSessionIntegrity",
  "auditForwardSessions",
];

const bodies = {};

for (const name of targetFunctions) {
  bodies[name] =
    extractFunction(
      audit,
      name,
    );
}

const allAuditExports =
  exportedFunctions(audit);

const allKrxExports =
  exportedFunctions(krx);

const combinedBodies =
  Object.values(bodies)
    .filter(Boolean)
    .join("\n\n");

const auditImportsKrx =
  audit.includes(
    "krx-trading-calendar",
  );

const bodyReferencesKrxExport =
  allKrxExports.filter(
    name =>
      combinedBodies.includes(name),
  );

const calendarArithmeticSignals = {
  setDate:
    combinedBodies.includes(
      ".setDate(",
    ),

  setUTCDate:
    combinedBodies.includes(
      ".setUTCDate(",
    ),

  dateAddMilliseconds:
    combinedBodies.includes(
      "86400000",
    ) ||
    combinedBodies.includes(
      "24 * 60 * 60 * 1000",
    ) ||
    combinedBodies.includes(
      "24*60*60*1000",
    ),

  dateConstructorPresent:
    combinedBodies.includes(
      "new Date(",
    ),
};

const sessionArithmeticSignals = {
  usesTargetSessionDate:
    combinedBodies.includes(
      "targetSessionDate",
    ),

  usesSourceTradingDate:
    combinedBodies.includes(
      "sourceTradingDate",
    ),

  usesTradingDatesArray:
    [
      "tradingDates",
      "sessionDates",
      "marketSessions",
      "openDates",
      "tradingDays",
    ].some(
      token =>
        combinedBodies.includes(token),
    ),

  usesKrxImport:
    auditImportsKrx,

  referencesKrxExport:
    bodyReferencesKrxExport.length > 0,
};

let semanticAssessment =
  "INCONCLUSIVE";

if (
  sessionArithmeticSignals.usesKrxImport &&
  sessionArithmeticSignals.referencesKrxExport
) {
  semanticAssessment =
    "KRX_TRADING_SESSION_BOUND";
} else if (
  calendarArithmeticSignals.setDate ||
  calendarArithmeticSignals.setUTCDate ||
  calendarArithmeticSignals.dateAddMilliseconds
) {
  semanticAssessment =
    "CALENDAR_DAY_ARITHMETIC_DETECTED";
} else if (
  sessionArithmeticSignals.usesTargetSessionDate &&
  !sessionArithmeticSignals.usesKrxImport
) {
  semanticAssessment =
    "TARGET_SESSION_DATE_DRIVEN_NEEDS_EXACT_SOURCE_REVIEW";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_EXACT_PROBE_V3_COMPLETE",

  probeVersion:
    "V3_BASE64_SAFE_STRING_FUNCTION_EXTRACTION",

  mode:
    "READ_ONLY_EXACT_FUNCTION_BODY_PROBE",

  files: {
    maturityAudit:
      AUDIT_FILE,

    krxCalendar:
      KRX_FILE,
  },

  auditExports:
    allAuditExports,

  krxExports:
    allKrxExports,

  targetFunctions:
    Object.fromEntries(
      Object.entries(bodies)
        .map(
          ([name, body]) => [
            name,
            {
              found:
                !!body,

              source:
                body,
            },
          ],
        ),
    ),

  binding: {
    auditImportsKrx,
    bodyReferencesKrxExport,
  },

  calendarArithmeticSignals,
  sessionArithmeticSignals,

  semanticAssessment,

  decision: {
    needsRepair:
      semanticAssessment ===
      "CALENDAR_DAY_ARITHMETIC_DETECTED",

    needsFurtherExactReview:
      semanticAssessment ===
        "INCONCLUSIVE" ||
      semanticAssessment ===
        "TARGET_SESSION_DATE_DRIVEN_NEEDS_EXACT_SOURCE_REVIEW",

    safeToLeaveAsIs:
      semanticAssessment ===
      "KRX_TRADING_SESSION_BOUND",
  },

  safety: {
    sourceOnly:
      true,

    maturityAuditExecuted:
      false,

    collectorExecuted:
      false,

    networkRequests:
      0,

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

  nextGate:
    semanticAssessment ===
      "KRX_TRADING_SESSION_BOUND"
      ? "VERIFY_FIRST_REAL_FORWARD_SESSION_READINESS"
      : "REPAIR_OR_BIND_KRX_TRADING_SESSION_MATURITY_BEFORE_FIRST_REAL_FORWARD_SESSION",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-krx-maturity-semantics-exact-probe-v3.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
