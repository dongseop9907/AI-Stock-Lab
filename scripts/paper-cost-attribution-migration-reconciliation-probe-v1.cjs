const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const TARGET_VERSIONS = new Set([
  "063",
  "064",
  "065",
  "20261010000100",
]);

function sha256(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function migrationVersion(name) {
  const match =
    name.match(/^([^_]+)_/);

  return match
    ? match[1]
    : null;
}

const files =
  fs.existsSync(MIGRATIONS)
    ? fs.readdirSync(MIGRATIONS)
        .filter(name => name.endsWith(".sql"))
        .sort()
    : [];

const byVersion =
  new Map();

for (const name of files) {
  const version =
    migrationVersion(name);

  if (!version) {
    continue;
  }

  const list =
    byVersion.get(version) ?? [];

  list.push(name);
  byVersion.set(version, list);
}

const targetDetails = [];

for (const version of TARGET_VERSIONS) {
  const names =
    byVersion.get(version) ?? [];

  targetDetails.push({
    version,
    fileCount:
      names.length,
    files:
      names.map(name => {
        const abs =
          path.join(
            MIGRATIONS,
            name
          );

        const text =
          fs.readFileSync(
            abs,
            "utf8"
          );

        const lines =
          text.split(/\r?\n/);

        return {
          name,
          bytes:
            Buffer.byteLength(
              text,
              "utf8"
            ),
          sha256:
            sha256(text),
          firstNonEmptyLines:
            lines
              .map(line => line.trim())
              .filter(Boolean)
              .slice(0, 18),
          features: {
            createsTable:
              /\bcreate\s+table\b/i.test(text),
            altersTable:
              /\balter\s+table\b/i.test(text),
            createsFunction:
              /\bcreate\s+(?:or\s+replace\s+)?function\b/i.test(text),
            createsTrigger:
              /\bcreate\s+trigger\b/i.test(text),
            insertsData:
              /\binsert\s+into\b/i.test(text),
            updatesData:
              /\bupdate\s+\S+\s+set\b/i.test(text),
            deletesData:
              /\bdelete\s+from\b/i.test(text),
            paperTradingRelated:
              /paper_order_requests|paper_positions|paper_trade_history|paper_accounts/i.test(text),
            modelRelated:
              /model_|promotion|shadow|paper|live/i.test(text),
          },
        };
      }),
  });
}

const duplicateVersions =
  [...byVersion.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([version, names]) => ({
      version,
      files: names,
    }));

const nearby =
  files.filter(name => {
    const version =
      migrationVersion(name);

    return (
      version === "061" ||
      version === "062" ||
      version === "063" ||
      version === "064" ||
      version === "065" ||
      version === "066"
    );
  });

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_MIGRATION_RECONCILIATION_PROBE_V1_COMPLETE",

      purpose:
        "Identify local-only 063/064/065 and target 20261010000100 before any Supabase db push.",

      migrationDirectory:
        "supabase/migrations",

      localSqlFileCount:
        files.length,

      targetDetails,

      nearbyLegacySequence:
        nearby,

      duplicateVersions,

      observations: {
        targetCostMigrationPresent:
          (byVersion.get("20261010000100") ?? []).length === 1,

        localOnlyCandidatesToReconcile: [
          "063",
          "064",
          "065",
        ],

        remoteOnlyVersionsObservedFromPreviousMigrationList: [
          "20261006",
          "20261008000100",
          "20261008000200",
        ],

        dbPushAllowedNow:
          false,
      },

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        migrationsApplied:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      nextGate:
        "CLASSIFY_063_064_065_AS_REQUIRED_PENDING_OR_STALE_SUPERSEDED_MIGRATIONS",
    },
    null,
    2
  )
);

process.exitCode = 0;
