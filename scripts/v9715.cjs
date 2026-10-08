'use strict';

// V9.7.15 read-only price-source contract discovery.
// Goal:
//   Find existing local DB tables/code paths that can supply the verified
//   pre-event reference price needed for CASH_DIVIDEND adjustment factors.
//
// Safety:
//   - local filesystem read-only
//   - no database connection
//   - no network
//   - no .env reads
//   - no INSERT/UPDATE/DELETE/UPSERT
//
// Looks for:
//   - SQL tables containing stock/security identifier + market date + close/reference price
//   - indexes/unique keys on stock/date
//   - Supabase .from('...') reads of likely price tables
//   - code references to close, previous close, adjusted close, OHLCV, daily bars
//
// Run:
//   node .\scripts\v9715.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_15_PRICE_SOURCE_DISCOVERY';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_EVIDENCE = 80;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.prisma'
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
  /^v9715\.cjs$/i
];

const STOCK_COLS = [
  'stock_code', 'symbol', 'ticker', 'security_code', 'issue_code', 'code'
];

const DATE_COLS = [
  'trade_date', 'market_date', 'trading_date', 'date', 'business_date',
  'base_date', 'observed_date'
];

const PRICE_COLS = [
  'close', 'close_price', 'closing_price', 'prev_close', 'previous_close',
  'reference_price', 'base_price', 'adj_close', 'adjusted_close',
  'open', 'high', 'low'
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'PRICE_SOURCE_DISCOVERY_FAILED';
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeIdent(v) {
  return String(v ?? '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();
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

function cleanSql(sql) {
  return sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevelCsv(text) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i ? text[i - 1] : '';

    if (quote) {
      cur += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }

    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }

    cur += ch;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function findCreateTables(sql) {
  const cleaned = cleanSql(sql);
  const rx = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*\(/ig;
  const out = [];
  let m;

  while ((m = rx.exec(cleaned))) {
    const open = rx.lastIndex - 1;
    let depth = 0;
    let quote = null;
    let close = -1;

    for (let i = open; i < cleaned.length; i++) {
      const ch = cleaned[i];
      const prev = i ? cleaned[i - 1] : '';

      if (quote) {
        if (ch === quote && prev !== '\\') quote = null;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }

      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }

    if (close < 0) continue;

    const body = cleaned.slice(open + 1, close);
    const columns = [];

    for (const item of splitTopLevelCsv(body)) {
      if (/^(constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(item)) {
        continue;
      }

      const cm = item.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/s);
      if (!cm) continue;

      columns.push({
        name: normalizeIdent(cm[1]),
        definition: cm[2].replace(/\s+/g, ' ').trim().slice(0, 500)
      });
    }

    out.push({
      tableName: normalizeIdent(m[1]),
      columns,
      body: body.replace(/\s+/g, ' ').trim().slice(0, 5000)
    });

    rx.lastIndex = close + 1;
  }

  return out;
}

function parseIndexes(sql) {
  const cleaned = cleanSql(sql);
  const out = [];
  const rx = /\bcreate\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?["`]?([\w-]+)["`]?\s+on\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*(?:using\s+\w+\s*)?\(([^;]+?)\)(?:\s+where\s+([^;]+))?\s*;/ig;
  let m;

  while ((m = rx.exec(cleaned))) {
    out.push({
      unique: !!m[1],
      indexName: normalizeIdent(m[2]),
      tableName: normalizeIdent(m[3]),
      expression: m[4].replace(/\s+/g, ' ').trim(),
      where: m[5] ? m[5].replace(/\s+/g, ' ').trim() : null
    });
  }

  return out;
}

function scoreTable(table) {
  const cols = new Set(table.columns.map(c => c.name));

  const stockMatches = STOCK_COLS.filter(c => cols.has(c));
  const dateMatches = DATE_COLS.filter(c => cols.has(c));
  const priceMatches = PRICE_COLS.filter(c => cols.has(c));

  let score = 0;
  if (stockMatches.length) score += 5;
  if (dateMatches.length) score += 5;
  if (priceMatches.length) score += 7;

  if (/price|ohlc|bar|candle|daily|market|quote|stock|history/i.test(table.tableName)) {
    score += 3;
  }

  if (cols.has('volume')) score += 2;
  if (cols.has('adjusted_close') || cols.has('adj_close')) score += 2;
  if (cols.has('prev_close') || cols.has('previous_close')) score += 2;

  return {
    score,
    stockMatches,
    dateMatches,
    priceMatches
  };
}

function lineContext(text, index, before = 6, after = 8) {
  const lines = text.split(/\r?\n/);
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }

  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    text: lines
      .slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 6000)
  };
}

function scanCodeRefs(file, text, evidence) {
  const lower = text.toLowerCase();

  const fromRx = /\.from\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let m;

  while ((m = fromRx.exec(text))) {
    const table = normalizeIdent(m[2]);
    const ctx = lineContext(text, m.index);

    if (/price|ohlc|bar|candle|daily|market|quote|history|stock/i.test(table) ||
        /\b(close|close_price|prev_close|previous_close|reference_price|adjusted_close|adj_close|trade_date|market_date)\b/i.test(ctx.text)) {
      if (evidence.supabaseRefs.length < MAX_EVIDENCE) {
        evidence.supabaseRefs.push({
          tableName: table,
          file: file.rel,
          line: ctx.line,
          context: ctx.text
        });
      }
    }

    if (m.index === fromRx.lastIndex) fromRx.lastIndex++;
  }

  const priceTerms = [
    'close_price', 'closing_price', 'prev_close', 'previous_close',
    'reference_price', 'adjusted_close', 'adj_close',
    'trade_date', 'market_date', 'daily_bar', 'ohlcv'
  ];

  for (const term of priceTerms) {
    if (!lower.includes(term)) continue;

    const rx = new RegExp(`\\b${term}\\b`, 'ig');
    while ((m = rx.exec(text))) {
      if (evidence.priceCodeRefs.length >= MAX_EVIDENCE) break;

      const ctx = lineContext(text, m.index);
      evidence.priceCodeRefs.push({
        term,
        file: file.rel,
        line: ctx.line,
        context: ctx.text
      });

      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(root, 'logs', 'corporate-action-price-source-discovery-v9-7-15.json');

  const files = walk(root);
  const tables = [];
  const indexes = [];
  const evidence = {
    supabaseRefs: [],
    priceCodeRefs: []
  };

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    if (file.ext === '.sql') {
      for (const table of findCreateTables(text)) {
        tables.push({
          ...table,
          file: file.rel
        });
      }

      for (const index of parseIndexes(text)) {
        indexes.push({
          ...index,
          file: file.rel
        });
      }
    }

    scanCodeRefs(file, text, evidence);
  }

  const candidates = tables
    .map(table => {
      const score = scoreTable(table);
      const relatedIndexes = indexes.filter(i => i.tableName === table.tableName);

      return {
        tableName: table.tableName,
        file: table.file,
        score: score.score,
        stockColumns: score.stockMatches,
        dateColumns: score.dateMatches,
        priceColumns: score.priceMatches,
        columns: table.columns,
        indexes: relatedIndexes
      };
    })
    .filter(x => x.stockColumns.length && x.dateColumns.length && x.priceColumns.length)
    .sort((a, b) => b.score - a.score || a.tableName.localeCompare(b.tableName));

  const refCounts = new Map();
  for (const ref of evidence.supabaseRefs) {
    refCounts.set(ref.tableName, (refCounts.get(ref.tableName) || 0) + 1);
  }

  for (const candidate of candidates) {
    candidate.supabaseReferenceCount = refCounts.get(candidate.tableName) || 0;

    candidate.stockDateUniqueSurface = candidate.indexes.filter(index => {
      if (!index.unique) return false;
      const d = index.expression.toLowerCase();

      const hasStock = candidate.stockColumns.some(c => d.includes(c));
      const hasDate = candidate.dateColumns.some(c => d.includes(c));
      return hasStock && hasDate;
    });
  }

  const preferred = candidates[0] || null;

  let status;
  if (!preferred) {
    status = 'NO_EXISTING_PRICE_SOURCE_CONTRACT_FOUND';
  } else if (
    preferred.priceColumns.some(c =>
      ['close', 'close_price', 'closing_price', 'prev_close', 'previous_close', 'reference_price'].includes(c)
    )
  ) {
    status = 'PRICE_SOURCE_CANDIDATE_FOUND';
  } else {
    status = 'PRICE_SOURCE_REVIEW_REQUIRED';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'LOCAL_READ_ONLY_PRICE_SOURCE_DISCOVERY',
    scan: {
      filesScanned: files.length,
      createTablesFound: tables.length,
      priceSourceCandidatesFound: candidates.length
    },
    preferredCandidate: preferred,
    candidates: candidates.slice(0, 30),
    codeEvidence: evidence,
    referencePricePolicyNeeded: {
      targetEvents: 3,
      actionType: 'CASH_DIVIDEND',
      desiredPrice:
        'Last valid unadjusted market close/reference price immediately before the effective ex-dividend date, from an authoritative or existing project market-price source.',
      forbiddenShortcut:
        'Do not derive the reference price from the dividend amount or adjusted series.'
    },
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      writesPerformed: 0,
      adjustmentRowsInserted: 0,
      coveragePromoted: false
    },
    nextGate:
      status === 'PRICE_SOURCE_CANDIDATE_FOUND'
        ? 'VERIFY_LIVE_COVERAGE_FOR_THE_3_CASH_DIVIDEND_EFFECTIVE_DATES'
        : 'SELECT_OR_IMPLEMENT_AN_AUTHORITATIVE_UNADJUSTED_DAILY_PRICE_SOURCE'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status,
    filesScanned: state.scan.filesScanned,
    priceSourceCandidatesFound: candidates.length,
    preferredTable: preferred?.tableName ?? null,
    preferredStockColumns: preferred?.stockColumns ?? [],
    preferredDateColumns: preferred?.dateColumns ?? [],
    preferredPriceColumns: preferred?.priceColumns ?? [],
    preferredSupabaseReferenceCount: preferred?.supabaseReferenceCount ?? 0,
    stockDateUniqueSurfaces: preferred?.stockDateUniqueSurface?.length ?? 0,
    writesPerformed: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report: ' + outputFile);

  if (status === 'NO_EXISTING_PRICE_SOURCE_CONTRACT_FOUND') {
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
