const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const targetMigration =
  "20261008000400_execute_paper_buy_order_committed_risk_lock.sql";

const targetVersion =
  "20261008000400";

const verifierRel =
  "scripts/alpha-v3-fill-transition-shared-account-lock-verify.cjs";

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-fill-transition-lock-db-apply.json"
  );

function quoteCmdArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:\\=-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function runCli(args, timeout = 240000) {
  if (!fs.existsSync(cli)) {
    throw new Error("LOCAL_SUPABASE_CLI_NOT_FOUND");
  }

  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "C:\\Windows\\System32\\cmd.exe";

  const command = [
    quoteCmdArg(cli),
    ...args.map(quoteCmdArg),
  ].join(" ");

  return spawnSync(
    comspec,
    ["/d", "/s", "/c", command],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
}

function runNodeScript(rel, timeout = 120000) {
  return spawnSync(
    process.execPath,
    [
      path.resolve(root, rel),
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
    }
  );
}

function tail(value, count = 35) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

function extractPending(text) {
  const lines =
    String(text ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split(/\r?\n/);

  let inList = false;
  const files = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (/Would push these migrations:/i.test(line)) {
      inList = true;
      continue;
    }

    if (/Remote database is up to date/i.test(line)) {
      inList = false;
      continue;
    }

    if (!inList) {
      continue;
    }

    const match =
      line.match(
        /([0-9]{3,14}_[A-Za-z0-9_.-]+\.sql)\s*$/
      );

    if (match) {
      files.push(match[1]);
    }
  }

  return [...new Set(files)].sort();
}

function parseMigrationRows(text) {
  const rows = [];

  for (
    const raw
    of String(text ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
  ) {
    if (!raw.includes("|") && !raw.includes("│")) {
      continue;
    }

    const parts = raw.split(/[|│]/);

    if (parts.length < 2) {
      continue;
    }

    const pick = (value) => {
      const m =
        String(value)
          .replace(/`/g, "")
          .match(/\b\d{3,14}\b/);

      return m ? m[0] : null;
    };

    const local = pick(parts[0]);
    const remote = pick(parts[1]);

    if (local || remote) {
      rows.push({
        local,
        remote,
        raw: raw.trim(),
      });
    }
  }

  return rows;
}

/*
 * Gate 1: local static verifier must still pass.
 */
const verifier =
  runNodeScript(
    verifierRel
  );

const verifierCombined =
  `${verifier.stdout ?? ""}\n${verifier.stderr ?? ""}`;

const staticVerified =
  verifier.status === 0 &&
  verifierCombined.includes(
    "ALPHA_V3_FILL_TRANSITION_SHARED_ACCOUNT_LOCK_VERIFIED"
  ) &&
  /"failed"\s*:\s*\[\s*\]/.test(
    verifierCombined
  );

if (!staticVerified) {
  const report = {
    status:
      "ALPHA_V3_FILL_TRANSITION_LOCK_DB_APPLY_BLOCKED_STATIC_VERIFY",

    staticVerify: {
      exitCode:
        verifier.status,

      outputTail:
        tail(
          verifierCombined,
          40
        ),
    },

    databaseWrites:
      0,

    nextGate:
      "FIX_FILL_TRANSITION_STATIC_VERIFY",
  };

  fs.mkdirSync(
    path.dirname(reportFile),
    { recursive: true }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(report, null, 2)
  );

  process.exitCode = 2;
  return;
}

/*
 * Gate 2: exact single pending migration.
 */
const preDry =
  runCli(
    [
      "db",
      "push",
      "--dry-run",
      "--linked",
    ],
    180000
  );

const preDryCombined =
  `${preDry.stdout ?? ""}\n${preDry.stderr ?? ""}`;

const prePending =
  extractPending(
    preDryCombined
  );

const preflightSafe =
  preDry.status === 0 &&
  prePending.length === 1 &&
  prePending[0] === targetMigration;

if (!preflightSafe) {
  const report = {
    status:
      "ALPHA_V3_FILL_TRANSITION_LOCK_DB_APPLY_BLOCKED_DRY_RUN",

    staticVerified,

    preDryRun: {
      exitCode:
        preDry.status,

      pendingSqlFiles:
        prePending,

      outputTail:
        tail(
          preDryCombined,
          40
        ),
    },

    databaseWrites:
      0,

    nextGate:
      "REVIEW_PENDING_MIGRATIONS_BEFORE_FILL_LOCK_APPLY",
  };

  fs.mkdirSync(
    path.dirname(reportFile),
    { recursive: true }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(report, null, 2)
  );

  process.exitCode = 2;
  return;
}

/*
 * REAL DB WRITE: apply exactly the verified pending migration.
 */
const push =
  runCli(
    [
      "db",
      "push",
      "--linked",
      "--yes",
    ],
    240000
  );

const pushCombined =
  `${push.stdout ?? ""}\n${push.stderr ?? ""}`;

if (push.status !== 0) {
  const report = {
    status:
      "ALPHA_V3_FILL_TRANSITION_LOCK_DB_APPLY_FAILED",

    staticVerified,

    prePendingSqlFiles:
      prePending,

    push: {
      exitCode:
        push.status,

      outputTail:
        tail(
          pushCombined,
          40
        ),
    },

    databaseWriteAttempted:
      true,

    nextGate:
      "INSPECT_FILL_LOCK_MIGRATION_AFTER_PUSH_FAILURE",
  };

  fs.mkdirSync(
    path.dirname(reportFile),
    { recursive: true }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(report, null, 2)
  );

  process.exitCode = 2;
  return;
}

/*
 * Post-apply migration history.
 */
const migrationList =
  runCli(
    [
      "migration",
      "list",
      "--linked",
    ],
    180000
  );

const migrationListCombined =
  `${migrationList.stdout ?? ""}\n${migrationList.stderr ?? ""}`;

const rows =
  parseMigrationRows(
    migrationListCombined
  );

const targetRow =
  rows.find(
    (row) =>
      row.local === targetVersion ||
      row.remote === targetVersion
  ) ?? null;

const targetHistoryApplied =
  Boolean(
    targetRow &&
    targetRow.local === targetVersion &&
    targetRow.remote === targetVersion
  );

/*
 * Final dry-run: must be fully up to date.
 */
const postDry =
  runCli(
    [
      "db",
      "push",
      "--dry-run",
      "--linked",
    ],
    180000
  );

const postDryCombined =
  `${postDry.stdout ?? ""}\n${postDry.stderr ?? ""}`;

const postPending =
  extractPending(
    postDryCombined
  );

const remoteUpToDate =
  postDry.status === 0 &&
  postPending.length === 0 &&
  /Remote database is up to date/i.test(
    postDryCombined
  );

const verified =
  targetHistoryApplied &&
  remoteUpToDate;

const report = {
  status:
    verified
      ? "ALPHA_V3_FILL_TRANSITION_LOCK_DB_APPLY_VERIFIED"
      : "ALPHA_V3_FILL_TRANSITION_LOCK_DB_APPLY_POSTCHECK_REVIEW",

  staticVerified,

  preDryRun: {
    pendingSqlFiles:
      prePending,

    onlyTargetPending:
      preflightSafe,
  },

  push: {
    exitCode:
      push.status,

    migrationApplied:
      push.status === 0,

    outputTail:
      tail(
        pushCombined,
        30
      ),
  },

  postApply: {
    targetHistoryApplied,
    targetHistoryRow:
      targetRow,

    pendingSqlFiles:
      postPending,

    remoteDatabaseUpToDate:
      remoteUpToDate,

    migrationListTail:
      tail(
        migrationListCombined,
        20
      ),

    dryRunTail:
      tail(
        postDryCombined,
        20
      ),
  },

  contract: {
    lockKey:
      "AI_STOCK_LAB_COMMITTED_RISK_V3:<account_id>",

    reservationRpc:
      "create_paper_buy_order_with_committed_risk_v3",

    fillRpc:
      "execute_paper_buy_order",

    sharedTransactionLockApplied:
      verified,

    productionPolicyChanged:
      false,
  },

  decision: {
    databaseApplied:
      push.status === 0,

    verified,

    nextGate:
      verified
        ? "BUILD_ISOLATED_RESERVATION_TO_FILL_TRANSFER_TEST"
        : "REVIEW_FILL_LOCK_POSTAPPLY_STATE",
  },

  safety: {
    migrationSqlApplied:
      push.status === 0
        ? 1
        : 0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    tradingExecuted:
      false,
  },

  outputFile:
    "logs/alpha-v3-fill-transition-lock-db-apply.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  { recursive: true }
);

fs.writeFileSync(
  reportFile,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      staticVerified:
        report.staticVerified,

      prePendingSqlFiles:
        report.preDryRun
          .pendingSqlFiles,

      migrationApplied:
        report.push
          .migrationApplied,

      targetHistoryApplied:
        report.postApply
          .targetHistoryApplied,

      remoteDatabaseUpToDate:
        report.postApply
          .remoteDatabaseUpToDate,

      sharedTransactionLockApplied:
        report.contract
          .sharedTransactionLockApplied,

      databaseApplied:
        report.decision
          .databaseApplied,

      ordersCreated:
        0,

      positionsChanged:
        0,

      nextGate:
        report.decision
          .nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);

if (!verified) {
  process.exitCode = 2;
}
