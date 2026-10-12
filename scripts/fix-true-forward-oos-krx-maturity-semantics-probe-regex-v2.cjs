const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PROBE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-krx-maturity-semantics-exact-probe-v1.cjs"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_REGEX_FIX_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PROBE)) {
  fail(
    "PROBE_FILE_NOT_FOUND",
    { probe: PROBE }
  );
  return;
}

fs.mkdirSync(
  BACKUP_DIR,
  { recursive: true }
);

const backup = path.join(
  BACKUP_DIR,
  "true-forward-oos-krx-maturity-semantics-exact-probe-v1.before-regex-fix-v2.cjs"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    PROBE,
    backup
  );
}

const replacement = String.raw`const fs = require("fs");
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

  let best =
    -1;

  for (
    const candidate of candidates
  ) {
    const index =
      source.indexOf(
        candidate
      );

    if (
      index >= 0 &&
      (
        best < 0 ||
        index < best
      )
    ) {
      best =
        index;
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
      name
    );

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

  let inLineComment =
    false;

  let inBlockComment =
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

    const next =
      source[i + 1];

    if (
      inLineComment
    ) {
      if (
        ch === "\n"
      ) {
        inLineComment =
          false;
      }

      continue;
    }

    if (
      inBlockComment
    ) {
      if (
        ch === "*" &&
        next === "/"
      ) {
        inBlockComment =
          false;

        i += 1;
      }

      continue;
    }

    if (
      escaped
    ) {
      escaped =
        false;

      continue;
    }

    if (
      (
        inSingle ||
        inDouble ||
        inTemplate
      ) &&
      ch === "\\"
    ) {
      escaped =
        true;

      continue;
    }

    if (
      !inSingle &&
      !inDouble &&
      !inTemplate
    ) {
      if (
        ch === "/" &&
        next === "/"
      ) {
        inLineComment =
          true;

        i += 1;

        continue;
      }

      if (
        ch === "/" &&
        next === "*"
      ) {
        inBlockComment =
          true;

        i += 1;

        continue;
      }
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
      ch === "`"
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
  const names =
    [];

  const patterns = [
    "export async function ",
    "export function ",
  ];

  for (
    const marker of patterns
  ) {
    let offset =
      0;

    while (
      offset <
      source.length
    ) {
      const index =
        source.indexOf(
          marker,
          offset
        );

      if (
        index < 0
      ) {
        break;
      }

      const nameStart =
        index +
        marker.length;

      let nameEnd =
        nameStart;

      while (
        nameEnd <
          source.length &&
        /[A-Za-z0-9_$]/.test(
          source[nameEnd]
        )
      ) {
        nameEnd +=
          1;
      }

      const name =
        source.slice(
          nameStart,
          nameEnd
        );

      if (
        name &&
        !names.includes(
          name
        )
      ) {
        names.push(
          name
        );
      }

      offset =
        nameEnd +
        1;
    }
  }

  return names;
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
  audit.includes(
    "krx-trading-calendar"
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

  setUTCDate:
    combinedBodies.includes(
      ".setUTCDate("
    ),

  dateAddMilliseconds:
    combinedBodies.includes(
      "86400000"
    ) ||
    combinedBodies.includes(
      "24 * 60 * 60 * 1000"
    ) ||
    combinedBodies.includes(
      "24*60*60*1000"
    ),

  dateConstructorArithmetic:
    combinedBodies.includes(
      "new Date("
    ) &&
    (
      combinedBodies.includes(
        "+ 1"
      ) ||
      combinedBodies.includes(
        "+ 3"
      ) ||
      combinedBodies.includes(
        "+ 5"
      )
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
    [
      "tradingDates",
      "sessionDates",
      "marketSessions",
      "openDates",
      "tradingDays",
    ].some(
      token =>
        combinedBodies.includes(
          token
        )
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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_EXACT_PROBE_V2_COMPLETE",

  mode:
    "READ_ONLY_EXACT_FUNCTION_BODY_PROBE_NO_DYNAMIC_REGEX",

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
    "true-forward-oos-krx-maturity-semantics-exact-probe-v2.json"
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
`;

fs.writeFileSync(
  PROBE,
  replacement,
  "utf8"
);

const written =
  fs.readFileSync(
    PROBE,
    "utf8"
  );

const checks = {
  noDynamicFunctionRegex:
    !written.includes(
      "new RegExp("
    ),

  stringBasedFunctionDiscovery:
    written.includes(
      "findFunctionStart("
    ),

  functionBodyExtractorPresent:
    written.includes(
      "extractFunction("
    ),

  targetFunctionsPreserved:
    written.includes(
      '"buildMaturitySchedule"'
    ) &&
    written.includes(
      '"buildSessionIntegrity"'
    ) &&
    written.includes(
      '"auditForwardSessions"'
    ),

  productSourceChanges:
    true,

  tradingLogicChanges:
    true,
};

const failed = [];

if (
  !checks.noDynamicFunctionRegex
) {
  failed.push(
    "DYNAMIC_REGEX_REMAINS"
  );
}

if (
  !checks.stringBasedFunctionDiscovery
) {
  failed.push(
    "STRING_FUNCTION_DISCOVERY_MISSING"
  );
}

if (
  !checks.functionBodyExtractorPresent
) {
  failed.push(
    "FUNCTION_BODY_EXTRACTOR_MISSING"
  );
}

if (
  !checks.targetFunctionsPreserved
) {
  failed.push(
    "TARGET_FUNCTIONS_MISSING"
  );
}

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_REGEX_FIX_V2_REPAIRED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_REGEX_FIX_V2_FAILED",

  changedFile:
    "scripts/true-forward-oos-krx-maturity-semantics-exact-probe-v1.cjs",

  backupFile:
    "scripts/backups/true-forward-oos-krx-maturity-semantics-exact-probe-v1.before-regex-fix-v2.cjs",

  repair: {
    previousFailure:
      "DYNAMIC_REGEXP_DOUBLE_ESCAPING_CREATED_UNTERMINATED_GROUP",

    newStrategy:
      "STRING_BASED_FUNCTION_DISCOVERY_AND_BRACE_BALANCED_EXTRACTION",

    dynamicFunctionRegex:
      "REMOVED"
  },

  checks: {
    noDynamicFunctionRegex:
      checks.noDynamicFunctionRegex,

    stringBasedFunctionDiscovery:
      checks.stringBasedFunctionDiscovery,

    functionBodyExtractorPresent:
      checks.functionBodyExtractorPresent,

    targetFunctionsPreserved:
      checks.targetFunctionsPreserved,

    productSourceChanges:
      0,

    tradingLogicChanges:
      0,
  },

  safety: {
    probeExecutedByFix:
      false,

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
      false
  },

  failed,

  nextAction:
    failed.length === 0
      ? "NODE_CHECK_AND_RERUN_EXACT_KRX_MATURITY_SEMANTICS_PROBE"
      : "INSPECT_PROBE_V2_REPAIR"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
