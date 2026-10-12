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
  const trimmed =
    lines[i].trim();

  /*
   * Repair the exact malformed regex currently reported by Node:
   * /\\b(?:public\\.)?([a-z_][a-z0-9_]*)\\s*\\(/gi
   *
   * The generated JS source must contain SINGLE backslashes:
   * /\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi
   */
  if (
    trimmed.includes("public") &&
    trimmed.includes("[a-z_][a-z0-9_]*") &&
    trimmed.includes("/gi")
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ?? "";

    const replacement =
      String.raw`${indent}/\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;`;

    if (
      lines[i] !==
      replacement
    ) {
      repairs.push({
        line:
          i + 1,
        kind:
          "FUNCTION_CALL_REGEX",
        before:
          lines[i].trim(),
        after:
          replacement.trim(),
      });

      lines[i] =
        replacement;
    }
  }

  /*
   * Repair the PostgreSQL dollar-quote detector if it was
   * also emitted with doubled backslashes.
   */
  if (
    trimmed.includes("A-Za-z0-9_") &&
    trimmed.includes("as") &&
    trimmed.includes("/i")
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ?? "";

    const replacement =
      String.raw`${indent}/\bas\s+(\$[A-Za-z0-9_]*\$)/i,`;

    if (
      lines[i] !==
      replacement
    ) {
      repairs.push({
        line:
          i + 1,
        kind:
          "DOLLAR_QUOTE_REGEX",
        before:
          lines[i].trim(),
        after:
          replacement.trim(),
      });

      lines[i] =
        replacement;
    }
  }

  /*
   * Normalize any malformed row-lock regex lines.
   */
  if (
    trimmed.includes("for") &&
    trimmed.includes("update") &&
    trimmed.includes("/i") &&
    (
      trimmed.includes("\\\\s") ||
      trimmed.includes("\\s")
    )
  ) {
    const indent =
      lines[i].match(/^\s*/)?.[0] ?? "";

    const suffix =
      trimmed.endsWith(",")
        ? ","
        : "";

    const replacement =
      String.raw`${indent}/for\s+update/i${suffix}`;

    if (
      lines[i] !==
      replacement
    ) {
      repairs.push({
        line:
          i + 1,
        kind:
          "ROW_LOCK_REGEX",
        before:
          lines[i].trim(),
        after:
          replacement.trim(),
      });

      lines[i] =
        replacement;
    }
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
 * Syntax validation only.
 * node --check does NOT execute the file.
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
  malformedFunctionCallRegexGone:
    !finalText.includes(
      String.raw`/\\b(?:public\\.)?([a-z_][a-z0-9_]*)\\s*\\(/gi`,
    ),

  correctFunctionCallRegexPresent:
    finalText.includes(
      String.raw`/\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi`,
    ),

  malformedDollarQuoteRegexGone:
    !finalText.includes(
      String.raw`/\\bas\\s+(\\$[A-Za-z0-9_]*\\$)/i`,
    ),

  correctDollarQuoteRegexPresent:
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
          ? "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V3_HARD_REGEX_REPAIRED"
          : "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V3_HARD_REGEX_REVIEW",

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
