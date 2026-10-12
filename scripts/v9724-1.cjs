'use strict';

// V9.7.24.1 read-only canonical market ingestion path inspector.
//
// Goal:
//   Identify the real production ingestion path among the candidates found
//   by v9.7.24, while excluding one-off validation/repair scripts.
//
// Focus:
//   - lib/market/process-market-data-backfill-v8-3.ts
//   - process-market-data-backfill-v8-3.ts
//   - lib/market/sync-daily-bars.ts
//   - imports/callers/package scripts referencing those files/functions
//   - non-scripts source files containing FID_ORG_ADJ_PRC / KIS daily API
//
// This script only reads local files.
//
// Run:
//   node .\scripts\v9724-1.cjs

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_24_1_CANONICAL_MARKET_INGESTION_PATH_INSPECTOR';

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.turbo',
  'dist', 'build', 'coverage', '.vercel', '.cache'
]);

const EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'
]);

const FOCUS_FILES = [
  'lib/market/process-market-data-backfill-v8-3.ts',
  'process-market-data-backfill-v8-3.ts',
  'lib/market/sync-daily-bars.ts'
];

const INTEREST_PATTERNS = [
  ['market_daily_bars', /market_daily_bars/i],
  ['adjusted_price', /adjusted_price/i],
  ['KIS_DAILY_V8_3', /KIS_DAILY_V8_3/i],
  ['FID_ORG_ADJ_PRC', /FID_ORG_ADJ_PRC/i],
  ['daily_api', /inquire-daily-itemchartprice/i],
  ['upsert', /\.upsert\s*\(|resolution=merge-duplicates|on_conflict/i],
  ['insert', /\.insert\s*\(/i],
  ['source_assignment', /\bsource\s*[:=]/i],
  ['adjusted_assignment', /\badjusted_price\s*[:=]/i],
  ['fetch', /\bfetch\s*\(/i],
  ['supabase_from', /\.from\s*\(/i]
];

function walk(root) {
  const files = [];

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        visit(path.join(dir, e.name));
        continue;
      }

      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!EXTENSIONS.has(ext)) continue;
      files.push(path.join(dir, e.name));
    }
  }

  visit(root);
  return files;
}

function readText(file) {
  try {
    const s = fs.statSync(file);
    if (s.size > 5 * 1024 * 1024) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function snippets(text, regex, radius = 4, max = 12) {
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const local = new RegExp(regex.source, regex.flags.replace('g', ''));
    if (!local.test(lines[i])) continue;

    const from = Math.max(0, i - radius);
    const to = Math.min(lines.length - 1, i + radius);

    out.push({
      line: i + 1,
      fromLine: from + 1,
      toLine: to + 1,
      snippet: lines
        .slice(from, to + 1)
        .map((line, j) => `${from + j + 1}: ${line}`)
        .join('\n')
    });

    if (out.length >= max) break;
  }

  return out;
}

function summarizeFocusFile(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    return {
      file: rel,
      exists: false
    };
  }

  const text = readText(full);
  if (text == null) {
    return {
      file: rel,
      exists: true,
      readable: false
    };
  }

  const evidence = {};
  for (const [key, rx] of INTEREST_PATTERNS) {
    const s = snippets(text, rx);
    if (s.length) evidence[key] = s;
  }

  const exports = [];
  const exportRx =
    /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = exportRx.exec(text))) exports.push(m[1]);

  const functions = [];
  const fnRx =
    /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(|const\s+([A-Za-z0-9_]+)\s*=\s*async\s*\(/g;
  while ((m = fnRx.exec(text))) {
    functions.push(m[1] || m[2]);
  }

  return {
    file: rel,
    exists: true,
    readable: true,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256(text),
    exports: [...new Set(exports)],
    functions: [...new Set(functions)].slice(0, 80),
    evidence
  };
}

function findReferences(root, files, focusSummaries) {
  const refs = [];

  const searchTerms = new Set([
    'process-market-data-backfill-v8-3',
    'sync-daily-bars',
    'processMarketDataBackfill',
    'syncDailyBars'
  ]);

  for (const focus of focusSummaries) {
    for (const x of focus.exports || []) searchTerms.add(x);
  }

  for (const full of files) {
    const rel = path.relative(root, full).replaceAll('\\', '/');

    // Exclude v9.7 diagnostic scripts from caller evidence.
    if (rel.startsWith('scripts/v97')) continue;
    if (rel.startsWith('logs/')) continue;

    const text = readText(full);
    if (text == null) continue;

    const hits = [];

    for (const term of searchTerms) {
      if (!term) continue;
      if (!text.includes(term)) continue;

      const rx = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );

      hits.push({
        term,
        snippets: snippets(text, rx, 3, 6)
      });
    }

    if (hits.length) {
      refs.push({
        file: rel,
        hits
      });
    }
  }

  return refs;
}

function findNonScriptKisSources(root, files) {
  const out = [];

  for (const full of files) {
    const rel = path.relative(root, full).replaceAll('\\', '/');

    if (rel.startsWith('scripts/')) continue;
    if (rel.startsWith('logs/')) continue;

    const text = readText(full);
    if (text == null) continue;

    const hasAdj = /FID_ORG_ADJ_PRC/i.test(text);
    const hasDaily =
      /inquire-daily-itemchartprice/i.test(text) ||
      /daily-itemchartprice/i.test(text);

    if (!hasAdj && !hasDaily) continue;

    out.push({
      file: rel,
      fidOrgAdjPrc: hasAdj
        ? snippets(text, /FID_ORG_ADJ_PRC/i, 4, 10)
        : [],
      dailyApi: hasDaily
        ? snippets(text, /inquire-daily-itemchartprice|daily-itemchartprice/i, 4, 10)
        : []
    });
  }

  return out;
}

function packageScriptEvidence(root) {
  const pkg = path.join(root, 'package.json');
  if (!fs.existsSync(pkg)) return null;

  const text = readText(pkg);
  if (text == null) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      file: 'package.json',
      parseError: true
    };
  }

  const scripts = parsed.scripts || {};
  const interesting = {};

  for (const [name, cmd] of Object.entries(scripts)) {
    const s = String(cmd);
    if (
      /market|backfill|daily|sync|kis|stock/i.test(name) ||
      /process-market-data-backfill-v8-3|sync-daily-bars|market_daily_bars/i.test(s)
    ) {
      interesting[name] = s;
    }
  }

  return {
    file: 'package.json',
    scripts: interesting
  };
}

function compareFocusCopies(focusSummaries) {
  const byFile = Object.fromEntries(
    focusSummaries
      .filter(x => x.exists && x.readable)
      .map(x => [x.file, x])
  );

  const a = byFile['lib/market/process-market-data-backfill-v8-3.ts'];
  const b = byFile['process-market-data-backfill-v8-3.ts'];

  if (!a || !b) {
    return {
      comparable: false
    };
  }

  return {
    comparable: true,
    identicalSha256: a.sha256 === b.sha256,
    libSha256: a.sha256,
    rootSha256: b.sha256,
    libBytes: a.bytes,
    rootBytes: b.bytes
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(
    root,
    'logs',
    'canonical-market-ingestion-path-v9-7-24-1.json'
  );

  const files = walk(root);

  const focusSummaries =
    FOCUS_FILES.map(rel => summarizeFocusFile(root, rel));

  const refs =
    findReferences(root, files, focusSummaries);

  const nonScriptKisSources =
    findNonScriptKisSources(root, files);

  const packageScripts =
    packageScriptEvidence(root);

  const copyComparison =
    compareFocusCopies(focusSummaries);

  const existingFocus =
    focusSummaries.filter(x => x.exists && x.readable);

  let likelyCanonicalWriter = null;
  let likelyCanonicalSyncEntry = null;

  const libBackfill =
    existingFocus.find(
      x => x.file === 'lib/market/process-market-data-backfill-v8-3.ts'
    );

  const syncDaily =
    existingFocus.find(
      x => x.file === 'lib/market/sync-daily-bars.ts'
    );

  if (libBackfill) {
    likelyCanonicalWriter = libBackfill.file;
  }

  if (syncDaily) {
    likelyCanonicalSyncEntry = syncDaily.file;
  }

  const report = {
    version: VERSION,
    status:
      likelyCanonicalWriter || likelyCanonicalSyncEntry
        ? 'CANONICAL_MARKET_INGESTION_PATH_CANDIDATES_NARROWED'
        : 'CANONICAL_MARKET_INGESTION_PATH_REVIEW_REQUIRED',
    root,
    summary: {
      filesScanned: files.length,
      focusFilesFound: existingFocus.length,
      callerReferenceFiles: refs.length,
      nonScriptKisSourceFiles: nonScriptKisSources.length,
      rootAndLibBackfillComparable: copyComparison.comparable,
      rootAndLibBackfillIdentical:
        copyComparison.identicalSha256 ?? null
    },
    likelyCanonicalWriter,
    likelyCanonicalSyncEntry,
    focusFiles: focusSummaries,
    rootVsLibBackfill: copyComparison,
    callerReferences: refs,
    nonScriptKisSources,
    packageScripts,
    decisionRules: {
      preferLibModuleOverRootCopy:
        'Prefer lib/market module if it is imported/called by app/runtime code.',
      preferActualCallerEvidence:
        'Caller/import evidence outranks filename similarity.',
      doNotPatchValidationScripts:
        true,
      desiredStorageContract:
        'KIS mode0 adjusted prices, adjusted_price=true',
      desiredPostActionBehavior:
        'After a supported corporate action, re-query relevant pre-action history from KIS mode0 and idempotently upsert stale rows.'
    },
    safety: {
      databaseConnected: false,
      kisConnected: false,
      filesModified: 0,
      writesPerformed: 0
    }
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tmp = output + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2), 'utf8');
  fs.renameSync(tmp, output);

  console.log(JSON.stringify({
    status: report.status,
    filesScanned: report.summary.filesScanned,
    focusFilesFound: report.summary.focusFilesFound,
    callerReferenceFiles: report.summary.callerReferenceFiles,
    nonScriptKisSourceFiles: report.summary.nonScriptKisSourceFiles,
    rootAndLibBackfillComparable:
      report.summary.rootAndLibBackfillComparable,
    rootAndLibBackfillIdentical:
      report.summary.rootAndLibBackfillIdentical,
    likelyCanonicalWriter,
    likelyCanonicalSyncEntry,
    focusFiles: focusSummaries.map(x => ({
      file: x.file,
      exists: x.exists,
      readable: x.readable ?? null,
      bytes: x.bytes ?? null,
      sha256: x.sha256 ?? null,
      exports: x.exports ?? [],
      functions: x.functions ?? []
    })),
    callerReferenceFiles: refs.map(x => x.file),
    nonScriptKisSourceFiles:
      nonScriptKisSources.map(x => x.file),
    packageScripts:
      packageScripts?.scripts ?? {},
    writesPerformed: 0
  }, null, 2));

  console.log(
    'Upload only this report if needed: ' + output
  );
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
