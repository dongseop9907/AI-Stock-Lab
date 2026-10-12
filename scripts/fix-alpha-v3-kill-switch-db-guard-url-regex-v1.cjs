const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-preflight.cjs",
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-db-verify.cjs",
  "scripts/install-alpha-v3-kill-switch-db-create-fill-guards-v1.cjs"
];

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

const results = [];

for (const rel of targets) {
  const before =
    read(rel);

  let after =
    before;

  /*
   * Generated runtime scripts currently contain:
   *   .replace(/\\/+$/, "");
   *
   * which is invalid JavaScript because the regex closes
   * too early. The runtime source must be:
   *   .replace(/\/+$/, "");
   *
   * The installer itself needs one extra escaping layer so
   * future regeneration produces the valid runtime form.
   */
  if (
    rel.endsWith(
      "install-alpha-v3-kill-switch-db-create-fill-guards-v1.cjs"
    )
  ) {
    after =
      after.replaceAll(
        String.raw`.replace(/\\\\/+$/, "");`,
        String.raw`.replace(/\\/+$/, "");`
      );

    /*
     * Defensive variants in case the file was formatted with
     * single quotes or slightly different escaping.
     */
    after =
      after.replaceAll(
        String.raw`.replace(/\\\\/+$/, '');`,
        String.raw`.replace(/\\/+$/, '');`
      );
  } else {
    after =
      after.replaceAll(
        String.raw`.replace(/\\/+$/, "");`,
        String.raw`.replace(/\/+$/, "");`
      );

    after =
      after.replaceAll(
        String.raw`.replace(/\\/+$/, '');`,
        String.raw`.replace(/\/+$/, '');`
      );
  }

  write(rel, after);

  results.push({
    file: rel,
    changed:
      after !== before,

    invalidRuntimeRegexPresent:
      rel.includes(
        "preflight"
      ) ||
      rel.includes(
        "db-verify"
      )
        ? after.includes(
            String.raw`.replace(/\\/+$/,`
          )
        : null,

    validRuntimeRegexPresent:
      rel.includes(
        "preflight"
      ) ||
      rel.includes(
        "db-verify"
      )
        ? after.includes(
            String.raw`.replace(/\/+$/,`
          )
        : null,

    installerFutureGenerationFixed:
      rel.includes(
        "install-alpha-v3-kill-switch-db-create-fill-guards-v1.cjs"
      )
        ? after.includes(
            String.raw`.replace(/\\/+$/,`
          )
        : null
  });
}

const preflight =
  read(
    "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-preflight.cjs"
  );

const dbVerify =
  read(
    "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-db-verify.cjs"
  );

const installer =
  read(
    "scripts/install-alpha-v3-kill-switch-db-create-fill-guards-v1.cjs"
  );

const checks = {
  preflightValidRegex:
    preflight.includes(
      String.raw`.replace(/\/+$/,`
    ),

  preflightInvalidRegexAbsent:
    !preflight.includes(
      String.raw`.replace(/\\/+$/,`
    ),

  dbVerifyValidRegex:
    dbVerify.includes(
      String.raw`.replace(/\/+$/,`
    ),

  dbVerifyInvalidRegexAbsent:
    !dbVerify.includes(
      String.raw`.replace(/\\/+$/,`
    ),

  installerRegenerationEscapingFixed:
    installer.includes(
      String.raw`.replace(/\\/+$/,`
    ),

  allTargetsPresent:
    results.length === 3
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
          ? "ALPHA_V3_KILL_SWITCH_DB_GUARD_URL_REGEX_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_GUARD_URL_REGEX_FIX_V1_REVIEW",

      patchedFiles:
        results,

      checks,
      failed,

      diagnosis: {
        rootCause:
          "NESTED_TEMPLATE_REGEX_OVER_ESCAPED",

        invalidGeneratedSource:
          '.replace(/\\\\/+$/, "")',

        validGeneratedSource:
          '.replace(/\\/+$/, "")'
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
          : "REVIEW_REGEX_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
