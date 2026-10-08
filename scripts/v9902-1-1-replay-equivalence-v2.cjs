#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.2.1.1 replay equivalence audit V2
 *
 * Reclassifies exactly ONE known non-business representation difference:
 *
 * historical untouched FUTURE_CASH:
 *   stockCode=478560
 *   actionType=CASH_DIVIDEND
 *   providerEventId=""
 *
 * replay untouched FUTURE_CASH:
 *   stockCode=478560
 *   actionType=CASH_DIVIDEND
 *   providerEventId="20260928900449"
 *
 * The provider ID is independently corroborated by the repaired V9.8
 * production preflight futurePendingRows source.
 *
 * This difference is allowed ONLY when:
 * - all business counts remain identical,
 * - exactCarryForwardIdentityNewRows remains 0,
 * - touched/untouched accounting remains 1/54,
 * - all current V9.9 queues remain business-identical,
 * - the one carry-forward reconfirmation remains 001570/SPIN_OFF,
 * - 478560 is NOT touched by the 2026-10-02..2026-10-04 window,
 * - source evidence uniquely proves providerEventId=20260928900449.
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_2_1_1_REPLAY_V2_FUTURE_CASH_PROVIDER_ID_ENRICHMENT_EQUIVALENCE_AUDIT';

const HIST_VERSION =
  'V9_9_2_1_1_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const REPLAY_VERSION =
  'V9_9_2_1_1_REPLAY_V2_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const EXPECTED_STATUS =
  'WORKSET_CARRY_FORWARD_RECONCILIATION_READY';

const CASH = {
  stockCode: '478560',
  actionType: 'CASH_DIVIDEND',
  providerEventId: '20260928900449',
  recordDate: '2026-10-13',
};

const COUNT_FIELDS = [
  'newSourceCandidates',
  'newInCurrentCanonicalContract',
  'newOutOfScope',
  'priorFutureRatio',
  'priorFutureStructural',
  'priorFutureCash',
  'priorCarryForwardTotal',
  'exactCarryForwardIdentityNewRows',
  'stockActionCarryForwardRelatedNewRows',
  'newCorrectionChainLookupOnly',
  'newStandaloneDetailFetch',
  'touchedCarryForwardItems',
  'untouchedCarryForwardItems',
  'blockers',
];

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

function stable(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stable).join(',') + ']';
  }
  return '{' + Object.keys(value).sort().map(
    (key) => JSON.stringify(key) + ':' + stable(value[key]),
  ).join(',') + '}';
}

function sortedJson(rows) {
  return rows.map(stable).sort();
}

function normalizeProviderId(value) {
  return String(value ?? '').trim();
}

function compactCarry(row, options = {}) {
  const ignoreFutureCashProviderId =
    Boolean(options.ignoreFutureCashProviderId);

  const isKnownFutureCash =
    String(row.category ?? '') === 'FUTURE_CASH' &&
    String(row.stockCode ?? '') === CASH.stockCode &&
    String(row.actionType ?? '') === CASH.actionType;

  return {
    category: row.category ?? null,
    providerEventId:
      ignoreFutureCashProviderId && isKnownFutureCash
        ? '__EXPECTED_ENRICHMENT_IGNORED__'
        : normalizeProviderId(row.providerEventId),
    stockCode: row.stockCode ?? null,
    actionType: row.actionType ?? null,
    effectiveDate: row.effectiveDate ?? null,
    recordDate: row.recordDate ?? null,
    disposition: row.disposition ?? null,
  };
}

function compactMatch(row) {
  return {
    category: row.category ?? null,
    providerEventId: normalizeProviderId(row.providerEventId),
    stockCode: row.stockCode ?? null,
    actionType: row.actionType ?? null,
  };
}

function compactQueueRow(row) {
  return {
    providerEventId: row.providerEventId ?? null,
    receiptNo: row.receiptNo ?? null,
    stockCode: row.stockCode ?? null,
    actionType: row.actionType ?? null,
    disposition: row.disposition ?? null,
    exactCarryForwardIdentityMatches:
      sortedJson((row.exactCarryForwardIdentityMatches ?? []).map(compactMatch)),
    stockActionCarryForwardMatches:
      sortedJson((row.stockActionCarryForwardMatches ?? []).map(compactMatch)),
  };
}

function queue(report, key) {
  if (report.queues && Array.isArray(report.queues[key])) {
    return report.queues[key];
  }
  if (Array.isArray(report[key])) {
    return report[key];
  }
  return [];
}

function compareSet(issues, field, a, b) {
  const sa = sortedJson(a);
  const sb = sortedJson(b);

  if (stable(sa) !== stable(sb)) {
    const setA = new Set(sa);
    const setB = new Set(sb);

    issues.push({
      field,
      historicalOnly: sa.filter((x) => !setB.has(x)),
      replayOnly: sb.filter((x) => !setA.has(x)),
    });
  }
}

function main() {
  const root = path.resolve(__dirname, '..');

  const historicalFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1.json',
  );

  const replayFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay-v2.json',
  );

  const sourcePreflightFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json',
  );

  const previousAuditFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2-1.json',
  );

  for (const file of [
    historicalFile,
    replayFile,
    sourcePreflightFile,
    previousAuditFile,
  ]) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const historical = readJson(historicalFile);
  const replay = readJson(replayFile);
  const sourcePreflight = readJson(sourcePreflightFile);
  const previousAudit = readJson(previousAuditFile);

  assert(
    historical.version === HIST_VERSION,
    `HISTORICAL_VERSION_MISMATCH:${historical.version}`,
  );

  assert(
    replay.version === REPLAY_VERSION,
    `REPLAY_VERSION_MISMATCH:${replay.version}`,
  );

  assert(
    historical.status === EXPECTED_STATUS,
    `HISTORICAL_STATUS_MISMATCH:${historical.status}`,
  );

  assert(
    replay.status === EXPECTED_STATUS,
    `REPLAY_STATUS_MISMATCH:${replay.status}`,
  );

  const futurePendingRows =
    Array.isArray(sourcePreflight.futurePendingRows)
      ? sourcePreflight.futurePendingRows
      : [];

  const sourceCashMatches =
    futurePendingRows.filter(
      (row) =>
        String(row.stockCode ?? row.stock_code ?? '') === CASH.stockCode &&
        String(row.actionType ?? row.action_type ?? '') === CASH.actionType &&
        String(row.providerEventId ?? row.provider_event_id ?? '') === CASH.providerEventId &&
        String(row.recordDate ?? row.record_date ?? '') === CASH.recordDate,
    );

  assert(
    sourceCashMatches.length === 1,
    `SOURCE_478560_PROVIDER_ID_PROOF_COUNT:${sourceCashMatches.length}`,
  );

  assert(
    previousAudit.status ===
      'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENCE_BLOCKED',
    `PREVIOUS_AUDIT_STATUS:${previousAudit.status}`,
  );

  assert(
    Number(previousAudit.counts?.totalBusinessMismatchRows) === 1,
    `PREVIOUS_MISMATCH_COUNT:${previousAudit.counts?.totalBusinessMismatchRows}`,
  );

  assert(
    Array.isArray(previousAudit.businessMismatches) &&
      previousAudit.businessMismatches.length === 1 &&
      previousAudit.businessMismatches[0].field === 'untouchedCarryForward',
    'PREVIOUS_MISMATCH_NOT_ONLY_UNTOUCHED_CARRY_FORWARD',
  );

  const issues = [];

  for (const field of COUNT_FIELDS) {
    const a = historical.counts?.[field];
    const b = replay.counts?.[field];

    if (a !== b) {
      issues.push({
        field: `counts.${field}`,
        historical: a ?? null,
        replay: b ?? null,
      });
    }
  }

  if (historical.nextGate !== replay.nextGate) {
    issues.push({
      field: 'nextGate',
      historical: historical.nextGate,
      replay: replay.nextGate,
    });
  }

  compareSet(
    issues,
    'touchedCarryForward',
    (historical.touchedCarryForward ?? []).map(String),
    (replay.touchedCarryForward ?? []).map(String),
  );

  const histUntouched = historical.untouchedCarryForward ?? [];
  const replayUntouched = replay.untouchedCarryForward ?? [];

  const histCash =
    histUntouched.filter(
      (row) =>
        String(row.category ?? '') === 'FUTURE_CASH' &&
        String(row.stockCode ?? '') === CASH.stockCode &&
        String(row.actionType ?? '') === CASH.actionType,
    );

  const replayCash =
    replayUntouched.filter(
      (row) =>
        String(row.category ?? '') === 'FUTURE_CASH' &&
        String(row.stockCode ?? '') === CASH.stockCode &&
        String(row.actionType ?? '') === CASH.actionType,
    );

  assert(
    histCash.length === 1,
    `HIST_FUTURE_CASH_COUNT:${histCash.length}`,
  );

  assert(
    replayCash.length === 1,
    `REPLAY_FUTURE_CASH_COUNT:${replayCash.length}`,
  );

  const providerIdEnrichment =
    normalizeProviderId(histCash[0].providerEventId) === '' &&
    normalizeProviderId(replayCash[0].providerEventId) === CASH.providerEventId;

  assert(
    providerIdEnrichment,
    'EXPECTED_FUTURE_CASH_PROVIDER_ID_ENRICHMENT_NOT_FOUND',
  );

  compareSet(
    issues,
    'untouchedCarryForwardAfterExpectedEnrichmentNormalization',
    histUntouched.map(
      (row) =>
        compactCarry(row, {
          ignoreFutureCashProviderId: true,
        }),
    ),
    replayUntouched.map(
      (row) =>
        compactCarry(row, {
          ignoreFutureCashProviderId: true,
        }),
    ),
  );

  const queueKeys = [
    'carryForwardReconfirmationQueue',
    'newStandaloneDetailFetchQueue',
    'standaloneDetailFetchQueue',
    'newCorrectionChainLookupQueue',
    'correctionChainLookupQueue',
    'outOfScopeQueue',
  ];

  const queueComparison = {};

  for (const key of queueKeys) {
    const a = queue(historical, key);
    const b = queue(replay, key);

    queueComparison[key] = {
      historical: a.length,
      replay: b.length,
    };

    compareSet(
      issues,
      `queues.${key}`,
      a.map(compactQueueRow),
      b.map(compactQueueRow),
    );
  }

  const replayReconfirm =
    queue(replay, 'carryForwardReconfirmationQueue');

  const reconfirmationStill001570 =
    replayReconfirm.length === 1 &&
    String(replayReconfirm[0].providerEventId ?? '') === '20261002000513' &&
    String(replayReconfirm[0].stockCode ?? '') === '001570' &&
    String(replayReconfirm[0].actionType ?? '') === 'SPIN_OFF';

  if (!reconfirmationStill001570) {
    issues.push({
      field: 'carryForwardReconfirmationQueue.identity',
      replay: replayReconfirm.map(compactQueueRow),
    });
  }

  if (
    Number(replay.counts?.exactCarryForwardIdentityNewRows) !== 0
  ) {
    issues.push({
      field: 'replay.exactCarryForwardIdentityNewRows',
      actual: replay.counts?.exactCarryForwardIdentityNewRows,
      expected: 0,
    });
  }

  const touchedContains478560 =
    (replay.touchedCarryForward ?? []).some(
      (value) =>
        String(value).includes(
          `|${CASH.stockCode}|${CASH.actionType}`,
        ),
    );

  if (touchedContains478560) {
    issues.push({
      field: '478560TouchedByCurrentWindow',
      actual: true,
      expected: false,
    });
  }

  const businessEquivalent =
    issues.length === 0;

  const status =
    businessEquivalent
      ? 'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENT_AFTER_EXPECTED_FUTURE_CASH_ID_ENRICHMENT'
      : 'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENCE_RECLASSIFICATION_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      historicalVersion: historical.version,
      replayVersion: replay.version,
      previousAuditVersion: previousAudit.version,
      sourcePreflightVersion: sourcePreflight.version,
    },

    expectedEnrichment: {
      category: 'FUTURE_CASH',
      stockCode: CASH.stockCode,
      actionType: CASH.actionType,
      historicalProviderEventId:
        normalizeProviderId(histCash[0].providerEventId),
      replayProviderEventId:
        normalizeProviderId(replayCash[0].providerEventId),
      sourceEvidenceProviderEventId: CASH.providerEventId,
      recordDate: CASH.recordDate,
      classification:
        'SOURCE_CORROBORATED_PROVIDER_ID_ENRICHMENT_NOT_CURRENT_WINDOW_BUSINESS_DIVERGENCE',
    },

    counts: {
      historicalCarryForward:
        historical.counts?.priorCarryForwardTotal ?? null,
      replayCarryForward:
        replay.counts?.priorCarryForwardTotal ?? null,
      historicalTouched:
        historical.counts?.touchedCarryForwardItems ?? null,
      replayTouched:
        replay.counts?.touchedCarryForwardItems ?? null,
      historicalUntouched:
        historical.counts?.untouchedCarryForwardItems ?? null,
      replayUntouched:
        replay.counts?.untouchedCarryForwardItems ?? null,
      replayExactIdentityMatches:
        replay.counts?.exactCarryForwardIdentityNewRows ?? null,
      businessIssueRows:
        issues.length,
    },

    queueComparison,

    proofs: {
      sourceEvidenceUnique:
        sourceCashMatches.length === 1,
      providerIdEnrichmentExact:
        providerIdEnrichment,
      currentWindowExactIdentityMatchesRemainZero:
        Number(replay.counts?.exactCarryForwardIdentityNewRows) === 0,
      currentWindowTouched478560:
        touchedContains478560,
      carryForwardReconfirmationStill001570:
        reconfirmationStill001570,
      allQueuesBusinessEquivalent:
        issues.filter(
          (row) =>
            String(row.field).startsWith('queues.'),
        ).length === 0,
    },

    issues,

    conclusion: {
      reconciliationBusinessEquivalent:
        businessEquivalent,
      futureCashProviderIdDifference:
        'EXPECTED_ENRICHMENT',
      repairedV98BridgeChangesCurrentV99BusinessResult:
        false,
      historicalV993EvidenceReuseCandidate:
        businessEquivalent,
      historicalV9931EvidenceReuseCandidate:
        businessEquivalent,
      historicalV994ChainResolutionReuseCandidate:
        businessEquivalent,
      openDartRefetchRequiredAtThisGate:
        false,
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
      coverageWindowAdvanced: false,
    },

    nextGate:
      businessEquivalent
        ? 'AUDIT_HISTORICAL_V9_9_3_3_1_4_EVIDENCE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2-1.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        expectedEnrichment: report.expectedEnrichment,
        counts: report.counts,
        proofs: report.proofs,
        issues: report.issues,
        conclusion: report.conclusion,
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,
        expectedEnrichment: report.expectedEnrichment,
        ...report.counts,
        queueComparison: report.queueComparison,
        proofs: report.proofs,
        issues: report.issues,
        conclusion: report.conclusion,
        networkRequests: 0,
        databaseWrites: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (!businessEquivalent) {
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
          'V9_9_2_1_1_REPLAY_EQUIVALENCE_RECLASSIFICATION_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
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
