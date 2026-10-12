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

function extractFunctionByName(
  source,
  name,
) {
  const markers = [
    "export async function " + name + "(",
    "export function " + name + "(",
    "async function " + name + "(",
    "function " + name + "(",
  ];

  let start = -1;

  for (const marker of markers) {
    const index =
      source.indexOf(
        marker
      );

    if (
      index >= 0 &&
      (
        start < 0 ||
        index < start
      )
    ) {
      start =
        index;
    }
  }

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
      ch === String.fromCharCode(96)
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

function extractHeader(
  body
) {
  if (!body) {
    return null;
  }

  const brace =
    body.indexOf(
      "{"
    );

  return (
    brace >= 0
      ? body.slice(
          0,
          brace
        ).trim()
      : body.trim()
  );
}

function importLinesFor(
  source,
  token
) {
  return source
    .split(/\r?\n/)
    .map(
      (line, i) => ({
        line:
          i + 1,
        text:
          line,
      })
    )
    .filter(
      row =>
        row.text.includes(
          token
        )
    )
    .slice(
      0,
      20
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

const addCalendarDays =
  extractFunctionByName(
    audit,
    "addCalendarDays"
  );

const buildMaturitySchedule =
  extractFunctionByName(
    audit,
    "buildMaturitySchedule"
  );

const nextKrxTradingDate =
  extractFunctionByName(
    krx,
    "nextKrxTradingDate"
  );

const isKrxTradingDate =
  extractFunctionByName(
    krx,
    "isKrxTradingDate"
  );

const resolveExpectedKrxMarketDate =
  extractFunctionByName(
    krx,
    "resolveExpectedKrxMarketDate"
  );

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_REPAIR_SIGNATURE_PROBE_V1_COMPLETE",

  mode:
    "READ_ONLY_SIGNATURE_AND_BODY_PROBE",

  confirmedIssue: {
    buildMaturityScheduleUsesCalendarDays:
      Boolean(
        buildMaturitySchedule &&
        buildMaturitySchedule.includes(
          "addCalendarDays"
        )
      ),

    currentSemantics:
      "CALENDAR_DAY_MATURITY",

    requiredSemantics:
      "KRX_TRADING_SESSION_MATURITY",
  },

  auditFunctions: {
    addCalendarDays: {
      found:
        !!addCalendarDays,

      header:
        extractHeader(
          addCalendarDays
        ),

      source:
        addCalendarDays,
    },

    buildMaturitySchedule: {
      found:
        !!buildMaturitySchedule,

      header:
        extractHeader(
          buildMaturitySchedule
        ),

      source:
        buildMaturitySchedule,
    },
  },

  krxFunctions: {
    nextKrxTradingDate: {
      found:
        !!nextKrxTradingDate,

      header:
        extractHeader(
          nextKrxTradingDate
        ),

      source:
        nextKrxTradingDate,
    },

    isKrxTradingDate: {
      found:
        !!isKrxTradingDate,

      header:
        extractHeader(
          isKrxTradingDate
        ),

      source:
        isKrxTradingDate,
    },

    resolveExpectedKrxMarketDate: {
      found:
        !!resolveExpectedKrxMarketDate,

      header:
        extractHeader(
          resolveExpectedKrxMarketDate
        ),

      source:
        resolveExpectedKrxMarketDate,
    },
  },

  importEvidence: {
    auditKrxMentions:
      importLinesFor(
        audit,
        "krx-trading-calendar"
      ),

    krxNextMentions:
      importLinesFor(
        krx,
        "nextKrxTradingDate"
      ),
  },

  repairReadiness: {
    nextKrxTradingDateFound:
      !!nextKrxTradingDate,

    exactNextKrxSignatureKnown:
      !!extractHeader(
        nextKrxTradingDate
      ),

    buildMaturityScheduleFound:
      !!buildMaturitySchedule,

    canBuildDeterministicRepair:
      !!nextKrxTradingDate &&
      !!buildMaturitySchedule,
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
    !!nextKrxTradingDate &&
    !!buildMaturitySchedule
      ? "REPLACE_CALENDAR_DAY_MATURITY_WITH_KRX_TRADING_SESSION_MATURITY"
      : "STOP_AND_REVIEW_KRX_CALENDAR_API",
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
    "true-forward-oos-krx-maturity-repair-signature-probe-v1.json"
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
