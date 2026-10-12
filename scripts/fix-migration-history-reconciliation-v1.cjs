const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
  "migration-history-reconciliation-v1"
);

const RENAMES = [
  {
    from: "063_alpha_v1_kis_investor_flow_daily.sql",
    to: "20261006_alpha_v1_kis_investor_flow_daily.sql",
  },
  {
    from: "064_committed_risk_reservation_v3.sql",
    to: "20261008000100_committed_risk_reservation_v3.sql",
  },
  {
    from: "065_committed_risk_concurrency_test_harness.sql",
    to: "20261008000200_committed_risk_concurrency_test_harness.sql",
  },
];

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_MIGRATION_HISTORY_RECONCILIATION_V1_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (!fs.existsSync(MIGRATIONS)) {
  fail("MIGRATIONS_DIRECTORY_NOT_FOUND");
  return;
}

const before = RENAMES.map(item => {
  const fromAbs = path.join(MIGRATIONS, item.from);
  const toAbs = path.join(MIGRATIONS, item.to);

  return {
    ...item,
    fromExists: fs.existsSync(fromAbs),
    toExists: fs.existsSync(toAbs),
    fromHash: fs.existsSync(fromAbs)
      ? sha256(fromAbs)
      : null,
    toHash: fs.existsSync(toAbs)
      ? sha256(toAbs)
      : null,
  };
});

const invalid = before.filter(
  row =>
    !row.fromExists ||
    row.toExists
);

if (invalid.length > 0) {
  fail(
    "PRE_RENAME_GUARD_BLOCKED",
    {
      before,
      rule:
        "Every legacy source must exist and every restored-version destination must be absent.",
    }
  );
  return;
}

fs.mkdirSync(
  BACKUP_DIR,
  { recursive: true }
);

for (const item of RENAMES) {
  const fromAbs = path.join(MIGRATIONS, item.from);
  const backupAbs = path.join(BACKUP_DIR, item.from);

  if (!fs.existsSync(backupAbs)) {
    fs.copyFileSync(
      fromAbs,
      backupAbs
    );
  }
}

for (const item of RENAMES) {
  const fromAbs = path.join(MIGRATIONS, item.from);
  const toAbs = path.join(MIGRATIONS, item.to);

  fs.renameSync(
    fromAbs,
    toAbs
  );
}

const after = RENAMES.map(item => {
  const fromAbs = path.join(MIGRATIONS, item.from);
  const toAbs = path.join(MIGRATIONS, item.to);
  const backupAbs = path.join(BACKUP_DIR, item.from);

  return {
    ...item,
    fromExists: fs.existsSync(fromAbs),
    toExists: fs.existsSync(toAbs),
    backupExists: fs.existsSync(backupAbs),
    toHash: fs.existsSync(toAbs)
      ? sha256(toAbs)
      : null,
    backupHash: fs.existsSync(backupAbs)
      ? sha256(backupAbs)
      : null,
  };
});

const checks = {
  legacy063Removed:
    !after[0].fromExists,

  restored20261006Exists:
    after[0].toExists,

  legacy064Removed:
    !after[1].fromExists,

  restored20261008000100Exists:
    after[1].toExists,

  legacy065Removed:
    !after[2].fromExists,

  restored20261008000200Exists:
    after[2].toExists,

  backupsExist:
    after.every(row => row.backupExists),

  contentPreserved:
    after.every((row, index) =>
      row.toHash === before[index].fromHash &&
      row.backupHash === before[index].fromHash
    ),

  costMigrationUntouched:
    fs.existsSync(
      path.join(
        MIGRATIONS,
        "20261010000100_paper_execution_cost_attribution_v1.sql"
      )
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

if (failed.length > 0) {
  fail(
    "POST_RENAME_VERIFY_FAILED",
    {
      before,
      after,
      checks,
      failed,
    }
  );
  return;
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_MIGRATION_HISTORY_RECONCILIATION_V1_RENAMED",

      rationale: {
        "063":
          "Remote object exists while remote history contains 20261006.",
        "064":
          "Reserved-risk production schema exists while remote history contains 20261008000100.",
        "065":
          "Remote history contains 20261008000200 for the same test-harness lineage; do not reapply a test harness merely because its RPC is no longer exposed.",
      },

      renames: after.map(row => ({
        from: row.from,
        to: row.to,
        sha256: row.toHash,
        backup:
          path
            .relative(ROOT, path.join(BACKUP_DIR, row.from))
            .replaceAll("\\", "/"),
      })),

      checks,

      safety: {
        localFilesRenamed: 3,
        sqlContentModified: false,
        databaseReads: 0,
        databaseWrites: 0,
        migrationsApplied: 0,
        migrationHistoryRemoteChanged: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      failed: [],

      nextGate:
        "RUN_SUPABASE_MIGRATION_LIST_AND_REQUIRE_ONLY_20261010000100_LOCAL_ONLY",
    },
    null,
    2
  )
);

process.exitCode = 0;
