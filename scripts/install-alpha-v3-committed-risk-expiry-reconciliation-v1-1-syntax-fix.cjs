const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targetRel =
  "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs";

const target =
  path.resolve(
    root,
    targetRel
  );

const backup =
  path.resolve(
    root,
    "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs.before-syntax-fix-v1-1.bak"
  );

if (!fs.existsSync(target)) {
  throw new Error(
    `TARGET_INSTALLER_NOT_FOUND:${targetRel}`
  );
}

let text =
  fs.readFileSync(
    target,
    "utf8"
  );

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    target,
    backup
  );
}

const bad =
  'name.replace(/[.*+?^${}()|[\\\\]\\\\\\\\]/g, "\\\\$&");';

const good =
  'name.replace(/[.*+?^$()|[\\\\]\\\\\\\\{}]/g, "\\\\$&");';

if (text.includes(bad)) {
  text =
    text.replace(
      bad,
      good
    );
} else {
  /*
   * Fallback targeted replacement in case escaping differs slightly.
   */
  const before =
    text;

  text =
    text.replace(
      /name\.replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g,\s*"\\\\\$&"\);/,
      'name.replace(/[.*+?^$()|[\\\\]\\\\\\\\{}]/g, "\\\\$&");'
    );

  if (text === before) {
    throw new Error(
      "SYNTAX_FIX_PATTERN_NOT_FOUND"
    );
  }
}

if (
  text.includes(
    '/[.*+?^${}()|[\\]\\\\]/g'
  )
) {
  throw new Error(
    "BAD_TEMPLATE_INTERPOLATION_PATTERN_STILL_PRESENT"
  );
}

fs.writeFileSync(
  target,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V1_1_SYNTAX_FIX_INSTALLED",

      patchedFile:
        targetRel,

      backupFile:
        "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs.before-syntax-fix-v1-1.bak",

      fix:
        "ESCAPE_REGEX_REWRITTEN_TO_AVOID_TEMPLATE_LITERAL_INTERPOLATION",

      databaseWrites:
        0,

      nextAction:
        "RERUN_EXPIRY_RECONCILIATION_INSTALLER"
    },
    null,
    2
  )
);
