#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.5 / 5.1 historical canonical-source reuse audit
 *
 * READ ONLY.
 *
 * Proves whether historical canonical source-selection artifacts can be reused
 * after repaired V9.8 lineage replay and V9.9 evidence/chain reuse proof.
 *
 * Required business contract:
 * - 7 active canonical chains
 * - action types:
 *     CASH_DIVIDEND 3
 *     MERGER 2
 *     REVERSE_SPLIT 1
 *     SPIN_OFF 1
 * - V9.9.5 -> V9.9.5.1 active canonical identity set is unchanged
 * - no blocking / unresolved-accounting rows in V9.9.5.1
 * - 001570 SPIN_OFF canonical root remains 20260909000291
 * - correction receipt 20261002000513 is represented in that canonical chain
 *   when chain/source/member receipt fields are exposed
 * - no DB writes
 *
 * 028080 remains separate virtual repair overlay and is not injected into this
 * incremental seven-event set.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_5_5_1_REPLAY_READ_ONLY_HISTORICAL_CANONICAL_SOURCE_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_3_3_1_4_REPLAY_V2_FINGERPRINT_SEMANTICS_AWARE_HISTORICAL_EVIDENCE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_RESULTS_REUSABLE_AFTER_FINGERPRINT_SEMANTICS_RECLASSIFICATION';

const EXPECTED_ACTION_COUNTS = {
  CASH_DIVIDEND: 3,
  MERGER: 2,
  REVERSE_SPLIT: 1,
  SPIN_OFF: 1,
};

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return value;
    }
  }
  return null;
}

function normalizeReceipt(value) {
  const text = String(value ?? '').trim();
  return /^\d{14}$/.test(text) ? text : '';
}

function normalizeStock(value) {
  const text = String(value ?? '').trim();
  return text ? text.padStart(6, '0') : '';
}

function normalizeAction(value) {
  return String(value ?? '').trim().toUpperCase();
}

function badStatus(value) {
  const text = String(value ?? '').toUpperCase();
  return (
    text.includes('FAILED') ||
    text.includes('BLOCKED') ||
    text.includes('ERROR')
  );
}

function safetyWrites(doc) {
  const values = [
    doc?.databaseWrites,
    doc?.safety?.databaseWrites,
    doc?.counts?.databaseWrites,
  ];

  for (const value of values) {
    if (value !== undefined && value !== null) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

function arrayField(doc, ...names) {
  for (const name of names) {
    if (Array.isArray(doc?.[name])) return doc[name];
  }
  return [];
}

function receiptCandidates(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;

  if (Array.isArray(value)) {
    for (const child of value) {
      receiptCandidates(child, out);
    }
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'string' &&
      /receipt|rcept|providerEventId|provider_event_id/i.test(key)
    ) {
      const receipt = normalizeReceipt(child);
      if (receipt) out.add(receipt);
    }

    if (child && typeof child === 'object') {
      receiptCandidates(child, out);
    }
  }

  return out;
}

function canonicalRow(row) {
  const providerEventId = normalizeReceipt(
    firstNonEmpty(
      row.providerEventId,
      row.provider_event_id,
      row.rootReceiptNo,
      row.root_receipt_no,
      row.canonicalReceiptNo,
      row.canonical_receipt_no,
    ),
  );

  const sourceReceiptNo = normalizeReceipt(
    firstNonEmpty(
      row.sourceReceiptNo,
      row.source_receipt_no,
      row.canonicalSourceReceiptNo,
      row.canonical_source_receipt_no,
      row.latestValidReceiptNo,
      row.latest_valid_receipt_no,
      row.receiptNo,
      row.receipt_no,
    ),
  );

  const stockCode = normalizeStock(
    firstNonEmpty(
      row.stockCode,
      row.stock_code,
    ),
  );

  const actionType = normalizeAction(
    firstNonEmpty(
      row.actionType,
      row.action_type,
    ),
  );

  const sourceKind = firstNonEmpty(
    row.sourceKind,
    row.source_kind,
    row.canonicalSourceKind,
    row.canonical_source_kind,
    row.selectedSourceKind,
    row.selected_source_kind,
  );

  const allReceipts = [
    ...receiptCandidates(row),
  ].sort();

  return {
    providerEventId,
    sourceReceiptNo,
    stockCode,
    actionType,
    sourceKind:
      sourceKind === null
        ? null
        : String(sourceKind),
    allReceipts,
  };
}

function identityKey(row) {
  return [
    row.providerEventId,
    row.stockCode,
    row.actionType,
  ].join('|');
}

function countActions(rows) {
  const out = {};
  for (const row of rows) {
    const key = row.actionType || 'UNKNOWN';
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function compareObjectCounts(actual, expected) {
  const keys = [
    ...new Set([
      ...Object.keys(actual),
      ...Object.keys(expected),
    ]),
  ].sort();

  const differences = [];

  for (const key of keys) {
    if (Number(actual[key] ?? 0) !== Number(expected[key] ?? 0)) {
      differences.push({
        actionType: key,
        actual: Number(actual[key] ?? 0),
        expected: Number(expected[key] ?? 0),
      });
    }
  }

  return differences;
}

function lengthOrZero(doc, ...names) {
  return arrayField(doc, ...names).length;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    upstream: path.join(
      root,
      'logs',
      'opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay-v2.json',
    ),
    canonical5: path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-9-5.json',
    ),
    canonical51: path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-9-5-1.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-historical-canonical-source-reuse-v9-9-5-5-1-replay.json',
  );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const upstream = readJson(files.upstream);
  const canonical5 = readJson(files.canonical5);
  const canonical51 = readJson(files.canonical51);

  assert(
    upstream.version === UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${upstream.version}`,
  );

  assert(
    upstream.status === UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${upstream.status}`,
  );

  assert(
    upstream.conclusion?.historicalV994ChainResolutionReusable === true,
    'UPSTREAM_CHAIN_REUSE_NOT_PROVEN',
  );

  const raw5 = arrayField(canonical5, 'activeChains');
  const raw51 = arrayField(canonical51, 'activeChains');

  assert(
    raw5.length > 0,
    'V9_9_5_ACTIVE_CHAINS_MISSING',
  );

  assert(
    raw51.length > 0,
    'V9_9_5_1_ACTIVE_CHAINS_MISSING',
  );

  const active5 = raw5.map(canonicalRow);
  const active51 = raw51.map(canonicalRow);

  const issues = [];

  if (badStatus(canonical5.status)) {
    issues.push({
      check: 'canonical5.status',
      actual: canonical5.status,
      expected: 'NON_FAILED_NON_BLOCKED',
    });
  }

  if (badStatus(canonical51.status)) {
    issues.push({
      check: 'canonical51.status',
      actual: canonical51.status,
      expected: 'NON_FAILED_NON_BLOCKED',
    });
  }

  const writes5 = safetyWrites(canonical5);
  const writes51 = safetyWrites(canonical51);

  if (writes5 !== null && writes5 !== 0) {
    issues.push({
      check: 'canonical5.databaseWrites',
      actual: writes5,
      expected: 0,
    });
  }

  if (writes51 !== null && writes51 !== 0) {
    issues.push({
      check: 'canonical51.databaseWrites',
      actual: writes51,
      expected: 0,
    });
  }

  if (active5.length !== 7) {
    issues.push({
      check: 'canonical5.activeChains',
      actual: active5.length,
      expected: 7,
    });
  }

  if (active51.length !== 7) {
    issues.push({
      check: 'canonical51.activeChains',
      actual: active51.length,
      expected: 7,
    });
  }

  const actionCounts5 = countActions(active5);
  const actionCounts51 = countActions(active51);

  const actionDiff5 =
    compareObjectCounts(
      actionCounts5,
      EXPECTED_ACTION_COUNTS,
    );

  const actionDiff51 =
    compareObjectCounts(
      actionCounts51,
      EXPECTED_ACTION_COUNTS,
    );

  if (actionDiff5.length > 0) {
    issues.push({
      check: 'canonical5.actionTypeCounts',
      differences: actionDiff5,
    });
  }

  if (actionDiff51.length > 0) {
    issues.push({
      check: 'canonical51.actionTypeCounts',
      differences: actionDiff51,
    });
  }

  const identities5 =
    active5.map(identityKey).sort();

  const identities51 =
    active51.map(identityKey).sort();

  const set5 = new Set(identities5);
  const set51 = new Set(identities51);

  const only5 =
    identities5.filter((x) => !set51.has(x));

  const only51 =
    identities51.filter((x) => !set5.has(x));

  if (only5.length > 0 || only51.length > 0) {
    issues.push({
      check: 'activeCanonicalIdentitySetChangedBetween5And51',
      onlyIn5: only5,
      onlyIn51: only51,
    });
  }

  const duplicate5 =
    active5.length -
    new Set(identities5).size;

  const duplicate51 =
    active51.length -
    new Set(identities51).size;

  if (duplicate5 !== 0 || duplicate51 !== 0) {
    issues.push({
      check: 'duplicateCanonicalIdentities',
      canonical5: duplicate5,
      canonical51: duplicate51,
    });
  }

  const blockingRows51 =
    lengthOrZero(
      canonical51,
      'blockingRows',
    );

  const remainingUnaccounted51 =
    lengthOrZero(
      canonical51,
      'remainingUnaccountedReceipts',
    );

  const conflicted51 =
    lengthOrZero(
      canonical51,
      'conflictedChains',
    );

  if (blockingRows51 !== 0) {
    issues.push({
      check: 'canonical51.blockingRows',
      actual: blockingRows51,
      expected: 0,
    });
  }

  if (remainingUnaccounted51 !== 0) {
    issues.push({
      check: 'canonical51.remainingUnaccountedReceipts',
      actual: remainingUnaccounted51,
      expected: 0,
    });
  }

  if (conflicted51 !== 0) {
    issues.push({
      check: 'canonical51.conflictedChains',
      actual: conflicted51,
      expected: 0,
    });
  }

  // Current incremental workset has no withdrawal gate. V9.9.5.1 may still
  // expose accounting arrays, but they must not create a blocking mutation.
  const withdrawalAccounting = {
    withdrawalControls:
      lengthOrZero(canonical51, 'withdrawalControls'),
    carryInWithdrawalControls:
      lengthOrZero(canonical51, 'carryInWithdrawalControls'),
    otherEntityWithdrawalControls:
      lengthOrZero(canonical51, 'otherEntityWithdrawalControls'),
    additionalSuppressedControls:
      lengthOrZero(canonical51, 'additionalSuppressedControls'),
    currentWindowNonactiveControls:
      lengthOrZero(canonical51, 'currentWindowNonactiveControls'),
    suppressedChains:
      lengthOrZero(canonical51, 'suppressedChains'),
    quarantineDocuments:
      lengthOrZero(canonical51, 'quarantineDocuments'),
  };

  const find001570 = (rows) =>
    rows.filter(
      (row) =>
        row.stockCode === '001570' &&
        row.actionType === 'SPIN_OFF',
    );

  const row001570_5 = find001570(active5);
  const row001570_51 = find001570(active51);

  if (row001570_5.length !== 1) {
    issues.push({
      check: 'canonical5.001570SpinOffRowCount',
      actual: row001570_5.length,
      expected: 1,
    });
  }

  if (row001570_51.length !== 1) {
    issues.push({
      check: 'canonical51.001570SpinOffRowCount',
      actual: row001570_51.length,
      expected: 1,
    });
  }

  const inspect001570 = (row) => {
    if (!row) {
      return {
        rootMatches: false,
        correctionReceiptRepresented: false,
      };
    }

    const rootMatches =
      row.providerEventId === '20260909000291';

    const correctionReceiptRepresented =
      row.sourceReceiptNo === '20261002000513' ||
      row.allReceipts.includes('20261002000513');

    return {
      ...row,
      rootMatches,
      correctionReceiptRepresented,
    };
  };

  const proof001570_5 =
    inspect001570(row001570_5[0]);

  const proof001570_51 =
    inspect001570(row001570_51[0]);

  if (
    row001570_5.length === 1 &&
    !proof001570_5.rootMatches
  ) {
    issues.push({
      check: 'canonical5.001570Root',
      actual: proof001570_5.providerEventId,
      expected: '20260909000291',
    });
  }

  if (
    row001570_51.length === 1 &&
    !proof001570_51.rootMatches
  ) {
    issues.push({
      check: 'canonical51.001570Root',
      actual: proof001570_51.providerEventId,
      expected: '20260909000291',
    });
  }

  // Only enforce correction-receipt representation when receipt-bearing fields
  // are present at all. This avoids inventing a schema requirement that the
  // historical artifact did not promise.
  const receiptFieldsExposed5 =
    row001570_5.length === 1 &&
    (
      proof001570_5.sourceReceiptNo ||
      proof001570_5.allReceipts.length > 1
    );

  const receiptFieldsExposed51 =
    row001570_51.length === 1 &&
    (
      proof001570_51.sourceReceiptNo ||
      proof001570_51.allReceipts.length > 1
    );

  if (
    receiptFieldsExposed5 &&
    !proof001570_5.correctionReceiptRepresented
  ) {
    issues.push({
      check: 'canonical5.001570CorrectionReceiptRepresentation',
      actual: proof001570_5,
      expectedReceipt: '20261002000513',
    });
  }

  if (
    receiptFieldsExposed51 &&
    !proof001570_51.correctionReceiptRepresented
  ) {
    issues.push({
      check: 'canonical51.001570CorrectionReceiptRepresentation',
      actual: proof001570_51,
      expectedReceipt: '20261002000513',
    });
  }

  // Source-kind evidence is a useful positive proof when exposed, but not a
  // schema requirement.
  const sourceKindRows5 =
    active5.filter((row) => row.sourceKind !== null);

  const sourceKindRows51 =
    active51.filter((row) => row.sourceKind !== null);

  const xmlLike = (value) =>
    /XML/i.test(String(value ?? ''));

  const sourceKindSummary = {
    canonical5: {
      exposed: sourceKindRows5.length,
      xmlLike:
        sourceKindRows5.filter(
          (row) => xmlLike(row.sourceKind),
        ).length,
    },
    canonical51: {
      exposed: sourceKindRows51.length,
      xmlLike:
        sourceKindRows51.filter(
          (row) => xmlLike(row.sourceKind),
        ).length,
    },
  };

  if (
    sourceKindRows5.length === 7 &&
    sourceKindSummary.canonical5.xmlLike !== 7
  ) {
    issues.push({
      check: 'canonical5.primarySourceKinds',
      actual: sourceKindSummary.canonical5,
      expected: '7_XML_LIKE',
    });
  }

  if (
    sourceKindRows51.length === 7 &&
    sourceKindSummary.canonical51.xmlLike !== 7
  ) {
    issues.push({
      check: 'canonical51.primarySourceKinds',
      actual: sourceKindSummary.canonical51,
      expected: '7_XML_LIKE',
    });
  }

  // 028080 must not appear in this 7-event V9.9 incremental set.
  const contains028080 =
    [...active5, ...active51]
      .some(
        (row) => row.stockCode === '028080',
      );

  if (contains028080) {
    issues.push({
      check: '028080InjectedIntoV99IncrementalCanonicalSet',
      actual: true,
      expected: false,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      upstreamVersion:
        upstream.version,
      upstreamFingerprint:
        upstream.outputFingerprint ?? null,
      canonical5Version:
        canonical5.version ?? null,
      canonical5Fingerprint:
        canonical5.outputFingerprint ?? null,
      canonical51Version:
        canonical51.version ?? null,
      canonical51Fingerprint:
        canonical51.outputFingerprint ?? null,
    },

    counts: {
      canonical5ActiveChains:
        active5.length,
      canonical51ActiveChains:
        active51.length,
      canonical5DuplicateIdentities:
        duplicate5,
      canonical51DuplicateIdentities:
        duplicate51,
      identityOnlyIn5:
        only5.length,
      identityOnlyIn51:
        only51.length,
      canonical51BlockingRows:
        blockingRows51,
      canonical51RemainingUnaccountedReceipts:
        remainingUnaccounted51,
      canonical51ConflictedChains:
        conflicted51,
      issues:
        issues.length,
    },

    actionTypeCounts: {
      expected:
        EXPECTED_ACTION_COUNTS,
      canonical5:
        actionCounts5,
      canonical51:
        actionCounts51,
    },

    withdrawalAccounting,

    sourceKindSummary,

    canonical001570: {
      canonical5:
        proof001570_5,
      canonical51:
        proof001570_51,
    },

    identitySetDiff: {
      onlyIn5:
        only5,
      onlyIn51:
        only51,
    },

    stageStatus: {
      canonical5: {
        status:
          canonical5.status ?? null,
        databaseWrites:
          writes5,
      },
      canonical51: {
        status:
          canonical51.status ?? null,
        databaseWrites:
          writes51,
      },
    },

    issues,

    conclusion: {
      historicalV995CanonicalSourceReusable:
        reusable,
      historicalV9951WithdrawalAccountingReusable:
        reusable,

      activeCanonicalIdentityStable:
        reusable &&
        only5.length === 0 &&
        only51.length === 0,

      canonical001570RootPreserved:
        reusable &&
        proof001570_5.rootMatches &&
        proof001570_51.rootMatches,

      safeToAdvanceToHistoricalV996FieldExtractionReuseAudit:
        reusable,

      networkRefetchRequired:
        false,

      physical028080RepairStillSeparate:
        true,
      physical028080RepairAddedToIncrementalSet:
        false,
    },

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      coverageWindowAdvanced: false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_6_6_1_6_3_FIELD_EXTRACTION_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-historical-canonical-source-reuse-v9-9-5-5-1-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,
        counts:
          report.counts,
        actionTypeCounts:
          report.actionTypeCounts,
        withdrawalAccounting:
          report.withdrawalAccounting,
        canonical001570:
          report.canonical001570,
        identitySetDiff:
          report.identitySetDiff,
        stageStatus:
          report.stageStatus,
        issues:
          report.issues,
        conclusion:
          report.conclusion,
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        version:
          report.version,

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        withdrawalAccounting:
          report.withdrawalAccounting,

        sourceKindSummary:
          report.sourceKindSummary,

        canonical001570:
          report.canonical001570,

        stageStatus:
          report.stageStatus,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequests: 0,
        databaseWrites: 0,

        nextGate:
          report.nextGate,
        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (!reusable) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_REUSE_AUDIT_FAILED',
        version: VERSION,
        error:
          String(error?.message ?? error),
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
