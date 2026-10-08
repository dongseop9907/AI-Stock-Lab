const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql";

const migrationFile =
  path.resolve(root, migrationRel);

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-final-preapply-gate.json"
  );

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const npxCmd =
  path.join(
    path.dirname(process.execPath),
    "npx.cmd"
  );

const atomicVerifyRel =
  "scripts/alpha-v3-committed-risk-atomic-integration-verify.ts";

const targetTypeFiles = [
  "lib/trading/committed-risk-reservation.ts",
  "lib/trading/paper-order-service.ts",
];

const rpcNames = [
  "create_paper_buy_order_with_committed_risk_v3",
  "release_paper_buy_risk_v3",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function tail(value, count = 30) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

function findFunctionHeader(sql, name) {
  const escaped = escapeRegex(name);

  const regex = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}\\s*\\([\\s\\S]*?\\)\\s*[\\s\\S]*?)(?=\\bas\\s+\\$[A-Za-z0-9_]*\\$)`,
    "i"
  );

  const match = regex.exec(sql);

  if (!match) {
    return null;
  }

  return {
    index: match.index,
    end: match.index + match[0].length,
    header: match[1],
  };
}

function normalizeSearchPath(sql, name) {
  const block = findFunctionHeader(sql, name);

  if (!block) {
    throw new Error(`FUNCTION_HEADER_NOT_FOUND:${name}`);
  }

  let header = block.header;

  if (!/\bsecurity\s+definer\b/i.test(header)) {
    throw new Error(`SECURITY_DEFINER_NOT_FOUND:${name}`);
  }

  // Remove every function-level search_path clause from the header.
  header = header.replace(
    /^\s*set\s+search_path\s*(?:=|to)\s*[^\r\n;]+;?\s*$/gim,
    ""
  );

  // Insert exactly one hardened search_path immediately after SECURITY DEFINER.
  header = header.replace(
    /\bsecurity\s+definer\b/i,
    "security definer\nset search_path = public, pg_temp"
  );

  // Avoid excessive blank lines caused by cleanup.
  header = header.replace(/\n{3,}/g, "\n\n");

  return (
    sql.slice(0, block.index) +
    header +
    sql.slice(block.end)
  );
}

function verifyRpcHeader(sql, name) {
  const block = findFunctionHeader(sql, name);

  if (!block) {
    return {
      found: false,
      securityDefiner: false,
      searchPathClauses: [],
      exactOneSecureSearchPath: false,
    };
  }

  const clauses = [
    ...block.header.matchAll(
      /^\s*set\s+search_path\s*(?:=|to)\s*([^\r\n;]+);?\s*$/gim
    ),
  ].map((match) =>
    match[1]
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );

  return {
    found: true,
    securityDefiner:
      /\bsecurity\s+definer\b/i.test(block.header),

    searchPathClauses: clauses,

    exactOneSecureSearchPath:
      clauses.length === 1 &&
      clauses[0] === "public, pg_temp",

    headerPreview:
      block.header
        .split(/\r?\n/)
        .slice(-14)
        .join("\n"),
  };
}

function verifyPrivileges(sql, name) {
  const escaped = escapeRegex(name);
  const fn = `public\\.${escaped}\\s*\\([^;]+\\)`;

  const test = (pattern) =>
    new RegExp(pattern, "i").test(sql);

  return {
    revokePublic:
      test(
        `revoke\\s+all\\s+on\\s+function\\s+${fn}\\s+from\\s+public`
      ),

    revokeAnon:
      test(
        `revoke\\s+all\\s+on\\s+function\\s+${fn}\\s+from\\s+anon`
      ),

    revokeAuthenticated:
      test(
        `revoke\\s+all\\s+on\\s+function\\s+${fn}\\s+from\\s+authenticated`
      ),

    grantServiceRole:
      test(
        `grant\\s+execute\\s+on\\s+function\\s+${fn}\\s+to\\s+service_role`
      ),

    dangerousGrant:
      test(
        `grant\\s+execute\\s+on\\s+function\\s+${fn}\\s+to\\s+(?:public|anon|authenticated)`
      ),
  };
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

if (!fs.existsSync(migrationFile)) {
  throw new Error(`MIGRATION_NOT_FOUND:${migrationRel}`);
}

let sql = fs.readFileSync(migrationFile, "utf8");

for (const name of rpcNames) {
  sql = normalizeSearchPath(sql, name);
}

fs.writeFileSync(migrationFile, sql, "utf8");

const security = Object.fromEntries(
  rpcNames.map((name) => [
    name,
    {
      header: verifyRpcHeader(sql, name),
      privileges: verifyPrivileges(sql, name),
    },
  ])
);

const securityVerified = rpcNames.every((name) => {
  const row = security[name];

  return (
    row.header.found &&
    row.header.securityDefiner &&
    row.header.exactOneSecureSearchPath &&
    row.privileges.revokePublic &&
    row.privileges.revokeAnon &&
    row.privileges.revokeAuthenticated &&
    row.privileges.grantServiceRole &&
    !row.privileges.dangerousGrant
  );
});

/*
 * Existing committed-risk static verifier.
 */
const atomicVerifyPath = path.resolve(root, atomicVerifyRel);

let atomic = {
  attempted: false,
  exitCode: null,
  passed: false,
  outputTail: null,
};

if (fs.existsSync(atomicVerifyPath)) {
  atomic.attempted = true;

  const result = runCmd(
    npxCmd,
    [
      "tsx",
      "--env-file=.env.local",
      `./${atomicVerifyRel.replace(/\\/g, "/")}`,
    ],
    180000
  );

  const combined =
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  atomic.exitCode = result.status;
  atomic.outputTail = tail(combined, 35);

  atomic.passed =
    result.status === 0 &&
    /ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFIED/.test(
      combined
    ) &&
    /"failed"\s*:\s*\[\s*\]/.test(combined) &&
    /"syntaxErrors"\s*:\s*\[\s*\]/.test(combined);
}

/*
 * Semantic TypeScript gate.
 * Full-project tsc may contain unrelated legacy errors; fail only if diagnostics
 * reference the two files changed by this integration.
 */
const tsc = runCmd(
  npxCmd,
  [
    "tsc",
    "--noEmit",
    "--pretty",
    "false",
  ],
  240000
);

const tscCombined =
  `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`;

const targetDiagnostics = tscCombined
  .split(/\r?\n/)
  .filter((line) =>
    targetTypeFiles.some((file) =>
      line
        .replace(/\\/g, "/")
        .toLowerCase()
        .includes(file.toLowerCase())
    )
  )
  .filter(Boolean);

const targetTypecheckPassed =
  targetDiagnostics.length === 0;

/*
 * Final remote dry run.
 */
if (!fs.existsSync(cli)) {
  throw new Error("LOCAL_SUPABASE_CLI_NOT_FOUND");
}

const dryRun = runCmd(
  cli,
  [
    "db",
    "push",
    "--dry-run",
    "--linked",
  ],
  180000
);

const dryRunCombined =
  `${dryRun.stdout ?? ""}\n${dryRun.stderr ?? ""}`;

const pendingSqlFiles =
  extractSqlFiles(dryRunCombined);

const onlyTargetPending =
  dryRun.status === 0 &&
  pendingSqlFiles.length === 1 &&
  pendingSqlFiles[0] ===
    "20261008000100_committed_risk_reservation_v3.sql";

const verified =
  securityVerified &&
  atomic.passed &&
  targetTypecheckPassed &&
  onlyTargetPending;

const report = {
  status: verified
    ? "ALPHA_V3_COMMITTED_RISK_FINAL_PREAPPLY_GATE_VERIFIED"
    : "ALPHA_V3_COMMITTED_RISK_FINAL_PREAPPLY_GATE_REVIEW",

  security: {
    verified: securityVerified,
    rpc: security,
  },

  atomicStaticVerify: atomic,

  typecheck: {
    fullTscExitCode: tsc.status,
    targetFiles: targetTypeFiles,
    targetDiagnostics,
    targetTypecheckPassed,
    note:
      "Full repo may contain unrelated legacy TypeScript diagnostics; this gate only fails on committed-risk target files.",
  },

  dryRun: {
    exitCode: dryRun.status,
    pendingSqlFiles,
    onlyTargetPending,
    outputTail: tail(dryRunCombined, 35),
  },

  decision: {
    readyForDatabaseApply: verified,
    nextGate: verified
      ? "APPLY_COMMITTED_RISK_MIGRATION"
      : "REVIEW_FAILED_PREAPPLY_CHECK",
  },

  safety: {
    migrationFilePatchedLocally: true,
    databaseWrites: 0,
    migrationHistoryChanged: false,
    migrationSqlApplied: 0,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-committed-risk-final-preapply-gate.json",
};

fs.mkdirSync(path.dirname(reportFile), {
  recursive: true,
});

fs.writeFileSync(
  reportFile,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: report.status,

      securityVerified:
        report.security.verified,

      security:
        Object.fromEntries(
          Object.entries(report.security.rpc).map(
            ([name, row]) => [
              name,
              {
                securityDefiner:
                  row.header.securityDefiner,

                searchPathClauses:
                  row.header.searchPathClauses,

                exactOneSecureSearchPath:
                  row.header.exactOneSecureSearchPath,

                revokePublic:
                  row.privileges.revokePublic,

                revokeAnon:
                  row.privileges.revokeAnon,

                revokeAuthenticated:
                  row.privileges.revokeAuthenticated,

                grantServiceRole:
                  row.privileges.grantServiceRole,

                dangerousGrant:
                  row.privileges.dangerousGrant,
              },
            ]
          )
        ),

      atomicStaticVerifyPassed:
        report.atomicStaticVerify.passed,

      targetTypecheckPassed:
        report.typecheck.targetTypecheckPassed,

      targetDiagnostics:
        report.typecheck.targetDiagnostics,

      pendingSqlFiles:
        report.dryRun.pendingSqlFiles,

      onlyTargetPending:
        report.dryRun.onlyTargetPending,

      readyForDatabaseApply:
        report.decision.readyForDatabaseApply,

      databaseWrites: 0,

      nextGate:
        report.decision.nextGate,

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
