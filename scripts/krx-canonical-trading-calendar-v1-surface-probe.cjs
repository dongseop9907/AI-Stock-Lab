const fs = require("fs");
const path = require("path");

const root = process.cwd();

const includeRoots = [
  "app",
  "lib",
  "scripts",
];

const allowedExt =
  new Set([
    ".ts",
    ".tsx",
    ".js",
    ".cjs",
    ".mjs",
  ]);

const ignoreParts =
  new Set([
    "node_modules",
    ".next",
    ".git",
    "logs",
    "dist",
    "build",
    "coverage",
  ]);

const patterns = [
  {
    id: "CALENDAR_MODE",
    re: /WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES|WEEKDAY_PLUS_VERIFIED_OVERRIDES/g,
  },
  {
    id: "MANUAL_VERIFIED_KRX",
    re: /MANUAL_VERIFIED_KRX_CALENDAR/g,
  },
  {
    id: "NEXT_EXPECTED_KRX_OPEN_DATE",
    re: /nextExpectedKrxOpenDate/g,
  },
  {
    id: "EXPECTED_MARKET_DATE",
    re: /expectedMarketDate|expected_market_date/g,
  },
  {
    id: "WEEKDAY_COMPUTATION",
    re: /getUTCDay\s*\(|getDay\s*\(|weekday/gi,
  },
  {
    id: "CALENDAR_OVERRIDE",
    re: /calendar[_A-Za-z]*override|overrideData|verifiedOverride/gi,
  },
  {
    id: "KRX_CALENDAR",
    re: /KRX.{0,50}calendar|calendar.{0,50}KRX/gi,
  },
  {
    id: "TRADING_DAY_FUNCTION",
    re: /nextTrading|previousTrading|isTradingDay|tradingDay|tradingDate/gi,
  },
  {
    id: "PUBLIC_HOLIDAY",
    re: /public.?holiday|holiday.?closure|substitute.?holiday/gi,
  },
];

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return;

  for (const ent of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    if (ignoreParts.has(ent.name)) continue;

    const abs = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      walk(abs, acc);
      continue;
    }

    if (!ent.isFile()) continue;

    const ext = path.extname(ent.name).toLowerCase();

    if (!allowedExt.has(ext)) continue;

    acc.push(abs);
  }
}

function rel(abs) {
  return path
    .relative(root, abs)
    .replace(/\\/g, "/");
}

function lineNumberAt(text, index) {
  let count = 1;

  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }

  return count;
}

function lineTextAt(text, index) {
  const start =
    text.lastIndexOf("\n", index) + 1;

  const endRaw =
    text.indexOf("\n", index);

  const end =
    endRaw < 0
      ? text.length
      : endRaw;

  return text
    .slice(start, end)
    .trim()
    .slice(0, 280);
}

const files = [];

for (const base of includeRoots) {
  walk(path.resolve(root, base), files);
}

const findings = [];

for (const abs of files) {
  const text =
    fs.readFileSync(abs, "utf8");

  const hits = [];

  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;

    let match;

    while (
      (match = pattern.re.exec(text))
    ) {
      hits.push({
        kind: pattern.id,
        line:
          lineNumberAt(
            text,
            match.index,
          ),
        match:
          match[0],
        text:
          lineTextAt(
            text,
            match.index,
          ),
      });

      if (
        pattern.re.lastIndex ===
        match.index
      ) {
        pattern.re.lastIndex += 1;
      }
    }
  }

  if (hits.length === 0) continue;

  findings.push({
    file: rel(abs),
    hitCount: hits.length,
    kinds:
      Array.from(
        new Set(
          hits.map(
            (hit) =>
              hit.kind,
          ),
        ),
      ).sort(),
    hits:
      hits.slice(0, 40),
  });
}

function score(row) {
  const weights = {
    NEXT_EXPECTED_KRX_OPEN_DATE: 8,
    CALENDAR_MODE: 7,
    MANUAL_VERIFIED_KRX: 7,
    KRX_CALENDAR: 6,
    CALENDAR_OVERRIDE: 5,
    EXPECTED_MARKET_DATE: 4,
    TRADING_DAY_FUNCTION: 4,
    PUBLIC_HOLIDAY: 3,
    WEEKDAY_COMPUTATION: 2,
  };

  return row.kinds.reduce(
    (sum, kind) =>
      sum +
      (weights[kind] ?? 1),
    0,
  );
}

findings.sort(
  (a, b) =>
    score(b) - score(a) ||
    a.file.localeCompare(b.file),
);

const likelyImplementations =
  findings.filter(
    (row) =>
      row.kinds.includes(
        "WEEKDAY_COMPUTATION",
      ) &&
      (
        row.kinds.includes(
          "CALENDAR_OVERRIDE",
        ) ||
        row.kinds.includes(
          "NEXT_EXPECTED_KRX_OPEN_DATE",
        ) ||
        row.kinds.includes(
          "EXPECTED_MARKET_DATE",
        ) ||
        row.kinds.includes(
          "TRADING_DAY_FUNCTION",
        )
      ),
  );

const likelyConsumers =
  findings.filter(
    (row) =>
      row.kinds.includes(
        "EXPECTED_MARKET_DATE",
      ) ||
      row.kinds.includes(
        "NEXT_EXPECTED_KRX_OPEN_DATE",
      ) ||
      row.kinds.includes(
        "CALENDAR_MODE",
      ),
  );

const producer =
  findings.find(
    (row) =>
      row.file ===
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  ) ?? null;

const result = {
  status:
    "KRX_CANONICAL_TRADING_CALENDAR_V1_SURFACE_PROBE_COMPLETE",

  counts: {
    sourceFilesScanned:
      files.length,

    filesWithCalendarSignals:
      findings.length,

    likelyIndependentImplementations:
      likelyImplementations.length,

    likelyConsumers:
      likelyConsumers.length,
  },

  currentKnownContract: {
    exchange:
      "KRX",

    timeZone:
      "Asia/Seoul",

    weekendsClosed:
      true,

    verifiedOverrides:
      true,

    unknownSpecialClosure:
      "FAIL_CLOSED",

    knownRequiredClosure:
      {
        date:
          "2026-10-09",

        reason:
          "HANGEUL_DAY_PUBLIC_HOLIDAY",

        isOpen:
          false,
      },

    nextRegularSessionAfter20261008:
      "2026-10-12",
  },

  producer,

  likelyIndependentImplementations:
    likelyImplementations.slice(0, 25),

  likelyConsumers:
    likelyConsumers.slice(0, 30),

  allFindings:
    findings.slice(0, 60),

  intendedCanonicalApi: [
    "isKrxTradingDate(date, overrides?)",
    "nextKrxTradingDate(afterDate, overrides?)",
    "previousKrxTradingDate(beforeDate, overrides?)",
    "resolveExpectedKrxMarketDate(now, overrides?)",
    "mergeVerifiedKrxOverrides(runtimeOverrides)",
  ],

  migrationPlan: [
    "CREATE lib/trading/krx-trading-calendar.ts",
    "MOVE verified fixed closures into canonical module",
    "PRESERVE runtime verified DB overrides",
    "BIND Forward OOS producer to canonical module",
    "BIND freshness expected-market-date logic to canonical module",
    "BIND maintenance/supervisor consumers where duplicate weekday logic exists",
    "ADD contract tests for weekend, Hangeul Day, runtime override precedence, and fail-closed behavior",
    "DO NOT change Alpha V3 score, threshold, premium cap, historical cutoff, scheduler activation, or real trading",
  ],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    schedulerChanged: false,
    realTradingChanged: false,
    forwardOosStateChanged: false,
  },

  logFile:
    "logs/krx-canonical-trading-calendar-v1-surface-probe.json",

  nextGate:
    "BUILD_CANONICAL_KRX_CALENDAR_FROM_DISCOVERED_SURFACES",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(
    root,
    result.logFile,
  ),
  JSON.stringify(
    result,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        result.status,

      counts:
        result.counts,

      producer:
        result.producer,

      likelyIndependentImplementations:
        result.likelyIndependentImplementations,

      intendedCanonicalApi:
        result.intendedCanonicalApi,

      migrationPlan:
        result.migrationPlan,

      safety:
        result.safety,

      logFile:
        result.logFile,

      nextGate:
        result.nextGate,
    },
    null,
    2,
  ),
);
