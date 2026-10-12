const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs",
  "scripts/alpha-v3-fill-lock-order-apply-and-stress.cjs",
];

function redact(line) {
  return line
    .replace(
      /(SUPABASE_[A-Z0-9_]*KEY\s*[:=]\s*)["'][^"']+["']/gi,
      "$1<REDACTED>",
    )
    .replace(
      /(password\s*[:=]\s*)["'][^"']+["']/gi,
      "$1<REDACTED>",
    )
    .replace(
      /(token\s*[:=]\s*)["'][^"']+["']/gi,
      "$1<REDACTED>",
    );
}

function context(lines, i, radius = 4) {
  const start = Math.max(0, i - radius);
  const end = Math.min(lines.length, i + radius + 1);

  return lines.slice(start, end).map(
    (line, offset) => ({
      line: start + offset + 1,
      text: redact(line.trim()).slice(0, 300),
    }),
  );
}

const results = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    results.push({
      file: rel,
      exists: false,
      commandSites: [],
    });
    continue;
  }

  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split(/\r?\n/);

  const commandSites = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      /supabase/i.test(line) &&
      (
        /spawnSync|execFileSync|execSync|spawn\(/.test(line) ||
        /db\s+(push|reset)|migration\s+(up|repair)|--linked|--include-all/i.test(line) ||
        /supabase(\.cmd)?/i.test(line)
      )
    ) {
      commandSites.push({
        line: i + 1,
        context: context(lines, i),
      });
    }
  }

  results.push({
    file: rel,
    exists: true,
    commandSites: commandSites.slice(0, 20),
  });
}

const report = {
  status:
    "ALPHA_V3_SUPABASE_CLI_COMMAND_PROBE_V1_COMPLETE",

  results,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    secretsPrinted: false,
  },

  fullLogFile:
    "logs/alpha-v3-supabase-cli-command-probe-v1.json",

  nextGate:
    "BUILD_01800_APPLY_AND_NO_ORDER_REGRESSION_WITH_EXACT_EXISTING_CLI_PATTERN",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, report.fullLogFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      commandSites:
        results.map((row) => ({
          file: row.file,
          exists: row.exists,
          lines: row.commandSites.map((site) => site.context),
        })),
      safety: report.safety,
      fullLogFile: report.fullLogFile,
      nextGate: report.nextGate,
    },
    null,
    2,
  ),
);
