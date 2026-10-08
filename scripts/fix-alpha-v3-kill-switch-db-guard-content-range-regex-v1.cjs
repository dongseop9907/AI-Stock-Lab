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
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
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
 * Runtime files must contain:
 *   /\/(\d+|\*)$/
 *
 * Current broken generated form:
 *   /\\/(\\d+|\\*)$/
 */
for (const rel of runtimeFiles) {
  const before = read(rel);

  let after = before
    .replaceAll(
      String.raw`/\\/(\\d+|\\*)$/`,
      String.raw`/\/(\d+|\*)$/`
    )
    .replaceAll(
      String.raw`/\\/(\\d+|\*)$/`,
      String.raw`/\/(\d+|\*)$/`
    )
    .replaceAll(
      String.raw`/\\/(\d+|\\*)$/`,
      String.raw`/\/(\d+|\*)$/`
    );

  write(rel, after);

  patched.push({
    file: rel,
    changed: after !== before
  });
}

/*
 * Installer template needs one extra escaping layer so that
 * regenerated runtime code becomes:
 *   /\/(\d+|\*)$/
 *
 * Therefore inside the installer source we want:
 *   /\\/(\\d+|\\*)$/
 * only within the template literal source text, not runtime.
 *
 * Normalize any over-escaped variant down by one layer.
 */
{
  const before =
    read(installerRel);

  let after =
    before
      .replaceAll(
        String.raw`/\\\\/(\\\\d+|\\\\*)$/`,
        String.raw`/\\/(\\d+|\\*)$/`
      )
      .replaceAll(
        String.raw`/\\\\/(\\d+|\\\\*)$/`,
        String.raw`/\\/(\\d+|\\*)$/`
      );

  write(
    installerRel,
    after
  );

  patched.push({
    file:
      installerRel,
    changed:
      after !== before
  });
}

const preflight =
  read(runtimeFiles[0]);

const dbVerify =
  read(runtimeFiles[1]);

const installer =
  read(installerRel);

const validRuntimePattern =
  String.raw`/\/(\d+|\*)$/`;

const brokenRuntimePattern =
  String.raw`/\\/(\\d+|\\*)$/`;

const expectedInstallerPattern =
  String.raw`/\\/(\\d+|\\*)$/`;

const checks = {
  preflightValidContentRangeRegex:
    preflight.includes(
      validRuntimePattern
    ),

  preflightBrokenRegexAbsent:
    !preflight.includes(
      brokenRuntimePattern
    ),

  dbVerifyValidContentRangeRegex:
    dbVerify.includes(
      validRuntimePattern
    ),

  dbVerifyBrokenRegexAbsent:
    !dbVerify.includes(
      brokenRuntimePattern
    ),

  installerRegenerationPatternPresent:
    installer.includes(
      expectedInstallerPattern
    ),

  urlSlashRegexStillValidInPreflight:
    preflight.includes(
      String.raw`.replace(/\/+$/,`
    ),

  urlSlashRegexStillValidInDbVerify:
    dbVerify.includes(
      String.raw`.replace(/\/+$/,`
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
          ? "ALPHA_V3_KILL_SWITCH_DB_GUARD_CONTENT_RANGE_REGEX_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_GUARD_CONTENT_RANGE_REGEX_FIX_V1_REVIEW",

      patchedFiles:
        patched,

      checks,
      failed,

      diagnosis: {
        rootCause:
          "SECOND_NESTED_TEMPLATE_REGEX_OVER_ESCAPED",

        invalidGeneratedSource:
          "/\\\\/(\\\\d+|\\\\*)$/",

        validGeneratedSource:
          "/\\/(\\d+|\\*)$/"
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
          ? "RERUN_PREFLIGHT_DB_PUSH_AND_DB_VERIFY"
          : "REVIEW_CONTENT_RANGE_REGEX_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
