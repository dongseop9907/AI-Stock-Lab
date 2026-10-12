#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.3 / 3.1 / 4 historical evidence reuse audit
 *
 * READ ONLY.
 *
 * Preconditions:
 * - V9.9.2.1.1 replay is business-equivalent to historical reconciliation.
 * - Current V9.9 workset remains 7 detail-fetch / 3 chain-lookup.
 *
 * This audit DOES NOT refetch OpenDART.
 * It proves whether the historical evidence artifacts can be reused by:
 *  1) checking all current 7 detail receipt IDs exist in historical 9.3 and 9.3.1,
 *  2) checking all current 3 chain receipt IDs exist in historical 9.4,
 *  3) verifying 001570 / SPIN_OFF / 20261002000513 remains the sole
 *     carry-forward reconfirmation and its resolved root matches one of the
 *     carry-forward stock/action matches when 9.4 exposes a root,
 *  4) validating artifact source-fingerprint continuity when those fields exist,
 *  5) ensuring no historical stage reports failure/blocking or DB writes.
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_3_3_1_4_REPLAY_READ_ONLY_HISTORICAL_EVIDENCE_CHAIN_REUSE_AUDIT';

const EQUIVALENCE_VERSION =
  'V9_9_2_1_1_REPLAY_V2_FUTURE_CASH_PROVIDER_ID_ENRICHMENT_EQUIVALENCE_AUDIT';

const EQUIVALENCE_STATUS =
  'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENT_AFTER_EXPECTED_FUTURE_CASH_ID_ENRICHMENT';

const EXPECTED = {
  detail: 7,
  chain: 3,
  standalone: 4,
  reconfirmation: 1,
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

function normalizeReceipt(value) {
  const text = String(value ?? '').trim();
  return /^\d{14}$/.test(text) ? text : '';
}

function normalizeStock(value) {
  const text = String(value ?? '').trim();
  return text.padStart(6, '0');
}

function recursiveObjects(value, out = []) {
  if (!value || typeof value !== 'object') {
    return out;
  }

  if (!Array.isArray(value)) {
    out.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      recursiveObjects(child, out);
    }
  }

  return out;
}

function getReceiptCandidates(obj) {
  return [
    obj.receiptNo,
    obj.receipt_no,
    obj.rcept_no,
    obj.providerEventId,
    obj.provider_event_id,
    obj.sourceReceiptNo,
    obj.source_receipt_no,
    obj.targetReceiptNo,
    obj.target_receipt_no,
  ]
    .map(normalizeReceipt)
    .filter(Boolean);
}

function objectsForReceipt(doc, receiptNo) {
  return recursiveObjects(doc).filter(
    (obj) =>
      getReceiptCandidates(obj)
        .includes(receiptNo),
  );
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

function extractRootReceipt(obj) {
  return normalizeReceipt(
    firstNonEmpty(
      obj.rootReceiptNo,
      obj.root_receipt_no,
      obj.rootProviderEventId,
      obj.root_provider_event_id,
      obj.resolvedRootReceiptNo,
      obj.resolved_root_receipt_no,
      obj.canonicalReceiptNo,
      obj.canonical_receipt_no,
      obj.originalReceiptNo,
      obj.original_receipt_no,
    ),
  );
}

function extractResolutionStatus(obj) {
  return firstNonEmpty(
    obj.resolutionStatus,
    obj.resolution_status,
    obj.status,
    obj.chainStatus,
    obj.chain_status,
  );
}

function collectReceiptSetFromDoc(doc) {
  const set = new Set();

  for (const obj of recursiveObjects(doc)) {
    for (const receipt of getReceiptCandidates(obj)) {
      set.add(receipt);
    }
  }

  return set;
}

function possibleFingerprint(obj) {
  return firstNonEmpty(
    obj?.sourceFingerprint,
    obj?.source_fingerprint,
    obj?.source?.inputFingerprint,
    obj?.source?.input_fingerprint,
    obj?.source?.sourceFingerprint,
    obj?.source?.source_fingerprint,
    obj?.inputFingerprint,
    obj?.input_fingerprint,
  );
}

function safetyWrites(doc) {
  const candidates = [
    doc?.databaseWrites,
    doc?.safety?.databaseWrites,
    doc?.counts?.databaseWrites,
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

function badStatus(status) {
  const text = String(status ?? '').toUpperCase();

  return (
    text.includes('FAILED') ||
    text.includes('BLOCKED') ||
    text.includes('ERROR')
  );
}

function findQueue(report, key) {
  if (
    report.queues &&
    Array.isArray(report.queues[key])
  ) {
    return report.queues[key];
  }

  if (Array.isArray(report[key])) {
    return report[key];
  }

  return [];
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    equivalence: path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2-1.json',
    ),

    replayRecon: path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay-v2.json',
    ),

    workset: path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-workset-v9-9-2.json',
    ),

    evidence3: path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-evidence-v9-9-3.json',
    ),

    evidence31: path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-evidence-v9-9-3-1.json',
    ),

    chain4: path.join(
      root,
      'logs',
      'opendart-corporate-action-chain-resolution-v9-9-4.json',
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
    'opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay.json',
  );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs = Object.fromEntries(
    Object.entries(files).map(
      ([name, file]) => [name, readJson(file)],
    ),
  );

  assert(
    docs.equivalence.version === EQUIVALENCE_VERSION,
    `EQUIVALENCE_VERSION_MISMATCH:${docs.equivalence.version}`,
  );

  assert(
    docs.equivalence.status === EQUIVALENCE_STATUS,
    `EQUIVALENCE_STATUS_MISMATCH:${docs.equivalence.status}`,
  );

  assert(
    docs.equivalence.conclusion
      ?.reconciliationBusinessEquivalent === true,
    'RECONCILIATION_NOT_BUSINESS_EQUIVALENT',
  );

  const detailQueue =
    Array.isArray(docs.workset.detailFetchQueue)
      ? docs.workset.detailFetchQueue
      : [];

  const chainQueue =
    Array.isArray(docs.workset.chainLookupQueue)
      ? docs.workset.chainLookupQueue
      : [];

  assert(
    detailQueue.length === EXPECTED.detail,
    `EXPECTED_7_DETAIL_QUEUE_GOT_${detailQueue.length}`,
  );

  assert(
    chainQueue.length === EXPECTED.chain,
    `EXPECTED_3_CHAIN_QUEUE_GOT_${chainQueue.length}`,
  );

  const detailReceipts = [
    ...new Set(
      detailQueue
        .map(
          (row) =>
            normalizeReceipt(
              firstNonEmpty(
                row.receiptNo,
                row.providerEventId,
              ),
            ),
        )
        .filter(Boolean),
    ),
  ].sort();

  const chainReceipts = [
    ...new Set(
      chainQueue
        .map(
          (row) =>
            normalizeReceipt(
              firstNonEmpty(
                row.receiptNo,
                row.providerEventId,
              ),
            ),
        )
        .filter(Boolean),
    ),
  ].sort();

  assert(
    detailReceipts.length === EXPECTED.detail,
    `DETAIL_RECEIPT_UNIQUE_COUNT:${detailReceipts.length}`,
  );

  assert(
    chainReceipts.length === EXPECTED.chain,
    `CHAIN_RECEIPT_UNIQUE_COUNT:${chainReceipts.length}`,
  );

  const receiptSets = {
    evidence3:
      collectReceiptSetFromDoc(docs.evidence3),
    evidence31:
      collectReceiptSetFromDoc(docs.evidence31),
    chain4:
      collectReceiptSetFromDoc(docs.chain4),
    canonical5:
      collectReceiptSetFromDoc(docs.canonical5),
    canonical51:
      collectReceiptSetFromDoc(docs.canonical51),
  };

  const missing = {
    evidence3: detailReceipts.filter(
      (receipt) =>
        !receiptSets.evidence3.has(receipt),
    ),

    evidence31: detailReceipts.filter(
      (receipt) =>
        !receiptSets.evidence31.has(receipt),
    ),

    chain4: chainReceipts.filter(
      (receipt) =>
        !receiptSets.chain4.has(receipt),
    ),
  };

  const reconfirmQueue =
    findQueue(
      docs.replayRecon,
      'carryForwardReconfirmationQueue',
    );

  assert(
    reconfirmQueue.length === EXPECTED.reconfirmation,
    `RECONFIRMATION_QUEUE_COUNT:${reconfirmQueue.length}`,
  );

  const r001570 = reconfirmQueue[0];

  assert(
    normalizeReceipt(r001570.providerEventId) ===
      '20261002000513' &&
    normalizeStock(r001570.stockCode) ===
      '001570' &&
    String(r001570.actionType) ===
      'SPIN_OFF',
    'EXPECTED_001570_SPIN_OFF_RECONFIRMATION_NOT_FOUND',
  );

  const matchedRootIds = [
    ...(
      r001570
        .exactCarryForwardIdentityMatches ??
      []
    ),
    ...(
      r001570
        .stockActionCarryForwardMatches ??
      []
    ),
  ]
    .map(
      (row) =>
        normalizeReceipt(row.providerEventId),
    )
    .filter(Boolean);

  assert(
    matchedRootIds.length > 0,
    '001570_EXPECTED_CARRY_FORWARD_ROOT_MISSING',
  );

  const chain001570Objects =
    objectsForReceipt(
      docs.chain4,
      '20261002000513',
    );

  const chain001570Roots = [
    ...new Set(
      chain001570Objects
        .map(extractRootReceipt)
        .filter(Boolean),
    ),
  ];

  const chain001570Statuses = [
    ...new Set(
      chain001570Objects
        .map(extractResolutionStatus)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const rootExposed =
    chain001570Roots.length > 0;

  const rootMatchesCarryForward =
    !rootExposed ||
    chain001570Roots.some(
      (rootReceipt) =>
        matchedRootIds.includes(
          rootReceipt,
        ),
    );

  const stageStatus = {
    evidence3: {
      version: docs.evidence3.version ?? null,
      status: docs.evidence3.status ?? null,
      databaseWrites:
        safetyWrites(docs.evidence3),
    },
    evidence31: {
      version: docs.evidence31.version ?? null,
      status: docs.evidence31.status ?? null,
      databaseWrites:
        safetyWrites(docs.evidence31),
    },
    chain4: {
      version: docs.chain4.version ?? null,
      status: docs.chain4.status ?? null,
      databaseWrites:
        safetyWrites(docs.chain4),
    },
    canonical5: {
      version: docs.canonical5.version ?? null,
      status: docs.canonical5.status ?? null,
      databaseWrites:
        safetyWrites(docs.canonical5),
    },
    canonical51: {
      version: docs.canonical51.version ?? null,
      status: docs.canonical51.status ?? null,
      databaseWrites:
        safetyWrites(docs.canonical51),
    },
  };

  const fingerprintContinuity = {
    evidence3To31: {
      upstream:
        docs.evidence3.outputFingerprint ??
        null,
      downstreamSource:
        possibleFingerprint(
          docs.evidence31,
        ),
      checkable: false,
      matches: null,
    },

    evidence31ToChain4: {
      upstream:
        docs.evidence31.outputFingerprint ??
        null,
      downstreamSource:
        possibleFingerprint(
          docs.chain4,
        ),
      checkable: false,
      matches: null,
    },

    chain4ToCanonical5: {
      upstream:
        docs.chain4.outputFingerprint ??
        null,
      downstreamSource:
        possibleFingerprint(
          docs.canonical5,
        ),
      checkable: false,
      matches: null,
    },
  };

  for (
    const item of
    Object.values(
      fingerprintContinuity,
    )
  ) {
    if (
      item.upstream &&
      item.downstreamSource
    ) {
      item.checkable = true;
      item.matches =
        String(item.upstream) ===
        String(
          item.downstreamSource,
        );
    }
  }

  const issues = [];

  for (
    const [stage, rows]
    of Object.entries(missing)
  ) {
    if (rows.length > 0) {
      issues.push({
        check:
          `${stage}.missingReceipts`,
        receipts: rows,
      });
    }
  }

  for (
    const [stage, info]
    of Object.entries(stageStatus)
  ) {
    if (badStatus(info.status)) {
      issues.push({
        check:
          `${stage}.status`,
        actual:
          info.status,
        expected:
          'NON_FAILED_NON_BLOCKED',
      });
    }

    if (
      info.databaseWrites !== null &&
      info.databaseWrites !== 0
    ) {
      issues.push({
        check:
          `${stage}.databaseWrites`,
        actual:
          info.databaseWrites,
        expected:
          0,
      });
    }
  }

  for (
    const [edge, item]
    of Object.entries(
      fingerprintContinuity,
    )
  ) {
    if (
      item.checkable &&
      !item.matches
    ) {
      issues.push({
        check:
          `${edge}.fingerprint`,
        upstream:
          item.upstream,
        downstreamSource:
          item.downstreamSource,
      });
    }
  }

  if (!rootMatchesCarryForward) {
    issues.push({
      check:
        '001570.chainRootMatchesCarryForward',
      matchedCarryForwardProviderIds:
        matchedRootIds,
      historicalChainRoots:
        chain001570Roots,
      historicalChainStatuses:
        chain001570Statuses,
    });
  }

  // Confirm historical evidence is still the same 7/3 workset scope.
  const allDetailPresent =
    missing.evidence3.length === 0 &&
    missing.evidence31.length === 0;

  const allChainPresent =
    missing.chain4.length === 0;

  const reusable =
    issues.length === 0 &&
    allDetailPresent &&
    allChainPresent &&
    rootMatchesCarryForward;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      equivalenceVersion:
        docs.equivalence.version,
      equivalenceFingerprint:
        docs.equivalence
          .outputFingerprint ??
        null,

      replayReconciliationVersion:
        docs.replayRecon.version,
      replayReconciliationFingerprint:
        docs.replayRecon
          .outputFingerprint ??
        null,

      worksetVersion:
        docs.workset.version,
      worksetFingerprint:
        docs.workset
          .outputFingerprint ??
        null,
    },

    counts: {
      currentDetailReceipts:
        detailReceipts.length,
      currentChainReceipts:
        chainReceipts.length,

      evidence3DetailReceiptsPresent:
        detailReceipts.length -
        missing.evidence3.length,

      evidence31DetailReceiptsPresent:
        detailReceipts.length -
        missing.evidence31.length,

      chain4ReceiptsPresent:
        chainReceipts.length -
        missing.chain4.length,

      carryForwardReconfirmationQueue:
        reconfirmQueue.length,

      carryForwardMatchedRootIds:
        matchedRootIds.length,

      historical001570ExposedRoots:
        chain001570Roots.length,

      issues:
        issues.length,
    },

    receiptCoverage: {
      detailReceipts,
      chainReceipts,
      missing,
    },

    stageStatus,

    fingerprintContinuity,

    carryForward001570: {
      providerEventId:
        '20261002000513',
      stockCode:
        '001570',
      actionType:
        'SPIN_OFF',

      matchedCarryForwardProviderIds:
        matchedRootIds,

      historicalChainObjectsFound:
        chain001570Objects.length,

      historicalChainResolutionStatuses:
        chain001570Statuses,

      historicalChainRoots:
        chain001570Roots,

      historicalRootFieldExposed:
        rootExposed,

      rootMatchesCarryForward:
        rootMatchesCarryForward,
    },

    issues,

    conclusion: {
      historicalV993EvidenceReusable:
        reusable,
      historicalV9931EvidenceReusable:
        reusable,
      historicalV994ChainResolutionReusable:
        reusable,

      openDartRefetchRequired:
        false,

      safeToAdvanceToHistoricalV995ReuseAudit:
        reusable,

      physical028080RepairStillSeparate:
        true,
      physical028080RepairAddedToCarryForward55:
        false,
    },

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      coverageWindowAdvanced:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,
        source:
          report.source,
        counts:
          report.counts,
        receiptCoverage:
          report.receiptCoverage,
        stageStatus:
          report.stageStatus,
        fingerprintContinuity:
          report.fingerprintContinuity,
        carryForward001570:
          report.carryForward001570,
        issues:
          report.issues,
        conclusion:
          report.conclusion,
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        version:
          report.version,

        ...report.counts,

        stageStatus:
          report.stageStatus,

        fingerprintContinuity:
          report.fingerprintContinuity,

        carryForward001570:
          report.carryForward001570,

        missingReceipts:
          report.receiptCoverage
            .missing,

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
          'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_REUSE_AUDIT_FAILED',
        version: VERSION,
        error:
          String(
            error?.message ??
            error,
          ),
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
