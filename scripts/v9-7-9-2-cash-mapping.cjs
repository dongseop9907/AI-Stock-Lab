'use strict';

// V9.7.9.2 cash_amount mapping resolver.
// Purpose:
//   Trace only real corporate_action_events row construction/write sites and determine
//   what value is assigned to cash_amount. This avoids false ambiguity from unrelated
//   total-dividend variables elsewhere in the project.
//
// Safety:
//   - read-only local scan
//   - no DB connection
//   - no network
//   - no .env reads
//   - no migration execution
//   - no INSERT/UPDATE/DELETE/UPSERT execution

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_9_2_CASH_MAPPING_PROBE';
const V9791_VERSION = 'V9_7_9_1_CLEAN_COLUMN_SEMANTICS_PROBE';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const TEMP_PROBE_BASENAME_PATTERNS = [
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
  /^v9-7-9-2-cash-mapping\.cjs$/i
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'CASH_MAPPING_PROBE_FAILED';
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

function isTempProbe(rel) {
  const base = path.basename(rel);
  return TEMP_PROBE_BASENAME_PATTERNS.some(rx => rx.test(base));
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function context(text, index, before = 12, after = 16) {
  const lines = text.split(/\r?\n/);
  const line = lineOf(text, index);
  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    startLine: start + 1,
    endLine: end,
    text: lines
      .slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 9000)
  };
}

function extractCashAssignment(blockText) {
  const patterns = [
    /\bcash_amount\b\s*:\s*([^,\n}\]]+)/i,
    /\bcashAmount\b\s*:\s*([^,\n}\]]+)/i,
    /\bcash_amount\b\s*=\s*([^;\n]+)/i,
    /\bcashAmount\b\s*=\s*([^;\n]+)/i
  ];

  for (const rx of patterns) {
    const m = blockText.match(rx);
    if (m) {
      return {
        expression: m[1].trim(),
        rawMatch: m[0].trim()
      };
    }
  }

  return null;
}

function classifyExpression(expr, nearbyText) {
  const s = `${expr}\n${nearbyText}`.toLowerCase();

  const strongPerShare = [
    'per_share',
    'pershare',
    'per-share',
    'dividend_per_share',
    'dividendpershare',
    'cash_per_share',
    'cashpershare',
    'dps',
    'per_common_share',
    'percommonshare',
    'per_preferred_share',
    'perpreferredshare',
    '1주당',
    '주당배당'
  ];

  const strongTotal = [
    'total_cash',
    'totalcash',
    'total_dividend',
    'totaldividend',
    'dividend_total',
    'dividendtotal',
    'gross_dividend',
    'grossdividend',
    'aggregate_dividend',
    'aggregateamount',
    '배당금총액',
    '총배당금',
    '배당총액'
  ];

  const hasPerShare = strongPerShare.some(x => s.includes(x));
  const hasTotal = strongTotal.some(x => s.includes(x));

  if (hasPerShare && !hasTotal) {
    return {
      classification: 'PER_SHARE',
      reason: 'EXPLICIT_PER_SHARE_SOURCE_NAME'
    };
  }

  if (hasTotal && !hasPerShare) {
    return {
      classification: 'TOTAL',
      reason: 'EXPLICIT_TOTAL_AMOUNT_SOURCE_NAME'
    };
  }

  // Unit proof: if the same source/expression is used directly in a price adjustment,
  // then it has currency/share units.
  if (
    /(?:price|close|reference_price|prev_close|previous_close)[^;\n]{0,120}-[^;\n]{0,100}(?:cash_amount|cashamount)/i.test(nearbyText) ||
    /(?:cash_amount|cashamount)[^;\n]{0,100}\/[^;\n]{0,100}(?:price|close|reference_price|prev_close|previous_close)/i.test(nearbyText)
  ) {
    return {
      classification: 'PER_SHARE',
      reason: 'USED_AS_PER_SHARE_PRICE_ADJUSTMENT'
    };
  }

  // DART's dividend detail naming often uses "per share" values.
  if (
    /\b(?:thstrm|current|common|preferred)[a-z0-9_]*(?:div|dvd)[a-z0-9_]*(?:ps|per|share)\b/i.test(expr) ||
    /\b(?:div|dvd)[a-z0-9_]*(?:ps|per|share)\b/i.test(expr)
  ) {
    return {
      classification: 'PER_SHARE',
      reason: 'DART_PER_SHARE_FIELD_PATTERN'
    };
  }

  return {
    classification: 'UNKNOWN',
    reason: 'NO_DECISIVE_UNIT_EVIDENCE'
  };
}

function scan(root) {
  const files = walk(root);

  const writeSites = [];
  const standaloneAssignments = [];
  const excluded = [];

  for (const file of files) {
    if (isTempProbe(file.rel)) {
      excluded.push(file.rel);
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    const lower = text.toLowerCase();

    // Real Supabase write sites.
    if (lower.includes('corporate_action_events')) {
      const rx = /\.from\s*\(\s*['"`]corporate_action_events['"`]\s*\)[\s\S]{0,1800}?\.(?:insert|upsert|update)\s*\(([\s\S]{0,2200}?)\)/ig;
      let m;

      while ((m = rx.exec(text))) {
        const ctx = context(text, m.index, 16, 24);
        const block = m[0];
        const assignment = extractCashAssignment(block);

        writeSites.push({
          file: file.rel,
          line: ctx.line,
          operation:
            /\.upsert\s*\(/i.test(block) ? 'UPSERT' :
            /\.update\s*\(/i.test(block) ? 'UPDATE' :
            'INSERT',
          assignment,
          classification: assignment
            ? classifyExpression(assignment.expression, `${block}\n${ctx.text}`)
            : {
                classification: 'NO_DIRECT_ASSIGNMENT',
                reason: 'CASH_AMOUNT_NOT_INLINE_AT_WRITE_SITE'
              },
          context: ctx.text
        });

        if (m.index === rx.lastIndex) rx.lastIndex++;
      }

      // SQL insert sites.
      const sqlRx = /\binsert\s+into\s+(?:public\.)?corporate_action_events\s*\(([^)]+)\)\s*values\s*\(([\s\S]{0,2500}?)\)/ig;
      while ((m = sqlRx.exec(text))) {
        const cols = m[1].split(',').map(x => x.trim().replace(/["`]/g, '').toLowerCase());
        const vals = m[2].split(',').map(x => x.trim());

        const idx = cols.indexOf('cash_amount');
        const expr = idx >= 0 ? vals[idx] ?? null : null;
        const ctx = context(text, m.index, 16, 24);

        writeSites.push({
          file: file.rel,
          line: ctx.line,
          operation: 'SQL_INSERT',
          assignment: expr ? { expression: expr, rawMatch: expr } : null,
          classification: expr
            ? classifyExpression(expr, ctx.text)
            : {
                classification: 'NO_DIRECT_ASSIGNMENT',
                reason: 'CASH_AMOUNT_COLUMN_NOT_PRESENT'
              },
          context: ctx.text
        });

        if (m.index === sqlRx.lastIndex) sqlRx.lastIndex++;
      }
    }

    // Also capture non-probe direct assignments for evidence even if row object is built earlier.
    if (lower.includes('cash_amount') || lower.includes('cashamount')) {
      const assignRx = /\b(?:cash_amount|cashAmount)\b\s*[:=]\s*([^,\n;}]{1,260})/ig;
      let m;
      while ((m = assignRx.exec(text))) {
        const ctx = context(text, m.index, 8, 12);
        const expression = m[1].trim();
        standaloneAssignments.push({
          file: file.rel,
          line: ctx.line,
          expression,
          classification: classifyExpression(expression, ctx.text),
          context: ctx.text
        });

        if (m.index === assignRx.lastIndex) assignRx.lastIndex++;
      }
    }
  }

  return {
    filesDiscovered: files.length,
    excludedTemporaryProbeFiles: excluded,
    writeSites,
    standaloneAssignments
  };
}

function resolve(scanResult) {
  const direct = scanResult.writeSites.filter(x => x.assignment);
  const directPerShare = direct.filter(x => x.classification.classification === 'PER_SHARE');
  const directTotal = direct.filter(x => x.classification.classification === 'TOTAL');
  const directUnknown = direct.filter(x => x.classification.classification === 'UNKNOWN');

  if (directPerShare.length > 0 && directTotal.length === 0 && directUnknown.length === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
      proof: 'ALL_REAL_EVENT_WRITE_SITES_MAP_CASH_AMOUNT_FROM_PER_SHARE_SOURCE',
      directWriteSites: direct.length,
      perShareWriteSites: directPerShare.length,
      totalWriteSites: 0,
      unknownWriteSites: 0
    };
  }

  if (directTotal.length > 0 && directPerShare.length === 0 && directUnknown.length === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'TOTAL_CASH_AMOUNT',
      proof: 'ALL_REAL_EVENT_WRITE_SITES_MAP_CASH_AMOUNT_FROM_TOTAL_SOURCE',
      directWriteSites: direct.length,
      perShareWriteSites: 0,
      totalWriteSites: directTotal.length,
      unknownWriteSites: 0
    };
  }

  // If there are no inline/direct write-site assignments, use only standalone assignments
  // that occur in files also containing corporate_action_events.
  if (direct.length === 0) {
    const candidateAssignments = scanResult.standaloneAssignments.filter(a =>
      scanResult.writeSites.some(w => w.file === a.file) ||
      /corporate.?action/i.test(a.file)
    );

    const perShare = candidateAssignments.filter(x => x.classification.classification === 'PER_SHARE');
    const total = candidateAssignments.filter(x => x.classification.classification === 'TOTAL');
    const unknown = candidateAssignments.filter(x => x.classification.classification === 'UNKNOWN');

    if (perShare.length > 0 && total.length === 0 && unknown.length === 0) {
      return {
        status: 'PROVEN',
        cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
        proof: 'EVENT_PIPELINE_ASSIGNMENTS_ALL_PER_SHARE',
        directWriteSites: 0,
        candidateAssignments: candidateAssignments.length,
        perShareAssignments: perShare.length,
        totalAssignments: 0,
        unknownAssignments: 0
      };
    }
  }

  return {
    status: 'AMBIGUOUS',
    directWriteSites: direct.length,
    perShareWriteSites: directPerShare.length,
    totalWriteSites: directTotal.length,
    unknownWriteSites: directUnknown.length
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--v9791=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, fallback) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : fallback;
  };

  const v9791File = get(
    '--v9791=',
    path.join(root, 'logs', 'corporate-action-column-semantics-clean-probe-v9-7-9-1.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-cash-mapping-probe-v9-7-9-2.json')
  );

  const prev = loadJson(v9791File);
  if (!prev || prev.version !== V9791_VERSION) {
    throw new Error('INVALID_V9_7_9_1_REPORT');
  }

  if (prev.resolvedSemantics?.ratio?.status !== 'PROVEN') {
    throw new Error('RATIO_SEMANTICS_NOT_CLOSED');
  }

  const result = scan(root);
  const cash = resolve(result);

  const migrationRequired = !!prev.migrationNeed?.providerEventIdUniqueRequired;

  let status;
  if (cash.status === 'PROVEN') {
    status = migrationRequired
      ? 'MAPPING_CONTRACT_READY_SCHEMA_MIGRATION_REQUIRED'
      : 'MAPPING_AND_SCHEMA_CONTRACT_READY';
  } else {
    status = 'CASH_MAPPING_REVIEW_REQUIRED';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'READ_ONLY_REAL_EVENT_WRITE_PATH_ANALYSIS',
    inheritedRatioContract: {
      ratioFromMeaning: prev.resolvedSemantics.ratio.ratioFromMeaning,
      ratioToMeaning: prev.resolvedSemantics.ratio.ratioToMeaning,
      shareFactorFormula: prev.resolvedSemantics.ratio.shareFactorFormula,
      priceFactorFormula: prev.resolvedSemantics.ratio.priceFactorFormula
    },
    cashAmountResolution: cash,
    scan: {
      filesDiscovered: result.filesDiscovered,
      excludedTemporaryProbeFiles: result.excludedTemporaryProbeFiles,
      corporateActionEventWriteSites: result.writeSites,
      standaloneCashAssignments: result.standaloneAssignments
    },
    migrationNeed: {
      providerEventIdUniqueRequired: migrationRequired,
      recommendedUniqueConstraint: 'unique (provider, provider_event_id, is_validation)',
      recommendedConflictTarget: 'provider,provider_event_id,is_validation'
    },
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
    cashAmountMeaning: cash.cashAmountMeaning ?? null,
    cashAmountProof: cash.proof ?? null,
    directWriteSites: cash.directWriteSites ?? null,
    perShareWriteSites: cash.perShareWriteSites ?? null,
    totalWriteSites: cash.totalWriteSites ?? null,
    unknownWriteSites: cash.unknownWriteSites ?? null,
    providerEventIdUniqueRequired: migrationRequired,
    recommendedUniqueConstraint: state.migrationNeed.recommendedUniqueConstraint,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (status === 'CASH_MAPPING_REVIEW_REQUIRED') {
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
  classifyExpression,
  scan,
  resolve
};
