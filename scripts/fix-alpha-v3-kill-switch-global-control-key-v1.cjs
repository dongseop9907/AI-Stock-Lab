const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008001500_kill_switch_db_latch_audit_foundation_v1.sql";

const preflightRel =
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-preflight.cjs";

const dbVerifyRel =
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-db-verify.cjs";

const staticVerifyRel =
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-static-verify.cjs";

for (const rel of [
  migrationRel,
  preflightRel,
  dbVerifyRel,
  staticVerifyRel
]) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `TARGET_NOT_FOUND ${rel}`
    );
  }
}

const migrationFile =
  path.resolve(root, migrationRel);

let migration =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const beforeMigration =
  migration;

/*
 * 1) Foundation precondition:
 *    전체 row count=1 가정 대신 canonical global row 존재를 검증한다.
 */
migration =
  migration.replace(
    /select count\(\*\)\s+into v_count\s+from public\.trading_system_controls;\s+if v_count <> 1 then\s+raise exception[\s\S]*?end if;/m,
    `select count(*)
  into v_count
  from public.trading_system_controls
  where control_key = 'global';

  if v_count <> 1 then
    raise exception
      using
        errcode = '23514',
        message = format(
          'KILL_SWITCH_FOUNDATION_REJECTED expected_global_control_row actual=%s',
          v_count
        );
  end if;`
  );

/*
 * 2) Audit event identity: new.id -> new.control_key
 */
migration =
  migration.replaceAll(
    "new.id::text",
    "new.control_key::text"
  );

/*
 * 3) Trip/reset/status RPC row loading:
 *    order by id / generic first-row -> control_key='global'
 */
migration =
  migration.replaceAll(
    `from public.trading_system_controls
  order by id
  limit 1
  for update;`,
    `from public.trading_system_controls
  where control_key = 'global'
  for update;`
  );

migration =
  migration.replaceAll(
    `from public.trading_system_controls
  order by id
  limit 1;`,
    `from public.trading_system_controls
  where control_key = 'global';`
  );

/*
 * 4) Updates: v_control.id -> canonical global control_key.
 */
migration =
  migration.replaceAll(
    "where id = v_control.id;",
    "where control_key = 'global';"
  );

/*
 * 5) Status RPC identity.
 */
migration =
  migration.replaceAll(
    "v_control.id::text",
    "v_control.control_key::text"
  );

fs.writeFileSync(
  migrationFile,
  migration,
  "utf8"
);

/*
 * Preflight: select id -> control_key, no order=id.
 */
const preflightFile =
  path.resolve(root, preflightRel);

let preflight =
  fs.readFileSync(
    preflightFile,
    "utf8"
  );

preflight =
  preflight
    .replaceAll(
      "?select=id,emergency_stop&order=id.asc",
      "?select=control_key,emergency_stop&control_key=eq.global&limit=1"
    )
    .replaceAll(
      "String(payload[0].id)",
      "String(payload[0].control_key)"
    );

fs.writeFileSync(
  preflightFile,
  preflight,
  "utf8"
);

/*
 * DB verifier already compares the status RPC's controlId to the captured
 * baseline. No direct DB id query is required, but normalize any stale
 * literal references defensively.
 */
const dbVerifyFile =
  path.resolve(root, dbVerifyRel);

let dbVerify =
  fs.readFileSync(
    dbVerifyFile,
    "utf8"
  );

dbVerify =
  dbVerify
    .replaceAll(
      "trading_system_control",
      "trading_system_controls"
    );

fs.writeFileSync(
  dbVerifyFile,
  dbVerify,
  "utf8"
);

/*
 * Strengthen static verifier so future regressions back to id are caught.
 */
const staticFile =
  path.resolve(root, staticVerifyRel);

let staticText =
  fs.readFileSync(
    staticFile,
    "utf8"
  );

if (
  !staticText.includes(
    "canonicalGlobalControlKey"
  )
) {
  staticText =
    staticText.replace(
      "const checks = {",
      `const checks = {
  canonicalGlobalControlKey:
    text.includes("control_key = 'global'"),

  noTradingControlIdDependency:
    !/v_control\\.id\\b|new\\.id::text|where\\s+id\\s*=\\s*v_control\\.id|order\\s+by\\s+id/im.test(
      text
    ),`
    );
}

fs.writeFileSync(
  staticFile,
  staticText,
  "utf8"
);

const finalMigration =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const finalPreflight =
  fs.readFileSync(
    preflightFile,
    "utf8"
  );

const checks = {
  migrationChanged:
    finalMigration !==
      beforeMigration,

  usesPluralTable:
    finalMigration.includes(
      "public.trading_system_controls"
    ),

  canonicalGlobalControlKey:
    finalMigration.includes(
      "control_key = 'global'"
    ),

  noControlIdDependency:
    !/v_control\.id\b|new\.id::text|where\s+id\s*=\s*v_control\.id|order\s+by\s+id/im.test(
      finalMigration
    ),

  auditUsesControlKey:
    finalMigration.includes(
      "new.control_key::text"
    ),

  statusUsesControlKey:
    finalMigration.includes(
      "v_control.control_key::text"
    ),

  preflightSelectsControlKey:
    finalPreflight.includes(
      "select=control_key,emergency_stop"
    ),

  preflightFiltersGlobal:
    finalPreflight.includes(
      "control_key=eq.global"
    ),

  migrationVersionUnchanged:
    path
      .basename(migrationFile)
      .startsWith(
        "20261008001500_"
      ),

  noDatabaseActionPerformed:
    true
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_GLOBAL_CONTROL_KEY_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_GLOBAL_CONTROL_KEY_FIX_V1_REVIEW",

      schema: {
        table:
          "trading_system_controls",

        primaryKey:
          "control_key",

        canonicalControlKey:
          "global"
      },

      patchedFiles: [
        migrationRel,
        preflightRel,
        dbVerifyRel,
        staticVerifyRel
      ],

      checks,
      failed,

      behavior: {
        foundationTargetsGlobalOnly:
          true,

        migrationChangesEmergencyStop:
          false,

        migrationVersion:
          "20261008001500"
      },

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_PREFLIGHT_DB_PUSH_AND_DB_VERIFY"
          : "REVIEW_GLOBAL_CONTROL_KEY_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
