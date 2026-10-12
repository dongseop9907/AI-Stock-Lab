'use strict';

// V9.7.24 read-only market_daily_bars ingestion / writer discovery.
//
// Goal:
//   Find the exact local code paths that:
//     - call KIS daily historical price APIs
//     - set FID_ORG_ADJ_PRC
//     - write/upsert market_daily_bars
//     - set adjusted_price
//     - stamp source such as KIS_DAILY_V8_3
//
// This script does NOT touch Supabase or KIS.
// It only scans the local repository.
//
// Run:
//   node .\scripts\v9724.cjs
//
// Optional:
//   node .\scripts\v9724.cjs --root=C:\Users\user\Desktop\ai-stock-lab

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_24_MARKET_DAILY_BARS_WRITER_DISCOVERY';

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sql', '.json'
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '.vercel',
  '.cache'
]);

const SKIP_FILE_PREFIXES = [
  'row-level-price-basis',
  'stale-history-provenance',
  'focused-038060-basis',
  'all-supported-event-price-basis-audit',
  'controlled-stale-history-refresh',
  'proven-stale-history-refresh'
];

const PATTERNS = [
  { key: 'market_daily_bars', rx: /market_daily_bars/gi },
  { key: 'FID_ORG_ADJ_PRC', rx: /FID_ORG_ADJ_PRC/gi },
  { key: 'adjusted_price', rx: /adjusted_price/gi },
  { key: 'KIS_DAILY_V8_3', rx: /KIS_DAILY_V8_3/gi },
  {
    key: 'inquire_daily_itemchartprice',
    rx: /inquire-daily-itemchartprice/gi
  },
  {
    key: 'daily_itemchartprice_function',
    rx: /inquireDailyItemchartprice|inquire_daily_itemchartprice/gi
  },
  {
    key: 'supabase_upsert',
    rx: /\.upsert\s*\(|resolution=merge-duplicates|on_conflict/gi
  },
  {
    key: 'supabase_insert',
    rx: /\.insert\s*\(/gi
  },
  {
    key: 'postgrest_table_reference',
    rx: /\.from\s*\(\s*['"`]market_daily_bars['"`]\s*\)/gi
  }
];

function parseArgs() {
  const args = process.argv.slice(2);
  let root = path.resolve(__dirname, '..');
  let output = null;

  for (const arg of args) {
    if (arg.startsWith('--root=')) {
      root = path.resolve(arg.slice('--root='.length));
    } else if (arg.startsWith('--output=')) {
      output = path.resolve(arg.slice('--output='.length));
    } else {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  return {
    root,
    output:
      output ||
      path.join(
        root,
        'logs',
        'market-daily-bars-writer-discovery-v9-7-24.json'
      )
  };
}

function walk(root) {
  const out = [];

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(dir, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const full = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (!DEFAULT_EXTENSIONS.has(ext)) continue;

      const lower = entry.name.toLowerCase();
      if (
        SKIP_FILE_PREFIXES.some(prefix =>
          lower.startsWith(prefix.toLowerCase())
        )
      ) {
        continue;
      }

      out.push(full);
    }
  }

  visit(root);
  return out;
}

function countMatches(text, rx) {
  const copy = new RegExp(rx.source, rx.flags);
  const matches = text.match(copy);
  return matches ? matches.length : 0;
}

function lineContext(text, rx, radius = 3, maxHits = 8) {
  const lines = text.split(/\r?\n/);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const localRx = new RegExp(rx.source, rx.flags.replace('g', ''));
    if (!localRx.test(lines[i])) continue;

    const from = Math.max(0, i - radius);
    const to = Math.min(lines.length - 1, i + radius);

    result.push({
      line: i + 1,
      fromLine: from + 1,
      toLine: to + 1,
      snippet: lines
        .slice(from, to + 1)
        .map((line, idx) => `${from + idx + 1}: ${line}`)
        .join('\n')
    });

    if (result.length >= maxHits) break;
  }

  return result;
}

function extractAdjModes(text) {
  const evidence = [];

  const regexes = [
    /FID_ORG_ADJ_PRC\s*[:=]\s*['"`]?([01])['"`]?/gi,
    /['"`]FID_ORG_ADJ_PRC['"`]\s*:\s*['"`]?([01])['"`]?/gi,
    /FID_ORG_ADJ_PRC.*?\b([01])\b/gi
  ];

  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(text))) {
      evidence.push({
        mode: m[1],
        index: m.index,
        raw: m[0].slice(0, 200)
      });
      if (evidence.length >= 20) break;
    }
    if (evidence.length >= 20) break;
  }

  return evidence;
}

function classifyFile(relative, text, counts, adjModes) {
  const hasTable = counts.market_daily_bars > 0;
  const hasWrite =
    counts.supabase_upsert > 0 ||
    counts.supabase_insert > 0;
  const hasKisDaily =
    counts.FID_ORG_ADJ_PRC > 0 ||
    counts.inquire_daily_itemchartprice > 0 ||
    counts.daily_itemchartprice_function > 0;
  const hasAdjustedPrice = counts.adjusted_price > 0;

  const scores = {
    writerCandidate: 0,
    collectorCandidate: 0,
    policyCandidate: 0
  };

  if (hasTable) scores.writerCandidate += 3;
  if (hasWrite) scores.writerCandidate += 4;
  if (counts.postgrest_table_reference > 0) {
    scores.writerCandidate += 4;
  }
  if (counts.KIS_DAILY_V8_3 > 0) {
    scores.writerCandidate += 2;
  }
  if (hasAdjustedPrice) {
    scores.writerCandidate += 1;
    scores.policyCandidate += 2;
  }

  if (hasKisDaily) scores.collectorCandidate += 5;
  if (counts.FID_ORG_ADJ_PRC > 0) {
    scores.collectorCandidate += 3;
    scores.policyCandidate += 3;
  }

  const mode0Evidence =
    adjModes.filter(x => x.mode === '0').length;
  const mode1Evidence =
    adjModes.filter(x => x.mode === '1').length;

  let modeSignal = 'NO_LITERAL_MODE_EVIDENCE';
  if (mode0Evidence > 0 && mode1Evidence === 0) {
    modeSignal = 'LITERAL_MODE_0_PRESENT';
  } else if (mode1Evidence > 0 && mode0Evidence === 0) {
    modeSignal = 'LITERAL_MODE_1_PRESENT';
  } else if (mode0Evidence > 0 && mode1Evidence > 0) {
    modeSignal = 'BOTH_LITERAL_MODES_PRESENT';
  }

  let role = 'RELATED_REFERENCE';

  if (
    scores.writerCandidate >= 7 &&
    scores.collectorCandidate >= 5
  ) {
    role = 'KIS_MARKET_BAR_COLLECTOR_AND_WRITER';
  } else if (scores.writerCandidate >= 7) {
    role = 'MARKET_BAR_WRITER_CANDIDATE';
  } else if (scores.collectorCandidate >= 5) {
    role = 'KIS_DAILY_COLLECTOR_CANDIDATE';
  } else if (scores.policyCandidate >= 3) {
    role = 'PRICE_BASIS_POLICY_REFERENCE';
  }

  return {
    relative,
    role,
    scores,
    modeSignal
  };
}

function safeRead(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 5 * 1024 * 1024) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function main() {
  const { root, output } = parseArgs();

  if (!fs.existsSync(root)) {
    throw new Error('ROOT_NOT_FOUND');
  }

  const files = walk(root);
  const findings = [];

  for (const file of files) {
    const text = safeRead(file);
    if (text == null) continue;

    const counts = {};
    let totalHits = 0;

    for (const p of PATTERNS) {
      counts[p.key] = countMatches(text, p.rx);
      totalHits += counts[p.key];
    }

    if (totalHits === 0) continue;

    const adjModes = extractAdjModes(text);

    const relative =
      path.relative(root, file).replaceAll('\\', '/');

    const classification =
      classifyFile(relative, text, counts, adjModes);

    const contexts = {};

    for (const p of PATTERNS) {
      if (counts[p.key] <= 0) continue;
      contexts[p.key] = lineContext(
        text,
        p.rx,
        3,
        6
      );
    }

    findings.push({
      file: relative,
      role: classification.role,
      scores: classification.scores,
      modeSignal: classification.modeSignal,
      counts,
      adjModeEvidence: adjModes,
      contexts
    });
  }

  findings.sort((a, b) => {
    const aScore =
      a.scores.writerCandidate +
      a.scores.collectorCandidate +
      a.scores.policyCandidate;
    const bScore =
      b.scores.writerCandidate +
      b.scores.collectorCandidate +
      b.scores.policyCandidate;

    if (bScore !== aScore) return bScore - aScore;
    return a.file.localeCompare(b.file);
  });

  const writerCandidates = findings.filter(
    x =>
      x.role === 'KIS_MARKET_BAR_COLLECTOR_AND_WRITER' ||
      x.role === 'MARKET_BAR_WRITER_CANDIDATE'
  );

  const collectorCandidates = findings.filter(
    x =>
      x.role === 'KIS_MARKET_BAR_COLLECTOR_AND_WRITER' ||
      x.role === 'KIS_DAILY_COLLECTOR_CANDIDATE'
  );

  const mode0Files = findings.filter(
    x =>
      x.modeSignal === 'LITERAL_MODE_0_PRESENT' ||
      x.modeSignal === 'BOTH_LITERAL_MODES_PRESENT'
  );

  const mode1Files = findings.filter(
    x =>
      x.modeSignal === 'LITERAL_MODE_1_PRESENT' ||
      x.modeSignal === 'BOTH_LITERAL_MODES_PRESENT'
  );

  const sourceTagFiles = findings.filter(
    x => x.counts.KIS_DAILY_V8_3 > 0
  );

  const report = {
    version: VERSION,
    status:
      writerCandidates.length > 0
        ? 'MARKET_BAR_WRITER_CANDIDATES_FOUND'
        : 'MARKET_BAR_WRITER_REVIEW_REQUIRED',
    root,
    summary: {
      filesScanned: files.length,
      relevantFiles: findings.length,
      writerCandidates: writerCandidates.length,
      collectorCandidates: collectorCandidates.length,
      filesWithLiteralMode0: mode0Files.length,
      filesWithLiteralMode1: mode1Files.length,
      filesWithKisDailyV83SourceTag:
        sourceTagFiles.length
    },
    storageContractToImplement: {
      canonicalPriceBasis:
        'KIS inquire-daily-itemchartprice FID_ORG_ADJ_PRC=0',
      adjustedPriceFlag:
        true,
      sourceExpectation:
        'KIS_DAILY_V8_3_OR_SUCCESSOR',
      postCorporateActionRefresh:
        'REQUERY_PRE_ACTION_HISTORICAL_WINDOW_FROM_MODE_0_AND_UPSERT_BY_stock_code_trading_date',
      doNotMultiplyAdjustmentFactorIntoAlreadyAdjustedBars:
        true
    },
    writerCandidates: writerCandidates.map(x => ({
      file: x.file,
      role: x.role,
      scores: x.scores,
      modeSignal: x.modeSignal,
      counts: x.counts
    })),
    collectorCandidates: collectorCandidates.map(x => ({
      file: x.file,
      role: x.role,
      scores: x.scores,
      modeSignal: x.modeSignal,
      counts: x.counts
    })),
    allFindings: findings,
    safety: {
      databaseConnected: false,
      kisConnected: false,
      filesModified: 0,
      writesPerformed: 0
    },
    nextGate:
      writerCandidates.length > 0
        ? 'INSPECT_TOP_WRITER_CANDIDATE_AND_PATCH_EXISTING_INGESTION_WITH_POST_ACTION_REFRESH'
        : 'LOCATE_OR_CREATE_CANONICAL_MARKET_BAR_INGESTION_WRITER'
  };

  saveJson(output, report);

  console.log(JSON.stringify({
    status: report.status,
    filesScanned: report.summary.filesScanned,
    relevantFiles: report.summary.relevantFiles,
    writerCandidates: report.summary.writerCandidates,
    collectorCandidates: report.summary.collectorCandidates,
    filesWithLiteralMode0:
      report.summary.filesWithLiteralMode0,
    filesWithLiteralMode1:
      report.summary.filesWithLiteralMode1,
    filesWithKisDailyV83SourceTag:
      report.summary.filesWithKisDailyV83SourceTag,
    topWriterCandidates:
      report.writerCandidates.slice(0, 10),
    topCollectorCandidates:
      report.collectorCandidates.slice(0, 10),
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
