const fs = require("fs");
const path = require("path");

const root = process.cwd();

const oldRel =
  "supabase/migrations/20261008001200_order_state_machine_audit_guard_v1.sql";

const newRel =
  "supabase/migrations/20261008001300_order_state_machine_audit_guard_v1.sql";

const verifyRel =
  "scripts/alpha-v3-db-order-transition-audit-guard-v1-static-verify.cjs";

const oldFile =
  path.resolve(root, oldRel);

const newFile =
  path.resolve(root, newRel);

const verifyFile =
  path.resolve(root, verifyRel);

if (
  !fs.existsSync(oldFile) &&
  !fs.existsSync(newFile)
) {
  throw new Error(
    "ORDER_STATE_AUDIT_MIGRATION_NOT_FOUND"
  );
}

if (
  fs.existsSync(oldFile) &&
  fs.existsSync(newFile)
) {
  const oldText =
    fs.readFileSync(oldFile, "utf8");

  const newText =
    fs.readFileSync(newFile, "utf8");

  if (oldText !== newText) {
    throw new Error(
      "OLD_AND_NEW_MIGRATION_BOTH_EXIST_WITH_DIFFERENT_CONTENT"
    );
  }

  fs.unlinkSync(oldFile);
} else if (
  fs.existsSync(oldFile)
) {
  fs.renameSync(
    oldFile,
    newFile
  );
}

if (
  !fs.existsSync(newFile)
) {
  throw new Error(
    "RENAMED_MIGRATION_NOT_FOUND"
  );
}

if (
  fs.existsSync(verifyFile)
) {
  let text =
    fs.readFileSync(
      verifyFile,
      "utf8"
    );

  text =
    text.replaceAll(
      "20261008001200_order_state_machine_audit_guard_v1.sql",
      "20261008001300_order_state_machine_audit_guard_v1.sql"
    );

  fs.writeFileSync(
    verifyFile,
    text,
    "utf8"
  );
}

const collisions = new Map();

const migrationDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

for (
  const name of
    fs.readdirSync(
      migrationDir
    )
) {
  const match =
    name.match(
      /^(\d+)_/
    );

  if (!match) {
    continue;
  }

  const version =
    match[1];

  const items =
    collisions.get(
      version
    ) ?? [];

  items.push(name);

  collisions.set(
    version,
    items
  );
}

const duplicateVersions =
  [...collisions.entries()]
    .filter(
      ([, names]) =>
        names.length > 1
    )
    .map(
      ([version, names]) => ({
        version,
        names
      })
    );

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ORDER_STATE_MIGRATION_VERSION_COLLISION_FIXED",

      renamed: {
        from:
          oldRel,
        to:
          newRel
      },

      verifierPatched:
        fs.existsSync(
          verifyFile
        ),

      duplicateVersions,

      expectedExisting01200:
        "20261008001200_committed_risk_expiry_reconciliation_test_harness_cleanup.sql",

      newAuditVersion:
        "20261008001300",

      databaseWrites:
        0,

      nextAction:
        "STATIC_VERIFY_MIGRATION_LIST_PUSH_AND_DB_VERIFY"
    },
    null,
    2
  )
);

if (
  duplicateVersions.some(
    (item) =>
      item.version ===
        "20261008001200" ||
      item.version ===
        "20261008001300"
  )
) {
  process.exitCode =
    2;
}
