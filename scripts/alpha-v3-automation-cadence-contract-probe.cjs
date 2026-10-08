const fs = require("fs");
const path = require("path");

const root = process.cwd();

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-automation-cadence-contract-probe.json"
);

const explicitTargets = [
  "app/api/trading/automation/run/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "app/api/orders/paper/execute/route.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "app/components/AutomationRunPanel.tsx",
  "app/page.tsx",
  "package.json",
  "vercel.json",
  ".env.example",
  ".env.local.example",
  "README.md",
];

function walk(dir, depth = 0, maxDepth = 7) {
  if (!fs.existsSync(dir) || depth > maxDepth) {
    return [];
  }

  const rows = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".git",
        ".next",
        "logs",
        "backups",
      ].includes(entry.name)
    ) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      rows.push(...walk(full, depth + 1, maxDepth));
    } else if (
      /\.(ts|tsx|js|cjs|mjs|json|yml|yaml|md|toml)$/i.test(entry.name)
    ) {
      rows.push(full);
    }
  }

  return rows;
}

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      text: null,
    };
  }

  return {
    file: rel,
    exists: true,
    text: fs.readFileSync(file, "utf8"),
  };
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function snippets(text, regex, radius = 8, max = 30) {
  if (!text) {
    return [];
  }

  const normalized =
    text.replace(/\r\n/g, "\n");

  const lines =
    normalized.split("\n");

  const rows = [];
  let match;

  while (
    (match = regex.exec(normalized)) &&
    rows.length < max
  ) {
    const line =
      normalized
        .slice(0, match.index)
        .split("\n")
        .length;

    const start =
      Math.max(1, line - radius);

    const end =
      Math.min(lines.length, line + radius);

    rows.push({
      match: match[0],
      line,
      snippet:
        lines
          .slice(start - 1, end)
          .map(
            (value, offset) =>
              `${start + offset}: ${value}`
          )
          .join("\n"),
    });
  }

  return rows;
}

const targets =
  explicitTargets.map(read);

const directEvidence =
  targets.map((row) => ({
    file: row.file,
    exists: row.exists,

    routeShape: snippets(
      row.text,
      /export\s+async\s+function\s+(GET|POST)|fetch\s*\(|axios|executeApprovedPaperOrders|executePaperOrder|RISK_APPROVED/gi,
      8,
      35
    ),

    cadenceOrTrigger: snippets(
      row.text,
      /setInterval|setTimeout|cron|schedule|manual|button|onClick|fetch\s*\(|process\.env\.[A-Z0-9_]+|NEXT_PUBLIC_[A-Z0-9_]+|interval|poll|refresh/gi,
      8,
      40
    ),

    limits: snippets(
      row.text,
      /\.limit\s*\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\.all|Promise\.allSettled/gi,
      7,
      30
    ),
  }));

const allFiles =
  walk(root);

const repoEvidence = [];

const repoRegex =
  /\/api\/trading\/automation\/run|\/api\/orders\/paper\/execute-approved|executeApprovedPaperOrders|AUTOMATION_|CRON_|SCHEDULE_|POLL_|INTERVAL_|setInterval|setTimeout|vercel\.json|schedule:/gi;

for (const file of allFiles) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (!repoRegex.test(text)) {
    repoRegex.lastIndex = 0;
    continue;
  }

  repoRegex.lastIndex = 0;

  const hits =
    snippets(
      text,
      /\/api\/trading\/automation\/run|\/api\/orders\/paper\/execute-approved|executeApprovedPaperOrders|AUTOMATION_[A-Z0-9_]*|CRON_[A-Z0-9_]*|SCHEDULE_[A-Z0-9_]*|POLL_[A-Z0-9_]*|INTERVAL_[A-Z0-9_]*|setInterval|setTimeout|schedule:/gi,
      7,
      40
    );

  if (hits.length) {
    repoEvidence.push({
      file: rel(file),
      hits,
    });
  }
}

const envVars = new Set();

for (const row of [...directEvidence, ...repoEvidence]) {
  const snippetsList =
    row.cadenceOrTrigger ??
    row.hits ??
    [];

  for (const hit of snippetsList) {
    for (
      const match of hit.snippet.matchAll(
        /\b(?:process\.env\.)?([A-Z][A-Z0-9_]{3,})\b/g
      )
    ) {
      const name = match[1];

      if (
        /AUTOMATION|CRON|SCHEDULE|POLL|INTERVAL|ORDER|EXECUT/i.test(name)
      ) {
        envVars.add(name);
      }
    }
  }
}

const hasVercelCron =
  targets.some(
    (row) =>
      row.file === "vercel.json" &&
      row.exists &&
      /cron/i.test(row.text ?? "")
  );

const hasWorkflowSchedule =
  repoEvidence.some(
    (row) =>
      /\.github\/workflows\//i.test(row.file) &&
      row.hits.some(
        (hit) =>
          /schedule:/i.test(hit.match + "\n" + hit.snippet)
      )
  );

const hasSetInterval =
  repoEvidence.some(
    (row) =>
      row.hits.some(
        (hit) =>
          /setInterval/i.test(hit.match + "\n" + hit.snippet)
      )
  );

const automationRouteReferenced =
  repoEvidence
    .filter(
      (row) =>
        row.hits.some(
          (hit) =>
            /\/api\/trading\/automation\/run/i.test(
              hit.match + "\n" + hit.snippet
            )
        )
    )
    .map((row) => row.file);

const executeApprovedReferenced =
  repoEvidence
    .filter(
      (row) =>
        row.hits.some(
          (hit) =>
            /\/api\/orders\/paper\/execute-approved|executeApprovedPaperOrders/i.test(
              hit.match + "\n" + hit.snippet
            )
        )
    )
    .map((row) => row.file);

let triggerModel =
  "UNRESOLVED";

if (hasVercelCron || hasWorkflowSchedule) {
  triggerModel =
    "EXTERNAL_SCHEDULE_CONFIG_FOUND";
} else if (hasSetInterval) {
  triggerModel =
    "IN_APP_INTERVAL_FOUND";
} else if (
  automationRouteReferenced.some(
    (file) =>
      /AutomationRunPanel|page\.tsx/i.test(file)
  )
) {
  triggerModel =
    "UI_OR_MANUAL_ROUTE_TRIGGER_LIKELY";
}

const result = {
  status:
    "ALPHA_V3_AUTOMATION_CADENCE_CONTRACT_PROBE_COMPLETE",

  directEvidence,

  repoEvidence,

  summary: {
    triggerModel,
    hasVercelCron,
    hasWorkflowSchedule,
    hasSetInterval,
    cadenceEnvVars:
      [...envVars].sort(),

    automationRouteReferencedBy:
      [...new Set(automationRouteReferenced)].sort(),

    executeApprovedReferencedBy:
      [...new Set(executeApprovedReferenced)].sort(),
  },

  decision: {
    cadenceSourceResolved:
      triggerModel !== "UNRESOLVED",

    safeToChooseExpirySla:
      triggerModel === "EXTERNAL_SCHEDULE_CONFIG_FOUND" ||
      triggerModel === "IN_APP_INTERVAL_FOUND",

    nextGate:
      triggerModel === "EXTERNAL_SCHEDULE_CONFIG_FOUND" ||
      triggerModel === "IN_APP_INTERVAL_FOUND"
        ? "DERIVE_EXPIRY_SLA_FROM_RESOLVED_TRIGGER_CADENCE"
        : "DEFINE_EXPLICIT_AUTOMATION_CADENCE_BEFORE_MAINTENANCE_CALLER",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-automation-cadence-contract-probe.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  reportFile,
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: result.status,

      summary:
        result.summary,

      directFiles:
        result.directEvidence.map(
          (row) => ({
            file: row.file,
            exists: row.exists,
            routeShapeHits:
              row.routeShape.length,
            cadenceOrTriggerHits:
              row.cadenceOrTrigger.length,
            limitHits:
              row.limits.length,
          })
        ),

      repoEvidenceFiles:
        result.repoEvidence.map(
          (row) => row.file
        ),

      databaseWrites: 0,

      nextGate:
        result.decision.nextGate,

      outputFile:
        result.outputFile,
    },
    null,
    2
  )
);
