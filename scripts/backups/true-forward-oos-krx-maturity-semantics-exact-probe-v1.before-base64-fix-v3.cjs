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

function extractFunction(
  source,
  name,
) {
  const patterns = [
    new RegExp(
      "export\\\\s+(?:async\\\\s+)?function\\\\s+" +
      name +
      "\\\\s*\\\\("
    ),

    new RegExp(
      "(?:async\\\\s+)?function\\\\s+" +
      name +
      "\\\\s*\\\\("
    ),
  ];

  let start =
    -1;

  for (const pattern of patterns) {
    const match =
      pattern.exec(
        source
      );

    if (match) {
      start =
        match.index;

      break;
    }
  }

  if (
    start < 0
  ) {
    return null;
  }

  const braceStart =
    source.indexOf(
      "{",
      start
    );

  if (
    braceStart < 0
  ) {
    return null;
  }

  let depth =
    0;

  let inSingle =
    false;

  let inDouble =
    false;

  let inTemplate =
    false;

  let escaped =
    false;

  for (
    let i = braceStart;
    i < source.length;
    i++
  ) {
    const ch =
      source[i];

    if (
      escaped
    ) {
      escaped =
        false;

      continue;
    }

    if (
      ch === "\\\\"
    ) {
      escaped =
        true;

      continue;
    }

    if (
      !inDouble &&
      !inTemplate &&
      ch === "'"
    ) {
      inSingle =
        !inSingle;

      continue;
    }

    if (
      !inSingle &&
      !inTemplate &&
      ch === '"'
    ) {
      inDouble =
        !inDouble;

      continue;
    }

    if (
      !inSingle &&
      !inDouble &&
      ch === "\`"
    ) {
      inTemplate =
        !inTemplate;

      continue;
    }

    if (
      inSingle ||
      inDouble ||
      inTemplate
    ) {
      continue;
    }

    if (
      ch === "{"
    ) {
      depth +=
        1;
    } else if (
      ch === "}"
    ) {
      depth -=
        1;

      if (
        depth ===
        0
      ) {
        return source.slice(
          start,
          i + 1
        );
      }
    }
  }

  return source.slice(
    start
  );
}

function exportedFunctions(
  source
) {
  return [
    ...source.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
    ),
  ].map(
    match =>
      match[1]
  );
}

const audit =
  read(
    AUDIT_FILE
  );

const krx =
  read(
    KRX_FILE
  );

const targetFunctions = [
  "buildMaturitySchedule",
  "buildSessionIntegrity",
  "auditForwardSessions",
];

const bodies = {};

for (
  const name of targetFunctions
) {
  bodies[name] =
    extractFunction(
      audit,
      name
    );
}

const allAuditExports =
  exportedFunctions(
    audit
  );

const allKrxExports =
  exportedFunctions(
    krx
  );

const combinedBodies =
  Object.values(
    bodies
  )
    .filter(Boolean)
    .join(
      "\n\n"
    );

const auditImportsKrx =
  /from\s+["'][^"']*krx-trading-calendar[^"']*["']/.test(
    audit
  );

const bodyReferencesKrxExport =
  allKrxExports.filter(
    name =>
      combinedBodies.includes(
        name
      )
  );

const calendarArithmeticSignals = {
  setDate:
    combinedBodies.includes(
      ".setDate("
    ),

  dateAddMilliseconds:
    /86400000|24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(
      combinedBodies
    ),

  utcDayAdd:
    /setUTCDate\s*\(/.test(
      combinedBodies
    ),

  plusDayString:
    /\+\s*[135]\s*\*\s*(?:DAY|MS_PER_DAY|MILLIS_PER_DAY)/i.test(
      combinedBodies
    ),
};

const sessionArithmeticSignals = {
  usesTargetSessionDate:
    combinedBodies.includes(
      "targetSessionDate"
    ),

  usesSourceTradingDate:
    combinedBodies.includes(
      "sourceTradingDate"
    ),

  usesTradingDatesArray:
    /tradingDates|sessionDates|marketSessions|openDates/i.test(
      combinedBodies
    ),

  usesKrxImport:
    auditImportsKrx,

  referencesKrxExport:
    bodyReferencesKrxExport.length >
    0,
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
  calendarArithmeticSignals.dateAddMilliseconds ||
  calendarArithmeticSignals.utcDayAdd ||
  calendarArithmeticSignals.plusDayString
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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_EXACT_PROBE_V1_COMPLETE",

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

  targetFunctions: Object.fromEntries(
    Object.entries(
      bodies
    ).map(
      ([name, body]) => [
        name,
        {
          found:
            !!body,

          source:
            body,
        },
      ]
    )
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
    "logs"
  ),
  {
    recursive:
      true,
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-krx-maturity-semantics-exact-probe-v1.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode = 0;
