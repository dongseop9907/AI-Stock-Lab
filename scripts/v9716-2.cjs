'use strict';

// V9.7.16.2 read-only market_daily_bars ingestion-path discovery.
//
// Goal:
//   Find the REAL project code that writes/upserts market_daily_bars,
//   identify its upstream provider/API, row mapping, and idempotency contract,
//   so the missing 0001A0 / 204610 daily bars can be backfilled through
//   the existing ingestion pipeline instead of manually injecting web values.
//
// Safety:
//   - local filesystem read-only
//   - no DB connection
//   - no network
//   - no .env reads
//   - no INSERT / UPDATE / DELETE / UPSERT execution
//
// Run:
//   node .\scripts\v9716-2.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_16_2_MARKET_BAR_INGESTION_DISCOVERY';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 14000;
const MAX_EVIDENCE = 120;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const TEMP_PROBE = [
  /^collect-corporate-action-details-v9-7-2(?:\(1\))?\.cjs$/i,
  /^parse-corporate-action-details-v9-7-3\.cjs$/i,
  /^resolve-corporate-action-chains-v9-7-4(?:-1)?\.cjs$/i,
  /^resolve-dividend-market-adjustments-v9-7-5(?:-1)?\.cjs$/i,
  /^finalize-corporate-action-sample-v9-7-6\.cjs$/i,
  /^inspect-corporate-action-db-contract-v9-7-7(?:-fixed)?\.cjs$/i,
  /^validate-corporate-action-idempotency-v9-7-8(?:-redownload)?\.cjs$/i,
  /^resolve-corporate-action-column-semantics-v9-7-9\.cjs$/i,
  /^v9-7-9-column-semantics\.cjs$/i,
  /^v9-7-9-1-clean-semantics\.cjs$/i,
  /^v9-7-9-2-cash-mapping\.cjs$/i,
  /^v9-7-9-3-cash-consumer\.cjs$/i,
  /^v9710\.cjs$/i,
  /^v9711\.cjs$/i,
  /^v9713(?:-1)?\.cjs$/i,
  /^v9714\.cjs$/i,
  /^v9715\.cjs$/i,
  /^v9716(?:-1|-2)?\.cjs$/i
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'MARKET_BAR_INGESTION_DISCOVERY_FAILED';
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function walk(root) {
  const files = [];
  const stack = [root];

  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (files.length >= MAX_FILES) break;

      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        stack.push(full);
        continue;
      }

      if (!e.isFile()) continue;
      if (SENSITIVE_NAME.test(rel)) continue;
      if (TEMP_PROBE.some(rx => rx.test(path.basename(rel)))) continue;

      const ext = path.extname(e.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;

      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) continue;
      files.push({ full, rel, ext, size: stat.size });
    }
  }

  return files;
}

function lineNumberAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function context(text, index, before = 14, after = 20) {
  const lines = text.split(/\r?\n/);
  const line = lineNumberAt(text, index);
  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    text: lines
      .slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 12000)
  };
}

function push(arr, item) {
  if (arr.length < MAX_EVIDENCE) arr.push(item);
}

function providerHints(text) {
  const hints = [];

  const patterns = [
    ['KIS', /korea\s*investment|한국투자|kis\b|openapi\.koreainvestment|uapi\/domestic-stock/i],
    ['KIS_DAILY_ITEM_CHART', /inquire-daily-itemchartprice|FHKST03010100/i],
    ['KRX', /\bkrx\b|data\.krx|kind\.krx/i],
    ['NAVER_FINANCE', /finance\.naver|naver.*stock|naver.*finance/i],
    ['FINANCEDATAREADER', /FinanceDataReader|\bFDR\b/i],
    ['YAHOO_FINANCE', /query1\.finance\.yahoo|yfinance|yahoo.*finance/i],
    ['PUBLIC_DATA_PORTAL', /data\.go\.kr|공공데이터|apis\.data\.go\.kr/i],
    ['ALPHA_VANTAGE', /alphavantage/i],
    ['POLYGON', /polygon\.io/i]
  ];

  for (const [name, rx] of patterns) {
    if (rx.test(text)) hints.push(name);
  }

  return hints;
}

function extractConflictTarget(text) {
  const hits = [];

  const patterns = [
    /onConflict\s*:\s*['"`]([^'"`]+)['"`]/ig,
    /on_conflict=([^&'"`\s]+)/ig,
    /on\s+conflict\s*\(([^)]+)\)/ig
  ];

  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(text))) {
      hits.push(m[1].replace(/\s+/g, ' ').trim());
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }

  return [...new Set(hits)];
}

function scan(root) {
  const files = walk(root);

  const evidence = {
    writeSites: [],
    readSites: [],
    providerApiSites: [],
    mappingSites: [],
    sqlDefinitions: []
  };

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    const lower = text.toLowerCase();
    if (!lower.includes('market_daily_bars') &&
        !lower.includes('close_price') &&
        !lower.includes('trading_date')) {
      continue;
    }

    // Supabase/PostgREST write sites.
    const writeRx = /\.from\s*\(\s*['"`]market_daily_bars['"`]\s*\)[\s\S]{0,2500}?\.(insert|upsert|update)\s*\(([\s\S]{0,3500}?)\)/ig;
    let m;

    while ((m = writeRx.exec(text))) {
      const ctx = context(text, m.index, 20, 32);
      const block = m[0];

      push(evidence.writeSites, {
        file: file.rel,
        line: ctx.line,
        operation: m[1].toUpperCase(),
        providerHints: providerHints(`${block}\n${ctx.text}`),
        conflictTargets: extractConflictTarget(`${block}\n${ctx.text}`),
        context: ctx.text
      });

      if (m.index === writeRx.lastIndex) writeRx.lastIndex++;
    }

    // SQL inserts / upserts.
    const sqlWriteRx = /\binsert\s+into\s+(?:public\.)?market_daily_bars\b[\s\S]{0,3000}?(?:on\s+conflict[\s\S]{0,700})?/ig;
    while ((m = sqlWriteRx.exec(text))) {
      const ctx = context(text, m.index, 20, 28);
      push(evidence.writeSites, {
        file: file.rel,
        line: ctx.line,
        operation: 'SQL_INSERT',
        providerHints: providerHints(`${m[0]}\n${ctx.text}`),
        conflictTargets: extractConflictTarget(`${m[0]}\n${ctx.text}`),
        context: ctx.text
      });
      if (m.index === sqlWriteRx.lastIndex) sqlWriteRx.lastIndex++;
    }

    // Reads.
    const readRx = /\.from\s*\(\s*['"`]market_daily_bars['"`]\s*\)[\s\S]{0,1800}?\.select\s*\(/ig;
    while ((m = readRx.exec(text))) {
      const ctx = context(text, m.index, 12, 18);
      push(evidence.readSites, {
        file: file.rel,
        line: ctx.line,
        context: ctx.text
      });
      if (m.index === readRx.lastIndex) readRx.lastIndex++;
    }

    // Likely upstream API/provider sites near daily-bar mapping.
    const providerRx = /(inquire-daily-itemchartprice|FHKST03010100|uapi\/domestic-stock|openapi\.koreainvestment|data\.go\.kr|apis\.data\.go\.kr|query1\.finance\.yahoo|finance\.naver|FinanceDataReader|data\.krx)/ig;
    while ((m = providerRx.exec(text))) {
      const ctx = context(text, m.index, 18, 28);
      push(evidence.providerApiSites, {
        file: file.rel,
        line: ctx.line,
        match: m[0],
        providerHints: providerHints(ctx.text),
        context: ctx.text
      });
      if (m.index === providerRx.lastIndex) providerRx.lastIndex++;
    }

    // Mapping sites that mention all core bar columns.
    if (
      lower.includes('stock_code') &&
      lower.includes('trading_date') &&
      lower.includes('close_price')
    ) {
      const idx = lower.indexOf('close_price');
      const ctx = context(text, idx, 18, 28);
      push(evidence.mappingSites, {
        file: file.rel,
        line: ctx.line,
        providerHints: providerHints(ctx.text),
        conflictTargets: extractConflictTarget(ctx.text),
        context: ctx.text
      });
    }

    if (file.ext === '.sql' && lower.includes('market_daily_bars')) {
      const idx = lower.indexOf('market_daily_bars');
      const ctx = context(text, idx, 20, 40);
      push(evidence.sqlDefinitions, {
        file: file.rel,
        line: ctx.line,
        context: ctx.text
      });
    }
  }

  return { filesScanned: files.length, evidence };
}

function summarize(scanResult) {
  const writerFiles = [...new Set(scanResult.evidence.writeSites.map(x => x.file))];
  const providerSet = new Set();

  for (const bucket of [
    scanResult.evidence.writeSites,
    scanResult.evidence.providerApiSites,
    scanResult.evidence.mappingSites
  ]) {
    for (const item of bucket) {
      for (const hint of item.providerHints || []) providerSet.add(hint);
    }
  }

  const conflictTargets = new Set();
  for (const item of scanResult.evidence.writeSites) {
    for (const c of item.conflictTargets || []) conflictTargets.add(c);
  }

  return {
    writerFiles,
    providerHints: [...providerSet],
    conflictTargets: [...conflictTargets]
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  if (args.some(a => !a.startsWith('--output='))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'market-daily-bars-ingestion-discovery-v9-7-16-2.json'
      );

  const result = scan(root);
  const summary = summarize(result);

  let status;
  if (result.evidence.writeSites.length === 0) {
    status = 'MARKET_BAR_WRITER_NOT_FOUND';
  } else if (summary.providerHints.length === 0) {
    status = 'MARKET_BAR_WRITER_FOUND_PROVIDER_REVIEW_REQUIRED';
  } else {
    status = 'MARKET_BAR_INGESTION_PATH_FOUND';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'LOCAL_READ_ONLY_INGESTION_DISCOVERY',
    scan: {
      filesScanned: result.filesScanned,
      writeSites: result.evidence.writeSites.length,
      readSites: result.evidence.readSites.length,
      providerApiSites: result.evidence.providerApiSites.length,
      mappingSites: result.evidence.mappingSites.length
    },
    summary,
    evidence: result.evidence,
    missingWindowsToRepair: [
      {
        stockCode: '0001A0',
        requiredReferenceDate: '2026-08-13',
        effectiveDate: '2026-08-14',
        currentDbLatestPriorDate: '2026-07-31',
        reason: 'TARGET_BAR_GAP_CONFIRMED'
      },
      {
        stockCode: '204610',
        requiredReferenceDate: '2026-08-27',
        effectiveDate: '2026-08-28',
        currentDbLatestPriorDate: '2026-08-14',
        reason: 'TARGET_BAR_GAP_CONFIRMED'
      }
    ],
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      writesPerformed: 0,
      marketBarsInserted: 0,
      adjustmentRowsInserted: 0,
      coveragePromoted: false
    },
    nextGate:
      status === 'MARKET_BAR_INGESTION_PATH_FOUND'
        ? 'USE_EXISTING_PROVIDER_PIPELINE_TO_BACKFILL_THE_TWO_MISSING_WINDOWS_THEN_RERUN_V9_7_16_1'
        : 'REVIEW_WRITER_OR_IMPLEMENT_AUTHORITATIVE_BAR_BACKFILL_PATH'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status,
    filesScanned: state.scan.filesScanned,
    writeSitesFound: state.scan.writeSites,
    writerFiles: summary.writerFiles,
    providerHints: summary.providerHints,
    conflictTargets: summary.conflictTargets,
    missingWindows: state.missingWindowsToRepair,
    writesPerformed: 0,
    marketBarsInserted: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report: ' + outputFile);

  if (status === 'MARKET_BAR_WRITER_NOT_FOUND') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}
