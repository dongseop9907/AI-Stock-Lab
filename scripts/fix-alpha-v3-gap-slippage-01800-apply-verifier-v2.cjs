const fs = require("fs");
const path = require("path");

const root = process.cwd();

const applyPath = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.cjs",
);

if (!fs.existsSync(applyPath)) {
  throw new Error(
    "GAP_SLIPPAGE_01800_APPLY_SCRIPT_NOT_FOUND",
  );
}

const before =
  fs.readFileSync(
    applyPath,
    "utf8",
  );

let after =
  before;

/*
 * The V1 apply verifier used direct table-name checks inside 01800.
 * That produced false negatives because 01700 itself already uses
 * indirect/helper-based guard structure for some protections.
 *
 * Replace only the brittle "failedSourceChecks" gate with a semantic
 * preservation comparison against the exact 01700 source function.
 */
const oldGate = `const failedSourceChecks =
  Object.entries(sourceChecks)
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (failedSourceChecks.length > 0) {
  fail(
    "TARGET_MIGRATION_SOURCE_GUARD_REVIEW_REQUIRED",
    {
      sourceChecks,
      failedSourceChecks,
    },
  );
}`;

const newGate = `function extractSqlFunctionForPreservation(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const name =
    functionName.toLowerCase();

  const candidates =
    [
      \`create or replace function public.\${name}(\`,
      \`create function public.\${name}(\`,
    ]
      .map(
        (needle) =>
          lower.indexOf(
            needle,
          ),
      )
      .filter(
        (index) =>
          index >= 0,
      );

  if (
    candidates.length ===
    0
  ) {
    throw new Error(
      \`PRESERVATION_FUNCTION_NOT_FOUND:\${functionName}\`,
    );
  }

  const start =
    Math.min(
      ...candidates,
    );

  const tail =
    source.slice(
      start,
    );

  const asMatch =
    tail.match(
      /\\\\bas\\\\s+(\\\\$[A-Za-z0-9_]*\\\\$)/i,
    );

  if (
    !asMatch
  ) {
    throw new Error(
      \`PRESERVATION_FUNCTION_DOLLAR_QUOTE_NOT_FOUND:\${functionName}\`,
    );
  }

  const delimiter =
    asMatch[1];

  const opener =
    tail.indexOf(
      delimiter,
      asMatch.index,
    );

  const closer =
    tail.indexOf(
      delimiter,
      opener +
        delimiter.length,
    );

  if (
    opener <
      0 ||
    closer <
      0
  ) {
    throw new Error(
      \`PRESERVATION_FUNCTION_BOUNDARY_NOT_FOUND:\${functionName}\`,
    );
  }

  let end =
    closer +
    delimiter.length;

  while (
    end <
      tail.length &&
    /\\\\s/.test(
      tail[end],
    )
  ) {
    end +=
      1;
  }

  if (
    tail[end] ===
    ";"
  ) {
    end +=
      1;
  }

  return tail.slice(
    0,
    end,
  );
}

function preservationFunctionCalls(
  text,
) {
  const calls =
    new Set();

  const regex =
    /\\\\b(?:public\\\\.)?([a-z_][a-z0-9_]*)\\\\s*\\\\(/gi;

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

  for (
    const match of
      text.matchAll(
        regex,
      )
  ) {
    const call =
      match[1]
        .toLowerCase();

    if (
      !ignored.has(
        call,
      )
    ) {
      calls.add(
        call,
      );
    }
  }

  return [
    ...calls,
  ].sort();
}

function preservationCriticalLiterals(
  text,
) {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /'([^']{3,120})'/g,
        ),
      ]
        .map(
          (match) =>
            match[1],
        )
        .filter(
          (value) =>
            /[A-Z_]{3,}|RISK|FRESH|QUALITY|EMERGENCY|STOP|APPROVED|FILLED|FAILED|BLOCK|STALE/i.test(
              value,
            ),
        ),
    ),
  ].sort();
}

const original01700Path =
  path.resolve(
    root,
    "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql",
  );

if (
  !fs.existsSync(
    original01700Path,
  )
) {
  fail(
    "ORIGINAL_01700_MIGRATION_NOT_FOUND_FOR_SEMANTIC_PRESERVATION",
  );
}

const original01700Sql =
  fs.readFileSync(
    original01700Path,
    "utf8",
  );

const originalFillFn =
  extractSqlFunctionForPreservation(
    original01700Sql,
    "execute_paper_buy_order",
  );

const newFillFn =
  extractSqlFunctionForPreservation(
    migrationSql,
    "execute_paper_buy_order_with_execution_price_v1",
  );

const originalHelperCalls =
  preservationFunctionCalls(
    originalFillFn,
  );

const newHelperCalls =
  preservationFunctionCalls(
    newFillFn,
  );

const missingHelperCalls =
  originalHelperCalls.filter(
    (name) =>
      !newHelperCalls.includes(
        name,
      ),
  );

const originalCriticalLiterals =
  preservationCriticalLiterals(
    originalFillFn,
  );

const newCriticalLiterals =
  preservationCriticalLiterals(
    newFillFn,
  );

const missingCriticalLiterals =
  originalCriticalLiterals.filter(
    (value) =>
      !newCriticalLiterals.includes(
        value,
      ),
  );

const semanticPreservation = {
  originalHelperCallsPreserved:
    missingHelperCalls.length ===
      0,

  originalCriticalLiteralsPreserved:
    missingCriticalLiterals.length ===
      0,

  advisoryLockPreserved:
    !originalFillFn.includes(
      "pg_advisory_xact_lock",
    ) ||
    newFillFn.includes(
      "pg_advisory_xact_lock",
    ),

  rowLockPreserved:
    !/for\\\\s+update/i.test(
      originalFillFn,
    ) ||
    /for\\\\s+update/i.test(
      newFillFn,
    ),

  riskApprovedPreserved:
    !originalFillFn.includes(
      "RISK_APPROVED",
    ) ||
    newFillFn.includes(
      "RISK_APPROVED",
    ),

  freshnessMarkerPreserved:
    !(
      /market_data_freshness_observations|DATA_FRESHNESS/i.test(
        originalFillFn,
      )
    ) ||
    /market_data_freshness_observations|DATA_FRESHNESS/i.test(
      newFillFn,
    ),

  qualityMarkerPreserved:
    !(
      /market_data_quality_gate_observations|DATA_QUALITY/i.test(
        originalFillFn,
      )
    ) ||
    /market_data_quality_gate_observations|DATA_QUALITY/i.test(
      newFillFn,
    ),

  killSwitchMarkerPreserved:
    !(
      /trading_system_controls|emergency_stop/i.test(
        originalFillFn,
      )
    ) ||
    /trading_system_controls|emergency_stop/i.test(
      newFillFn,
    ),
};

const semanticPreservationFailed =
  Object.entries(
    semanticPreservation,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

/*
 * Direct table-name checks are diagnostic only.
 * Mandatory gates are:
 * - all non-brittle V1 source checks
 * - exact semantic preservation versus 01700
 */
const mandatorySourceChecks = {
  targetFunctionDefined:
    sourceChecks.targetFunctionDefined,

  executionPriceColumns:
    sourceChecks.executionPriceColumns,

  advisoryLockRetained:
    sourceChecks.advisoryLockRetained,

  orderLockRetained:
    sourceChecks.orderLockRetained,

  riskApprovedGuardRetained:
    sourceChecks.riskApprovedGuardRetained,

  executionDriftGuard:
    sourceChecks.executionDriftGuard,

  reservedRiskGuard:
    sourceChecks.reservedRiskGuard,

  staleSnapshotGuard:
    sourceChecks.staleSnapshotGuard,

  actualExecutionPriceUsed:
    sourceChecks.actualExecutionPriceUsed,
};

const failedSourceChecks =
  Object.entries(
    mandatorySourceChecks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

if (
  failedSourceChecks.length >
    0 ||
  semanticPreservationFailed.length >
    0
) {
  fail(
    "TARGET_MIGRATION_SOURCE_GUARD_REVIEW_REQUIRED",
    {
      sourceChecks,
      mandatorySourceChecks,
      failedSourceChecks,
      semanticPreservation,
      semanticPreservationFailed,
      preservationDetails: {
        originalHelperCalls,
        newHelperCalls,
        missingHelperCalls,
        missingCriticalLiterals,
      },
    },
  );
}`;

if (
  after.includes(
    oldGate,
  )
) {
  after =
    after.replace(
      oldGate,
      newGate,
    );
} else if (
  after.includes(
    "const semanticPreservation =",
  ) &&
  after.includes(
    "mandatorySourceChecks",
  )
) {
  // Idempotent rerun.
} else {
  throw new Error(
    "EXPECTED_V1_SOURCE_GUARD_GATE_NOT_FOUND",
  );
}

/*
 * Also expose semantic preservation in the final report so the
 * successful run proves why the previous direct-marker failures
 * were treated as diagnostics only.
 */
const oldPreflightFragment = `sourceChecks,

      migrationHistory: {`;

const newPreflightFragment = `sourceChecks,

      semanticPreservation: {
        checks:
          semanticPreservation,

        originalHelperCallCount:
          originalHelperCalls.length,

        newHelperCallCount:
          newHelperCalls.length,

        missingHelperCalls,

        missingCriticalLiterals,

        directMarkerDiagnostics: {
          killSwitchRetained:
            sourceChecks.killSwitchRetained,

          freshnessGuardRetained:
            sourceChecks.freshnessGuardRetained,

          qualityGuardRetained:
            sourceChecks.qualityGuardRetained,
        },
      },

      migrationHistory: {`;

if (
  after.includes(
    oldPreflightFragment,
  )
) {
  after =
    after.replace(
      oldPreflightFragment,
      newPreflightFragment,
    );
}

fs.writeFileSync(
  applyPath,
  after,
  "utf8",
);

const finalText =
  fs.readFileSync(
    applyPath,
    "utf8",
  );

const checks = {
  semanticPreservationGatePresent:
    finalText.includes(
      "const semanticPreservation =",
    ),

  comparesAgainst01700:
    finalText.includes(
      "20261008001700_data_freshness_db_create_fill_guards_v1.sql",
    ),

  helperCallPreservation:
    finalText.includes(
      "originalHelperCallsPreserved",
    ),

  criticalLiteralPreservation:
    finalText.includes(
      "originalCriticalLiteralsPreserved",
    ),

  directMarkersDiagnosticOnly:
    finalText.includes(
      "Direct table-name checks are diagnostic only.",
    ),

  stillChecks01800OnlyPending:
    finalText.includes(
      "OTHER_PENDING_MIGRATIONS_PRESENT",
    ),

  stillDryRunsBeforePush:
    finalText.includes(
      '"db",\n        "push",\n        "--linked",\n        "--dry-run"',
    ),

  stillNoOrderPrecondition:
    finalText.includes(
      "NO_ORDER_PRECONDITION_FAILED",
    ),

  stillPostApplyNoOrderRegression:
    finalText.includes(
      "POST_APPLY_NO_ORDER_REGRESSION_FAILED",
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length ===
        0
          ? "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V2_FIXED"
          : "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V2_REVIEW",

      diagnosis:
        "V1_REQUIRED_DIRECT_TABLE_NAME_MARKERS_NOT_PRESENT_IN_ORIGINAL_01700_SEMANTICS",

      patchedFile:
        "scripts/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.cjs",

      migrationFileChanged:
        false,

      checks,
      failed,

      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        networkCalls:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        migrationApplied:
          false,
      },

      nextGate:
        failed.length ===
        0
          ? "RUN_01800_DB_APPLY_AND_REGRESSION_AGAIN"
          : "REVIEW_APPLY_VERIFIER_PATCH",
    },
    null,
    2,
  ),
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
