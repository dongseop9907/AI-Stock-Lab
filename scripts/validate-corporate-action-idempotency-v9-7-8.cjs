'use strict';

// V9.7.8 read-only idempotency + column-semantics contract probe.
// Inputs:
//   - V9.7.6 canonical sample
//   - V9.7.4.1 resolved correction/withdrawal chains
//   - V9.7.7 local DB contract report
//
// Goals:
//   1) Confirm corporate_action_events is the event storage table.
//   2) Verify the current unique constraint is safe for correction chains.
//   3) Propose a stable canonical provider_event_id / source_fingerprint identity.
//   4) Inspect local code usages of ratio_from, ratio_to, cash_amount, provider_event_id,
//      and source_fingerprint before any row mapping is allowed.
//   5) Prove 15 validated sample events have unique canonical identities.
//
// Safety:
//   - NO database connection
//   - NO network
//   - NO .env reads
//   - NO INSERT / UPDATE / DELETE / UPSERT
//   - NO migrations applied
//   - NO coverage promotion

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_8_IDEMPOTENCY_CONTRACT_PROBE';
const CANONICAL_VERSION = 'V9_7_6_CANONICAL_SAMPLE_FINALIZATION_PROBE';
const CHAIN_VERSION = 'V9_7_4_1_CHAIN_REPAIR_PROBE';
const DB_VERSION = 'V9_7_7_DB_CONTRACT_PROBE';

const TARGET_TABLE = 'corporate_action_events';
const PROPOSED_PROVIDER = 'DART_KRX_CANONICAL';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_CONTEXTS_PER_TOKEN = 30;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const SEMANTIC_TOKENS = [
  'corporate_action_events',
  'ratio_from',
  'ratio_to',
  'cash_amount',
  'provider_event_id',
  'source_fingerprint'
];

function sha256(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'IDEMPOTENCY_CONTRACT_PROBE_FAILED';
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

function keyOfCandidate(c) {
  return `${c?.receiptNo ?? ''}|${c?.candidateActionType ?? ''}`;
}

function normalizeUniqueDefinition(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function lineContexts(text, token, rel) {
  const lines = text.split(/\r?\n/);
  const needle = token.toLowerCase();
  const hits = [];

  for (let i = 0; i < lines.length && hits.length < MAX_CONTEXTS_PER_TOKEN; i++) {
    if (!lines[i].toLowerCase().includes(needle)) continue;

    const start = Math.max(0, i - 3);
    const end = Math.min(lines.length, i + 4);
    const snippet = lines.slice(start, end)
      .map((line, idx) => `${start + idx + 1}: ${line}`)
      .join('\n');

    hits.push({
      file: rel,
      line: i + 1,
      snippet: snippet.slice(0, 2200)
    });
  }
  return hits;
}

function inspectSemantics(root) {
  const contexts = Object.fromEntries(SEMANTIC_TOKENS.map(t => [t, []]));
  const files = walk(root);

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.full, 'utf8').replace(/^\uFEFF/, ''); }
    catch { continue; }

    for (const token of SEMANTIC_TOKENS) {
      if (!text.toLowerCase().includes(token.toLowerCase())) continue;
      const remaining = MAX_CONTEXTS_PER_TOKEN - contexts[token].length;
      if (remaining <= 0) continue;
      contexts[token].push(...lineContexts(text, token, f.rel).slice(0, remaining));
    }
  }

  return {
    filesScanned: files.length,
    contexts
  };
}

function inferSemanticHints(contexts) {
  const all = token => (contexts[token] || []).map(x => x.snippet.toLowerCase()).join('\n');

  const ratioText = all('ratio_from') + '\n' + all('ratio_to');
  const cashText = all('cash_amount');
  const providerEventText = all('provider_event_id');
  const sourceFpText = all('source_fingerprint');

  const ratioHints = [];
  if (/ratio_to\s*\/\s*[^;\n]*ratio_from|ratio_to\s*\/\s*ratio_from/.test(ratioText)) {
    ratioHints.push('CODE_APPEARS_TO_USE_RATIO_TO_DIV_RATIO_FROM');
  }
  if (/ratio_from\s*\/\s*[^;\n]*ratio_to|ratio_from\s*\/\s*ratio_to/.test(ratioText)) {
    ratioHints.push('CODE_APPEARS_TO_USE_RATIO_FROM_DIV_RATIO_TO');
  }
  if (/share[_\s-]*factor|shares?/.test(ratioText)) {
    ratioHints.push('RATIO_FIELDS_REFERENCED_NEAR_SHARE_FACTOR_LOGIC');
  }
  if (/price[_\s-]*factor|adjust/.test(ratioText)) {
    ratioHints.push('RATIO_FIELDS_REFERENCED_NEAR_PRICE_ADJUSTMENT_LOGIC');
  }

  const cashHints = [];
  if (/per[_\s-]*share|주당/.test(cashText)) cashHints.push('CASH_AMOUNT_REFERENCED_AS_PER_SHARE');
  if (/total[_\s-]*(cash|dividend)|총.*배당/.test(cashText)) cashHints.push('CASH_AMOUNT_REFERENCED_AS_TOTAL_AMOUNT');
  if (/price|adjust|close|dividend/.test(cashText)) cashHints.push('CASH_AMOUNT_REFERENCED_NEAR_PRICE_ADJUSTMENT_LOGIC');

  const providerEventHints = [];
  if (/upsert|onconflict|on_conflict|unique|dedup|duplicate/.test(providerEventText)) {
    providerEventHints.push('PROVIDER_EVENT_ID_USED_IN_IDEMPOTENCY_OR_UNIQUENESS_LOGIC');
  }
  if (/rcept|receipt|dart/.test(providerEventText)) {
    providerEventHints.push('PROVIDER_EVENT_ID_REFERENCED_NEAR_DART_RECEIPT_LOGIC');
  }

  const sourceFpHints = [];
  if (/sha256|hash|fingerprint|stable|canonical/.test(sourceFpText)) {
    sourceFpHints.push('SOURCE_FINGERPRINT_HAS_HASH_OR_CANONICAL_IDENTITY_USAGE');
  }
  if (/raw|payload|document|response/.test(sourceFpText)) {
    sourceFpHints.push('SOURCE_FINGERPRINT_MAY_BE_DERIVED_FROM_RAW_SOURCE_CONTENT');
  }

  return {
    ratioFields: {
      hints: ratioHints,
      proven: ratioHints.length === 1 && !(
        ratioHints.includes('CODE_APPEARS_TO_USE_RATIO_TO_DIV_RATIO_FROM') &&
        ratioHints.includes('CODE_APPEARS_TO_USE_RATIO_FROM_DIV_RATIO_TO')
      )
    },
    cashAmount: {
      hints: cashHints,
      provenAsPerShare:
        cashHints.includes('CASH_AMOUNT_REFERENCED_AS_PER_SHARE') &&
        !cashHints.includes('CASH_AMOUNT_REFERENCED_AS_TOTAL_AMOUNT')
    },
    providerEventId: {
      hints: providerEventHints
    },
    sourceFingerprint: {
      hints: sourceFpHints
    }
  };
}

function validateInputs(canonical, chain, db) {
  if (!canonical || canonical.version !== CANONICAL_VERSION || !Array.isArray(canonical.records)) {
    throw new Error('INVALID_V9_7_6_CANONICAL_REPORT');
  }
  if (!chain || chain.version !== CHAIN_VERSION || !Array.isArray(chain.records)) {
    throw new Error('INVALID_V9_7_4_1_CHAIN_REPORT');
  }
  if (!db || db.version !== DB_VERSION || !Array.isArray(db.storageCandidates)) {
    throw new Error('INVALID_V9_7_7_DB_CONTRACT_REPORT');
  }

  if ((canonical.summary?.validatedEvents ?? -1) !== 15 ||
      (canonical.summary?.rejectedCandidates ?? -1) !== 6 ||
      (canonical.summary?.unresolvedCandidates ?? -1) !== 0 ||
      (canonical.summary?.errors ?? -1) !== 0) {
    throw new Error('CANONICAL_SAMPLE_INVARIANT_NOT_CLOSED');
  }

  if ((chain.summary?.correctionChainsUnresolved ?? -1) !== 0 ||
      (chain.summary?.withdrawalLinksUnresolved ?? -1) !== 0 ||
      (chain.summary?.errors ?? -1) !== 0) {
    throw new Error('CHAIN_REPORT_NOT_CLOSED');
  }
}

function canonicalProviderEventId(record, chainMap) {
  if (/^\d{14}$/.test(record.canonicalReceiptNo ?? '')) {
    return {
      providerEventId: record.canonicalReceiptNo,
      source: 'V9_7_6_CANONICAL_RECEIPT'
    };
  }

  const chain = chainMap.get(keyOfCandidate(record.candidate));
  if (chain?.chainType === 'CORRECTION' &&
      chain?.status === 'RESOLVED' &&
      /^\d{14}$/.test(chain.originalReceiptNo ?? '')) {
    return {
      providerEventId: chain.originalReceiptNo,
      source: 'RESOLVED_ORIGINAL_RECEIPT'
    };
  }

  if (/^\d{14}$/.test(record.candidate?.receiptNo ?? '')) {
    return {
      providerEventId: record.candidate.receiptNo,
      source: 'CURRENT_RECEIPT_NO_CORRECTION_CHAIN'
    };
  }

  throw new Error('CANONICAL_PROVIDER_EVENT_ID_NOT_DERIVABLE');
}

function canonicalIdentityPreview(canonical, chain) {
  const chainMap = new Map(chain.records.map(r => [keyOfCandidate(r.candidate), r]));
  const rows = [];

  for (const r of canonical.records) {
    if (r.finalStatus !== 'VALIDATED') continue;
    if (!r.event?.actionType || !r.event?.effectiveDate || !r.candidate?.stockCode) {
      throw new Error('VALIDATED_EVENT_REQUIRED_FIELD_MISSING');
    }

    const pe = canonicalProviderEventId(r, chainMap);
    const identityMaterial = [
      PROPOSED_PROVIDER,
      pe.providerEventId,
      r.candidate.stockCode,
      r.event.actionType
    ].join('|');

    const contentMaterial = stableStringify({
      stockCode: r.candidate.stockCode,
      providerEventId: pe.providerEventId,
      actionType: r.event.actionType,
      event: r.event
    });

    rows.push({
      stockCode: r.candidate.stockCode,
      actionType: r.event.actionType,
      effectiveDate: r.event.effectiveDate,
      currentReceiptNo: r.candidate.receiptNo,
      provider: PROPOSED_PROVIDER,
      providerEventId: pe.providerEventId,
      providerEventIdSource: pe.source,
      proposedIdentityFingerprint: sha256(identityMaterial),
      contentFingerprint: sha256(contentMaterial),
      originalEvent: r.event
    });
  }

  return rows;
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([key, rows]) => ({ key, rows }));
}

function uniqueHasProviderEventId(table) {
  return (table.uniqueSurfaces || []).some(u =>
    normalizeUniqueDefinition(u.definition || u.column || '')
      .includes('provider_event_id')
  );
}

function uniqueHasExactCurrentKey(table) {
  const expected = [
    'stock_code',
    'action_type',
    'effective_date',
    'provider',
    'source_fingerprint',
    'is_validation'
  ];
  return (table.uniqueSurfaces || []).some(u => {
    const d = normalizeUniqueDefinition(u.definition || '');
    return expected.every(c => d.includes(c));
  });
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--canonical=', '--chain=', '--db=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, def) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : def;
  };

  const canonicalFile = get(
    '--canonical=',
    path.join(root, 'logs', 'corporate-action-canonical-sample-v9-7-6.json')
  );
  const chainFile = get(
    '--chain=',
    path.join(root, 'logs', 'corporate-action-chain-repair-probe-v9-7-4-1.json')
  );
  const dbFile = get(
    '--db=',
    path.join(root, 'logs', 'corporate-action-db-contract-probe-v9-7-7.json')
  );
  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-idempotency-contract-probe-v9-7-8.json')
  );

  const canonical = loadJson(canonicalFile);
  const chain = loadJson(chainFile);
  const db = loadJson(dbFile);

  validateInputs(canonical, chain, db);

  const target = db.storageCandidates.find(x => x.tableName === TARGET_TABLE);
  if (!target) throw new Error('CORPORATE_ACTION_EVENTS_TABLE_NOT_FOUND');

  const requiredColumns = [
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'ratio_from',
    'ratio_to',
    'cash_amount',
    'currency',
    'provider',
    'provider_event_id',
    'source_fingerprint',
    'status',
    'metadata',
    'is_validation',
    'production_applied',
    'created_at'
  ];

  const actualCols = new Set((target.columns || []).map(c => c.name));
  const missingColumns = requiredColumns.filter(c => !actualCols.has(c));

  const rows = canonicalIdentityPreview(canonical, chain);

  const providerEventDuplicates = duplicateGroups(
    rows,
    r => `${r.provider}|${r.providerEventId}`
  );

  const identityFingerprintDuplicates = duplicateGroups(
    rows,
    r => r.proposedIdentityFingerprint
  );

  const currentUniquePreviewDuplicates = duplicateGroups(
    rows,
    r => [
      r.stockCode,
      r.actionType,
      r.effectiveDate,
      r.provider,
      r.proposedIdentityFingerprint,
      'true'
    ].join('|')
  );

  const currentUniqueKeyFound = uniqueHasExactCurrentKey(target);
  const providerEventIdUniqueFound = uniqueHasProviderEventId(target);

  const semantics = inspectSemantics(root);
  const semanticHints = inferSemanticHints(semantics.contexts);

  const risks = [];
  if (!providerEventIdUniqueFound) {
    risks.push({
      code: 'PROVIDER_EVENT_ID_NOT_UNIQUE',
      severity: 'HIGH',
      explanation:
        'The schema contains provider_event_id but no discovered UNIQUE surface protects it.'
    });
  }

  if (currentUniqueKeyFound) {
    risks.push({
      code: 'CURRENT_UNIQUE_KEY_INCLUDES_EFFECTIVE_DATE',
      severity: 'HIGH',
      explanation:
        'A correction that changes effective_date can bypass the current uniqueness key and create a second row for the same canonical provider event.'
    });
    risks.push({
      code: 'CURRENT_UNIQUE_KEY_INCLUDES_SOURCE_FINGERPRINT',
      severity: 'MEDIUM',
      explanation:
        'If source_fingerprint is based on raw/corrected source content, the same economic event can receive a different fingerprint after a correction.'
    });
  }

  if (!semanticHints.ratioFields.proven) {
    risks.push({
      code: 'RATIO_COLUMN_DIRECTION_NOT_PROVEN',
      severity: 'MEDIUM',
      explanation:
        'ratio_from/ratio_to mapping must be proven from existing adjustment code before import row construction.'
    });
  }

  if (!semanticHints.cashAmount.provenAsPerShare) {
    risks.push({
      code: 'CASH_AMOUNT_SEMANTICS_NOT_PROVEN',
      severity: 'MEDIUM',
      explanation:
        'cash_amount must be confirmed as per-share vs total cash amount before mapping CASH_DIVIDEND rows.'
    });
  }

  const identityClosed =
    rows.length === 15 &&
    providerEventDuplicates.length === 0 &&
    identityFingerprintDuplicates.length === 0;

  const proposedContract = {
    provider: PROPOSED_PROVIDER,
    providerEventId:
      'Canonical DART original receipt number for correction chains; otherwise the event receipt number.',
    sourceFingerprint:
      'Stable identity fingerprint SHA256(provider|provider_event_id|stock_code|action_type), NOT a raw-document/content hash.',
    preferredUniqueConstraint:
      'unique (provider, provider_event_id, is_validation)',
    preferredUpsertConflictTarget:
      'provider,provider_event_id,is_validation',
    correctionBehavior:
      'A later correction updates the existing canonical provider event row rather than inserting a second economic event.',
    withdrawnBehavior:
      'Withdrawn originals are excluded/suppressed before row construction; no active event row is created from the withdrawal sample.'
  };

  let status;
  if (missingColumns.length) {
    status = 'TARGET_TABLE_SCHEMA_INCOMPLETE';
  } else if (!identityClosed) {
    status = 'CANONICAL_IDENTITY_NOT_CLOSED';
  } else if (!providerEventIdUniqueFound || !semanticHints.ratioFields.proven || !semanticHints.cashAmount.provenAsPerShare) {
    status = 'IDEMPOTENCY_READY_MAPPING_REVIEW_REQUIRED';
  } else {
    status = 'IDEMPOTENCY_AND_MAPPING_CONTRACT_READY';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'READ_ONLY_LOCAL_CONTRACT_ANALYSIS',
    targetTable: TARGET_TABLE,
    targetTableContract: {
      columns: target.columns,
      uniqueSurfaces: target.uniqueSurfaces,
      currentUniqueKeyFound,
      providerEventIdUniqueFound,
      missingRequiredColumns: missingColumns
    },
    canonicalIdentity: {
      validatedEvents: rows.length,
      providerEventDuplicates: providerEventDuplicates.length,
      identityFingerprintDuplicates: identityFingerprintDuplicates.length,
      currentUniquePreviewDuplicates: currentUniquePreviewDuplicates.length,
      rows
    },
    semanticEvidence: {
      hints: semanticHints,
      contexts: semantics.contexts
    },
    proposedContract,
    risks,
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
      'PROVE_RATIO_AND_CASH_COLUMN_SEMANTICS_AND_ADD_OR_CONFIRM_CANONICAL_PROVIDER_EVENT_UNIQUENESS_BEFORE_ANY_DB_WRITE'
  };

  save(outputFile, state);

  console.log(JSON.stringify({
    status,
    targetTable: TARGET_TABLE,
    validatedEvents: rows.length,
    providerEventDuplicates: providerEventDuplicates.length,
    identityFingerprintDuplicates: identityFingerprintDuplicates.length,
    currentUniqueKeyFound,
    providerEventIdUniqueFound,
    ratioSemanticsProven: semanticHints.ratioFields.proven,
    ratioSemanticHints: semanticHints.ratioFields.hints,
    cashAmountPerShareProven: semanticHints.cashAmount.provenAsPerShare,
    cashAmountSemanticHints: semanticHints.cashAmount.hints,
    riskCodes: risks.map(r => r.code),
    proposedUniqueConstraint: proposedContract.preferredUniqueConstraint,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (status === 'TARGET_TABLE_SCHEMA_INCOMPLETE' ||
      status === 'CANONICAL_IDENTITY_NOT_CLOSED') {
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
  stableStringify,
  canonicalProviderEventId,
  canonicalIdentityPreview,
  duplicateGroups,
  inferSemanticHints,
  normalizeUniqueDefinition
};
