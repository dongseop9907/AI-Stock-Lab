'use strict';

// V9.7.9 read-only corporate-action column semantics resolver.
// Purpose:
//   - Resolve ratio_from / ratio_to semantics from actual adjustment formulas.
//   - Resolve cash_amount semantics from actual corporate_action_events row construction.
//   - Inspect provider_event_id and source_fingerprint usage.
//   - Produce exact file/line evidence before any schema migration or DB write.
//
// Safety:
//   - NO database connection
//   - NO network
//   - NO .env reads
//   - NO INSERT / UPDATE / DELETE / UPSERT execution
//   - NO migration execution
//   - NO coverage promotion

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_9_COLUMN_SEMANTICS_PROBE';
const V978_VERSION = 'V9_7_8_IDEMPOTENCY_CONTRACT_PROBE';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_EVIDENCE = 80;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'COLUMN_SEMANTICS_PROBE_FAILED';
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
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

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
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > MAX_FILE_BYTES) continue;

      files.push({ full, rel, ext, size: stat.size });
    }
  }

  return files;
}

function normalizeLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function snippet(lines, index, before = 4, after = 5) {
  const start = Math.max(0, index - before);
  const end = Math.min(lines.length, index + after + 1);
  return {
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n')
      .slice(0, 4000)
  };
}

function scanFiles(root) {
  const files = walk(root);
  const evidence = {
    ratioToOverFrom: [],
    ratioFromOverTo: [],
    shareFactor: [],
    priceFactor: [],
    cashAmountAssignments: [],
    cashAmountArithmetic: [],
    providerEventId: [],
    sourceFingerprint: [],
    corporateActionEventWrites: []
  };

  const push = (bucket, item) => {
    if (bucket.length < MAX_EVIDENCE) bucket.push(item);
  };

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.full, 'utf8').replace(/^\uFEFF/, ''); }
    catch { continue; }

    const lower = text.toLowerCase();
    const relevant =
      lower.includes('ratio_from') ||
      lower.includes('ratio_to') ||
      lower.includes('cash_amount') ||
      lower.includes('provider_event_id') ||
      lower.includes('source_fingerprint') ||
      lower.includes('corporate_action_events');

    if (!relevant) continue;

    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const l = line.toLowerCase();

      if (/ratio_to\s*\/\s*(?:[a-z0-9_?.()[\]]*\s*)?ratio_from/i.test(line)) {
        push(evidence.ratioToOverFrom, {
          file: f.rel,
          line: i + 1,
          context: snippet(lines, i)
        });
      }

      if (/ratio_from\s*\/\s*(?:[a-z0-9_?.()[\]]*\s*)?ratio_to/i.test(line)) {
        push(evidence.ratioFromOverTo, {
          file: f.rel,
          line: i + 1,
          context: snippet(lines, i)
        });
      }

      if (l.includes('share_factor') || l.includes('sharefactor') || l.includes('share factor')) {
        if (l.includes('ratio_from') || l.includes('ratio_to')) {
          push(evidence.shareFactor, {
            file: f.rel,
            line: i + 1,
            context: snippet(lines, i)
          });
        }
      }

      if (l.includes('price_factor') || l.includes('pricefactor') || l.includes('price factor')) {
        if (l.includes('ratio_from') || l.includes('ratio_to')) {
          push(evidence.priceFactor, {
            file: f.rel,
            line: i + 1,
            context: snippet(lines, i)
          });
        }
      }

      if (/\bcash_amount\s*[:=]/i.test(line)) {
        push(evidence.cashAmountAssignments, {
          file: f.rel,
          line: i + 1,
          lineText: normalizeLine(line),
          context: snippet(lines, i, 6, 7)
        });
      }

      if (l.includes('cash_amount') && /[+\-*/]/.test(line)) {
        push(evidence.cashAmountArithmetic, {
          file: f.rel,
          line: i + 1,
          lineText: normalizeLine(line),
          context: snippet(lines, i, 5, 6)
        });
      }

      if (l.includes('provider_event_id')) {
        push(evidence.providerEventId, {
          file: f.rel,
          line: i + 1,
          lineText: normalizeLine(line),
          context: snippet(lines, i, 4, 5)
        });
      }

      if (l.includes('source_fingerprint')) {
        push(evidence.sourceFingerprint, {
          file: f.rel,
          line: i + 1,
          lineText: normalizeLine(line),
          context: snippet(lines, i, 4, 5)
        });
      }

      if (l.includes('corporate_action_events')) {
        const block = snippet(lines, i, 8, 14);
        if (/\.(?:insert|upsert|update|delete)\s*\(/i.test(block.text) ||
            /\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b/i.test(block.text)) {
          push(evidence.corporateActionEventWrites, {
            file: f.rel,
            line: i + 1,
            context: block
          });
        }
      }
    }
  }

  return { filesScanned: files.length, evidence };
}

function formulaHas(text, a, op, b) {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  return compact.includes(`${a}${op}${b}`);
}

function resolveRatioSemantics(ev) {
  const combined = [
    ...ev.ratioToOverFrom,
    ...ev.ratioFromOverTo,
    ...ev.shareFactor,
    ...ev.priceFactor
  ];

  let shareToOverFrom = false;
  let shareFromOverTo = false;
  let priceToOverFrom = false;
  let priceFromOverTo = false;
  const decisive = [];

  for (const item of combined) {
    const t = item.context?.text || '';

    const shareNearby = /share[_\s-]*factor|event[_\s-]*share|cumulative[_\s-]*share/i.test(t);
    const priceNearby = /price[_\s-]*factor|event[_\s-]*price|cumulative[_\s-]*price/i.test(t);

    const toOverFrom =
      formulaHas(t, 'ratio_to', '/', 'ratio_from') ||
      /ratio[_\s-]*to[\s\S]{0,100}\/[\s\S]{0,100}ratio[_\s-]*from/i.test(t);

    const fromOverTo =
      formulaHas(t, 'ratio_from', '/', 'ratio_to') ||
      /ratio[_\s-]*from[\s\S]{0,100}\/[\s\S]{0,100}ratio[_\s-]*to/i.test(t);

    if (shareNearby && toOverFrom) {
      shareToOverFrom = true;
      decisive.push({ kind: 'SHARE_FACTOR_RATIO_TO_OVER_FROM', ...item });
    }
    if (shareNearby && fromOverTo) {
      shareFromOverTo = true;
      decisive.push({ kind: 'SHARE_FACTOR_RATIO_FROM_OVER_TO', ...item });
    }
    if (priceNearby && toOverFrom) {
      priceToOverFrom = true;
      decisive.push({ kind: 'PRICE_FACTOR_RATIO_TO_OVER_FROM', ...item });
    }
    if (priceNearby && fromOverTo) {
      priceFromOverTo = true;
      decisive.push({ kind: 'PRICE_FACTOR_RATIO_FROM_OVER_TO', ...item });
    }
  }

  const standardClosed =
    shareToOverFrom &&
    priceFromOverTo &&
    !shareFromOverTo &&
    !priceToOverFrom;

  const inverseClosed =
    shareFromOverTo &&
    priceToOverFrom &&
    !shareToOverFrom &&
    !priceFromOverTo;

  if (standardClosed) {
    return {
      status: 'PROVEN',
      ratioFromMeaning: 'PRE_ACTION_UNIT',
      ratioToMeaning: 'POST_ACTION_UNIT',
      shareFactorFormula: 'ratio_to / ratio_from',
      priceFactorFormula: 'ratio_from / ratio_to',
      decisiveEvidence: decisive.slice(0, 20)
    };
  }

  if (inverseClosed) {
    return {
      status: 'PROVEN',
      ratioFromMeaning: 'POST_ACTION_UNIT',
      ratioToMeaning: 'PRE_ACTION_UNIT',
      shareFactorFormula: 'ratio_from / ratio_to',
      priceFactorFormula: 'ratio_to / ratio_from',
      decisiveEvidence: decisive.slice(0, 20)
    };
  }

  return {
    status: 'AMBIGUOUS',
    observations: {
      shareToOverFrom,
      shareFromOverTo,
      priceToOverFrom,
      priceFromOverTo
    },
    decisiveEvidence: decisive.slice(0, 30)
  };
}

function classifyCashExpression(text) {
  const s = text.toLowerCase();

  const perShareHints = [
    'per_share', 'pershare', 'per-share', 'dividend_per_share',
    'dividendpershare', 'dps', 'cash_per_share', 'cashpershare',
    'percommonshare', 'per_common_share', 'perpreferredshare',
    'per_preferred_share', '1주당', '주당'
  ];

  const totalHints = [
    'total_cash', 'totalcash', 'total_dividend', 'totaldividend',
    'dividend_total', 'dividendtotal', 'aggregate', 'gross_amount',
    'grossamount', '총배당', '배당금총액', '총액'
  ];

  const perShare = perShareHints.some(x => s.includes(x));
  const total = totalHints.some(x => s.includes(x));

  if (perShare && !total) return 'PER_SHARE';
  if (total && !perShare) return 'TOTAL';
  if (perShare && total) return 'MIXED';
  return 'UNKNOWN';
}

function resolveCashSemantics(ev) {
  const assignmentEvidence = ev.cashAmountAssignments.map(x => {
    const all = `${x.lineText}\n${x.context?.text || ''}`;
    return { ...x, classification: classifyCashExpression(all) };
  });

  const perShare = assignmentEvidence.filter(x => x.classification === 'PER_SHARE');
  const total = assignmentEvidence.filter(x => x.classification === 'TOTAL');
  const mixed = assignmentEvidence.filter(x => x.classification === 'MIXED');
  const unknown = assignmentEvidence.filter(x => x.classification === 'UNKNOWN');

  // Strongest evidence is explicit row/object assignment to cash_amount.
  if (perShare.length > 0 && total.length === 0 && mixed.length === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
      decisiveEvidence: perShare.slice(0, 20),
      unknownEvidence: unknown.slice(0, 10)
    };
  }

  if (total.length > 0 && perShare.length === 0 && mixed.length === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'TOTAL_CASH_AMOUNT',
      decisiveEvidence: total.slice(0, 20),
      unknownEvidence: unknown.slice(0, 10)
    };
  }

  return {
    status: 'AMBIGUOUS',
    counts: {
      perShare: perShare.length,
      total: total.length,
      mixed: mixed.length,
      unknown: unknown.length
    },
    evidence: assignmentEvidence.slice(0, 40)
  };
}

function analyzeProviderEventId(ev) {
  const joined = ev.providerEventId.map(x => `${x.lineText}\n${x.context?.text || ''}`).join('\n').toLowerCase();

  return {
    references: ev.providerEventId.length,
    usedNearReceipt:
      /provider_event_id[\s\S]{0,300}(rcept|receipt|dart)|(?:rcept|receipt|dart)[\s\S]{0,300}provider_event_id/i.test(joined),
    usedNearConflict:
      /provider_event_id[\s\S]{0,300}(upsert|on_conflict|onconflict|unique|duplicate|dedup)|(?:upsert|on_conflict|onconflict|unique|duplicate|dedup)[\s\S]{0,300}provider_event_id/i.test(joined),
    evidence: ev.providerEventId.slice(0, 20)
  };
}

function analyzeSourceFingerprint(ev) {
  const joined = ev.sourceFingerprint.map(x => `${x.lineText}\n${x.context?.text || ''}`).join('\n').toLowerCase();

  const rawContent =
    /source_fingerprint[\s\S]{0,500}(raw|payload|document|response|body|json\.stringify)|(?:raw|payload|document|response|body|json\.stringify)[\s\S]{0,500}source_fingerprint/i.test(joined);

  const canonicalIdentity =
    /source_fingerprint[\s\S]{0,500}(provider_event_id|stock_code|action_type|canonical)|(?:provider_event_id|stock_code|action_type|canonical)[\s\S]{0,500}source_fingerprint/i.test(joined);

  return {
    references: ev.sourceFingerprint.length,
    appearsRawContentBased: rawContent,
    appearsCanonicalIdentityBased: canonicalIdentity,
    evidence: ev.sourceFingerprint.slice(0, 20)
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--v978=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, def) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : def;
  };

  const v978File = get(
    '--v978=',
    path.join(root, 'logs', 'corporate-action-idempotency-contract-probe-v9-7-8.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-column-semantics-probe-v9-7-9.json')
  );

  const v978 = loadJson(v978File);
  if (!v978 || v978.version !== V978_VERSION) {
    throw new Error('INVALID_V9_7_8_REPORT');
  }

  if ((v978.canonicalIdentity?.validatedEvents ?? -1) !== 15 ||
      (v978.canonicalIdentity?.providerEventDuplicates ?? -1) !== 0 ||
      (v978.canonicalIdentity?.identityFingerprintDuplicates ?? -1) !== 0) {
    throw new Error('V9_7_8_IDENTITY_NOT_CLOSED');
  }

  const scan = scanFiles(root);
  const ratio = resolveRatioSemantics(scan.evidence);
  const cash = resolveCashSemantics(scan.evidence);
  const providerEventId = analyzeProviderEventId(scan.evidence);
  const sourceFingerprint = analyzeSourceFingerprint(scan.evidence);

  const migrationNeed = {
    providerEventIdUniqueRequired: !v978.targetTableContract?.providerEventIdUniqueFound,
    currentUniqueKeyUnsafeForCanonicalCorrections: !!v978.targetTableContract?.currentUniqueKeyFound,
    recommendedUniqueConstraint: 'unique (provider, provider_event_id, is_validation)',
    recommendedConflictTarget: 'provider,provider_event_id,is_validation'
  };

  const risks = [];

  if (ratio.status !== 'PROVEN') {
    risks.push('RATIO_SEMANTICS_STILL_AMBIGUOUS');
  }

  if (cash.status !== 'PROVEN') {
    risks.push('CASH_AMOUNT_SEMANTICS_STILL_AMBIGUOUS');
  }

  if (migrationNeed.providerEventIdUniqueRequired) {
    risks.push('PROVIDER_EVENT_ID_UNIQUENESS_MIGRATION_REQUIRED');
  }

  if (migrationNeed.currentUniqueKeyUnsafeForCanonicalCorrections) {
    risks.push('LEGACY_UNIQUE_KEY_SHOULD_NOT_BE_PRIMARY_UPSERT_IDENTITY');
  }

  let status;
  if (ratio.status === 'PROVEN' && cash.status === 'PROVEN') {
    status = migrationNeed.providerEventIdUniqueRequired
      ? 'MAPPING_CONTRACT_READY_SCHEMA_MIGRATION_REQUIRED'
      : 'MAPPING_AND_SCHEMA_CONTRACT_READY';
  } else {
    status = 'COLUMN_SEMANTICS_REVIEW_REQUIRED';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'READ_ONLY_LOCAL_STATIC_ANALYSIS',
    input: {
      v978Version: v978.version,
      targetTable: v978.targetTable
    },
    scan: {
      filesScanned: scan.filesScanned
    },
    resolvedSemantics: {
      ratio,
      cashAmount: cash,
      providerEventId,
      sourceFingerprint
    },
    migrationNeed,
    riskCodes: risks,
    rawEvidence: scan.evidence,
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      migrationsApplied: 0,
      writesPerformed: 0,
      eventRowsInserted: 0,
      coveragePromoted: false
    },
    nextGate:
      status === 'MAPPING_CONTRACT_READY_SCHEMA_MIGRATION_REQUIRED'
        ? 'GENERATE_REVIEW_ONLY_MIGRATION_AND_15_ROW_MAPPING_PREVIEW'
        : status === 'MAPPING_AND_SCHEMA_CONTRACT_READY'
          ? 'GENERATE_15_ROW_MAPPING_PREVIEW'
          : 'MANUAL_EVIDENCE_REVIEW_BEFORE_SCHEMA_OR_DB_WRITE'
  };

  save(outputFile, state);

  console.log(JSON.stringify({
    status,
    ratioStatus: ratio.status,
    ratioFromMeaning: ratio.ratioFromMeaning ?? null,
    ratioToMeaning: ratio.ratioToMeaning ?? null,
    shareFactorFormula: ratio.shareFactorFormula ?? null,
    priceFactorFormula: ratio.priceFactorFormula ?? null,
    cashAmountStatus: cash.status,
    cashAmountMeaning: cash.cashAmountMeaning ?? null,
    providerEventIdReferences: providerEventId.references,
    providerEventIdUsedNearReceipt: providerEventId.usedNearReceipt,
    providerEventIdUsedNearConflict: providerEventId.usedNearConflict,
    sourceFingerprintReferences: sourceFingerprint.references,
    sourceFingerprintAppearsRawContentBased: sourceFingerprint.appearsRawContentBased,
    sourceFingerprintAppearsCanonicalIdentityBased: sourceFingerprint.appearsCanonicalIdentityBased,
    providerEventIdUniqueRequired: migrationNeed.providerEventIdUniqueRequired,
    recommendedUniqueConstraint: migrationNeed.recommendedUniqueConstraint,
    riskCodes: risks,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (status === 'COLUMN_SEMANTICS_REVIEW_REQUIRED') {
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
  resolveRatioSemantics,
  resolveCashSemantics,
  analyzeProviderEventId,
  analyzeSourceFingerprint,
  classifyCashExpression
};
