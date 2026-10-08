const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-committed-risk-security-hardening-v2.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst migrationRel =\n  \"supabase/migrations/20261008000100_committed_risk_reservation_v3.sql\";\n\nconst migrationFile =\n  path.resolve(root, migrationRel);\n\nconst backupFile =\n  path.resolve(\n    root,\n    \"supabase/migrations/20261008000100_committed_risk_reservation_v3.sql.before-security-hardening-v2.bak\"\n  );\n\nconst reportFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-committed-risk-security-hardening-v2.json\"\n  );\n\nconst rpcNames = [\n  \"create_paper_buy_order_with_committed_risk_v3\",\n  \"release_paper_buy_risk_v3\",\n];\n\nfunction escapeRegex(value) {\n  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\");\n}\n\nfunction findFunctionHeader(sql, name) {\n  const escaped = escapeRegex(name);\n\n  const regex = new RegExp(\n    `(create\\\\s+(?:or\\\\s+replace\\\\s+)?function\\\\s+public\\\\.${escaped}\\\\s*\\\\([\\\\s\\\\S]*?\\\\)\\\\s*[\\\\s\\\\S]*?)(?=\\\\bas\\\\s+\\\\$[A-Za-z0-9_]*\\\\$)`,\n    \"i\"\n  );\n\n  const match = regex.exec(sql);\n\n  if (!match) {\n    return null;\n  }\n\n  return {\n    fullMatch: match[0],\n    header: match[1],\n    index: match.index,\n    end: match.index + match[0].length,\n  };\n}\n\nfunction hardenOne(sql, name) {\n  const block = findFunctionHeader(sql, name);\n\n  if (!block) {\n    throw new Error(`FUNCTION_HEADER_NOT_FOUND:${name}`);\n  }\n\n  let header = block.header;\n\n  if (!/\\bsecurity\\s+definer\\b/i.test(header)) {\n    throw new Error(`SECURITY_DEFINER_NOT_FOUND:${name}`);\n  }\n\n  if (!/\\bset\\s+search_path\\s*(?:=|to)\\s*public\\s*,\\s*pg_temp\\b/i.test(header)) {\n    header = header.replace(\n      /\\bsecurity\\s+definer\\b/i,\n      \"security definer\\nset search_path = public, pg_temp\"\n    );\n  }\n\n  return (\n    sql.slice(0, block.index) +\n    header +\n    sql.slice(block.end)\n  );\n}\n\nfunction verifyHeader(sql, name) {\n  const block = findFunctionHeader(sql, name);\n\n  if (!block) {\n    return {\n      found: false,\n      securityDefiner: false,\n      fixedSearchPath: false,\n      headerPreview: null,\n    };\n  }\n\n  return {\n    found: true,\n    securityDefiner:\n      /\\bsecurity\\s+definer\\b/i.test(block.header),\n\n    fixedSearchPath:\n      /\\bset\\s+search_path\\s*(?:=|to)\\s*public\\s*,\\s*pg_temp\\b/i.test(\n        block.header\n      ),\n\n    headerPreview:\n      block.header\n        .split(/\\r?\\n/)\n        .slice(-12)\n        .join(\"\\n\"),\n  };\n}\n\nfunction verifyPrivileges(sql, name) {\n  const escaped = escapeRegex(name);\n\n  const functionPrefix =\n    `public\\\\.${escaped}\\\\s*\\\\([^;]+\\\\)`;\n\n  return {\n    revokePublic:\n      new RegExp(\n        `revoke\\\\s+all\\\\s+on\\\\s+function\\\\s+${functionPrefix}\\\\s+from\\\\s+public`,\n        \"i\"\n      ).test(sql),\n\n    revokeAnon:\n      new RegExp(\n        `revoke\\\\s+all\\\\s+on\\\\s+function\\\\s+${functionPrefix}\\\\s+from\\\\s+anon`,\n        \"i\"\n      ).test(sql),\n\n    revokeAuthenticated:\n      new RegExp(\n        `revoke\\\\s+all\\\\s+on\\\\s+function\\\\s+${functionPrefix}\\\\s+from\\\\s+authenticated`,\n        \"i\"\n      ).test(sql),\n\n    grantServiceRole:\n      new RegExp(\n        `grant\\\\s+execute\\\\s+on\\\\s+function\\\\s+${functionPrefix}\\\\s+to\\\\s+service_role`,\n        \"i\"\n      ).test(sql),\n\n    dangerousGrant:\n      new RegExp(\n        `grant\\\\s+execute\\\\s+on\\\\s+function\\\\s+${functionPrefix}\\\\s+to\\\\s+(?:public|anon|authenticated)`,\n        \"i\"\n      ).test(sql),\n  };\n}\n\nif (!fs.existsSync(migrationFile)) {\n  throw new Error(`MIGRATION_NOT_FOUND:${migrationRel}`);\n}\n\nif (!fs.existsSync(backupFile)) {\n  fs.copyFileSync(migrationFile, backupFile);\n}\n\nlet sql = fs.readFileSync(migrationFile, \"utf8\");\n\nconst before = Object.fromEntries(\n  rpcNames.map((name) => [\n    name,\n    {\n      header: verifyHeader(sql, name),\n      privileges: verifyPrivileges(sql, name),\n    },\n  ])\n);\n\nfor (const name of rpcNames) {\n  sql = hardenOne(sql, name);\n}\n\nfs.writeFileSync(migrationFile, sql, \"utf8\");\n\nconst after = Object.fromEntries(\n  rpcNames.map((name) => [\n    name,\n    {\n      header: verifyHeader(sql, name),\n      privileges: verifyPrivileges(sql, name),\n    },\n  ])\n);\n\nconst allSafe = rpcNames.every((name) => {\n  const row = after[name];\n\n  return (\n    row.header.found &&\n    row.header.securityDefiner &&\n    row.header.fixedSearchPath &&\n    row.privileges.revokePublic &&\n    row.privileges.revokeAnon &&\n    row.privileges.revokeAuthenticated &&\n    row.privileges.grantServiceRole &&\n    !row.privileges.dangerousGrant\n  );\n});\n\nconst report = {\n  status: allSafe\n    ? \"ALPHA_V3_COMMITTED_RISK_SECURITY_HARDENING_V2_VERIFIED\"\n    : \"ALPHA_V3_COMMITTED_RISK_SECURITY_HARDENING_V2_REVIEW\",\n\n  before,\n  after,\n\n  migrationPatched:\n    fs.readFileSync(migrationFile, \"utf8\") !==\n    fs.readFileSync(backupFile, \"utf8\"),\n\n  databaseWrites: 0,\n\n  nextGate: allSafe\n    ? \"RERUN_ATOMIC_STATIC_VERIFY_AND_FINAL_DRY_RUN\"\n    : \"REVIEW_FUNCTION_HEADERS_BEFORE_DB_APPLY\",\n\n  outputFile:\n    \"logs/alpha-v3-committed-risk-security-hardening-v2.json\",\n};\n\nfs.mkdirSync(path.dirname(reportFile), {\n  recursive: true,\n});\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      after: report.after,\n      migrationPatched: report.migrationPatched,\n      databaseWrites: 0,\n      nextGate: report.nextGate,\n      outputFile: report.outputFile,\n    },\n    null,\n    2\n  )\n);\n\nif (!allSafe) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_SECURITY_HARDENING_V2_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-committed-risk-security-hardening-v2.cjs",

      fix:
        "DETERMINISTIC_SECURITY_DEFINER_HEADER_SEARCH_PATH_PATCH",

      databaseWrites:
        0,

      nextAction:
        "RUN_SECURITY_HARDENING_V2"
    },
    null,
    2
  )
);
