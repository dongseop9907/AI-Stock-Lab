const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();

const target = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.cjs",
);

if (!fs.existsSync(target)) {
  throw new Error(
    "GAP_SLIPPAGE_01800_APPLY_SCRIPT_NOT_FOUND",
  );
}

const before =
  fs.readFileSync(
    target,
    "utf8",
  );

const lines =
  before.split(/\r?\n/);

const repairs = [];

for (let i = 0; i < lines.length; i += 1) {
  const current =
    lines[i].trim();

  const next =
    lines[i + 1]
      ?.trim() ??
    "";

  /*
   * V3 accidentally changed:
   *
   * /for\s+update/i.test(
   *   migrationSql,
   *
   * into:
   *
   * /for\s+update/i
   *   migrationSql,
   *
   * Restore only these known semantic sites.
   */
  if (
    current ===
      String.raw`/for\s+update/i` &&
    next ===
      "migrationSql,"
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ??
      "";

    const replacement =
      String.raw`${indent}/for\s+update/i.test(`;

    repairs.push({
      line:
        i + 1,
      kind:
        "SOURCE_ORDER_LOCK_TEST",
      before:
        lines[i].trim(),
      after:
        replacement.trim(),
    });

    lines[i] =
      replacement;

    continue;
  }

  /*
   * Semantic preservation gate:
   *
   * !/for\s+update/i.test(
   *   originalFillFn,
   * ) ||
   * /for\s+update/i.test(
   *   newFillFn,
   * )
   */
  if (
    current ===
      String.raw`/for\s+update/i` &&
    next ===
      "originalFillFn,"
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ??
      "";

    const replacement =
      String.raw`${indent}!/for\s+update/i.test(`;

    repairs.push({
      line:
        i + 1,
      kind:
        "ORIGINAL_ROW_LOCK_NEGATED_TEST",
      before:
        lines[i].trim(),
      after:
        replacement.trim(),
    });

    lines[i] =
      replacement;

    continue;
  }

  if (
    current ===
      String.raw`/for\s+update/i` &&
    next ===
      "newFillFn,"
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ??
      "";

    const replacement =
      String.raw`${indent}/for\s+update/i.test(`;

    repairs.push({
      line:
        i + 1,
      kind:
        "NEW_ROW_LOCK_TEST",
      before:
        lines[i].trim(),
      after:
        replacement.trim(),
    });

    lines[i] =
      replacement;

    continue;
  }
}

const after =
  lines.join("\n");

fs.writeFileSync(
  target,
  after,
  "utf8",
);

/*
 * Parse-only validation. No script execution, no DB access.
 */
const check =
  spawnSync(
    process.execPath,
    [
      "--check",
      target,
    ],
    {
      cwd:
        root,
      encoding:
        "utf8",
    },
  );

const finalText =
  fs.readFileSync(
    target,
    "utf8",
  );

const checks = {
  sourceOrderLockTestRestored:
    finalText.includes(
      String.raw`/for\s+update/i.test(
      migrationSql,`,
    ),

  originalRowLockNegatedTestRestored:
    finalText.includes(
      String.raw`!/for\s+update/i.test(
      originalFillFn,`,
    ),

  newRowLockTestRestored:
    finalText.includes(
      String.raw`/for\s+update/i.test(
      newFillFn,`,
    ),

  functionCallRegexStillCorrect:
    finalText.includes(
      String.raw`/\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi`,
    ),

  dollarQuoteRegexStillCorrect:
    finalText.includes(
      String.raw`/\bas\s+(\$[A-Za-z0-9_]*\$)/i`,
    ),

  syntaxValid:
    check.status ===
      0,
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
          ? "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V4_ROW_LOCK_REPAIRED"
          : "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V4_ROW_LOCK_REVIEW",

      diagnosis:
        "V3_REPLACED_ENTIRE_ROW_LOCK_REGEX_LINES_AND_REMOVED_TEST_CALL_SYNTAX",

      patchedFile:
        "scripts/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.cjs",

      repairs,
      checks,
      failed,

      nodeCheck: {
        exitCode:
          check.status,

        stderr:
          (
            check.stderr ||
            ""
          )
            .trim()
            .slice(
              0,
              3000,
            ),
      },

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
          ? "RUN_01800_DB_APPLY_AND_REGRESSION"
          : "STOP_AND_REVIEW_REMAINING_SYNTAX_ERROR",
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
