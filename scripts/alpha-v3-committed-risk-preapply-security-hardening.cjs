const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql";

const migrationFile =
  path.resolve(
    root,
    migrationRel
  );

const backupFile =
  path.resolve(
    root,
    "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql.before-security-hardening-v1.bak"
  );

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-preapply-security-hardening.json"
  );

const rpcSpecs = [
  {
    name:
      "create_paper_buy_order_with_committed_risk_v3",

    signature:
      "public.create_paper_buy_order_with_committed_risk_v3(uuid,text,integer,numeric,numeric,uuid,boolean,numeric,numeric)",
  },

  {
    name:
      "release_paper_buy_risk_v3",

    signature:
      "public.release_paper_buy_risk_v3(uuid,text)",
  },
];

function walk(dir, maxDepth = 6, depth = 0) {
  if (
    depth > maxDepth ||
    !fs.existsSync(dir)
  ) {
    return [];
  }

  const result = [];

  for (
    const entry
    of fs.readdirSync(
      dir,
      {
        withFileTypes:
          true,
      }
    )
  ) {
    if (
      [
        "node_modules",
        ".git",
        ".next",
        "logs",
        "supabase",
      ].includes(
        entry.name
      )
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name
      );

    if (
      entry.isDirectory()
    ) {
      result.push(
        ...walk(
          full,
          maxDepth,
          depth + 1
        )
      );

      continue;
    }

    if (
      /\.(ts|tsx|js|cjs|mjs)$/i.test(
        entry.name
      )
    ) {
      result.push(
        full
      );
    }
  }

  return result;
}

function rel(file) {
  return path
    .relative(
      root,
      file
    )
    .replace(
      /\\/g,
      "/"
    );
}

function findServerClientDefinitions() {
  const files =
    walk(root);

  const hits = [];

  for (const file of files) {
    let text;

    try {
      text =
        fs.readFileSync(
          file,
          "utf8"
        );
    } catch {
      continue;
    }

    if (
      !text.includes(
        "createSupabaseServerClient"
      )
    ) {
      continue;
    }

    const defines =
      /(function|const|let|var)\s+createSupabaseServerClient\b|export\s+(?:async\s+)?function\s+createSupabaseServerClient\b/.test(
        text
      );

    const importsOnly =
      /import[\s\S]{0,250}\bcreateSupabaseServerClient\b/.test(
        text
      ) &&
      !defines;

    hits.push({
      file:
        rel(file),

      defines,

      importsOnly,

      serviceRoleKey:
        /SUPABASE_SERVICE_ROLE_KEY/.test(
          text
        ),

      anonKey:
        /NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY/.test(
          text
        ),

      createClient:
        /\bcreateClient\s*\(/.test(
          text
        ),
    });
  }

  return hits;
}

function findFunctionBlock(
  sql,
  functionName
) {
  const escaped =
    functionName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const startRegex =
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}\\s*\\(`,
      "i"
    );

  const startMatch =
    startRegex.exec(sql);

  if (!startMatch) {
    return null;
  }

  const start =
    startMatch.index;

  const rest =
    sql.slice(start);

  const asMatch =
    /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(
      rest
    );

  if (!asMatch) {
    return null;
  }

  const asIndex =
    start +
    asMatch.index;

  const delimiter =
    asMatch[1];

  const bodyStart =
    asIndex +
    asMatch[0].length;

  const bodyEnd =
    sql.indexOf(
      delimiter,
      bodyStart
    );

  if (bodyEnd < 0) {
    return null;
  }

  const endSemicolon =
    sql.indexOf(
      ";",
      bodyEnd +
      delimiter.length
    );

  const end =
    endSemicolon >= 0
      ? endSemicolon + 1
      : bodyEnd +
        delimiter.length;

  return {
    start,
    asIndex,
    end,
    header:
      sql.slice(
        start,
        asIndex
      ),

    full:
      sql.slice(
        start,
        end
      ),
  };
}

function hardenSearchPath(
  sql,
  functionName
) {
  const block =
    findFunctionBlock(
      sql,
      functionName
    );

  if (!block) {
    throw new Error(
      `RPC_DEFINITION_NOT_FOUND:${functionName}`
    );
  }

  if (
    /\bset\s+search_path\s*=/i.test(
      block.header
    )
  ) {
    return sql;
  }

  const insertion =
    "\nset search_path = public, pg_temp\n";

  return (
    sql.slice(
      0,
      block.asIndex
    ) +
    insertion +
    sql.slice(
      block.asIndex
    )
  );
}

function hasSecurityDefiner(
  sql,
  functionName
) {
  const block =
    findFunctionBlock(
      sql,
      functionName
    );

  return Boolean(
    block &&
    /\bsecurity\s+definer\b/i.test(
      block.header
    )
  );
}

function hasFixedSearchPath(
  sql,
  functionName
) {
  const block =
    findFunctionBlock(
      sql,
      functionName
    );

  return Boolean(
    block &&
    /\bset\s+search_path\s*=\s*public\s*,\s*pg_temp\b/i.test(
      block.header
    )
  );
}

function privilegeBlock() {
  return [
    "",
    "-- Committed Risk RPC privilege hardening.",
    "-- These SECURITY DEFINER functions are server-only mutation boundaries.",
    ...rpcSpecs.flatMap(
      (rpc) => [
        `revoke all on function ${rpc.signature} from public;`,
        `revoke all on function ${rpc.signature} from anon;`,
        `revoke all on function ${rpc.signature} from authenticated;`,
        `grant execute on function ${rpc.signature} to service_role;`,
        "",
      ]
    ),
  ].join("\n");
}

function hasPrivilegeHardening(
  sql,
  rpc
) {
  const escaped =
    rpc.name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  return {
    revokePublic:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]+\\)\\s+from\\s+public`,
        "i"
      ).test(
        sql
      ),

    revokeAnon:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]+\\)\\s+from\\s+anon`,
        "i"
      ).test(
        sql
      ),

    revokeAuthenticated:
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]+\\)\\s+from\\s+authenticated`,
        "i"
      ).test(
        sql
      ),

    grantServiceRole:
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]+\\)\\s+to\\s+service_role`,
        "i"
      ).test(
        sql
      ),

    dangerousGrant:
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]+\\)\\s+to\\s+(?:public|anon|authenticated)`,
        "i"
      ).test(
        sql
      ),
  };
}

if (
  !fs.existsSync(
    migrationFile
  )
) {
  throw new Error(
    `MIGRATION_NOT_FOUND:${migrationRel}`
  );
}

const serverHits =
  findServerClientDefinitions();

const definitionHits =
  serverHits.filter(
    (row) =>
      row.defines
  );

const serviceRoleConfirmed =
  definitionHits.some(
    (row) =>
      row.serviceRoleKey &&
      row.createClient
  );

const anonOnlyDefinition =
  definitionHits.length > 0 &&
  definitionHits.every(
    (row) =>
      row.anonKey &&
      !row.serviceRoleKey
  );

let sql =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const beforeChecks =
  Object.fromEntries(
    rpcSpecs.map(
      (rpc) => [
        rpc.name,
        {
          securityDefiner:
            hasSecurityDefiner(
              sql,
              rpc.name
            ),

          fixedSearchPath:
            hasFixedSearchPath(
              sql,
              rpc.name
            ),

          privileges:
            hasPrivilegeHardening(
              sql,
              rpc
            ),
        },
      ]
    )
  );

const allSecurityDefiner =
  rpcSpecs.every(
    (rpc) =>
      beforeChecks[
        rpc.name
      ].securityDefiner
  );

if (
  allSecurityDefiner &&
  !serviceRoleConfirmed
) {
  const report = {
    status:
      "ALPHA_V3_COMMITTED_RISK_PREAPPLY_SECURITY_HARDENING_BLOCKED",

    reason:
      anonOnlyDefinition
        ? "SERVER_CLIENT_DEFINITION_APPEARS_ANON_ONLY"
        : "SERVICE_ROLE_SERVER_CLIENT_NOT_CONFIRMED",

    serverClientDefinitions:
      definitionHits,

    beforeChecks,

    migrationPatched:
      false,

    databaseWrites:
      0,

    nextGate:
      "VERIFY_SERVER_CLIENT_AUTHORITY_BEFORE_RPC_PRIVILEGE_LOCKDOWN",
  };

  fs.mkdirSync(
    path.dirname(
      reportFile
    ),
    {
      recursive:
        true,
    }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  process.exitCode =
    2;

  return;
}

if (
  !fs.existsSync(
    backupFile
  )
) {
  fs.copyFileSync(
    migrationFile,
    backupFile
  );
}

for (const rpc of rpcSpecs) {
  if (
    hasSecurityDefiner(
      sql,
      rpc.name
    )
  ) {
    sql =
      hardenSearchPath(
        sql,
        rpc.name
      );
  }
}

const existingPrivilegeChecks =
  rpcSpecs.map(
    (rpc) =>
      hasPrivilegeHardening(
        sql,
        rpc
      )
  );

const privilegesAlreadyHardened =
  existingPrivilegeChecks.every(
    (check) =>
      check.revokePublic &&
      check.revokeAnon &&
      check.revokeAuthenticated &&
      check.grantServiceRole &&
      !check.dangerousGrant
  );

if (
  !privilegesAlreadyHardened
) {
  sql =
    sql.trimEnd() +
    "\n" +
    privilegeBlock() +
    "\n";
}

fs.writeFileSync(
  migrationFile,
  sql,
  "utf8"
);

const afterChecks =
  Object.fromEntries(
    rpcSpecs.map(
      (rpc) => [
        rpc.name,
        {
          securityDefiner:
            hasSecurityDefiner(
              sql,
              rpc.name
            ),

          fixedSearchPath:
            hasFixedSearchPath(
              sql,
              rpc.name
            ),

          privileges:
            hasPrivilegeHardening(
              sql,
              rpc
            ),
        },
      ]
    )
  );

const afterSafe =
  rpcSpecs.every(
    (rpc) => {
      const row =
        afterChecks[
          rpc.name
        ];

      if (
        !row.securityDefiner
      ) {
        return true;
      }

      return (
        row.fixedSearchPath &&
        row.privileges
          .revokePublic &&
        row.privileges
          .revokeAnon &&
        row.privileges
          .revokeAuthenticated &&
        row.privileges
          .grantServiceRole &&
        !row.privileges
          .dangerousGrant
      );
    }
  );

const report = {
  status:
    afterSafe
      ? "ALPHA_V3_COMMITTED_RISK_PREAPPLY_SECURITY_HARDENING_VERIFIED"
      : "ALPHA_V3_COMMITTED_RISK_PREAPPLY_SECURITY_HARDENING_REVIEW",

  serverClient: {
    serviceRoleConfirmed,
    definitionHits,
  },

  beforeChecks,
  afterChecks,

  migrationPatched:
    fs.readFileSync(
      migrationFile,
      "utf8"
    ) !==
    fs.readFileSync(
      backupFile,
      "utf8"
    ),

  backupFile:
    path
      .relative(
        root,
        backupFile
      )
      .replace(
        /\\/g,
        "/"
      ),

  databaseWrites:
    0,

  nextGate:
    afterSafe
      ? "RERUN_COMMITTED_RISK_STATIC_VERIFY_THEN_APPLY_MIGRATION"
      : "REVIEW_RPC_SECURITY_BEFORE_DB_APPLY",

  outputFile:
    "logs/alpha-v3-committed-risk-preapply-security-hardening.json",
};

fs.mkdirSync(
  path.dirname(
    reportFile
  ),
  {
    recursive:
      true,
  }
);

fs.writeFileSync(
  reportFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      serviceRoleConfirmed:
        report.serverClient
          .serviceRoleConfirmed,

      serverClientDefinitions:
        report.serverClient
          .definitionHits,

      migrationPatched:
        report.migrationPatched,

      afterChecks:
        report.afterChecks,

      databaseWrites:
        0,

      nextGate:
        report.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);

if (!afterSafe) {
  process.exitCode =
    2;
}
