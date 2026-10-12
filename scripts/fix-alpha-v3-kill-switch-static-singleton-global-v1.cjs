const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-static-verify.cjs";

const file =
  path.resolve(root, rel);

if (!fs.existsSync(file)) {
  throw new Error(
    "STATIC_VERIFIER_NOT_FOUND"
  );
}

const before =
  fs.readFileSync(
    file,
    "utf8"
  );

let after = before;

/*
 * Replace the legacy singleton check that expected
 * the old message expected_single_control_row.
 */
after =
  after.replace(
    /singletonPrecondition:\s*text\.includes\(\s*["']expected_single_control_row["']\s*\),/m,
    `singletonPrecondition:
    text.includes(
      "expected_global_control_row"
    ) &&
    text.includes(
      "control_key = 'global'"
    ),`
  );

/*
 * Defensive fallback in case formatting differs slightly.
 */
if (
  !after.includes(
    "expected_global_control_row"
  )
) {
  after =
    after.replace(
      "singletonPrecondition:",
      `singletonPrecondition:
    text.includes(
      "expected_global_control_row"
    ) &&
    text.includes(
      "control_key = 'global'"
    ),

  legacySingletonPreconditionRemoved:`
    );
}

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const checks = {
  verifierUsesGlobalSingletonMessage:
    after.includes(
      "expected_global_control_row"
    ),

  verifierRequiresGlobalKey:
    after.includes(
      "control_key = 'global'"
    ),

  staleLegacyExpectationAbsent:
    !after.includes(
      'text.includes("expected_single_control_row")'
    ) &&
    !after.includes(
      "text.includes('expected_single_control_row')"
    ),

  fileChanged:
    after !== before
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_STATIC_GLOBAL_SINGLETON_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_STATIC_GLOBAL_SINGLETON_FIX_V1_REVIEW",

      patchedFile: rel,

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_PREFLIGHT_DB_PUSH_AND_DB_VERIFY"
          : "REVIEW_STATIC_VERIFIER_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
