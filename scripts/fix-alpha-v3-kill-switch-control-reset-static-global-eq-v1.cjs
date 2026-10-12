const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-kill-switch-control-reset-rpc-binding-v1-static-verify.cjs";

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
 * Existing production code style allows a trailing comma:
 *
 *   .eq(
 *     "control_key",
 *     "global",
 *   )
 *
 * The verifier previously required no comma after "global".
 */
after =
  after.replace(
    /ordinaryUpdateStillTargetsGlobal:\s*\/\\\.eq\\\(\\s\*\\"control_key\\"\\s\*,\\s\*\\"global\\"\\s\*\\\)\/m\.test\(\s*text\s*\)/m,
    `ordinaryUpdateStillTargetsGlobal:
    /\\.eq\\(\\s*"control_key"\\s*,\\s*"global"\\s*,?\\s*\\)/m.test(
      text
    )`
  );

/*
 * Defensive simpler replacement if formatting differs.
 */
after =
  after.replace(
    `/\\.eq\\(\\s*"control_key"\\s*,\\s*"global"\\s*\\)/m.test(`,
    `/\\.eq\\(\\s*"control_key"\\s*,\\s*"global"\\s*,?\\s*\\)/m.test(`
  );

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const checks = {
  fileChanged:
    after !== before,

  trailingCommaAllowed:
    after.includes(
      `"global"\\s*,?\\s*\\)`
    ),

  checkNamePreserved:
    after.includes(
      "ordinaryUpdateStillTargetsGlobal"
    ),

  productionRouteUnchanged:
    true
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
          ? "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_STATIC_GLOBAL_EQ_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_STATIC_GLOBAL_EQ_FIX_V1_REVIEW",

      patchedFile:
        rel,

      checks,
      failed,

      diagnosis: {
        rootCause:
          "STATIC_VERIFIER_DID_NOT_ALLOW_TRAILING_COMMA_IN_SUPABASE_EQ_CALL",

        validProductionShape:
          '.eq("control_key", "global",)'
      },

      safety: {
        productionCodeChanged:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        emergencyStopChanged:
          false
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_TYPECHECK_NODECHECK_NEGATIVE_TEST"
          : "REVIEW_STATIC_VERIFIER_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
