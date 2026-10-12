const fs = require("fs");
const path = require("path");

const root = process.cwd();

const searchRoots = [
  "app",
  "lib",
  "scripts",
  "supabase/migrations"
];

const keywords = [
  "market_data_freshness_observations",
  "market_data_quality_gate_observations",
  "market_eod_sync_runs",
  "market_exchange_calendar_overrides",
  "expected_market_date",
  "expectedMarketDate",
  "business_weekday_lag",
  "businessWeekdayLag",
  "usable_for_shadow_comparison",
  "usableForShadowComparison",
  "usable_for_forward_shadow",
  "usableForForwardShadow",
  "FAIL_FRESHNESS",
  "freshness_status",
  "freshnessStatus",
  "production_applied",
  "productionApplied",
  "holiday",
  "calendar",
  "KOSPI",
  "KOSDAQ"
];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git"
      ) {
        continue;
      }

      out.push(...walk(abs));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs) {
  return path
    .relative(root, abs)
    .replace(/\\/g, "/");
}

function excerpt(text, lineIndex, radius = 6) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);

  return lines
    .slice(start, end)
    .map(
      (line, index) =>
        `${start + index + 1}: ${line}`
    )
    .join("\n");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

const files = [];

for (const rootRel of searchRoots) {
  files.push(
    ...walk(
      path.resolve(root, rootRel)
    )
  );
}

const findings = [];

for (const abs of files) {
  const text =
    fs.readFileSync(abs, "utf8");

  if (
    !keywords.some(
      (keyword) =>
        text.toLowerCase().includes(
          keyword.toLowerCase()
        )
    )
  ) {
    continue;
  }

  const lines =
    text.split(/\r?\n/);

  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const matched =
      keywords.filter(
        (keyword) =>
          lines[i]
            .toLowerCase()
            .includes(
              keyword.toLowerCase()
            )
      );

    if (matched.length > 0) {
      hits.push({
        line: i + 1,
        matched,
        excerpt:
          excerpt(
            text,
            i,
            5
          )
      });
    }
  }

  const tableWrites =
    uniq([
      ...[
        ...text.matchAll(
          /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]{0,900}\.(?:insert|upsert|update)\s*\(/g
        )
      ].map(
        (match) => match[1]
      ),

      ...[
        ...text.matchAll(
          /\binsert\s+into\s+(?:public\.)?([A-Za-z0-9_]+)/gi
        )
      ].map(
        (match) => match[1]
      )
    ]);

  const tableReads =
    uniq([
      ...[
        ...text.matchAll(
          /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]{0,900}\.(?:select|order|limit|maybeSingle|single)\s*\(/g
        )
      ].map(
        (match) => match[1]
      ),

      ...[
        ...text.matchAll(
          /\bfrom\s+(?:public\.)?([A-Za-z0-9_]+)/gi
        )
      ].map(
        (match) => match[1]
      )
    ]);

  const routeSignals = {
    hasPOST:
      /export\s+async\s+function\s+POST\b/.test(text),

    hasGET:
      /export\s+async\s+function\s+GET\b/.test(text),

    fetchCalls:
      (
        text.match(
          /\bfetch\s*\(/g
        ) || []
      ).length,

    cronMentions:
      (
        text.match(
          /\bcron\b|\bschedule\b|\bscheduler\b/gi
        ) || []
      ).length,

    dateMentions:
      (
        text.match(
          /expectedMarketDate|expected_market_date|businessWeekdayLag|business_weekday_lag|Asia\/Seoul|KST|holiday|calendar/gi
        ) || []
      ).length
  };

  findings.push({
    file:
      rel(abs),

    tableWrites,
    tableReads,
    routeSignals,
    hits
  });
}

const directWriters = {
  freshness:
    findings
      .filter(
        (item) =>
          item.tableWrites.includes(
            "market_data_freshness_observations"
          )
      )
      .map(
        (item) => item.file
      ),

  qualityGate:
    findings
      .filter(
        (item) =>
          item.tableWrites.includes(
            "market_data_quality_gate_observations"
          )
      )
      .map(
        (item) => item.file
      ),

  eodSync:
    findings
      .filter(
        (item) =>
          item.tableWrites.includes(
            "market_eod_sync_runs"
          )
      )
      .map(
        (item) => item.file
      )
};

const likelyPipelineFiles =
  findings
    .filter(
      (item) =>
        /freshness|quality-gate|quality_gate|eod|calendar|sync|capture/i.test(
          item.file
        ) ||
        item.tableWrites.length > 0
    )
    .map(
      (item) => ({
        file:
          item.file,

        tableWrites:
          item.tableWrites,

        tableReads:
          item.tableReads,

        routeSignals:
          item.routeSignals
      })
    );

const expectedDateFiles =
  findings
    .filter(
      (item) =>
        item.hits.some(
          (hit) =>
            hit.matched.some(
              (keyword) =>
                /expectedMarketDate|expected_market_date|businessWeekdayLag|business_weekday_lag|holiday|calendar/i.test(
                  keyword
                )
            )
        )
    )
    .map(
      (item) => item.file
    );

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_CAPTURE_PIPELINE_PROBE_V1_COMPLETE",

  summary: {
    scannedFileCount:
      files.length,

    relevantFileCount:
      findings.length,

    freshnessWriterCount:
      directWriters.freshness.length,

    qualityGateWriterCount:
      directWriters.qualityGate.length,

    eodSyncWriterCount:
      directWriters.eodSync.length,

    expectedDateLogicFileCount:
      expectedDateFiles.length
  },

  directWriters,
  expectedDateFiles,
  likelyPipelineFiles,
  findings,

  questions: {
    freshnessWriterFound:
      directWriters.freshness.length > 0,

    qualityGateWriterFound:
      directWriters.qualityGate.length > 0,

    eodSyncWriterFound:
      directWriters.eodSync.length > 0,

    expectedDateLogicFound:
      expectedDateFiles.length > 0,

    schedulerOrCronMentionFound:
      findings.some(
        (item) =>
          item.routeSignals.cronMentions > 0
      )
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-capture-pipeline-probe-v1.json",

  nextGate:
    "CLASSIFY_STALE_ROOT_CAUSE_AND_HARDEN_CAPTURE_PIPELINE_V1"
};

const logAbs =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logAbs),
  { recursive: true }
);

fs.writeFileSync(
  logAbs,
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

      summary:
        report.summary,

      directWriters:
        report.directWriters,

      expectedDateFiles:
        report.expectedDateFiles.slice(0, 20),

      likelyPipelineFiles:
        report.likelyPipelineFiles.slice(0, 25),

      questions:
        report.questions,

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
