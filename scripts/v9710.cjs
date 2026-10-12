'use strict';

// V9.7.10 review-only schema contract + 15-row mapping preview.
//
// Defines the missing semantic contract explicitly:
//   ratio_from = pre-action units
//   ratio_to   = post-action units
//   cash_amount = cash dividend amount PER SHARE (currency/share)
//
// Generates:
//   1) review-only SQL proposal (NOT executed)
//   2) 15-row canonical event mapping preview JSON
//
// Safety:
//   - NO database connection
//   - NO network
//   - NO .env reads
//   - NO migration execution
//   - NO INSERT / UPDATE / DELETE / UPSERT
//   - NO coverage promotion

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_10_CONTRACT_AND_MAPPING_PREVIEW';
const CANONICAL_VERSION = 'V9_7_6_CANONICAL_SAMPLE_FINALIZATION_PROBE';
const CHAIN_VERSION = 'V9_7_4_1_CHAIN_REPAIR_PROBE';
const IDEMPOTENCY_VERSION = 'V9_7_8_IDEMPOTENCY_CONTRACT_PROBE';
const RATIO_VERSION = 'V9_7_9_1_CLEAN_COLUMN_SEMANTICS_PROBE';
const CASH_CONSUMER_VERSION = 'V9_7_9_3_CASH_CONSUMER_UNIT_PROBE';

const PROVIDER = 'DART_KRX_CANONICAL';
const TARGET_TABLE = 'public.corporate_action_events';

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'CONTRACT_PREVIEW_FAILED';
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function saveText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function keyOfCandidate(c) {
  return `${c?.receiptNo ?? ''}|${c?.candidateActionType ?? ''}`;
}

function canonicalProviderEventId(record, chainMap) {
  if (/^\d{14}$/.test(record.canonicalReceiptNo ?? '')) {
    return {
      value: record.canonicalReceiptNo,
      source: 'V9_7_6_CANONICAL_RECEIPT'
    };
  }

  const chain = chainMap.get(keyOfCandidate(record.candidate));
  if (
    chain?.chainType === 'CORRECTION' &&
    chain?.status === 'RESOLVED' &&
    /^\d{14}$/.test(chain.originalReceiptNo ?? '')
  ) {
    return {
      value: chain.originalReceiptNo,
      source: 'RESOLVED_ORIGINAL_RECEIPT'
    };
  }

  if (/^\d{14}$/.test(record.candidate?.receiptNo ?? '')) {
    return {
      value: record.candidate.receiptNo,
      source: 'CURRENT_RECEIPT'
    };
  }

  throw new Error('CANONICAL_PROVIDER_EVENT_ID_NOT_DERIVABLE');
}

function finiteOrNull(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function positiveOrNull(v) {
  const n = finiteOrNull(v);
  return n !== null && n > 0 ? n : null;
}

function mapRatioFields(event) {
  switch (event.actionType) {
    case 'STOCK_SPLIT':
    case 'REVERSE_SPLIT': {
      const factor = positiveOrNull(event.factor);
      if (!factor) throw new Error('INVALID_SPLIT_FACTOR');
      return {
        ratio_from: 1,
        ratio_to: factor,
        ratioPolicy: 'FACTOR_AS_POST_ACTION_UNITS_PER_ONE_PRE_ACTION_UNIT'
      };
    }

    case 'STOCK_DIVIDEND': {
      const perShare = finiteOrNull(event.stockPerShare);
      if (perShare === null || perShare < 0) {
        throw new Error('INVALID_STOCK_DIVIDEND_PER_SHARE');
      }
      return {
        ratio_from: 1,
        ratio_to: 1 + perShare,
        ratioPolicy: 'OLD_SHARE_1_BECOMES_1_PLUS_STOCK_DIVIDEND_PER_SHARE'
      };
    }

    case 'MERGER': {
      const left = positiveOrNull(event.ratio?.left);
      const right = finiteOrNull(event.ratio?.right);
      if (left === null || right === null || right < 0) {
        throw new Error('INVALID_MERGER_RATIO');
      }
      return {
        ratio_from: left,
        ratio_to: right,
        ratioPolicy: 'SOURCE_MERGER_EXCHANGE_RATIO_PRESERVED'
      };
    }

    case 'SPIN_OFF':
      // Do not coerce a spin-off allocation into the generic price/share ratio fields.
      // Parent-company price adjustment requires more than the new-company allocation ratio.
      return {
        ratio_from: null,
        ratio_to: null,
        ratioPolicy: 'NOT_PROJECTED_TO_GENERIC_RATIO_FIELDS'
      };

    case 'CASH_DIVIDEND':
      return {
        ratio_from: null,
        ratio_to: null,
        ratioPolicy: 'NOT_APPLICABLE'
      };

    default:
      throw new Error('UNSUPPORTED_VALIDATED_ACTION_TYPE');
  }
}

function mapCashAmount(event) {
  if (event.actionType !== 'CASH_DIVIDEND') {
    return {
      cash_amount: null,
      currency: null,
      cashPolicy: 'NOT_APPLICABLE'
    };
  }

  const perShare = finiteOrNull(event.cashPerShare);
  if (perShare === null || perShare < 0) {
    throw new Error('CASH_DIVIDEND_PER_SHARE_MISSING');
  }

  return {
    cash_amount: perShare,
    currency: event.currency || 'KRW',
    cashPolicy: 'CASH_AMOUNT_PER_SHARE'
  };
}

function validateInputs(canonical, chain, idem, ratio, cash) {
  if (!canonical || canonical.version !== CANONICAL_VERSION || !Array.isArray(canonical.records)) {
    throw new Error('INVALID_V9_7_6_REPORT');
  }

  if (!chain || chain.version !== CHAIN_VERSION || !Array.isArray(chain.records)) {
    throw new Error('INVALID_V9_7_4_1_REPORT');
  }

  if (!idem || idem.version !== IDEMPOTENCY_VERSION) {
    throw new Error('INVALID_V9_7_8_REPORT');
  }

  if (!ratio || ratio.version !== RATIO_VERSION) {
    throw new Error('INVALID_V9_7_9_1_REPORT');
  }

  if (!cash || cash.version !== CASH_CONSUMER_VERSION) {
    throw new Error('INVALID_V9_7_9_3_REPORT');
  }

  if (
    canonical.summary?.validatedEvents !== 15 ||
    canonical.summary?.rejectedCandidates !== 6 ||
    canonical.summary?.unresolvedCandidates !== 0 ||
    canonical.summary?.errors !== 0
  ) {
    throw new Error('CANONICAL_SAMPLE_NOT_CLOSED');
  }

  if (
    chain.summary?.correctionChainsUnresolved !== 0 ||
    chain.summary?.withdrawalLinksUnresolved !== 0 ||
    chain.summary?.errors !== 0
  ) {
    throw new Error('CHAIN_SAMPLE_NOT_CLOSED');
  }

  if (
    idem.canonicalIdentity?.providerEventDuplicates !== 0 ||
    idem.canonicalIdentity?.identityFingerprintDuplicates !== 0
  ) {
    throw new Error('IDEMPOTENCY_SAMPLE_NOT_CLOSED');
  }

  const r = ratio.resolvedSemantics?.ratio;
  if (
    r?.status !== 'PROVEN' ||
    r?.ratioFromMeaning !== 'PRE_ACTION_UNITS' ||
    r?.ratioToMeaning !== 'POST_ACTION_UNITS' ||
    r?.shareFactorFormula !== 'ratio_to / ratio_from' ||
    r?.priceFactorFormula !== 'ratio_from / ratio_to'
  ) {
    throw new Error('RATIO_CONTRACT_NOT_CLOSED');
  }
}

function mapValidatedRows(canonical, chain) {
  const chainMap = new Map(chain.records.map(r => [keyOfCandidate(r.candidate), r]));
  const rows = [];

  for (const record of canonical.records) {
    if (record.finalStatus !== 'VALIDATED') continue;

    const candidate = record.candidate;
    const event = record.event;

    if (!candidate?.stockCode || !event?.actionType || !event?.effectiveDate) {
      throw new Error('VALIDATED_EVENT_REQUIRED_FIELD_MISSING');
    }

    const providerEvent = canonicalProviderEventId(record, chainMap);
    const ratio = mapRatioFields(event);
    const cash = mapCashAmount(event);

    const identityMaterial = [
      PROVIDER,
      providerEvent.value,
      candidate.stockCode,
      event.actionType
    ].join('|');

    const sourceFingerprint = sha256(identityMaterial);

    const metadata = {
      schemaContractVersion: VERSION,
      candidateReceiptNo: candidate.receiptNo,
      canonicalProviderEventId: providerEvent.value,
      canonicalProviderEventIdSource: providerEvent.source,
      finalReason: record.finalReason,
      evidencePolicy: record.evidencePolicy ?? null,
      ratioPolicy: ratio.ratioPolicy,
      cashPolicy: cash.cashPolicy,
      originalCanonicalEvent: event,
      currentCorrectionReceiptNo: record.currentCorrectionReceiptNo ?? null,
      canonicalReceiptNo: record.canonicalReceiptNo ?? null
    };

    rows.push({
      stock_code: candidate.stockCode,
      action_type: event.actionType,
      effective_date: event.effectiveDate,
      ratio_from: ratio.ratio_from,
      ratio_to: ratio.ratio_to,
      cash_amount: cash.cash_amount,
      currency: cash.currency,
      provider: PROVIDER,
      provider_event_id: providerEvent.value,
      source_fingerprint: sourceFingerprint,
      status: 'VALIDATED',
      metadata,
      is_validation: true,
      production_applied: false
    });
  }

  return rows;
}

function duplicateGroups(rows, fn) {
  const m = new Map();
  for (const row of rows) {
    const k = fn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }
  return [...m.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, group }));
}

function buildSql() {
  return `-- V9.7.10 REVIEW-ONLY PROPOSAL
-- DO NOT APPLY YET.
-- Generated by v9-7-10-contract-preview.cjs.
--
-- Purpose:
--   1) Define corporate_action_events semantic comments.
--   2) Add stable provider-event idempotency protection.
--
-- Before applying in a later stage, run the preflight SELECT statements below
-- against the real database and review any returned rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT QUERY A: duplicate canonical provider identities.
-- Expected before migration: zero rows for non-null provider_event_id.
-- ---------------------------------------------------------------------------
SELECT
  provider,
  provider_event_id,
  is_validation,
  COUNT(*) AS row_count
FROM ${TARGET_TABLE}
WHERE provider_event_id IS NOT NULL
GROUP BY provider, provider_event_id, is_validation
HAVING COUNT(*) > 1;

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT QUERY B: current population shape.
-- Review only; this does not modify data.
-- ---------------------------------------------------------------------------
SELECT
  provider,
  action_type,
  is_validation,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE provider_event_id IS NULL) AS missing_provider_event_id
FROM ${TARGET_TABLE}
GROUP BY provider, action_type, is_validation
ORDER BY provider, action_type, is_validation;

-- ---------------------------------------------------------------------------
-- SEMANTIC CONTRACT
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN ${TARGET_TABLE}.ratio_from IS
  'Pre-action units. Generic share factor = ratio_to / ratio_from; generic price factor = ratio_from / ratio_to when the action type supports generic ratio adjustment.';

COMMENT ON COLUMN ${TARGET_TABLE}.ratio_to IS
  'Post-action units. Generic share factor = ratio_to / ratio_from; generic price factor = ratio_from / ratio_to when the action type supports generic ratio adjustment.';

COMMENT ON COLUMN ${TARGET_TABLE}.cash_amount IS
  'Cash dividend amount PER SHARE, denominated by currency. Never total dividend cash.';

COMMENT ON COLUMN ${TARGET_TABLE}.provider_event_id IS
  'Stable canonical provider event identifier. For DART correction chains use the original canonical DART receipt number; otherwise use the event receipt number.';

COMMENT ON COLUMN ${TARGET_TABLE}.source_fingerprint IS
  'Stable event identity fingerprint. For DART_KRX_CANONICAL: SHA256(provider|provider_event_id|stock_code|action_type). Do not use corrected raw-document bytes as the canonical row identity.';

-- ---------------------------------------------------------------------------
-- IDEMPOTENCY PROTECTION
-- Existing legacy uniqueness remains untouched in this proposal.
-- The new index protects a stable provider-event identity and tolerates
-- legacy rows where provider_event_id is NULL.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS
  uq_corporate_action_events_provider_event_validation
ON ${TARGET_TABLE} (provider, provider_event_id, is_validation)
WHERE provider_event_id IS NOT NULL;

-- REVIEW-ONLY FILE:
-- Keep this transaction uncommitted in v9.7.10.
ROLLBACK;
`;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = [
    '--canonical=',
    '--chain=',
    '--idempotency=',
    '--ratio=',
    '--cash=',
    '--output=',
    '--sql='
  ];

  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, fallback) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : fallback;
  };

  const canonicalFile = get(
    '--canonical=',
    path.join(root, 'logs', 'corporate-action-canonical-sample-v9-7-6.json')
  );

  const chainFile = get(
    '--chain=',
    path.join(root, 'logs', 'corporate-action-chain-repair-probe-v9-7-4-1.json')
  );

  const idemFile = get(
    '--idempotency=',
    path.join(root, 'logs', 'corporate-action-idempotency-contract-probe-v9-7-8.json')
  );

  const ratioFile = get(
    '--ratio=',
    path.join(root, 'logs', 'corporate-action-column-semantics-clean-probe-v9-7-9-1.json')
  );

  const cashFile = get(
    '--cash=',
    path.join(root, 'logs', 'corporate-action-cash-consumer-unit-probe-v9-7-9-3.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-contract-mapping-preview-v9-7-10.json')
  );

  const sqlFile = get(
    '--sql=',
    path.join(root, 'logs', 'corporate-action-schema-proposal-v9-7-10.sql')
  );

  const canonical = loadJson(canonicalFile);
  const chain = loadJson(chainFile);
  const idem = loadJson(idemFile);
  const ratio = loadJson(ratioFile);
  const cash = loadJson(cashFile);

  validateInputs(canonical, chain, idem, ratio, cash);

  const rows = mapValidatedRows(canonical, chain);

  const providerDupes = duplicateGroups(
    rows,
    r => `${r.provider}|${r.provider_event_id}|${r.is_validation}`
  );

  const fingerprintDupes = duplicateGroups(
    rows,
    r => r.source_fingerprint
  );

  const cashRows = rows.filter(r => r.action_type === 'CASH_DIVIDEND');
  const stockDividendRows = rows.filter(r => r.action_type === 'STOCK_DIVIDEND');
  const splitRows = rows.filter(r =>
    r.action_type === 'STOCK_SPLIT' ||
    r.action_type === 'REVERSE_SPLIT'
  );
  const mergerRows = rows.filter(r => r.action_type === 'MERGER');
  const spinOffRows = rows.filter(r => r.action_type === 'SPIN_OFF');

  const invariants = {
    mappedRows: rows.length,
    expectedMappedRows: 15,
    providerIdentityDuplicates: providerDupes.length,
    sourceFingerprintDuplicates: fingerprintDupes.length,
    cashDividendRows: cashRows.length,
    cashDividendRowsWithPerShareAmount: cashRows.filter(r =>
      Number.isFinite(r.cash_amount) && r.cash_amount >= 0
    ).length,
    stockDividendRows: stockDividendRows.length,
    stockDividendRowsWithRatio: stockDividendRows.filter(r =>
      Number.isFinite(r.ratio_from) && Number.isFinite(r.ratio_to)
    ).length,
    splitOrReverseSplitRows: splitRows.length,
    splitRowsWithRatio: splitRows.filter(r =>
      Number.isFinite(r.ratio_from) && Number.isFinite(r.ratio_to)
    ).length,
    mergerRows: mergerRows.length,
    mergerRowsWithSourceRatio: mergerRows.filter(r =>
      Number.isFinite(r.ratio_from) && Number.isFinite(r.ratio_to)
    ).length,
    spinOffRows: spinOffRows.length,
    spinOffRowsWithGenericRatioSuppressed: spinOffRows.filter(r =>
      r.ratio_from === null && r.ratio_to === null
    ).length
  };

  const closed =
    invariants.mappedRows === 15 &&
    invariants.providerIdentityDuplicates === 0 &&
    invariants.sourceFingerprintDuplicates === 0 &&
    invariants.cashDividendRowsWithPerShareAmount === invariants.cashDividendRows &&
    invariants.stockDividendRowsWithRatio === invariants.stockDividendRows &&
    invariants.splitRowsWithRatio === invariants.splitOrReverseSplitRows &&
    invariants.mergerRowsWithSourceRatio === invariants.mergerRows &&
    invariants.spinOffRowsWithGenericRatioSuppressed === invariants.spinOffRows;

  const sql = buildSql();
  saveText(sqlFile, sql);

  const state = {
    version: VERSION,
    status: closed
      ? 'CONTRACT_AND_15_ROW_MAPPING_PREVIEW_READY'
      : 'CONTRACT_MAPPING_PREVIEW_REVIEW_REQUIRED',
    scope: 'REVIEW_ONLY_NO_DATABASE_WRITE',
    explicitContracts: {
      ratio_from: 'PRE_ACTION_UNITS',
      ratio_to: 'POST_ACTION_UNITS',
      shareFactorFormula: 'ratio_to / ratio_from',
      priceFactorFormula: 'ratio_from / ratio_to',
      cash_amount: 'CASH_DIVIDEND_AMOUNT_PER_SHARE',
      cashAmountUnit: 'currency/share',
      provider: PROVIDER,
      provider_event_id:
        'Canonical original DART receipt for correction chains; otherwise event DART receipt',
      source_fingerprint:
        'SHA256(provider|provider_event_id|stock_code|action_type)',
      upsertIdentity:
        '(provider, provider_event_id, is_validation)'
    },
    mappingPolicies: {
      CASH_DIVIDEND:
        'cash_amount=cashPerShare; generic ratio fields null',
      STOCK_DIVIDEND:
        'ratio_from=1; ratio_to=1+stockPerShare',
      STOCK_SPLIT:
        'ratio_from=1; ratio_to=factor',
      REVERSE_SPLIT:
        'ratio_from=1; ratio_to=factor',
      MERGER:
        'preserve source exchange ratio left:right as ratio_from:ratio_to; adjustment support remains a separate decision',
      SPIN_OFF:
        'do not coerce new-company allocation ratio into generic ratio_from/ratio_to; preserve all source fields in metadata'
    },
    invariants,
    rows,
    sqlProposal: {
      path: path.relative(root, sqlFile).replace(/\\/g, '/'),
      sha256: sha256(sql),
      executed: false,
      migrationApplied: false
    },
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      writesPerformed: 0,
      eventRowsInserted: 0,
      migrationsApplied: 0,
      coveragePromoted: false
    },
    nextGate:
      'REVIEW_SQL_AND_RUN_DATABASE_READ_ONLY_PREFLIGHT_BEFORE_APPLYING_ANY_MIGRATION'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    mappedRows: invariants.mappedRows,
    providerIdentityDuplicates: invariants.providerIdentityDuplicates,
    sourceFingerprintDuplicates: invariants.sourceFingerprintDuplicates,
    cashDividendRows: invariants.cashDividendRows,
    cashDividendRowsWithPerShareAmount: invariants.cashDividendRowsWithPerShareAmount,
    stockDividendRows: invariants.stockDividendRows,
    splitOrReverseSplitRows: invariants.splitOrReverseSplitRows,
    mergerRows: invariants.mergerRows,
    spinOffRows: invariants.spinOffRows,
    spinOffGenericRatioSuppressed: invariants.spinOffRowsWithGenericRatioSuppressed,
    proposedUniqueIndex:
      'unique(provider, provider_event_id, is_validation) where provider_event_id is not null',
    sqlProposalExecuted: false,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Review-only SQL proposal: ' + sqlFile);
  console.log('Upload only this report (no .env files): ' + outputFile);

  if (!closed) {
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
  mapRatioFields,
  mapCashAmount,
  canonicalProviderEventId,
  mapValidatedRows,
  buildSql
};
