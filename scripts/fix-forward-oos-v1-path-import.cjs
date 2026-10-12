const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_V1_PATH_IMPORT_REPAIR_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail(
    "TARGET_FILE_NOT_FOUND",
    {
      target:
        "scripts/true-forward-oos-first-session-orchestrator-v1.ts",
    }
  );
  return;
}

const before =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const usesPath =
  /\bpath\./.test(
    before
  );

const hasNodePathDefaultImport =
  /import\s+path\s+from\s+["']node:path["'];?/.test(
    before
  );

const hasNodePathNamespaceImport =
  /import\s+\*\s+as\s+path\s+from\s+["']node:path["'];?/.test(
    before
  );

const hasPathImport =
  hasNodePathDefaultImport ||
  hasNodePathNamespaceImport;

if (!usesPath) {
  fail(
    "PATH_IDENTIFIER_NOT_USED",
    {
      interpretation:
        "The reported TS2304 may refer to a different current source state.",
    }
  );
  return;
}

let after =
  before;

let changed =
  false;

if (!hasPathImport) {
  after =
    `import path from "node:path";\n` +
    before;

  changed =
    true;
}

const afterHasPathImport =
  /import\s+path\s+from\s+["']node:path["'];?/.test(
    after
  ) ||
  /import\s+\*\s+as\s+path\s+from\s+["']node:path["'];?/.test(
    after
  );

if (!afterHasPathImport) {
  fail(
    "POST_REPAIR_PATH_IMPORT_MISSING"
  );
  return;
}

if (changed) {
  const backupDir =
    path.join(
      ROOT,
      "scripts",
      "backups",
      "forward-oos-v1-path-import-repair"
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true,
    }
  );

  const backup =
    path.join(
      backupDir,
      "true-forward-oos-first-session-orchestrator-v1.ts"
    );

  if (!fs.existsSync(backup)) {
    fs.writeFileSync(
      backup,
      before,
      "utf8"
    );
  }

  fs.writeFileSync(
    TARGET,
    after,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_V1_PATH_IMPORT_REPAIRED",

      target:
        "scripts/true-forward-oos-first-session-orchestrator-v1.ts",

      diagnosis: {
        usesPath,
        hadPathImportBefore:
          hasPathImport,
        hasPathImportAfter:
          afterHasPathImport,
        sourceChanged:
          changed,
      },

      action:
        changed
          ? 'Added import path from "node:path";'
          : "No source change required; path import already exists.",

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        forwardProducerExecuted:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        "RUN_FILE_TSC_AND_FULL_APP_TSC",
    },
    null,
    2
  )
);

process.exitCode = 0;
