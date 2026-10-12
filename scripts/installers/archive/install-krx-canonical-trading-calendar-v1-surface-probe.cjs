const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-canonical-trading-calendar-v1-surface-probe.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst includeRoots = [\n  \"app\",\n  \"lib\",\n  \"scripts\",\n];\n\nconst allowedExt =\n  new Set([\n    \".ts\",\n    \".tsx\",\n    \".js\",\n    \".cjs\",\n    \".mjs\",\n  ]);\n\nconst ignoreParts =\n  new Set([\n    \"node_modules\",\n    \".next\",\n    \".git\",\n    \"logs\",\n    \"dist\",\n    \"build\",\n    \"coverage\",\n  ]);\n\nconst patterns = [\n  {\n    id: \"CALENDAR_MODE\",\n    re: /WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES|WEEKDAY_PLUS_VERIFIED_OVERRIDES/g,\n  },\n  {\n    id: \"MANUAL_VERIFIED_KRX\",\n    re: /MANUAL_VERIFIED_KRX_CALENDAR/g,\n  },\n  {\n    id: \"NEXT_EXPECTED_KRX_OPEN_DATE\",\n    re: /nextExpectedKrxOpenDate/g,\n  },\n  {\n    id: \"EXPECTED_MARKET_DATE\",\n    re: /expectedMarketDate|expected_market_date/g,\n  },\n  {\n    id: \"WEEKDAY_COMPUTATION\",\n    re: /getUTCDay\\s*\\(|getDay\\s*\\(|weekday/gi,\n  },\n  {\n    id: \"CALENDAR_OVERRIDE\",\n    re: /calendar[_A-Za-z]*override|overrideData|verifiedOverride/gi,\n  },\n  {\n    id: \"KRX_CALENDAR\",\n    re: /KRX.{0,50}calendar|calendar.{0,50}KRX/gi,\n  },\n  {\n    id: \"TRADING_DAY_FUNCTION\",\n    re: /nextTrading|previousTrading|isTradingDay|tradingDay|tradingDate/gi,\n  },\n  {\n    id: \"PUBLIC_HOLIDAY\",\n    re: /public.?holiday|holiday.?closure|substitute.?holiday/gi,\n  },\n];\n\nfunction walk(dir, acc) {\n  if (!fs.existsSync(dir)) return;\n\n  for (const ent of fs.readdirSync(dir, {\n    withFileTypes: true,\n  })) {\n    if (ignoreParts.has(ent.name)) continue;\n\n    const abs = path.join(dir, ent.name);\n\n    if (ent.isDirectory()) {\n      walk(abs, acc);\n      continue;\n    }\n\n    if (!ent.isFile()) continue;\n\n    const ext = path.extname(ent.name).toLowerCase();\n\n    if (!allowedExt.has(ext)) continue;\n\n    acc.push(abs);\n  }\n}\n\nfunction rel(abs) {\n  return path\n    .relative(root, abs)\n    .replace(/\\\\/g, \"/\");\n}\n\nfunction lineNumberAt(text, index) {\n  let count = 1;\n\n  for (let i = 0; i < index; i += 1) {\n    if (text.charCodeAt(i) === 10) count += 1;\n  }\n\n  return count;\n}\n\nfunction lineTextAt(text, index) {\n  const start =\n    text.lastIndexOf(\"\\n\", index) + 1;\n\n  const endRaw =\n    text.indexOf(\"\\n\", index);\n\n  const end =\n    endRaw < 0\n      ? text.length\n      : endRaw;\n\n  return text\n    .slice(start, end)\n    .trim()\n    .slice(0, 280);\n}\n\nconst files = [];\n\nfor (const base of includeRoots) {\n  walk(path.resolve(root, base), files);\n}\n\nconst findings = [];\n\nfor (const abs of files) {\n  const text =\n    fs.readFileSync(abs, \"utf8\");\n\n  const hits = [];\n\n  for (const pattern of patterns) {\n    pattern.re.lastIndex = 0;\n\n    let match;\n\n    while (\n      (match = pattern.re.exec(text))\n    ) {\n      hits.push({\n        kind: pattern.id,\n        line:\n          lineNumberAt(\n            text,\n            match.index,\n          ),\n        match:\n          match[0],\n        text:\n          lineTextAt(\n            text,\n            match.index,\n          ),\n      });\n\n      if (\n        pattern.re.lastIndex ===\n        match.index\n      ) {\n        pattern.re.lastIndex += 1;\n      }\n    }\n  }\n\n  if (hits.length === 0) continue;\n\n  findings.push({\n    file: rel(abs),\n    hitCount: hits.length,\n    kinds:\n      Array.from(\n        new Set(\n          hits.map(\n            (hit) =>\n              hit.kind,\n          ),\n        ),\n      ).sort(),\n    hits:\n      hits.slice(0, 40),\n  });\n}\n\nfunction score(row) {\n  const weights = {\n    NEXT_EXPECTED_KRX_OPEN_DATE: 8,\n    CALENDAR_MODE: 7,\n    MANUAL_VERIFIED_KRX: 7,\n    KRX_CALENDAR: 6,\n    CALENDAR_OVERRIDE: 5,\n    EXPECTED_MARKET_DATE: 4,\n    TRADING_DAY_FUNCTION: 4,\n    PUBLIC_HOLIDAY: 3,\n    WEEKDAY_COMPUTATION: 2,\n  };\n\n  return row.kinds.reduce(\n    (sum, kind) =>\n      sum +\n      (weights[kind] ?? 1),\n    0,\n  );\n}\n\nfindings.sort(\n  (a, b) =>\n    score(b) - score(a) ||\n    a.file.localeCompare(b.file),\n);\n\nconst likelyImplementations =\n  findings.filter(\n    (row) =>\n      row.kinds.includes(\n        \"WEEKDAY_COMPUTATION\",\n      ) &&\n      (\n        row.kinds.includes(\n          \"CALENDAR_OVERRIDE\",\n        ) ||\n        row.kinds.includes(\n          \"NEXT_EXPECTED_KRX_OPEN_DATE\",\n        ) ||\n        row.kinds.includes(\n          \"EXPECTED_MARKET_DATE\",\n        ) ||\n        row.kinds.includes(\n          \"TRADING_DAY_FUNCTION\",\n        )\n      ),\n  );\n\nconst likelyConsumers =\n  findings.filter(\n    (row) =>\n      row.kinds.includes(\n        \"EXPECTED_MARKET_DATE\",\n      ) ||\n      row.kinds.includes(\n        \"NEXT_EXPECTED_KRX_OPEN_DATE\",\n      ) ||\n      row.kinds.includes(\n        \"CALENDAR_MODE\",\n      ),\n  );\n\nconst producer =\n  findings.find(\n    (row) =>\n      row.file ===\n      \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n  ) ?? null;\n\nconst result = {\n  status:\n    \"KRX_CANONICAL_TRADING_CALENDAR_V1_SURFACE_PROBE_COMPLETE\",\n\n  counts: {\n    sourceFilesScanned:\n      files.length,\n\n    filesWithCalendarSignals:\n      findings.length,\n\n    likelyIndependentImplementations:\n      likelyImplementations.length,\n\n    likelyConsumers:\n      likelyConsumers.length,\n  },\n\n  currentKnownContract: {\n    exchange:\n      \"KRX\",\n\n    timeZone:\n      \"Asia/Seoul\",\n\n    weekendsClosed:\n      true,\n\n    verifiedOverrides:\n      true,\n\n    unknownSpecialClosure:\n      \"FAIL_CLOSED\",\n\n    knownRequiredClosure:\n      {\n        date:\n          \"2026-10-09\",\n\n        reason:\n          \"HANGEUL_DAY_PUBLIC_HOLIDAY\",\n\n        isOpen:\n          false,\n      },\n\n    nextRegularSessionAfter20261008:\n      \"2026-10-12\",\n  },\n\n  producer,\n\n  likelyIndependentImplementations:\n    likelyImplementations.slice(0, 25),\n\n  likelyConsumers:\n    likelyConsumers.slice(0, 30),\n\n  allFindings:\n    findings.slice(0, 60),\n\n  intendedCanonicalApi: [\n    \"isKrxTradingDate(date, overrides?)\",\n    \"nextKrxTradingDate(afterDate, overrides?)\",\n    \"previousKrxTradingDate(beforeDate, overrides?)\",\n    \"resolveExpectedKrxMarketDate(now, overrides?)\",\n    \"mergeVerifiedKrxOverrides(runtimeOverrides)\",\n  ],\n\n  migrationPlan: [\n    \"CREATE lib/trading/krx-trading-calendar.ts\",\n    \"MOVE verified fixed closures into canonical module\",\n    \"PRESERVE runtime verified DB overrides\",\n    \"BIND Forward OOS producer to canonical module\",\n    \"BIND freshness expected-market-date logic to canonical module\",\n    \"BIND maintenance/supervisor consumers where duplicate weekday logic exists\",\n    \"ADD contract tests for weekend, Hangeul Day, runtime override precedence, and fail-closed behavior\",\n    \"DO NOT change Alpha V3 score, threshold, premium cap, historical cutoff, scheduler activation, or real trading\",\n  ],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    schedulerChanged: false,\n    realTradingChanged: false,\n    forwardOosStateChanged: false,\n  },\n\n  logFile:\n    \"logs/krx-canonical-trading-calendar-v1-surface-probe.json\",\n\n  nextGate:\n    \"BUILD_CANONICAL_KRX_CALENDAR_FROM_DISCOVERED_SURFACES\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    result.logFile,\n  ),\n  JSON.stringify(\n    result,\n    null,\n    2,\n  ) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        result.status,\n\n      counts:\n        result.counts,\n\n      producer:\n        result.producer,\n\n      likelyIndependentImplementations:\n        result.likelyIndependentImplementations,\n\n      intendedCanonicalApi:\n        result.intendedCanonicalApi,\n\n      migrationPlan:\n        result.migrationPlan,\n\n      safety:\n        result.safety,\n\n      logFile:\n        result.logFile,\n\n      nextGate:\n        result.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "KRX_CANONICAL_TRADING_CALENDAR_V1_SURFACE_PROBE_INSTALLED",

      generatedFile:
        "scripts/krx-canonical-trading-calendar-v1-surface-probe.cjs",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        sourceFilesModified: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        schedulerChanged: false,
        realTradingChanged: false,
        forwardOosStateChanged: false
      },

      nextAction:
        "RUN_KRX_CANONICAL_TRADING_CALENDAR_V1_SURFACE_PROBE"
    },
    null,
    2
  )
);
