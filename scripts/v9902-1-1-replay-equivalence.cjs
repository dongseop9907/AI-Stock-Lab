#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.2.1.1 replay equivalence audit
 *
 * READ ONLY.
 *
 * Compare:
 *   historical:
 *     logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1.json
 *
 *   repaired replay:
 *     logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay-v2.json
 *
 * Goal:
 * Prove that the repaired V9.8 replay bridge changes only provenance/input
 * contract metadata and DOES NOT change the V9.9 reconciliation business
 * result.
 *
 * If equivalent, historical V9.9.3 / 3.1 / 4 evidence may be considered for
 * controlled reuse instead of re-fetching OpenDART immediately.
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_2_1_1_REPLAY_V2_HISTORICAL_BUSINESS_EQUIVALENCE_AUDIT';

const HISTORICAL_VERSION =
  'V9_9_2_1_1_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const REPLAY_VERSION =
  'V9_9_2_1_1_REPLAY_V2_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const EXPECTED_STATUS =
  'WORKSET_CARRY_FORWARD_RECONCILIATION_READY';

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
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function stableStringify(value) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return (
      '[' +
      value
        .map(stableStringify)
        .join(',') +
      ']'
    );
  }

  const keys =
    Object.keys(value).sort();

  return (
    '{' +
    keys
      .map(
        (key) =>
          JSON.stringify(key) +
          ':' +
          stableStringify(
            value[key],
          ),
      )
      .join(',') +
    '}'
  );
}

function sortedJson(rows) {
  return rows
    .map(
      (row) =>
        stableStringify(row),
    )
    .sort();
}

function compactCarry(row) {
  return {
    category:
      row.category ?? null,

    providerEventId:
      row.providerEventId ?? null,

    stockCode:
      row.stockCode ?? null,

    actionType:
      row.actionType ?? null,

    effectiveDate:
      row.effectiveDate ?? null,

    recordDate:
      row.recordDate ?? null,

    disposition:
      row.disposition ?? null,
  };
}

function compactMatch(row) {
  return {
    category:
      row.category ?? null,

    providerEventId:
      row.providerEventId ?? null,

    stockCode:
      row.stockCode ?? null,

    actionType:
      row.actionType ?? null,
  };
}

function compactNewRow(row) {
  return {
    providerEventId:
      row.providerEventId ?? null,

    receiptNo:
      row.receiptNo ?? null,

    stockCode:
      row.stockCode ?? null,

    actionType:
      row.actionType ?? null,

    gate:
      row.gate ?? null,

    needsChainLookup:
      row.needsChainLookup ?? null,

    canBecomeProductionEvent:
      row.canBecomeProductionEvent ?? null,

    likelyCarryForwardRelated:
      row.likelyCarryForwardRelated ?? null,

    disposition:
      row.disposition ?? null,

    exactCarryForwardIdentityMatches:
      sortedJson(
        (
          row.exactCarryForwardIdentityMatches ??
          []
        ).map(compactMatch),
      ),

    stockActionCarryForwardMatches:
      sortedJson(
        (
          row.stockActionCarryForwardMatches ??
          []
        ).map(compactMatch),
      ),
  };
}

function findRowsByPossibleKeys(
  report,
  keys,
) {
  for (const key of keys) {
    if (Array.isArray(report[key])) {
      return report[key];
    }

    if (
      report.queues &&
      Array.isArray(
        report.queues[key],
      )
    ) {
      return report.queues[key];
    }
  }

  return [];
}

function compareScalar(
  mismatches,
  field,
  historical,
  replay,
) {
  if (historical !== replay) {
    mismatches.push({
      field,
      historical:
        historical ?? null,
      replay:
        replay ?? null,
    });
  }
}

function compareSet(
  mismatches,
  field,
  historicalRows,
  replayRows,
) {
  const a =
    sortedJson(historicalRows);

  const b =
    sortedJson(replayRows);

  if (
    stableStringify(a) !==
    stableStringify(b)
  ) {
    mismatches.push({
      field,
      historicalCount:
        historicalRows.length,
      replayCount:
        replayRows.length,

      historicalOnly:
        a.filter(
          (value) =>
            !new Set(b).has(value),
        ),

      replayOnly:
        b.filter(
          (value) =>
            !new Set(a).has(value),
        ),
    });
  }
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const historicalFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1.json',
    );

  const replayFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay-v2.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2.json',
    );

  for (
    const file of [
      historicalFile,
      replayFile,
    ]
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const historical =
    readJson(historicalFile);

  const replay =
    readJson(replayFile);

  assert(
    historical.version ===
      HISTORICAL_VERSION,
    `HISTORICAL_VERSION_MISMATCH:${historical.version}`,
  );

  assert(
    replay.version ===
      REPLAY_VERSION,
    `REPLAY_VERSION_MISMATCH:${replay.version}`,
  );

  assert(
    historical.status ===
      EXPECTED_STATUS,
    `HISTORICAL_STATUS_MISMATCH:${historical.status}`,
  );

  assert(
    replay.status ===
      EXPECTED_STATUS,
    `REPLAY_STATUS_MISMATCH:${replay.status}`,
  );

  const mismatches = [];

  // The business counts must match exactly.
  for (const field of COUNT_FIELDS) {
    compareScalar(
      mismatches,
      `counts.${field}`,
      historical.counts?.[field],
      replay.counts?.[field],
    );
  }

  compareScalar(
    mismatches,
    'nextGate',
    historical.nextGate,
    replay.nextGate,
  );

  // Touched carry-forward identity set.
  compareSet(
    mismatches,
    'touchedCarryForward',
    (
      historical.touchedCarryForward ??
      []
    ).map(String),
    (
      replay.touchedCarryForward ??
      []
    ).map(String),
  );

  // Untouched carry-forward: compare business identity/disposition only.
  compareSet(
    mismatches,
    'untouchedCarryForward',
    (
      historical.untouchedCarryForward ??
      []
    ).map(compactCarry),
    (
      replay.untouchedCarryForward ??
      []
    ).map(compactCarry),
  );

  // Reconciled new rows if present.
  const historicalReconciled =
    findRowsByPossibleKeys(
      historical,
      [
        'reconciledNewRows',
        'newRows',
      ],
    );

  const replayReconciled =
    findRowsByPossibleKeys(
      replay,
      [
        'reconciledNewRows',
        'newRows',
      ],
    );

  if (
    historicalReconciled.length > 0 ||
    replayReconciled.length > 0
  ) {
    compareSet(
      mismatches,
      'reconciledNewRows',
      historicalReconciled
        .map(compactNewRow),
      replayReconciled
        .map(compactNewRow),
    );
  }

  const queueKeys = [
    'newStandaloneDetailFetchQueue',
    'standaloneDetailFetchQueue',
    'newCorrectionChainLookupQueue',
    'correctionChainLookupQueue',
    'carryForwardReconfirmationQueue',
    'outOfScopeQueue',
  ];

  const queueComparison = {};

  for (const key of queueKeys) {
    const histRows =
      findRowsByPossibleKeys(
        historical,
        [key],
      );

    const replayRows =
      findRowsByPossibleKeys(
        replay,
        [key],
      );

    queueComparison[key] = {
      historical:
        histRows.length,
      replay:
        replayRows.length,
    };

    compareSet(
      mismatches,
      `queues.${key}`,
      histRows.map(compactNewRow),
      replayRows.map(compactNewRow),
    );
  }

  // Specific safety guard: the only carry-forward reconfirmation must remain
  // 001570 / SPIN_OFF / 20261002000513.
  const replayReconfirm =
    findRowsByPossibleKeys(
      replay,
      [
        'carryForwardReconfirmationQueue',
      ],
    );

  const expectedReconfirmation =
    replayReconfirm.length === 1 &&
    String(
      replayReconfirm[0]
        .providerEventId ??
      '',
    ) ===
      '20261002000513' &&
    String(
      replayReconfirm[0]
        .stockCode ??
      '',
    ) ===
      '001570' &&
    String(
      replayReconfirm[0]
        .actionType ??
      '',
    ) ===
      'SPIN_OFF' &&
    String(
      replayReconfirm[0]
        .disposition ??
      '',
    ) ===
      'POSSIBLE_CARRY_FORWARD_CORRECTION_OR_RECONFIRMATION';

  if (!expectedReconfirmation) {
    mismatches.push({
      field:
        'expected001570CarryForwardReconfirmation',

      historical:
        true,

      replay:
        replayReconfirm.map(
          compactNewRow,
        ),
    });
  }

  // Provenance is expected to differ and is NOT a business mismatch.
  const expectedProvenanceDifferences = {
    historicalVersion:
      historical.version,

    replayVersion:
      replay.version,

    historicalPriorClosureVersion:
      historical.source
        ?.priorClosureVersion ??
      null,

    replayPriorClosureVersion:
      replay.source
        ?.priorClosureVersion ??
      null,

    historicalPriorClosureFingerprint:
      historical.source
        ?.priorClosureFingerprint ??
      null,

    replayPriorClosureFingerprint:
      replay.source
        ?.priorClosureFingerprint ??
      null,

    historicalOutputFingerprint:
      historical.outputFingerprint ??
      null,

    replayOutputFingerprint:
      replay.outputFingerprint ??
      null,
  };

  const equivalent =
    mismatches.length === 0;

  const status =
    equivalent
      ? 'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENT_TO_HISTORICAL'
      : 'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENCE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      historicalVersion:
        historical.version,

      historicalFingerprint:
        historical.outputFingerprint ??
        null,

      replayVersion:
        replay.version,

      replayFingerprint:
        replay.outputFingerprint ??
        null,
    },

    counts: {
      historicalCarryForward:
        historical.counts
          ?.priorCarryForwardTotal ??
        null,

      replayCarryForward:
        replay.counts
          ?.priorCarryForwardTotal ??
        null,

      historicalTouched:
        historical.counts
          ?.touchedCarryForwardItems ??
        null,

      replayTouched:
        replay.counts
          ?.touchedCarryForwardItems ??
        null,

      historicalUntouched:
        historical.counts
          ?.untouchedCarryForwardItems ??
        null,

      replayUntouched:
        replay.counts
          ?.untouchedCarryForwardItems ??
        null,

      queueBusinessMismatchRows:
        mismatches.filter(
          (row) =>
            String(row.field)
              .startsWith('queues.'),
        ).length,

      totalBusinessMismatchRows:
        mismatches.length,
    },

    queueComparison,

    expected001570CarryForwardReconfirmation:
      expectedReconfirmation,

    expectedProvenanceDifferences,

    businessMismatches:
      mismatches,

    conclusion: {
      reconciliationBusinessEquivalent:
        equivalent,

      repairedV98BridgeChangesV99BusinessResult:
        !equivalent,

      historicalV993EvidenceReuseCandidate:
        equivalent,

      historicalV9931EvidenceReuseCandidate:
        equivalent,

      historicalV994ChainResolutionReuseCandidate:
        equivalent,

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
      productionApplied:
        false,
      coverageWindowAdvanced:
        false,
    },

    nextGate:
      equivalent
        ? 'AUDIT_HISTORICAL_V9_9_3_3_1_4_EVIDENCE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-workset-carryforward-equivalence-v9-9-2-1-1-replay-v2.json',
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

        queueComparison:
          report.queueComparison,

        expected001570CarryForwardReconfirmation:
          report.expected001570CarryForwardReconfirmation,

        businessMismatches:
          report.businessMismatches,

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

        queueComparison:
          report.queueComparison,

        expected001570CarryForwardReconfirmation:
          report.expected001570CarryForwardReconfirmation,

        businessMismatches:
          report.businessMismatches,

        conclusion:
          report.conclusion,

        databaseWrites:
          0,

        networkRequests:
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

  if (!equivalent) {
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
          'V9_9_2_1_1_REPLAY_BUSINESS_EQUIVALENCE_AUDIT_FAILED',

        version:
          VERSION,

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
