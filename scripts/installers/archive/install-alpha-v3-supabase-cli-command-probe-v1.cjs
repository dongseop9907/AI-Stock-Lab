const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-supabase-cli-command-probe-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs\",\n  \"scripts/alpha-v3-fill-lock-order-apply-and-stress.cjs\",\n];\n\nfunction redact(line) {\n  return line\n    .replace(\n      /(SUPABASE_[A-Z0-9_]*KEY\\s*[:=]\\s*)[\"'][^\"']+[\"']/gi,\n      \"$1<REDACTED>\",\n    )\n    .replace(\n      /(password\\s*[:=]\\s*)[\"'][^\"']+[\"']/gi,\n      \"$1<REDACTED>\",\n    )\n    .replace(\n      /(token\\s*[:=]\\s*)[\"'][^\"']+[\"']/gi,\n      \"$1<REDACTED>\",\n    );\n}\n\nfunction context(lines, i, radius = 4) {\n  const start = Math.max(0, i - radius);\n  const end = Math.min(lines.length, i + radius + 1);\n\n  return lines.slice(start, end).map(\n    (line, offset) => ({\n      line: start + offset + 1,\n      text: redact(line.trim()).slice(0, 300),\n    }),\n  );\n}\n\nconst results = [];\n\nfor (const rel of targets) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    results.push({\n      file: rel,\n      exists: false,\n      commandSites: [],\n    });\n    continue;\n  }\n\n  const text = fs.readFileSync(abs, \"utf8\");\n  const lines = text.split(/\\r?\\n/);\n\n  const commandSites = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n\n    if (\n      /supabase/i.test(line) &&\n      (\n        /spawnSync|execFileSync|execSync|spawn\\(/.test(line) ||\n        /db\\s+(push|reset)|migration\\s+(up|repair)|--linked|--include-all/i.test(line) ||\n        /supabase(\\.cmd)?/i.test(line)\n      )\n    ) {\n      commandSites.push({\n        line: i + 1,\n        context: context(lines, i),\n      });\n    }\n  }\n\n  results.push({\n    file: rel,\n    exists: true,\n    commandSites: commandSites.slice(0, 20),\n  });\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_SUPABASE_CLI_COMMAND_PROBE_V1_COMPLETE\",\n\n  results,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    secretsPrinted: false,\n  },\n\n  fullLogFile:\n    \"logs/alpha-v3-supabase-cli-command-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_01800_APPLY_AND_NO_ORDER_REGRESSION_WITH_EXACT_EXISTING_CLI_PATTERN\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, report.fullLogFile),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      commandSites:\n        results.map((row) => ({\n          file: row.file,\n          exists: row.exists,\n          lines: row.commandSites.map((site) => site.context),\n        })),\n      safety: report.safety,\n      fullLogFile: report.fullLogFile,\n      nextGate: report.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_SUPABASE_CLI_COMMAND_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-supabase-cli-command-probe-v1.cjs",

      consoleMode:
        "COMPACT",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        secretsPrinted: false
      },

      nextAction:
        "RUN_SUPABASE_CLI_COMMAND_PROBE"
    },
    null,
    2
  )
);
