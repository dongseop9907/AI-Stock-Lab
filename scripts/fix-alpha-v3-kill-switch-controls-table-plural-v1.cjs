const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "supabase/migrations/20261008001500_kill_switch_db_latch_audit_foundation_v1.sql",
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-static-verify.cjs",
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-preflight.cjs",
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-db-verify.cjs"
];

const changed = [];
const skipped = [];

for (const rel of targets) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `TARGET_NOT_FOUND ${rel}`
    );
  }

  const before =
    fs.readFileSync(
      file,
      "utf8"
    );

  const after =
    before
      .replaceAll(
        "public.trading_system_control",
        "public.trading_system_controls"
      )
      .replaceAll(
        "/rest/v1/trading_system_control",
        "/rest/v1/trading_system_controls"
      );

  if (after !== before) {
    fs.writeFileSync(
      file,
      after,
      "utf8"
    );

    changed.push(rel);
  } else {
    skipped.push(rel);
  }
}

const migrationFile = path.resolve(
  root,
  targets[0]
);

const migrationText =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const checks = {
  pluralTableReferenced:
    migrationText.includes(
      "public.trading_system_controls"
    ),

  singularQualifiedTableAbsent:
    !migrationText.includes(
      "public.trading_system_control "
    ) &&
    !migrationText.includes(
      "public.trading_system_control\n"
    ) &&
    !migrationText.includes(
      "public.trading_system_control;"
    ),

  migrationVersionUnchanged:
    path.basename(
      migrationFile
    ).startsWith(
      "20261008001500_"
    ),

  noDbActionPerformed:
    true
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) => !value
    )
    .map(
      ([key]) => key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_CONTROLS_TABLE_PLURAL_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTROLS_TABLE_PLURAL_FIX_V1_REVIEW",

      changedFiles: changed,
      unchangedFiles: skipped,

      tableName: {
        incorrect:
          "trading_system_control",
        correct:
          "trading_system_controls"
      },

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
          : "REVIEW_PLURAL_TABLE_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
