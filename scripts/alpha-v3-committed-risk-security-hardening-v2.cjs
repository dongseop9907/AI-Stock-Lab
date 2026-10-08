const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql";

const migrationFile =
  path.resolve(root, migrationRel);

const backupFile =
  path.resolve(
    root,
    "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql.before-security-hardening-v2.bak"
  );

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-security-hardening-v2.json"
  );

const rpcNames = [
  "create_paper_buy_order_with_committed_risk_v3",
  "release_paper_buy_risk_v3",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    fullMatch: match[0],
    header: match[1],
    index: match.index,
    end: match.index + match[0].length,
  };
}

function hardenOne(sql, name) {
  const block = findFunctionHeader(sql, name);

  if (!block) {
    throw new Error(`FUNCTION_HEADER_NOT_FOUND:${name}`);
  }

  let header = block.header;

  if (!/\bsecurity\s+definer\b/i.test(header)) {
    throw new Error(`SECURITY_DEFINER_NOT_FOUND:${name}`);
  }

  if (!/\bset\s+search_path\s*(?:=|to)\s*public\s*,\s*pg_temp\b/i.test(header)) {
    header = header.replace(
      /\bsecurity\s+definer\b/i,
      "security definer\nset search_path = public, pg_temp"
    );
  }

  return (
    sql.slice(0, block.index) +
    header +
    sql.slice(block.end)
  );
}

function verifyHeader(sql, name) {
  const block = findFunctionHeader(sql, name);

  if (!block) {
    return {
      found: false,
      securityDefiner: false,
      fixedSearchPath: false,
      headerPreview: null,
    };
  }

  return {
    found: true,
    securityDefiner:
      /\bsecurity\s+definer\b/i.test(block.header),

    fixedSearchPath:
      /\bset\s+search_path\s*(?:=|to)\s*public\s*,\s*pg_temp\b/i.test(
        block.header
      ),

    headerPreview:
      block.header
        .split(/\r?\n/)
        .slice(-12)
        .join("\n"),
  };
}

function verifyPrivileges(sql, name) {
  const escaped = escapeRegex(name);

  const functionPrefix =
    `public\\.${escaped}\\s*\\([^;]+\\)`;

  return {
    revokePublic:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+${functionPrefix}\\s+from\\s+public`,
        "i"
      ).test(sql),

    revokeAnon:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+${functionPrefix}\\s+from\\s+anon`,
        "i"
      ).test(sql),

    revokeAuthenticated:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+${functionPrefix}\\s+from\\s+authenticated`,
        "i"
      ).test(sql),

    grantServiceRole:
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${functionPrefix}\\s+to\\s+service_role`,
        "i"
      ).test(sql),

    dangerousGrant:
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${functionPrefix}\\s+to\\s+(?:public|anon|authenticated)`,
        "i"
      ).test(sql),
  };
}

if (!fs.existsSync(migrationFile)) {
  throw new Error(`MIGRATION_NOT_FOUND:${migrationRel}`);
}

if (!fs.existsSync(backupFile)) {
  fs.copyFileSync(migrationFile, backupFile);
}

let sql = fs.readFileSync(migrationFile, "utf8");

const before = Object.fromEntries(
  rpcNames.map((name) => [
    name,
    {
      header: verifyHeader(sql, name),
      privileges: verifyPrivileges(sql, name),
    },
  ])
);

for (const name of rpcNames) {
  sql = hardenOne(sql, name);
}

fs.writeFileSync(migrationFile, sql, "utf8");

const after = Object.fromEntries(
  rpcNames.map((name) => [
    name,
    {
      header: verifyHeader(sql, name),
      privileges: verifyPrivileges(sql, name),
    },
  ])
);

const allSafe = rpcNames.every((name) => {
  const row = after[name];

  return (
    row.header.found &&
    row.header.securityDefiner &&
    row.header.fixedSearchPath &&
    row.privileges.revokePublic &&
    row.privileges.revokeAnon &&
    row.privileges.revokeAuthenticated &&
    row.privileges.grantServiceRole &&
    !row.privileges.dangerousGrant
  );
});

const report = {
  status: allSafe
    ? "ALPHA_V3_COMMITTED_RISK_SECURITY_HARDENING_V2_VERIFIED"
    : "ALPHA_V3_COMMITTED_RISK_SECURITY_HARDENING_V2_REVIEW",

  before,
  after,

  migrationPatched:
    fs.readFileSync(migrationFile, "utf8") !==
    fs.readFileSync(backupFile, "utf8"),

  databaseWrites: 0,

  nextGate: allSafe
    ? "RERUN_ATOMIC_STATIC_VERIFY_AND_FINAL_DRY_RUN"
    : "REVIEW_FUNCTION_HEADERS_BEFORE_DB_APPLY",

  outputFile:
    "logs/alpha-v3-committed-risk-security-hardening-v2.json",
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
      after: report.after,
      migrationPatched: report.migrationPatched,
      databaseWrites: 0,
      nextGate: report.nextGate,
      outputFile: report.outputFile,
    },
    null,
    2
  )
);

if (!allSafe) {
  process.exitCode = 2;
}
