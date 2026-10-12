const fs = require("fs");
const path = require("path");

const root = process.cwd();

const runtimeFiles = [
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-preflight.cjs",
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-db-verify.cjs"
];

const installerRel =
  "scripts/install-alpha-v3-kill-switch-db-create-fill-guards-v1.cjs";

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(`FILE_NOT_FOUND ${rel}`);
  }

  return fs.readFileSync(abs, "utf8");
}

function write(rel, text) {
  fs.writeFileSync(
    path.resolve(root, rel),
    text,
    "utf8"
  );
}

const patched = [];

/*
 * Runtime scripts must split .env.local with:
 *   .split(/\r?\n/)
 *
 * Broken generated form:
 *   .split(/\\r?\\n/)
 */
for (const rel of runtimeFiles) {
  const before = read(rel);

  let after = before
    .replaceAll(
      String.raw`.split(/\\r?\\n/)`,
      String.raw`.split(/\r?\n/)`
    );

  write(rel, after);

  patched.push({
    file: rel,
    changed: after !== before
  });
}

/*
 * Installer template must keep exactly one extra escaping layer
 * so regenerated runtime code becomes .split(/\r?\n/).
 */
{
  const before = read(installerRel);

  let after = before
    .replaceAll(
      String.raw`.split(/\\\\r?\\\\n/)`,
      String.raw`.split(/\\r?\\n/)`
    );

  write(installerRel, after);

  patched.push({
    file: installerRel,
    changed: after !== before
  });
}

const preflight = read(runtimeFiles[0]);
const dbVerify = read(runtimeFiles[1]);
const installer = read(installerRel);

const checks = {
  preflightEnvSplitValid:
    preflight.includes(
      String.raw`.split(/\r?\n/)`
    ),

  preflightOverEscapedSplitAbsent:
    !preflight.includes(
      String.raw`.split(/\\r?\\n/)`
    ),

  dbVerifyEnvSplitValid:
    dbVerify.includes(
      String.raw`.split(/\r?\n/)`
    ),

  dbVerifyOverEscapedSplitAbsent:
    !dbVerify.includes(
      String.raw`.split(/\\r?\\n/)`
    ),

  installerRegenerationPatternPresent:
    installer.includes(
      String.raw`.split(/\\r?\\n/)`
    ),

  urlRegexStillValidPreflight:
    preflight.includes(
      String.raw`.replace(/\/+$/,`
    ),

  contentRangeRegexStillValidPreflight:
    preflight.includes(
      String.raw`/\/(\d+|\*)$/`
    ),

  urlRegexStillValidDbVerify:
    dbVerify.includes(
      String.raw`.replace(/\/+$/,`
    ),

  contentRangeRegexStillValidDbVerify:
    dbVerify.includes(
      String.raw`/\/(\d+|\*)$/`
    )
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
          ? "ALPHA_V3_KILL_SWITCH_DB_GUARD_ENV_PARSER_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_GUARD_ENV_PARSER_FIX_V1_REVIEW",

      patchedFiles: patched,

      checks,
      failed,

      diagnosis: {
        rootCause:
          "NESTED_TEMPLATE_ENV_NEWLINE_REGEX_OVER_ESCAPED",

        invalidGeneratedSource:
          ".split(/\\\\r?\\\\n/)",

        validGeneratedSource:
          ".split(/\\r?\\n/)"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        dbPushPerformed: false,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "NODE_CHECK_THEN_PREFLIGHT_DB_PUSH_DB_VERIFY"
          : "REVIEW_ENV_PARSER_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
