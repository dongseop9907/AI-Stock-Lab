'use strict';

// V9.7.24.2 read-only exact ingestion wiring extractor.
//
// Extracts targeted, line-numbered snippets from the real runtime candidates.
// No DB/KIS/network access. No source files modified.
//
// Run:
//   node .\scripts\v9724-2.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_24_2_EXACT_INGESTION_WIRING_EXTRACTOR';

const TARGETS = [
  'lib/kis/client.ts',
  'lib/market/process-market-data-backfill-v8-3.ts',
  'lib/market/sync-daily-bars.ts',
  'app/api/market/daily-bars/sync/route.ts',
  'app/api/market/data/v8/backfill/process/route.ts',
  'lib/market/run-market-data-integrity-v7-9.ts',
  'lib/market/run-market-eod-sync-v7-8.ts',
  'market-data-v8-3-process-route.ts'
];

const PATTERNS = [
  ['imports', /^\s*import\b/],
  ['exports', /^\s*export\b/],
  ['kis_daily_api', /inquire-daily-itemchartprice|itemchartprice/i],
  ['fid_org_adj_prc', /FID_ORG_ADJ_PRC/i],
  ['market_daily_bars', /market_daily_bars/i],
  ['adjusted_price', /adjusted_price/i],
  ['source_kis_daily', /KIS_DAILY|source\s*:/i],
  ['convert_daily_bar', /convertDailyBar/i],
  ['sync_daily_bars', /syncDailyBars/i],
  ['process_backfill', /processMarketDataBackfillV83/i],
  ['upsert', /\.upsert\s*\(|on_conflict|merge-duplicates/i],
  ['insert', /\.insert\s*\(/i],
  ['from_call', /\.from\s*\(/i],
  ['fetch', /\bfetch\s*\(/i],
  ['date_chunks', /createDateChunks|dateChunk/i],
  ['retry_sleep', /\bsleep\s*\(|retry|rate.?limit/i]
];

function readLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/\r?\n/);
}

function matchesAny(line) {
  const keys = [];
  for (const [key, rx] of PATTERNS) {
    if (rx.test(line)) keys.push(key);
  }
  return keys;
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  ranges.sort((a,b) => a.start - b.start || a.end - b.end);
  const out = [ranges[0]];

  for (let i = 1; i < ranges.length; i++) {
    const cur = ranges[i];
    const prev = out[out.length - 1];

    if (cur.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, cur.end);
      prev.keys = [...new Set([...prev.keys, ...cur.keys])];
    } else {
      out.push(cur);
    }
  }

  return out;
}

function extractFile(root, rel) {
  const full = path.join(root, rel);

  if (!fs.existsSync(full)) {
    return { file: rel, exists: false };
  }

  const lines = readLines(full);
  const rawRanges = [];

  for (let i = 0; i < lines.length; i++) {
    const keys = matchesAny(lines[i]);
    if (!keys.length) continue;

    rawRanges.push({
      start: Math.max(0, i - 7),
      end: Math.min(lines.length - 1, i + 12),
      keys
    });
  }

  const ranges = mergeRanges(rawRanges);

  const snippets = ranges.map((r, idx) => ({
    snippetId: idx + 1,
    keys: r.keys,
    fromLine: r.start + 1,
    toLine: r.end + 1,
    text: lines
      .slice(r.start, r.end + 1)
      .map((line, j) => `${r.start + j + 1}: ${line}`)
      .join('\n')
  }));

  const namedFunctions = [];
  const fnRegex =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(|(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*async\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRegex);
    if (m) {
      namedFunctions.push({
        name: m[1] || m[2],
        line: i + 1
      });
    }
  }

  return {
    file: rel,
    exists: true,
    lineCount: lines.length,
    namedFunctions,
    snippets
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(
    root,
    'logs',
    'exact-ingestion-wiring-v9-7-24-2.json'
  );

  const files = TARGETS.map(rel => extractFile(root, rel));

  const found = files.filter(x => x.exists);
  const missing = files.filter(x => !x.exists);

  const report = {
    version: VERSION,
    status:
      found.length >= 5
        ? 'EXACT_INGESTION_WIRING_EXTRACTED'
        : 'EXACT_INGESTION_WIRING_PARTIAL',
    summary: {
      targetFiles: TARGETS.length,
      filesFound: found.length,
      filesMissing: missing.length,
      totalSnippets: found.reduce(
        (n, f) => n + f.snippets.length,
        0
      )
    },
    files,
    decisionChecklist: {
      kisDailyModeOwner:
        'Identify which function in lib/kis/client.ts supplies FID_ORG_ADJ_PRC and whether callers can explicitly request mode 0.',
      backfillWriter:
        'Confirm processMarketDataBackfillV83 writes adjusted_price=true and how it calls the KIS client.',
      dailySyncWriter:
        'Confirm syncDailyBars writes adjusted_price=true and whether its KIS call uses adjusted mode.',
      routeOwnership:
        'Confirm API routes call the lib/market functions rather than root duplicate files.',
      postActionHook:
        'Choose a reusable market-history refresh function in lib/market; do not embed refresh logic in validation scripts.'
    },
    safety: {
      networkAccess: false,
      databaseConnected: false,
      sourceFilesModified: 0,
      writesPerformed: 0
    }
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    ...report.summary,
    files: files.map(f => ({
      file: f.file,
      exists: f.exists,
      lineCount: f.lineCount ?? null,
      namedFunctions: f.namedFunctions ?? [],
      snippets: f.snippets ?? []
    })),
    writesPerformed: 0
  }, null, 2));

  console.log('Upload only this report if needed: ' + output);
}

try {
  main();
} catch (err) {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
