const fs = require("fs");
const path = require("path");

const root = process.cwd();

const verifierRel =
  "scripts/alpha-v3-fill-lock-order-hardening-verify.cjs";

const verifierFile =
  path.resolve(
    root,
    verifierRel
  );

const backupFile =
  path.resolve(
    root,
    "scripts/alpha-v3-fill-lock-order-hardening-verify.cjs.before-verifier-v2.bak"
  );

if (!fs.existsSync(verifierFile)) {
  throw new Error(
    `VERIFIER_NOT_FOUND:${verifierRel}`
  );
}

let text =
  fs.readFileSync(
    verifierFile,
    "utf8"
  );

if (!fs.existsSync(backupFile)) {
  fs.copyFileSync(
    verifierFile,
    backupFile
  );
}

/*
 * V1 stored productionPolicyChanged:false inside `checks`,
 * while failed[] was computed by requiring every check to equal true.
 * Replace it with the positive invariant `noProductionPolicyChange:true`.
 */
if (
  text.includes(
    "productionPolicyChanged:\n    false,"
  )
) {
  text =
    text.replace(
      "productionPolicyChanged:\n    false,",
      "noProductionPolicyChange:\n    true,"
    );
}

if (
  text.includes(
    "productionPolicyChanged: false,"
  )
) {
  text =
    text.replace(
      "productionPolicyChanged: false,",
      "noProductionPolicyChange: true,"
    );
}

if (
  /\bproductionPolicyChanged\s*:\s*false\b/.test(
    text
  )
) {
  throw new Error(
    "OLD_NEGATIVE_CHECK_STILL_PRESENT"
  );
}

if (
  !/\bnoProductionPolicyChange\s*:\s*true\b/.test(
    text
  )
) {
  throw new Error(
    "POSITIVE_POLICY_INVARIANT_NOT_INSTALLED"
  );
}

fs.writeFileSync(
  verifierFile,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FILL_LOCK_ORDER_HARDENING_VERIFIER_V2_INSTALLED",

      patchedFile:
        verifierRel,

      backupFile:
        "scripts/alpha-v3-fill-lock-order-hardening-verify.cjs.before-verifier-v2.bak",

      fix:
        "NEGATIVE_POLICY_FLAG_REPLACED_WITH_POSITIVE_INVARIANT",

      migrationChanged:
        false,

      databaseWrites:
        0,

      nextAction:
        "RERUN_FILL_LOCK_ORDER_HARDENING_VERIFY"
    },
    null,
    2
  )
);
