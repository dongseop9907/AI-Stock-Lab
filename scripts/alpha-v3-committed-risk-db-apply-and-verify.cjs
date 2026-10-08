const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const npxCli =
  path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npx-cli.js"
  );

const targetMigration =
  "20261008000100_committed_risk_reservation_v3.sql";

const targetVersion =
  "20261008000100";

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-db-apply-and-verify.json"
  );

const generatedTypesFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-postapply-types.ts"
  );

const requiredColumns = [
  "reserved_risk_amount",
  "reserved_risk_at",
  "reserved_risk_released_at",
  "reserved_risk_release_reason",
  "committed_risk_reason",
  "committed_risk_snapshot",
];

const requiredFunctions = [
  "create_paper_buy_order_with_committed_risk_v3",
  "release_paper_buy_risk_v3",
];

function quoteCmdArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:\\=-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function runCmd(executable, args, timeout = 240000) {
  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "C:\\Windows\\System32\\cmd.exe";

  const command = [
    quoteCmdArg(executable),
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

function runNodeNpx(args, timeout = 240000) {
  if (!fs.existsSync(npxCli)) {
    throw new Error(
      `NPX_CLI_JS_NOT_FOUND:${npxCli}`
    );
  }

  return spawnSync(
    process.execPath,
    [
      npxCli,
      ...args,
    ],
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

function tail(value, count = 35) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

function extractSqlFiles(text) {
  return [
    ...new Set(
      (
        String(text ?? "").match(
          /\b\d{3,14}_[A-Za-z0-9_.-]+\.sql\b/g
        ) ?? []
      )
    ),
  ].sort();
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

    const pickVersion = (value) => {
      const m = String(value)
        .replace(/`/g, "")
        .match(/\b\d{3,14}\b/);

      return m ? m[0] : null;
    };

    const local = pickVersion(parts[0]);
    const remote = pickVersion(parts[1]);

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

function extractTableSection(typesText, tableName) {
  const escaped =
    tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const start =
    new RegExp(
      `^\\s{6}${escaped}:\\s*\\{`,
      "m"
    ).exec(typesText);

  if (!start) {
    return null;
  }

  const after =
    typesText.slice(
      start.index + start[0].length
    );

  const next =
    /^\s{6}[A-Za-z_][A-Za-z0-9_]*:\s*\{/m.exec(after);

  return next
    ? after.slice(0, next.index)
    : after;
}

function extractFunctionNames(typesText) {
  const functionsStart =
    /^\s{4}Functions:\s*\{/m.exec(typesText);

  if (!functionsStart) {
    return [];
  }

  const after =
    typesText.slice(
      functionsStart.index +
      functionsStart[0].length
    );

  const end =
    /^\s{4}(Enums|CompositeTypes):\s*\{/m.exec(after);

  const body =
    end
      ? after.slice(0, end.index)
      : after;

  return [
    ...new Set(
      [
        ...body.matchAll(
          /^\s{6}([A-Za-z_][A-Za-z0-9_]*):/gm
        ),
      ].map(
        (m) =>
          m[1]
      )
    ),
  ];
}

function runAtomicVerifier() {
  const result =
    runNodeNpx(
      [
        "tsx",
        "--env-file=.env.local",
        "./scripts/alpha-v3-committed-risk-atomic-integration-verify.ts",
      ],
      180000
    );

  const combined =
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  return {
    exitCode:
      result.status,

    passed:
      result.status === 0 &&
      combined.includes(
        "ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFIED"
      ),

    outputTail:
      tail(
        combined,
        35
      ),
  };
}

if (!fs.existsSync(cli)) {
  throw new Error("LOCAL_SUPABASE_CLI_NOT_FOUND");
}

fs.mkdirSync(
  path.dirname(reportFile),
  {
    recursive: true,
  }
);

/*
 * Gate 1: static integration must still pass.
 */
const atomic =
  runAtomicVerifier();

if (!atomic.passed) {
  const report = {
    status:
      "ALPHA_V3_COMMITTED_RISK_DB_APPLY_BLOCKED_ATOMIC_VERIFY",

    atomic,

    databaseWrites:
      0,

    nextGate:
      "FIX_ATOMIC_VERIFY_BEFORE_DB_APPLY",
  };

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
 * Gate 2: one final dry-run, requiring exactly our target.
 */
const preDry =
  runCmd(
    cli,
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
  extractSqlFiles(
    preDryCombined
  );

const preflightSafe =
  preDry.status === 0 &&
  prePending.length === 1 &&
  prePending[0] === targetMigration;

if (!preflightSafe) {
  const report = {
    status:
      "ALPHA_V3_COMMITTED_RISK_DB_APPLY_BLOCKED_DRY_RUN",

    atomic,

    preDryRun: {
      exitCode:
        preDry.status,

      pendingSqlFiles:
        prePending,

      outputTail:
        tail(
          preDryCombined,
          35
        ),
    },

    databaseWrites:
      0,

    nextGate:
      "REVIEW_PENDING_MIGRATIONS_BEFORE_DB_APPLY",
  };

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
 * REAL DB WRITE.
 * Supabase db push applies only the single pending migration verified above.
 */
const push =
  runCmd(
    cli,
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
      "ALPHA_V3_COMMITTED_RISK_DB_APPLY_FAILED",

    atomic,

    preDryRun: {
      pendingSqlFiles:
        prePending,
    },

    push: {
      exitCode:
        push.status,

      stdoutTail:
        tail(
          push.stdout,
          30
        ),

      stderrTail:
        tail(
          push.stderr,
          30
        ),
    },

    safety: {
      databaseWriteAttempted:
        true,

      applyMayHaveRolledBack:
        true,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      "INSPECT_MIGRATION_HISTORY_AFTER_PUSH_FAILURE",
  };

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
 * Post-apply history verification.
 */
const migrationList =
  runCmd(
    cli,
    [
      "migration",
      "list",
      "--linked",
    ],
    180000
  );

const migrationListCombined =
  `${migrationList.stdout ?? ""}\n${migrationList.stderr ?? ""}`;

const migrationRows =
  parseMigrationRows(
    migrationListCombined
  );

const targetHistoryRow =
  migrationRows.find(
    (row) =>
      row.local === targetVersion ||
      row.remote === targetVersion
  ) ?? null;

const targetHistoryApplied =
  Boolean(
    targetHistoryRow &&
    targetHistoryRow.local === targetVersion &&
    targetHistoryRow.remote === targetVersion
  );

/*
 * Post-apply remote schema API verification.
 */
const types =
  runCmd(
    cli,
    [
      "gen",
      "types",
      "typescript",
      "--linked",
      "--schema",
      "public",
    ],
    180000
  );

const typesText =
  String(
    types.stdout ?? ""
  );

if (
  types.status === 0 &&
  typesText
) {
  fs.writeFileSync(
    generatedTypesFile,
    typesText,
    "utf8"
  );
}

const orderSection =
  types.status === 0
    ? extractTableSection(
        typesText,
        "paper_order_requests"
      )
    : null;

const columnChecks =
  Object.fromEntries(
    requiredColumns.map(
      (column) => [
        column,
        Boolean(
          orderSection &&
          new RegExp(
            `^\\s{10}${column}:`,
            "m"
          ).test(
            orderSection
          )
        ),
      ]
    )
  );

const allColumnsPresent =
  Object.values(
    columnChecks
  ).every(Boolean);

const functionNames =
  types.status === 0
    ? extractFunctionNames(
        typesText
      )
    : [];

const functionChecks =
  Object.fromEntries(
    requiredFunctions.map(
      (name) => [
        name,
        functionNames.includes(
          name
        ),
      ]
    )
  );

const allFunctionsPresent =
  Object.values(
    functionChecks
  ).every(Boolean);

/*
 * Post-apply dry-run should be empty/up to date.
 */
const postDry =
  runCmd(
    cli,
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
  extractSqlFiles(
    postDryCombined
  );

const noPendingMigrations =
  postDry.status === 0 &&
  postPending.length === 0;

const verified =
  targetHistoryApplied &&
  types.status === 0 &&
  allColumnsPresent &&
  allFunctionsPresent &&
  noPendingMigrations;

const report = {
  status:
    verified
      ? "ALPHA_V3_COMMITTED_RISK_DB_APPLY_AND_VERIFY_COMPLETE"
      : "ALPHA_V3_COMMITTED_RISK_DB_APPLY_POSTCHECK_REVIEW",

  atomic,

  preDryRun: {
    exitCode:
      preDry.status,

    pendingSqlFiles:
      prePending,

    onlyTargetPending:
      preflightSafe,
  },

  push: {
    exitCode:
      push.status,

    outputTail:
      tail(
        pushCombined,
        35
      ),

    migrationApplied:
      push.status === 0,
  },

  postApply: {
    targetHistoryApplied,
    targetHistoryRow,

    typesGenerated:
      types.status === 0,

    columnChecks,
    allColumnsPresent,

    functionChecks,
    allFunctionsPresent,

    postDryRunExitCode:
      postDry.status,

    pendingSqlFiles:
      postPending,

    noPendingMigrations,
  },

  decision: {
    databaseApplied:
      push.status === 0,

    schemaVerified:
      verified,

    productionPolicyChanged:
      false,

    nextGate:
      verified
        ? "BUILD_SAFE_DB_CONCURRENCY_TEST"
        : "REVIEW_POSTAPPLY_SCHEMA_CHECKS",
  },

  safety: {
    databaseWriteOccurred:
      push.status === 0,

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

  files: {
    generatedTypes:
      "logs/alpha-v3-committed-risk-postapply-types.ts",

    report:
      "logs/alpha-v3-committed-risk-db-apply-and-verify.json",
  },
};

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

      atomicStaticVerifyPassed:
        report.atomic.passed,

      prePendingSqlFiles:
        report.preDryRun.pendingSqlFiles,

      migrationApplied:
        report.push.migrationApplied,

      targetHistoryApplied:
        report.postApply.targetHistoryApplied,

      columnChecks:
        report.postApply.columnChecks,

      functionChecks:
        report.postApply.functionChecks,

      noPendingMigrations:
        report.postApply.noPendingMigrations,

      databaseApplied:
        report.decision.databaseApplied,

      schemaVerified:
        report.decision.schemaVerified,

      ordersCreated:
        0,

      positionsChanged:
        0,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.files.report,
    },
    null,
    2
  )
);

if (!verified) {
  process.exitCode = 2;
}
