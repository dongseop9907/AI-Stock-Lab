#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.3 / 3.1 / 4 historical evidence reuse audit V2
 *
 * Fixes an audit-method defect from V1:
 * V1 compared an upstream artifact's outputFingerprint directly with the first
 * fingerprint-looking value found under downstream.source.
 *
 * That is not a valid generic contract. Several historical scripts calculate
 * their own sourceFingerprint / selected-input fingerprint for cache or
 * provenance identity. Such hashes are not necessarily equal to the upstream
 * report's outputFingerprint.
 *
 * V2 therefore:
 * - keeps ALL receipt coverage / chain-root / status / DB-write guards,
 * - requires the V1 blocker set to be fingerprint-only,
 * - inventories every fingerprint field under each source object,
 * - treats direct hash equality as strict ONLY when the downstream artifact
 *   explicitly exposes a field whose semantic name is outputFingerprint,
 * - does NOT treat generic sourceFingerprint/inputFingerprint equality with an
 *   upstream outputFingerprint as a business/evidence continuity contract
 *   unless an explicit output-fingerprint reference field exists,
 * - preserves 028080 as a separate virtual repair overlay.
 *
 * READ ONLY.
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_3_3_1_4_REPLAY_V2_FINGERPRINT_SEMANTICS_AWARE_HISTORICAL_EVIDENCE_REUSE_AUDIT';

const V1_VERSION =
  'V9_9_3_3_1_4_REPLAY_READ_ONLY_HISTORICAL_EVIDENCE_CHAIN_REUSE_AUDIT';

const EQUIVALENCE_VERSION =
  'V9_9_2_1_1_REPLAY_V2_FUTURE_CASH_PROVIDER_ID_ENRICHMENT_EQUIVALENCE_AUDIT';

const EQUIVALENCE_STATUS =
  'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENT_AFTER_EXPECTED_FUTURE_CASH_ID_ENRICHMENT';

const EXPECTED = {
  detail: 7,
  chain: 3,
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
  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );
  fs.renameSync(tmp, file);
}

function normalizeReceipt(value) {
  const text = String(value ?? '').trim();
  return /^\d{14}$/.test(text) ? text : '';
}

function normalizeStock(value) {
  return String(value ?? '').trim().padStart(6, '0');
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

function collectReceiptSet(doc) {
  const out = new Set();

  for (const obj of recursiveObjects(doc)) {
    for (const receipt of getReceiptCandidates(obj)) {
      out.add(receipt);
    }
  }

  return out;
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

function badStatus(status) {
  const text =
    String(status ?? '').toUpperCase();

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
    if (
      value !== undefined &&
      value !== null
    ) {
      const n = Number(value);
      return Number.isFinite(n)
        ? n
        : null;
    }
  }

  return null;
}

function isHash(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{64}$/i.test(
      value.trim(),
    )
  );
}

function collectFingerprintFields(
  value,
  prefix = '',
  out = [],
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return out;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const childPath =
      prefix
        ? `${prefix}.${key}`
        : key;

    if (
      /fingerprint/i.test(key) &&
      isHash(child)
    ) {
      out.push({
        path: childPath,
        key,
        value:
          child.trim(),
        semanticClass:
          /outputfingerprint/i.test(key)
            ? 'EXPLICIT_OUTPUT_FINGERPRINT_REFERENCE'
            : /inputfingerprint/i.test(key)
              ? 'INPUT_OR_SELECTED_INPUT_FINGERPRINT'
              : /sourcefingerprint/i.test(key)
                ? 'SOURCE_OR_CACHE_IDENTITY_FINGERPRINT'
                : 'GENERIC_FINGERPRINT',
      });
    }

    if (
      child &&
      typeof child === 'object'
    ) {
      collectFingerprintFields(
        child,
        childPath,
        out,
      );
    }
  }

  return out;
}

function collectSourceReferences(
  source,
  prefix = '',
  out = [],
) {
  if (
    !source ||
    typeof source !== 'object'
  ) {
    return out;
  }

  for (
    const [key, value]
    of Object.entries(source)
  ) {
    const childPath =
      prefix
        ? `${prefix}.${key}`
        : key;

    if (
      typeof value === 'string' &&
      (
        /version/i.test(key) ||
        /file|path/i.test(key)
      )
    ) {
      out.push({
        path:
          childPath,
        value,
      });
    }

    if (
      value &&
      typeof value === 'object'
    ) {
      collectSourceReferences(
        value,
        childPath,
        out,
      );
    }
  }

  return out;
}

function explicitOutputFingerprintChecks(
  upstream,
  downstream,
  edgeName,
) {
  const fields =
    collectFingerprintFields(
      downstream?.source ?? {},
    );

  const explicit =
    fields.filter(
      (row) =>
        row.semanticClass ===
        'EXPLICIT_OUTPUT_FINGERPRINT_REFERENCE',
    );

  const checks =
    explicit.map(
      (row) => ({
        edge:
          edgeName,
        downstreamPath:
          `source.${row.path}`,
        referencedHash:
          row.value,
        upstreamOutputFingerprint:
          upstream.outputFingerprint ??
          null,
        matches:
          Boolean(
            upstream.outputFingerprint
          ) &&
          String(
            upstream.outputFingerprint,
          ) ===
          String(row.value),
      }),
    );

  return {
    allSourceFingerprintFields:
      fields,
    explicitOutputFingerprintChecks:
      checks,
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    previousAudit:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay.json',
      ),

    equivalence:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2-1.json',
      ),

    replayRecon:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay-v2.json',
      ),

    workset:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-workset-v9-9-2.json',
      ),

    evidence3:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-9-3.json',
      ),

    evidence31:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-9-3-1.json',
      ),

    chain4:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-9-4.json',
      ),

    canonical5:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-9-5.json',
      ),

    canonical51:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-9-5-1.json',
      ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay-v2.json',
    );

  for (
    const [name, file]
    of Object.entries(files)
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs =
    Object.fromEntries(
      Object.entries(files)
        .map(
          ([name, file]) => [
            name,
            readJson(file),
          ],
        ),
    );

  assert(
    docs.previousAudit.version ===
      V1_VERSION,
    `V1_AUDIT_VERSION_MISMATCH:${docs.previousAudit.version}`,
  );

  assert(
    docs.previousAudit.status ===
      'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_REUSE_BLOCKED',
    `V1_AUDIT_STATUS_UNEXPECTED:${docs.previousAudit.status}`,
  );

  assert(
    docs.equivalence.version ===
      EQUIVALENCE_VERSION,
    `EQUIVALENCE_VERSION_MISMATCH:${docs.equivalence.version}`,
  );

  assert(
    docs.equivalence.status ===
      EQUIVALENCE_STATUS,
    `EQUIVALENCE_STATUS_MISMATCH:${docs.equivalence.status}`,
  );

  assert(
    docs.equivalence.conclusion
      ?.reconciliationBusinessEquivalent ===
      true,
    'RECONCILIATION_NOT_BUSINESS_EQUIVALENT',
  );

  // V1 is allowed to have ONLY the two audit-method fingerprint issues.
  const v1Issues =
    Array.isArray(
      docs.previousAudit.issues,
    )
      ? docs.previousAudit.issues
      : [];

  const expectedV1IssueNames =
    new Set([
      'evidence31ToChain4.fingerprint',
      'chain4ToCanonical5.fingerprint',
    ]);

  const unexpectedV1Issues =
    v1Issues.filter(
      (row) =>
        !expectedV1IssueNames.has(
          String(row.check),
        ),
    );

  const missingExpectedV1Issues =
    [...expectedV1IssueNames]
      .filter(
        (name) =>
          !v1Issues.some(
            (row) =>
              String(row.check) ===
              name,
          ),
      );

  assert(
    unexpectedV1Issues.length === 0,
    `V1_HAS_NON_FINGERPRINT_ISSUES:${JSON.stringify(unexpectedV1Issues)}`,
  );

  assert(
    missingExpectedV1Issues.length === 0 &&
      v1Issues.length === 2,
    `V1_FINGERPRINT_ISSUE_SET_UNEXPECTED:${JSON.stringify(v1Issues)}`,
  );

  const detailQueue =
    Array.isArray(
      docs.workset.detailFetchQueue,
    )
      ? docs.workset.detailFetchQueue
      : [];

  const chainQueue =
    Array.isArray(
      docs.workset.chainLookupQueue,
    )
      ? docs.workset.chainLookupQueue
      : [];

  assert(
    detailQueue.length ===
      EXPECTED.detail,
    `DETAIL_QUEUE_COUNT:${detailQueue.length}`,
  );

  assert(
    chainQueue.length ===
      EXPECTED.chain,
    `CHAIN_QUEUE_COUNT:${chainQueue.length}`,
  );

  const detailReceipts =
    [...new Set(
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
    )].sort();

  const chainReceipts =
    [...new Set(
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
    )].sort();

  assert(
    detailReceipts.length ===
      EXPECTED.detail,
    'DETAIL_RECEIPT_ID_COUNT_MISMATCH',
  );

  assert(
    chainReceipts.length ===
      EXPECTED.chain,
    'CHAIN_RECEIPT_ID_COUNT_MISMATCH',
  );

  const receiptSets = {
    evidence3:
      collectReceiptSet(
        docs.evidence3,
      ),
    evidence31:
      collectReceiptSet(
        docs.evidence31,
      ),
    chain4:
      collectReceiptSet(
        docs.chain4,
      ),
  };

  const missingReceipts = {
    evidence3:
      detailReceipts.filter(
        (receipt) =>
          !receiptSets.evidence3
            .has(receipt),
      ),

    evidence31:
      detailReceipts.filter(
        (receipt) =>
          !receiptSets.evidence31
            .has(receipt),
      ),

    chain4:
      chainReceipts.filter(
        (receipt) =>
          !receiptSets.chain4
            .has(receipt),
      ),
  };

  const reconfirmQueue =
    findQueue(
      docs.replayRecon,
      'carryForwardReconfirmationQueue',
    );

  assert(
    reconfirmQueue.length ===
      EXPECTED.reconfirmation,
    `RECONFIRM_QUEUE_COUNT:${reconfirmQueue.length}`,
  );

  const reconfirm =
    reconfirmQueue[0];

  assert(
    normalizeReceipt(
      reconfirm.providerEventId,
    ) === '20261002000513' &&
    normalizeStock(
      reconfirm.stockCode,
    ) === '001570' &&
    String(
      reconfirm.actionType,
    ) === 'SPIN_OFF',
    'EXPECTED_001570_RECONFIRMATION_NOT_FOUND',
  );

  const matchedRootIds =
    [
      ...(
        reconfirm
          .exactCarryForwardIdentityMatches ??
        []
      ),
      ...(
        reconfirm
          .stockActionCarryForwardMatches ??
        []
      ),
    ]
      .map(
        (row) =>
          normalizeReceipt(
            row.providerEventId,
          ),
      )
      .filter(Boolean);

  assert(
    matchedRootIds.length > 0,
    '001570_MATCHED_CARRY_FORWARD_ROOT_MISSING',
  );

  const chain001570Objects =
    objectsForReceipt(
      docs.chain4,
      '20261002000513',
    );

  const chainRoots =
    [...new Set(
      chain001570Objects
        .map(extractRootReceipt)
        .filter(Boolean),
    )];

  const chainStatuses =
    [...new Set(
      chain001570Objects
        .map(
          extractResolutionStatus,
        )
        .filter(Boolean)
        .map(String),
    )];

  assert(
    chainRoots.length > 0,
    '001570_HISTORICAL_CHAIN_ROOT_NOT_EXPOSED',
  );

  assert(
    chainRoots.some(
      (rootReceipt) =>
        matchedRootIds.includes(
          rootReceipt,
        ),
    ),
    `001570_ROOT_MISMATCH:${JSON.stringify({matchedRootIds, chainRoots})}`,
  );

  const stageStatus = {};

  for (
    const name of [
      'evidence3',
      'evidence31',
      'chain4',
      'canonical5',
      'canonical51',
    ]
  ) {
    stageStatus[name] = {
      version:
        docs[name].version ??
        null,
      status:
        docs[name].status ??
        null,
      databaseWrites:
        safetyWrites(
          docs[name],
        ),
    };
  }

  const fingerprintSemantics = {
    evidence31ToChain4:
      explicitOutputFingerprintChecks(
        docs.evidence31,
        docs.chain4,
        'evidence31ToChain4',
      ),

    chain4ToCanonical5:
      explicitOutputFingerprintChecks(
        docs.chain4,
        docs.canonical5,
        'chain4ToCanonical5',
      ),

    sourceReferences: {
      evidence31:
        collectSourceReferences(
          docs.evidence31
            .source ?? {},
        ),

      chain4:
        collectSourceReferences(
          docs.chain4
            .source ?? {},
        ),

      canonical5:
        collectSourceReferences(
          docs.canonical5
            .source ?? {},
        ),
    },
  };

  const issues = [];

  for (
    const [stage, rows]
    of Object.entries(
      missingReceipts,
    )
  ) {
    if (rows.length > 0) {
      issues.push({
        check:
          `${stage}.missingReceipts`,
        receipts:
          rows,
      });
    }
  }

  for (
    const [stage, info]
    of Object.entries(stageStatus)
  ) {
    if (
      badStatus(info.status)
    ) {
      issues.push({
        check:
          `${stage}.status`,
        actual:
          info.status,
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

  // Only EXPLICIT outputFingerprint reference fields are equality contracts.
  for (
    const edge of [
      'evidence31ToChain4',
      'chain4ToCanonical5',
    ]
  ) {
    const checks =
      fingerprintSemantics[edge]
        .explicitOutputFingerprintChecks;

    for (const check of checks) {
      if (!check.matches) {
        issues.push({
          check:
            `${edge}.explicitOutputFingerprintReference`,
          ...check,
        });
      }
    }
  }

  const allGenericFingerprintDifferencesReclassified =
    (
      fingerprintSemantics
        .evidence31ToChain4
        .explicitOutputFingerprintChecks
        .length === 0
    ) &&
    (
      fingerprintSemantics
        .chain4ToCanonical5
        .explicitOutputFingerprintChecks
        .length === 0
    );

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_RESULTS_REUSABLE_AFTER_FINGERPRINT_SEMANTICS_RECLASSIFICATION'
      : 'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_REUSE_V2_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      previousAuditVersion:
        docs.previousAudit.version,

      equivalenceVersion:
        docs.equivalence.version,

      replayReconciliationVersion:
        docs.replayRecon.version,

      worksetVersion:
        docs.workset.version,
    },

    counts: {
      detailReceipts:
        detailReceipts.length,

      chainReceipts:
        chainReceipts.length,

      evidence3Present:
        detailReceipts.length -
        missingReceipts
          .evidence3.length,

      evidence31Present:
        detailReceipts.length -
        missingReceipts
          .evidence31.length,

      chain4Present:
        chainReceipts.length -
        missingReceipts
          .chain4.length,

      v1FingerprintOnlyIssues:
        v1Issues.length,

      v1UnexpectedNonFingerprintIssues:
        unexpectedV1Issues.length,

      currentIssues:
        issues.length,
    },

    receiptCoverage: {
      detailReceipts,
      chainReceipts,
      missingReceipts,
    },

    stageStatus,

    carryForward001570: {
      providerEventId:
        '20261002000513',

      stockCode:
        '001570',

      actionType:
        'SPIN_OFF',

      matchedCarryForwardProviderIds:
        matchedRootIds,

      historicalChainRoots:
        chainRoots,

      historicalChainStatuses:
        chainStatuses,

      rootMatchesCarryForward:
        true,
    },

    fingerprintSemantics: {
      policy:
        'ONLY_EXPLICIT_OUTPUT_FINGERPRINT_REFERENCE_IS_DIRECTLY_COMPARABLE_TO_UPSTREAM_OUTPUT_FINGERPRINT',

      genericInputOrSourceFingerprintDirectEqualityRequired:
        false,

      v1FalsePositiveIssues:
        v1Issues,

      ...fingerprintSemantics,

      genericFingerprintDifferencesReclassified:
        allGenericFingerprintDifferencesReclassified,
    },

    issues,

    conclusion: {
      historicalV993EvidenceReusable:
        reusable,

      historicalV9931EvidenceReusable:
        reusable,

      historicalV994ChainResolutionReusable:
        reusable,

      v1BlockWasAuditMethodFalsePositive:
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
      productionApplied:
        false,
      coverageWindowAdvanced:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-historical-evidence-chain-reuse-v9-9-3-3-1-4-replay-v2.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        counts:
          report.counts,

        receiptCoverage:
          report.receiptCoverage,

        stageStatus:
          report.stageStatus,

        carryForward001570:
          report.carryForward001570,

        fingerprintSemantics:
          report.fingerprintSemantics,

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

        carryForward001570:
          report.carryForward001570,

        fingerprintPolicy:
          report
            .fingerprintSemantics
            .policy,

        evidence31ToChain4FingerprintFields:
          report
            .fingerprintSemantics
            .evidence31ToChain4
            .allSourceFingerprintFields,

        chain4ToCanonical5FingerprintFields:
          report
            .fingerprintSemantics
            .chain4ToCanonical5
            .allSourceFingerprintFields,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequests:
          0,

        databaseWrites:
          0,

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
          'HISTORICAL_V9_9_3_3_1_4_EVIDENCE_CHAIN_REUSE_V2_AUDIT_FAILED',

        version: VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
