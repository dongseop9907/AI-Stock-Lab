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

const before = fs.readFileSync(
  target,
  "utf8",
);

let after = before;

const replacements = [
  {
    name: "function_call_regex",
    from:
      "/\\\\\\\\b(?:public\\\\\\\\.)?([a-z_][a-z0-9_]*)\\\\\\\\s*\\\\\\\\(/gi",
    to:
      "/\\\\b(?:public\\\\.)?([a-z_][a-z0-9_]*)\\\\s*\\\\(/gi",
  },
  {
    name: "as_dollar_quote_regex",
    from:
      "/\\\\\\\\bas\\\\\\\\s+(\\\\\\\\$[A-Za-z0-9_]*\\\\\\\\$)/i",
    to:
      "/\\\\bas\\\\s+(\\\\$[A-Za-z0-9_]*\\\\$)/i",
  },
  {
    name: "row_lock_regex_1",
    from:
      "/for\\\\\\\\s+update/i",
    to:
      "/for\\\\s+update/i",
  },
];

const actions = [];

for (const item of replacements) {
  if (after.includes(item.from)) {
    after = after.split(item.from).join(item.to);
    actions.push({
      name: item.name,
      action: "FIXED",
    });
  } else if (after.includes(item.to)) {
    actions.push({
      name: item.name,
      action: "ALREADY_FIXED",
    });
  } else {
    actions.push({
      name: item.name,
      action: "PATTERN_NOT_FOUND",
    });
  }
}

fs.writeFileSync(
  target,
  after,
  "utf8",
);

/*
 * Syntax check only. This does not execute the script and therefore
 * cannot touch Supabase or create/execute orders.
 */
const nodeExe = process.execPath;

const check = spawnSync(
  nodeExe,
  [
    "--check",
    target,
  ],
  {
    cwd: root,
    encoding: "utf8",
  },
);

const finalText = fs.readFileSync(
  target,
  "utf8",
);

const checks = {
  functionCallRegexCorrect:
    finalText.includes(
      "/\\b(?:public\\.)?([a-z_][a-z0-9_]*)\\s*\\(/gi",
    ),

  dollarQuoteRegexCorrect:
    finalText.includes(
      "/\\bas\\s+(\\$[A-Za-z0-9_]*\\$)/i",
    ),

  rowLockRegexCorrect:
    finalText.includes(
      "/for\\s+update/i",
    ),

  syntaxValid:
    check.status === 0,
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V2_REGEX_FIXED"
          : "ALPHA_V3_GAP_SLIPPAGE_01800_APPLY_VERIFIER_V2_REGEX_REVIEW",

      diagnosis:
        "GENERATED_REGEX_LITERALS_WERE_DOUBLE_ESCAPED",

      patchedFile:
        "scripts/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.cjs",

      actions,
      checks,
      failed,

      nodeCheck: {
        exitCode: check.status,
        stderr:
          (check.stderr || "").trim().slice(0, 2000),
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        migrationApplied: false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_01800_DB_APPLY_AND_REGRESSION"
          : "REVIEW_GENERATED_APPLY_SCRIPT",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
