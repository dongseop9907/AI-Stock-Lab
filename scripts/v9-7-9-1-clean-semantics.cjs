'use strict';

// V9.7.9.1 clean semantics probe.
// Fixes V9.7.9 self-contamination by excluding the temporary V9.7.x
// corporate-action discovery/probe scripts from semantic evidence.
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

const VERSION = 'V9_7_9_1_CLEAN_COLUMN_SEMANTICS_PROBE';
const V978_VERSION = 'V9_7_8_IDEMPOTENCY_CONTRACT_PROBE';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_EVIDENCE = 60;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const TEMP_PROBE_BASENAMES = [
  /^collect-corporate-action-details-v9-7-2(?:\(1\))?\.cjs$/i,
  /^parse-corporate-action-details-v9-7-3\.cjs$/i,
  /^resolve-corporate-action-chains-v9-7-4(?:-1)?\.cjs$/i,
  /^resolve-dividend-market-adjustments-v9-7-5(?:-1)?\.cjs$/i,
  /^finalize-corporate-action-sample-v9-7-6\.cjs$/i,
  /^inspect-corporate-action-db-contract-v9-7-7(?:-fixed)?\.cjs$/i,
  /^validate-corporate-action-idempotency-v9-7-8(?:-redownload)?\.cjs$/i,
  /^resolve-corporate-action-column-semantics-v9-7-9\.cjs$/i,
  /^v9-7-9-column-semantics\.cjs$/i,
  /^v9-7-9-1-clean-semantics\.cjs$/i
];

const TEMP_VERSION_MARKERS = [
  'V9_7_7_DB_CONTRACT_PROBE',
  'V9_7_8_IDEMPOTENCY_CONTRACT_PROBE',
  'V9_7_9_COLUMN_SEMANTICS_PROBE',
  'V9_7_9_1_CLEAN_COLUMN_SEMANTICS_PROBE'
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'CLEAN_COLUMN_SEMANTICS_PROBE_FAILED';
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

function shouldExclude(file, text) {
  const base = path.basename(file.rel);
  if (TEMP_PROBE_BASENAMES.some(rx => rx.test(base))) {
    return 'TEMP_V9_7_PROBE_FILENAME';
  }
  if (TEMP_VERSION_MARKERS.some(marker => text.includes(marker))) {
    return 'TEMP_V9_7_PROBE_MARKER';
  }
  return null;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function makeEvidence(file, text, index, matchText, kind) {
  const lines = text.split(/\r?\n/);
  const line = lineNumberAt(text, index);
  const start = Math.max(0, line - 6);
  const end = Math.min(lines.length, line + 7);

  return {
    kind,
    file: file.rel,
    line,
    match: String(matchText).replace(/\s+/g, ' ').trim().slice(0, 700),
    context: lines
      .slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 5000)
  };
}

function pushLimited(arr, value) {
  if (arr.length < MAX_EVIDENCE) arr.push(value);
}

function scanRegex(file, text, regex, kind, bucket) {
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text))) {
    pushLimited(bucket, makeEvidence(file, text, m.index, m[0], kind));
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
}

function scanProject(root) {
  const files = walk(root);
  const excluded = [];

  const evidence = {
    shareFactorToOverFrom: [],
    shareFactorFromOverTo: [],
    priceFactorFromOverTo: [],
    priceFactorToOverFrom: [],
    genericRatioToOverFrom: [],
    genericRatioFromOverTo: [],
    cashAmountSubtractedFromPrice: [],
    cashAmountDividedByPrice: [],
    cashAmountAssignments: [],
    cashAmountTotalHints: [],
    cashAmountPerShareHints: [],
    providerEventIdConflictUsage: [],
    providerEventIdReceiptUsage: [],
    sourceFingerprintRawHashUsage: [],
    sourceFingerprintIdentityUsage: [],
    corporateActionEventWrites: []
  };

  let scanned = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    const reason = shouldExclude(file, text);
    if (reason) {
      excluded.push({ file: file.rel, reason });
      continue;
    }

    scanned++;

    const lower = text.toLowerCase();
    if (!(
      lower.includes('ratio_from') ||
      lower.includes('ratio_to') ||
      lower.includes('cash_amount') ||
      lower.includes('provider_event_id') ||
      lower.includes('source_fingerprint') ||
      lower.includes('corporate_action_events')
    )) {
      continue;
    }

    // Factor assignment patterns. Allow optional object prefixes such as event.ratio_to.
    scanRegex(
      file,
      text,
      /\b(?:event_?share_?factor|share_?factor)\b\s*[:=]\s*[^;\n]{0,240}?\bratio_to\b[^;\n]{0,80}?\/[^;\n]{0,80}?\bratio_from\b/ig,
      'SHARE_FACTOR_RATIO_TO_OVER_FROM',
      evidence.shareFactorToOverFrom
    );

    scanRegex(
      file,
      text,
      /\b(?:event_?share_?factor|share_?factor)\b\s*[:=]\s*[^;\n]{0,240}?\bratio_from\b[^;\n]{0,80}?\/[^;\n]{0,80}?\bratio_to\b/ig,
      'SHARE_FACTOR_RATIO_FROM_OVER_TO',
      evidence.shareFactorFromOverTo
    );

    scanRegex(
      file,
      text,
      /\b(?:event_?price_?factor|price_?factor)\b\s*[:=]\s*[^;\n]{0,240}?\bratio_from\b[^;\n]{0,80}?\/[^;\n]{0,80}?\bratio_to\b/ig,
      'PRICE_FACTOR_RATIO_FROM_OVER_TO',
      evidence.priceFactorFromOverTo
    );

    scanRegex(
      file,
      text,
      /\b(?:event_?price_?factor|price_?factor)\b\s*[:=]\s*[^;\n]{0,240}?\bratio_to\b[^;\n]{0,80}?\/[^;\n]{0,80}?\bratio_from\b/ig,
      'PRICE_FACTOR_RATIO_TO_OVER_FROM',
      evidence.priceFactorToOverFrom
    );

    // Generic formulas as supporting evidence only.
    scanRegex(
      file,
      text,
      /\bratio_to\b[^;\n]{0,100}?\/[^;\n]{0,100}?\bratio_from\b/ig,
      'GENERIC_RATIO_TO_OVER_FROM',
      evidence.genericRatioToOverFrom
    );

    scanRegex(
      file,
      text,
      /\bratio_from\b[^;\n]{0,100}?\/[^;\n]{0,100}?\bratio_to\b/ig,
      'GENERIC_RATIO_FROM_OVER_TO',
      evidence.genericRatioFromOverTo
    );

    // cash_amount unit evidence:
    // If cash_amount is directly subtracted from a per-share price, it must have price/share units.
    scanRegex(
      file,
      text,
      /\b(?:reference_price|close_price|prev_close|previous_close|price|close)\b[^;\n]{0,120}?-\s*[^;\n]{0,80}?\bcash_amount\b/ig,
      'PRICE_MINUS_CASH_AMOUNT',
      evidence.cashAmountSubtractedFromPrice
    );

    scanRegex(
      file,
      text,
      /\bcash_amount\b[^;\n]{0,80}?\/[^;\n]{0,80}?\b(?:reference_price|close_price|prev_close|previous_close|price|close)\b/ig,
      'CASH_AMOUNT_DIVIDED_BY_PRICE',
      evidence.cashAmountDividedByPrice
    );

    scanRegex(
      file,
      text,
      /\bcash_amount\b\s*[:=]\s*[^,\n;}]{1,220}/ig,
      'CASH_AMOUNT_ASSIGNMENT',
      evidence.cashAmountAssignments
    );

    scanRegex(
      file,
      text,
      /(?:cash_amount|cashAmount)[\s\S]{0,180}(?:per_share|perShare|dividend_per_share|dividendPerShare|\bdps\b|1주당|주당)|(?:per_share|perShare|dividend_per_share|dividendPerShare|\bdps\b|1주당|주당)[\s\S]{0,180}(?:cash_amount|cashAmount)/ig,
      'CASH_AMOUNT_PER_SHARE_HINT',
      evidence.cashAmountPerShareHints
    );

    scanRegex(
      file,
      text,
      /(?:cash_amount|cashAmount)[\s\S]{0,180}(?:total_cash|totalCash|total_dividend|totalDividend|dividend_total|gross_amount|배당금총액|총배당|총액)|(?:total_cash|totalCash|total_dividend|totalDividend|dividend_total|gross_amount|배당금총액|총배당|총액)[\s\S]{0,180}(?:cash_amount|cashAmount)/ig,
      'CASH_AMOUNT_TOTAL_HINT',
      evidence.cashAmountTotalHints
    );

    scanRegex(
      file,
      text,
      /(?:provider_event_id|providerEventId)[\s\S]{0,250}(?:on_conflict|onConflict|upsert|unique|duplicate|dedup)|(?:on_conflict|onConflict|upsert|unique|duplicate|dedup)[\s\S]{0,250}(?:provider_event_id|providerEventId)/ig,
      'PROVIDER_EVENT_ID_CONFLICT_USAGE',
      evidence.providerEventIdConflictUsage
    );

    scanRegex(
      file,
      text,
      /(?:provider_event_id|providerEventId)[\s\S]{0,250}(?:rcept_no|rceptNo|receipt_no|receiptNo|dart)|(?:rcept_no|rceptNo|receipt_no|receiptNo|dart)[\s\S]{0,250}(?:provider_event_id|providerEventId)/ig,
      'PROVIDER_EVENT_ID_RECEIPT_USAGE',
      evidence.providerEventIdReceiptUsage
    );

    scanRegex(
      file,
      text,
      /(?:source_fingerprint|sourceFingerprint)[\s\S]{0,300}(?:raw_payload|rawPayload|raw_response|rawResponse|document|response|JSON\.stringify)|(?:raw_payload|rawPayload|raw_response|rawResponse|document|response|JSON\.stringify)[\s\S]{0,300}(?:source_fingerprint|sourceFingerprint)/ig,
      'SOURCE_FINGERPRINT_RAW_HASH_USAGE',
      evidence.sourceFingerprintRawHashUsage
    );

    scanRegex(
      file,
      text,
      /(?:source_fingerprint|sourceFingerprint)[\s\S]{0,300}(?:provider_event_id|providerEventId|stock_code|stockCode|action_type|actionType)|(?:provider_event_id|providerEventId|stock_code|stockCode|action_type|actionType)[\s\S]{0,300}(?:source_fingerprint|sourceFingerprint)/ig,
      'SOURCE_FINGERPRINT_IDENTITY_USAGE',
      evidence.sourceFingerprintIdentityUsage
    );

    // Write-site context only; script does NOT execute it.
    scanRegex(
      file,
      text,
      /\.from\s*\(\s*['"`]corporate_action_events['"`]\s*\)[\s\S]{0,500}\.(?:insert|upsert|update)\s*\(/ig,
      'CORPORATE_ACTION_EVENTS_WRITE_SITE',
      evidence.corporateActionEventWrites
    );

    scanRegex(
      file,
      text,
      /\binsert\s+into\s+(?:public\.)?corporate_action_events\b[\s\S]{0,700}/ig,
      'CORPORATE_ACTION_EVENTS_SQL_INSERT_SITE',
      evidence.corporateActionEventWrites
    );
  }

  return {
    filesDiscovered: files.length,
    filesScanned: scanned,
    excluded,
    evidence
  };
}

function resolveRatio(e) {
  const counts = {
    shareToOverFrom: e.shareFactorToOverFrom.length,
    shareFromOverTo: e.shareFactorFromOverTo.length,
    priceFromOverTo: e.priceFactorFromOverTo.length,
    priceToOverFrom: e.priceFactorToOverFrom.length
  };

  // Strong proof: explicit complementary share/price formulas.
  if (
    counts.shareToOverFrom > 0 &&
    counts.priceFromOverTo > 0 &&
    counts.shareFromOverTo === 0 &&
    counts.priceToOverFrom === 0
  ) {
    return {
      status: 'PROVEN',
      ratioFromMeaning: 'PRE_ACTION_UNITS',
      ratioToMeaning: 'POST_ACTION_UNITS',
      shareFactorFormula: 'ratio_to / ratio_from',
      priceFactorFormula: 'ratio_from / ratio_to',
      proof: 'EXPLICIT_COMPLEMENTARY_FACTOR_FORMULAS',
      counts
    };
  }

  if (
    counts.shareFromOverTo > 0 &&
    counts.priceToOverFrom > 0 &&
    counts.shareToOverFrom === 0 &&
    counts.priceFromOverTo === 0
  ) {
    return {
      status: 'PROVEN',
      ratioFromMeaning: 'POST_ACTION_UNITS',
      ratioToMeaning: 'PRE_ACTION_UNITS',
      shareFactorFormula: 'ratio_from / ratio_to',
      priceFactorFormula: 'ratio_to / ratio_from',
      proof: 'EXPLICIT_COMPLEMENTARY_FACTOR_FORMULAS',
      counts
    };
  }

  // Medium proof: one explicit factor plus inverse generic formula, without contradictory explicit formula.
  if (
    counts.shareToOverFrom > 0 &&
    counts.shareFromOverTo === 0 &&
    counts.priceToOverFrom === 0 &&
    e.genericRatioFromOverTo.length > 0
  ) {
    return {
      status: 'PROVEN',
      ratioFromMeaning: 'PRE_ACTION_UNITS',
      ratioToMeaning: 'POST_ACTION_UNITS',
      shareFactorFormula: 'ratio_to / ratio_from',
      priceFactorFormula: 'ratio_from / ratio_to',
      proof: 'EXPLICIT_SHARE_FACTOR_PLUS_INVERSE_PRICE_SUPPORT',
      counts
    };
  }

  return {
    status: 'AMBIGUOUS',
    counts,
    genericToOverFrom: e.genericRatioToOverFrom.length,
    genericFromOverTo: e.genericRatioFromOverTo.length
  };
}

function resolveCash(e) {
  const priceUnitEvidence =
    e.cashAmountSubtractedFromPrice.length +
    e.cashAmountDividedByPrice.length;

  const perShareHints = e.cashAmountPerShareHints.length;
  const totalHints = e.cashAmountTotalHints.length;

  if (priceUnitEvidence > 0 && totalHints === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
      proof: 'CASH_AMOUNT_USED_IN_PER_SHARE_PRICE_ADJUSTMENT_FORMULA',
      priceUnitEvidence,
      perShareHints,
      totalHints
    };
  }

  if (perShareHints > 0 && totalHints === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'CASH_AMOUNT_PER_SHARE',
      proof: 'EXPLICIT_PER_SHARE_ASSIGNMENT_OR_NAMING',
      priceUnitEvidence,
      perShareHints,
      totalHints
    };
  }

  if (totalHints > 0 && perShareHints === 0 && priceUnitEvidence === 0) {
    return {
      status: 'PROVEN',
      cashAmountMeaning: 'TOTAL_CASH_AMOUNT',
      proof: 'EXPLICIT_TOTAL_AMOUNT_ASSIGNMENT_OR_NAMING',
      priceUnitEvidence,
      perShareHints,
      totalHints
    };
  }

  return {
    status: 'AMBIGUOUS',
    priceUnitEvidence,
    perShareHints,
    totalHints,
    assignments: e.cashAmountAssignments.length
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--v978=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, fallback) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : fallback;
  };

  const v978File = get(
    '--v978=',
    path.join(root, 'logs', 'corporate-action-idempotency-contract-probe-v9-7-8.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-column-semantics-clean-probe-v9-7-9-1.json')
  );

  const v978 = loadJson(v978File);
  if (!v978 || v978.version !== V978_VERSION) {
    throw new Error('INVALID_V9_7_8_REPORT');
  }

  if (
    (v978.canonicalIdentity?.validatedEvents ?? -1) !== 15 ||
    (v978.canonicalIdentity?.providerEventDuplicates ?? -1) !== 0 ||
    (v978.canonicalIdentity?.identityFingerprintDuplicates ?? -1) !== 0
  ) {
    throw new Error('V9_7_8_IDENTITY_NOT_CLOSED');
  }

  const scan = scanProject(root);
  const ratio = resolveRatio(scan.evidence);
  const cash = resolveCash(scan.evidence);

  const providerEventId = {
    conflictUsageCount: scan.evidence.providerEventIdConflictUsage.length,
    receiptUsageCount: scan.evidence.providerEventIdReceiptUsage.length
  };

  const sourceFingerprint = {
    rawHashUsageCount: scan.evidence.sourceFingerprintRawHashUsage.length,
    identityUsageCount: scan.evidence.sourceFingerprintIdentityUsage.length
  };

  const migrationRequired = !v978.targetTableContract?.providerEventIdUniqueFound;

  const risks = [];
  if (ratio.status !== 'PROVEN') risks.push('RATIO_SEMANTICS_STILL_AMBIGUOUS');
  if (cash.status !== 'PROVEN') risks.push('CASH_AMOUNT_SEMANTICS_STILL_AMBIGUOUS');
  if (migrationRequired) risks.push('PROVIDER_EVENT_ID_UNIQUENESS_MIGRATION_REQUIRED');
  if (v978.targetTableContract?.currentUniqueKeyFound) {
    risks.push('LEGACY_UNIQUE_KEY_SHOULD_NOT_BE_PRIMARY_UPSERT_IDENTITY');
  }

  let status;
  if (ratio.status === 'PROVEN' && cash.status === 'PROVEN') {
    status = migrationRequired
      ? 'MAPPING_CONTRACT_READY_SCHEMA_MIGRATION_REQUIRED'
      : 'MAPPING_AND_SCHEMA_CONTRACT_READY';
  } else {
    status = 'CLEAN_SEMANTICS_EVIDENCE_REVIEW_REQUIRED';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'READ_ONLY_LOCAL_STATIC_ANALYSIS_EXCLUDING_TEMP_PROBES',
    scan: {
      filesDiscovered: scan.filesDiscovered,
      filesScanned: scan.filesScanned,
      excludedTemporaryProbeFiles: scan.excluded
    },
    resolvedSemantics: {
      ratio,
      cashAmount: cash,
      providerEventId,
      sourceFingerprint
    },
    decisiveEvidence: {
      shareFactorToOverFrom: scan.evidence.shareFactorToOverFrom,
      shareFactorFromOverTo: scan.evidence.shareFactorFromOverTo,
      priceFactorFromOverTo: scan.evidence.priceFactorFromOverTo,
      priceFactorToOverFrom: scan.evidence.priceFactorToOverFrom,
      cashAmountSubtractedFromPrice: scan.evidence.cashAmountSubtractedFromPrice,
      cashAmountDividedByPrice: scan.evidence.cashAmountDividedByPrice,
      cashAmountPerShareHints: scan.evidence.cashAmountPerShareHints,
      cashAmountTotalHints: scan.evidence.cashAmountTotalHints,
      providerEventIdConflictUsage: scan.evidence.providerEventIdConflictUsage,
      providerEventIdReceiptUsage: scan.evidence.providerEventIdReceiptUsage,
      sourceFingerprintRawHashUsage: scan.evidence.sourceFingerprintRawHashUsage,
      sourceFingerprintIdentityUsage: scan.evidence.sourceFingerprintIdentityUsage,
      corporateActionEventWrites: scan.evidence.corporateActionEventWrites
    },
    supportingEvidence: {
      genericRatioToOverFrom: scan.evidence.genericRatioToOverFrom,
      genericRatioFromOverTo: scan.evidence.genericRatioFromOverTo,
      cashAmountAssignments: scan.evidence.cashAmountAssignments
    },
    migrationNeed: {
      providerEventIdUniqueRequired: migrationRequired,
      recommendedUniqueConstraint: 'unique (provider, provider_event_id, is_validation)',
      recommendedConflictTarget: 'provider,provider_event_id,is_validation'
    },
    riskCodes: risks,
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
    filesDiscovered: scan.filesDiscovered,
    filesScanned: scan.filesScanned,
    excludedTemporaryProbeFiles: scan.excluded.length,
    ratioStatus: ratio.status,
    ratioFromMeaning: ratio.ratioFromMeaning ?? null,
    ratioToMeaning: ratio.ratioToMeaning ?? null,
    shareFactorFormula: ratio.shareFactorFormula ?? null,
    priceFactorFormula: ratio.priceFactorFormula ?? null,
    ratioProof: ratio.proof ?? null,
    cashAmountStatus: cash.status,
    cashAmountMeaning: cash.cashAmountMeaning ?? null,
    cashAmountProof: cash.proof ?? null,
    providerEventIdConflictUsageCount: providerEventId.conflictUsageCount,
    providerEventIdReceiptUsageCount: providerEventId.receiptUsageCount,
    sourceFingerprintRawHashUsageCount: sourceFingerprint.rawHashUsageCount,
    sourceFingerprintIdentityUsageCount: sourceFingerprint.identityUsageCount,
    providerEventIdUniqueRequired: migrationRequired,
    riskCodes: risks,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (status === 'CLEAN_SEMANTICS_EVIDENCE_REVIEW_REQUIRED') {
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
  shouldExclude,
  resolveRatio,
  resolveCash,
  scanProject
};
