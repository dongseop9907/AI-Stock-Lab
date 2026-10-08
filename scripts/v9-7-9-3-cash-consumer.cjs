'use strict';

// V9.7.9.3 cash_amount consumer-unit probe.
// Purpose:
//   Determine cash_amount semantics from downstream corporate-action adjustment logic.
//   If no real consumer exists yet, report that the semantic contract is not implemented
//   and must be defined explicitly before importer/schema migration.
//
// Safety:
//   - local read-only scan
//   - no DB connection
//   - no network
//   - no .env reads
//   - no writes except this JSON report

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_9_3_CASH_CONSUMER_UNIT_PROBE';
const PREV_VERSION = 'V9_7_9_2_CASH_MAPPING_PROBE';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_EVIDENCE = 80;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'
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
  /^v9-7-9-3-cash-consumer\.cjs$/i
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'CASH_CONSUMER_UNIT_PROBE_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
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

function snippet(text, index, before = 8, after = 10) {
  const lines = text.split(/\r?\n/);
  const line = lineNumberAt(text, index);
  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 7000)
  };
}

function push(arr, item) {
  if (arr.length < MAX_EVIDENCE) arr.push(item);
}

function scan(root) {
  const files = walk(root);

  const evidence = {
    allReferences: [],
    priceMinusCash: [],
    cashOverPrice: [],
    oneMinusCashOverPrice: [],
    cashTimesShares: [],
    cashDivShares: [],
    explicitPerShareNames: [],
    explicitTotalNames: []
  };

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    if (!/(cash_amount|cashAmount)/i.test(text)) continue;

    const refs = /\b(?:cash_amount|cashAmount)\b/g;
    let m;

    while ((m = refs.exec(text))) {
      push(evidence.allReferences, {
        file: file.rel,
        ...snippet(text, m.index, 7, 9)
      });
      if (m.index === refs.lastIndex) refs.lastIndex++;
    }

    const patterns = [
      {
        key: 'priceMinusCash',
        rx: /\b(?:reference_price|referencePrice|prev_close|prevClose|previous_close|previousClose|close_price|closePrice|price|close)\b[^;\n]{0,160}?-\s*[^;\n]{0,100}?\b(?:cash_amount|cashAmount)\b/ig
      },
      {
        key: 'cashOverPrice',
        rx: /\b(?:cash_amount|cashAmount)\b[^;\n]{0,100}?\/[^;\n]{0,100}?\b(?:reference_price|referencePrice|prev_close|prevClose|previous_close|previousClose|close_price|closePrice|price|close)\b/ig
      },
      {
        key: 'oneMinusCashOverPrice',
        rx: /\b1(?:\.0+)?\s*-\s*[^;\n]{0,80}?\b(?:cash_amount|cashAmount)\b[^;\n]{0,100}?\/[^;\n]{0,100}?\b(?:reference_price|referencePrice|prev_close|prevClose|previous_close|previousClose|close_price|closePrice|price|close)\b/ig
      },
      {
        key: 'cashTimesShares',
        rx: /\b(?:cash_amount|cashAmount)\b[^;\n]{0,100}?\*[^;\n]{0,100}?\b(?:shares|share_count|shareCount|outstanding_shares|outstandingShares)\b/ig
      },
      {
        key: 'cashDivShares',
        rx: /\b(?:cash_amount|cashAmount)\b[^;\n]{0,100}?\/[^;\n]{0,100}?\b(?:shares|share_count|shareCount|outstanding_shares|outstandingShares)\b/ig
      },
      {
        key: 'explicitPerShareNames',
        rx: /(?:cash_amount|cashAmount)[\s\S]{0,180}(?:per_share|perShare|dividend_per_share|dividendPerShare|\bdps\b|1주당|주당배당)|(?:per_share|perShare|dividend_per_share|dividendPerShare|\bdps\b|1주당|주당배당)[\s\S]{0,180}(?:cash_amount|cashAmount)/ig
      },
      {
        key: 'explicitTotalNames',
        rx: /(?:cash_amount|cashAmount)[\s\S]{0,180}(?:total_cash|totalCash|total_dividend|totalDividend|dividend_total|dividendTotal|배당금총액|총배당금|배당총액)|(?:total_cash|totalCash|total_dividend|totalDividend|dividend_total|dividendTotal|배당금총액|총배당금|배당총액)[\s\S]{0,180}(?:cash_amount|cashAmount)/ig
      }
    ];

    for (const p of patterns) {
      p.rx.lastIndex = 0;
      while ((m = p.rx.exec(text))) {
        push(evidence[p.key], {
          file: file.rel,
          match: m[0].replace(/\s+/g, ' ').trim().slice(0, 600),
          ...snippet(text, m.index, 8, 10)
        });
        if (m.index === p.rx.lastIndex) p.rx.lastIndex++;
      }
    }
  }

  return {
    filesScanned: files.length,
    evidence
  };
}

function resolve(e) {
  const perShareUnitEvidence =
    e.priceMinusCash.length +
    e.cashOverPrice.length +
    e.oneMinusCashOverPrice.length +
    e.cashTimesShares.length +
    e.explicitPerShareNames.length;

  const totalUnitEvidence =
    e.cashDivShares.length +
    e.explicitTotalNames.length;

  if (perShareUnitEvidence > 0 && totalUnitEvidence === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
      proof: 'DOWNSTREAM_UNIT_ARITHMETIC_REQUIRES_CURRENCY_PER_SHARE',
      perShareUnitEvidence,
      totalUnitEvidence
    };
  }

  if (totalUnitEvidence > 0 && perShareUnitEvidence === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'TOTAL_CASH_AMOUNT',
      proof: 'DOWNSTREAM_UNIT_ARITHMETIC_REQUIRES_TOTAL_CURRENCY',
      perShareUnitEvidence,
      totalUnitEvidence
    };
  }

  if (e.allReferences.length === 0) {
    return {
      status: 'NOT_IMPLEMENTED',
      cashAmountMeaning: null,
      proof: 'NO_REAL_CASH_AMOUNT_CONSUMER_FOUND',
      perShareUnitEvidence: 0,
      totalUnitEvidence: 0
    };
  }

  return {
    status: 'AMBIGUOUS',
    cashAmountMeaning: null,
    proof: 'CONFLICTING_OR_INSUFFICIENT_CONSUMER_EVIDENCE',
    perShareUnitEvidence,
    totalUnitEvidence,
    referenceCount: e.allReferences.length
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--prev=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, fallback) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : fallback;
  };

  const prevFile = get(
    '--prev=',
    path.join(root, 'logs', 'corporate-action-cash-mapping-probe-v9-7-9-2.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-cash-consumer-unit-probe-v9-7-9-3.json')
  );

  const prev = loadJson(prevFile);
  if (!prev || prev.version !== PREV_VERSION) {
    throw new Error('INVALID_V9_7_9_2_REPORT');
  }

  const result = scan(root);
  const cash = resolve(result.evidence);

  let status;

  if (cash.status === 'PROVEN') {
    status = prev.migrationNeed?.providerEventIdUniqueRequired
      ? 'MAPPING_CONTRACT_READY_SCHEMA_MIGRATION_REQUIRED'
      : 'MAPPING_AND_SCHEMA_CONTRACT_READY';
  } else if (cash.status === 'NOT_IMPLEMENTED') {
    status = 'CASH_SEMANTIC_CONTRACT_NOT_IMPLEMENTED';
  } else {
    status = 'CASH_CONSUMER_EVIDENCE_REVIEW_REQUIRED';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'READ_ONLY_DOWNSTREAM_UNIT_ANALYSIS',
    inheritedRatioContract: prev.inheritedRatioContract,
    cashAmountResolution: cash,
    evidence: result.evidence,
    scan: {
      filesScanned: result.filesScanned
    },
    migrationNeed: prev.migrationNeed,
    recommendation:
      cash.status === 'NOT_IMPLEMENTED'
        ? {
            action: 'DEFINE_CASH_AMOUNT_AS_PER_SHARE_IN_SCHEMA_AND_IMPORT_CONTRACT_BEFORE_IMPLEMENTING_ADJUSTMENT_LOGIC',
            rationale:
              'No production consumer currently defines the unit. A cash-dividend price adjustment requires a per-share cash amount.'
          }
        : null,
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      migrationsApplied: 0,
      writesPerformed: 0,
      eventRowsInserted: 0,
      coveragePromoted: false
    }
  };

  save(outputFile, state);

  console.log(JSON.stringify({
    status,
    cashAmountStatus: cash.status,
    cashAmountMeaning: cash.cashAmountMeaning,
    cashAmountProof: cash.proof,
    allCashAmountReferences: result.evidence.allReferences.length,
    priceMinusCashReferences: result.evidence.priceMinusCash.length,
    cashOverPriceReferences: result.evidence.cashOverPrice.length,
    oneMinusCashOverPriceReferences: result.evidence.oneMinusCashOverPrice.length,
    cashTimesSharesReferences: result.evidence.cashTimesShares.length,
    cashDivSharesReferences: result.evidence.cashDivShares.length,
    explicitPerShareReferences: result.evidence.explicitPerShareNames.length,
    explicitTotalReferences: result.evidence.explicitTotalNames.length,
    providerEventIdUniqueRequired: !!prev.migrationNeed?.providerEventIdUniqueRequired,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (status === 'CASH_CONSUMER_EVIDENCE_REVIEW_REQUIRED') {
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

module.exports = {
  scan,
  resolve
};
