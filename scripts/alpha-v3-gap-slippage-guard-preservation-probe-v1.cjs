const fs = require("fs");
const path = require("path");

const root = process.cwd();

const originalFile =
  "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql";

const newFile =
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql";

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `FILE_NOT_FOUND:${rel}`,
    );
  }

  return fs.readFileSync(abs, "utf8");
}

function extractFunction(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const functionNameLower =
    functionName.toLowerCase();

  /*
   * Do NOT search for the last occurrence of
   * "function public.<name>(" because REVOKE/GRANT statements
   * also contain that phrase after the real CREATE FUNCTION.
   *
   * Anchor specifically to the CREATE declaration.
   */
  const createOrReplaceNeedle =
    `create or replace function public.${functionNameLower}(`;

  const createNeedle =
    `create function public.${functionNameLower}(`;

  const createOrReplaceStart =
    lower.indexOf(
      createOrReplaceNeedle,
    );

  const createStart =
    lower.indexOf(
      createNeedle,
    );

  const starts =
    [
      createOrReplaceStart,
      createStart,
    ].filter(
      (value) =>
        value >= 0,
    );

  if (
    starts.length === 0
  ) {
    throw new Error(
      `FUNCTION_NOT_FOUND:${functionName}`,
    );
  }

  const start =
    Math.min(
      ...starts,
    );

  /*
   * Support both $ and tagged PostgreSQL dollar quoting.
   * Find the AS $tag$ opener after the function declaration,
   * then locate the matching closing delimiter followed by ;.
   */
  const afterStart =
    source.slice(
      start,
    );

  const asMatch =
    afterStart.match(
      /\bas\s+(\$[A-Za-z0-9_]*\$)/i,
    );

  if (
    !asMatch
  ) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_NOT_FOUND:${functionName}`,
    );
  }

  const delimiter =
    asMatch[1];

  const openerRelativeIndex =
    afterStart.indexOf(
      delimiter,
      asMatch.index,
    );

  if (
    openerRelativeIndex < 0
  ) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_OPEN_NOT_FOUND:${functionName}`,
    );
  }

  const bodyStartRelative =
    openerRelativeIndex +
    delimiter.length;

  const closingRelativeIndex =
    afterStart.indexOf(
      delimiter,
      bodyStartRelative,
    );

  if (
    closingRelativeIndex < 0
  ) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_CLOSE_NOT_FOUND:${functionName}`,
    );
  }

  let endRelative =
    closingRelativeIndex +
    delimiter.length;

  while (
    endRelative <
      afterStart.length &&
    /\s/.test(
      afterStart[
        endRelative
      ],
    )
  ) {
    endRelative += 1;
  }

  if (
    afterStart[
      endRelative
    ] ===
    ";"
  ) {
    endRelative +=
      1;
  }

  return source.slice(
    start,
    start +
      endRelative,
  );
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function functionCalls(text) {
  const calls =
    new Set();

  const regex =
    /\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

  const ignored =
    new Set([
      "if",
      "coalesce",
      "greatest",
      "least",
      "round",
      "floor",
      "ceil",
      "jsonb_build_object",
      "json_build_object",
      "now",
      "clock_timestamp",
      "current_date",
      "current_timestamp",
      "nullif",
      "abs",
      "lower",
      "upper",
      "substring",
      "cast",
      "count",
      "sum",
      "avg",
      "max",
      "min",
      "exists",
      "array",
      "values",
      "execute_paper_buy_order",
      "execute_paper_buy_order_with_execution_price_v1",
    ]);

  for (const match of text.matchAll(regex)) {
    const name =
      match[1].toLowerCase();

    if (!ignored.has(name)) {
      calls.add(name);
    }
  }

  return [...calls].sort();
}

function quotedLiterals(text) {
  return [
    ...new Set(
      [...text.matchAll(/'([^']{3,120})'/g)]
        .map((m) => m[1])
        .filter((value) =>
          /[A-Z_]{3,}|RISK|FRESH|QUALITY|EMERGENCY|STOP|APPROVED|FILLED|FAILED|BLOCK|STALE/i.test(
            value,
          ),
        ),
    ),
  ].sort();
}

function lockMarkers(text) {
  const markers = [
    "pg_advisory_xact_lock",
    "for update",
    "RISK_APPROVED",
    "FILLED",
    "FAILED",
    "emergency_stop",
    "trading_system_controls",
    "market_data_freshness_observations",
    "market_data_quality_gate_observations",
    "usable_for_production",
    "usable_production",
    "DATA_FRESHNESS",
    "DATA_QUALITY",
  ];

  return Object.fromEntries(
    markers.map((marker) => [
      marker,
      text.toLowerCase().includes(
        marker.toLowerCase(),
      ),
    ]),
  );
}

const originalSql =
  read(originalFile);

const newSql =
  read(newFile);

const originalFn =
  extractFunction(
    originalSql,
    "execute_paper_buy_order",
  );

const newFn =
  extractFunction(
    newSql,
    "execute_paper_buy_order_with_execution_price_v1",
  );

const originalCalls =
  functionCalls(originalFn);

const newCalls =
  functionCalls(newFn);

const missingCalls =
  originalCalls.filter(
    (name) =>
      !newCalls.includes(name),
  );

const addedCalls =
  newCalls.filter(
    (name) =>
      !originalCalls.includes(name),
  );

const originalLiterals =
  quotedLiterals(originalFn);

const newLiterals =
  quotedLiterals(newFn);

const missingCriticalLiterals =
  originalLiterals.filter(
    (value) =>
      !newLiterals.includes(value),
  );

const originalMarkers =
  lockMarkers(originalFn);

const newMarkers =
  lockMarkers(newFn);

const lostMarkers =
  Object.keys(originalMarkers)
    .filter(
      (key) =>
        originalMarkers[key] &&
        !newMarkers[key],
    );

const structuralChecks = {
  newFunctionExists:
    /function\s+public\.execute_paper_buy_order_with_execution_price_v1/i.test(
      newFn,
    ),

  executionPriceParameterAdded:
    /p_execution_price\s+numeric/i.test(
      newFn,
    ),

  executionObservedAtParameterAdded:
    /p_execution_observed_at\s+timestamptz/i.test(
      newFn,
    ),

  originalHelperCallsPreserved:
    missingCalls.length === 0,

  originalCriticalLiteralsPreserved:
    missingCriticalLiterals.length === 0,

  originalLockAndGuardMarkersPreserved:
    lostMarkers.length === 0,

  advisoryLockPreserved:
    !originalFn.includes(
      "pg_advisory_xact_lock",
    ) ||
    newFn.includes(
      "pg_advisory_xact_lock",
    ),

  rowLockPreserved:
    !/for\s+update/i.test(
      originalFn,
    ) ||
    /for\s+update/i.test(
      newFn,
    ),

  riskApprovedPreserved:
    !originalFn.includes(
      "RISK_APPROVED",
    ) ||
    newFn.includes(
      "RISK_APPROVED",
    ),

  executionDriftGuardAdded:
    newFn.includes(
      "ADVERSE_ENTRY_DRIFT_EXCEEDED",
    ),

  reservedRiskGuardAdded:
    newFn.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK",
    ),

  staleSnapshotGuardAdded:
    newFn.includes(
      "EXECUTION_SNAPSHOT_STALE",
    ),
};

const failed =
  Object.entries(structuralChecks)
    .filter(([, value]) => !value)
    .map(([name]) => name);

const originalDirectMarkers = {
  killSwitch:
    originalMarkers.emergency_stop ||
    originalMarkers.trading_system_controls,

  freshness:
    originalMarkers.market_data_freshness_observations ||
    originalMarkers.DATA_FRESHNESS,

  quality:
    originalMarkers.market_data_quality_gate_observations ||
    originalMarkers.DATA_QUALITY,
};

const newDirectMarkers = {
  killSwitch:
    newMarkers.emergency_stop ||
    newMarkers.trading_system_controls,

  freshness:
    newMarkers.market_data_freshness_observations ||
    newMarkers.DATA_FRESHNESS,

  quality:
    newMarkers.market_data_quality_gate_observations ||
    newMarkers.DATA_QUALITY,
};

const interpretation =
  failed.length === 0
    ? (
        originalDirectMarkers.killSwitch ||
        originalDirectMarkers.freshness ||
        originalDirectMarkers.quality
      )
      ? "ORIGINAL_GUARDS_PRESERVED_IN_NEW_RPC"
      : "ORIGINAL_RPC_USES_INDIRECT_OR_EXTERNAL_GUARDS_AND_NEW_RPC_PRESERVES_ORIGINAL_FUNCTION_STRUCTURE"
    : "REAL_PRESERVATION_DIFFERENCE_REQUIRES_REVIEW";

const report = {
  status:
    failed.length === 0
      ? "ALPHA_V3_GAP_SLIPPAGE_GUARD_PRESERVATION_V1_VERIFIED"
      : "ALPHA_V3_GAP_SLIPPAGE_GUARD_PRESERVATION_V1_REVIEW",

  source: {
    originalFile,
    newFile,
  },

  structuralChecks,

  failed,

  helperCalls: {
    original:
      originalCalls,
    new:
      newCalls,
    missing:
      missingCalls,
    added:
      addedCalls,
  },

  criticalLiterals: {
    originalCount:
      originalLiterals.length,
    newCount:
      newLiterals.length,
    missing:
      missingCriticalLiterals,
  },

  guardMarkers: {
    original:
      originalDirectMarkers,
    new:
      newDirectMarkers,
    lostMarkers,
  },

  interpretation,

  oldApplyCheckDiagnosis:
    (
      !originalDirectMarkers.killSwitch &&
      !originalDirectMarkers.freshness &&
      !originalDirectMarkers.quality &&
      failed.length === 0
    )
      ? "FALSE_NEGATIVE_FROM_REQUIRING_DIRECT_TABLE_NAME_MARKERS"
      : "DIRECT_MARKERS_REQUIRE_REVIEW",

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    migrationApplied: false,
  },

  fullLogFile:
    "logs/alpha-v3-gap-slippage-guard-preservation-v1.json",

  nextGate:
    failed.length === 0
      ? "PATCH_APPLY_VERIFIER_TO_COMPARE_AGAINST_01700_SEMANTICS_THEN_APPLY"
      : "DO_NOT_APPLY_01800_REPAIR_MIGRATION_FIRST",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, report.fullLogFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      structuralChecks:
        report.structuralChecks,

      failed:
        report.failed,

      helperCalls: {
        originalCount:
          originalCalls.length,
        newCount:
          newCalls.length,
        missing:
          missingCalls,
        added:
          addedCalls,
      },

      guardMarkers:
        report.guardMarkers,

      interpretation:
        report.interpretation,

      oldApplyCheckDiagnosis:
        report.oldApplyCheckDiagnosis,

      safety:
        report.safety,

      fullLogFile:
        report.fullLogFile,

      nextGate:
        report.nextGate,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
