#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.11.4 / 11.5 / 11.5.1 common-stock historical reuse audit
 *
 * READ ONLY / LOCAL ARTIFACTS ONLY.
 *
 * This audit DOES NOT execute the historical preflight/dry-run scripts,
 * DOES NOT contact Supabase, and DOES NOT execute V9.9.11.6 apply.
 *
 * Authoritative six-row V9.9 common-stock disposition:
 *   FACTOR_READY       = 2
 *   FUTURE_PENDING     = 1
 *   STRUCTURAL_BLOCKED = 3
 *
 * Therefore:
 *   canonical identities = 6
 *   persistable before snapshot gate = 5
 *   future-pending cash excluded from persistence = 1
 *
 * Historical V9.9.11.5.1 snapshot is intentionally preserved as 2026-10-04.
 * At that snapshot:
 *   - 2 factor-ready rows are eligible
 *   - 3 structural rows have future effective dates and are deferred
 *
 * Remote production contract:
 *   is_validation = false
 *   production_applied = false
 *   metadata.canonical_validation_status = VALIDATED
 *
 * 028080 remains a separate V9.8 virtual repair overlay and MUST NOT be
 * injected into the V9.9 incremental common-stock batch.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_4_5_5_1_REPLAY_READ_ONLY_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_10_1_10_2_1_10_3_REPLAY_V2_REVIEW_QUEUE_AWARE_COMMON_STOCK_STRUCTURAL_DATE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_RESULTS_REUSABLE_AFTER_REVIEW_QUEUE_SEMANTICS';

const SNAPSHOT_AS_OF = '2026-10-04';

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

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function keyFromParts(providerEventId, stockCode, actionType) {
  return [
    normalizeReceipt(providerEventId),
    normalizeStock(stockCode),
    normalizeAction(actionType),
  ].join('|');
}

function rowIdentity(row) {
  const cp = row?.canonicalPreview ?? {};

  return {
    providerEventId: normalizeReceipt(
      firstNonEmpty(
        row.providerEventId,
        row.provider_event_id,
        row.rootReceiptNo,
        row.root_receipt_no,
        cp.provider_event_id,
      ),
    ),

    stockCode: normalizeStock(
      firstNonEmpty(
        row.stockCode,
        row.stock_code,
        cp.stock_code,
      ),
    ),

    actionType: normalizeAction(
      firstNonEmpty(
        row.actionType,
        row.action_type,
        cp.action_type,
      ),
    ),
  };
}

function keyOf(row) {
  const id = rowIdentity(row);

  return keyFromParts(
    id.providerEventId,
    id.stockCode,
    id.actionType,
  );
}

function factorStatus(row) {
  return String(
    firstNonEmpty(
      row.factorValidation?.status,
      row.factor_validation?.status,
      row.factorStatus,
      row.factor_status,
      row.metadata?.factor_status,
    ) ?? '',
  ).toUpperCase();
}

function arrayField(doc, ...names) {
  for (const name of names) {
    if (Array.isArray(doc?.[name])) {
      return doc[name];
    }
  }

  return [];
}

function countField(doc, ...names) {
  for (const name of names) {
    const candidates = [
      doc?.[name],
      doc?.counts?.[name],
    ];

    for (const value of candidates) {
      if (value !== undefined && value !== null) {
        const n = Number(value);

        if (Number.isFinite(n)) {
          return n;
        }
      }
    }
  }

  return null;
}

function databaseWrites(doc) {
  return countField(
    doc,
    'databaseWrites',
    'writesPerformed',
  );
}

function productionRowContractIssues(row) {
  const issues = [];

  if (row.is_validation !== false) {
    issues.push('IS_VALIDATION_MUST_BE_FALSE');
  }

  if (row.production_applied !== false) {
    issues.push('PRODUCTION_APPLIED_MUST_BE_FALSE');
  }

  if (
    row.metadata?.canonical_validation_status !==
    'VALIDATED'
  ) {
    issues.push('CANONICAL_VALIDATION_STATUS_MUST_BE_VALIDATED');
  }

  if (!isIsoDate(row.effective_date)) {
    issues.push('EFFECTIVE_DATE_REQUIRED');
  }

  return issues;
}

function identitySet(rows) {
  return new Set(
    rows
      .map(keyOf)
      .filter(
        (key) =>
          !key.startsWith('||') &&
          !key.includes('||'),
      ),
  );
}

function diffSets(expected, actual) {
  return {
    missing: [...expected]
      .filter((key) => !actual.has(key))
      .sort(),

    unexpected: [...actual]
      .filter((key) => !expected.has(key))
      .sort(),
  };
}

function has028080(rows) {
  return rows.some(
    (row) =>
      rowIdentity(row).stockCode === '028080',
  );
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    upstream: path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-reuse-v9-9-10-1-10-2-1-10-3-common-stock-replay-v2.json',
    ),

    final103: path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
    ),

    preflight114: path.join(
      root,
      'logs',
      'opendart-corporate-action-production-event-preflight-v9-9-11-4-common-stock-scope.json',
    ),

    dryrun115: path.join(
      root,
      'logs',
      'opendart-corporate-action-bulk-insert-dry-run-v9-9-11-5-common-stock-scope.json',
    ),

    eligibility1151: path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-9-11-5-1-common-stock-scope.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay.json',
  );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs = Object.fromEntries(
    Object.entries(files).map(
      ([name, file]) => [
        name,
        readJson(file),
      ],
    ),
  );

  assert(
    docs.upstream.version === UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstream.version}`,
  );

  assert(
    docs.upstream.status === UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstream.status}`,
  );

  assert(
    docs.upstream.conclusion
      ?.safeToAdvanceToHistoricalV9_9_11_4_5_5_1ReuseAudit === true,
    'UPSTREAM_NOT_READY',
  );

  assert(
    docs.preflight114.status ===
      'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY',
    `PREFLIGHT_NOT_READY:${docs.preflight114.status}`,
  );

  assert(
    docs.dryrun115.status ===
      'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY',
    `DRYRUN_NOT_READY:${docs.dryrun115.status}`,
  );

  assert(
    docs.eligibility1151.status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',
    `ELIGIBILITY_NOT_READY:${docs.eligibility1151.status}`,
  );

  const issues = [];

  // ---------------------------------------------------------------
  // Reconstruct authoritative six-row business disposition from final103.
  // ---------------------------------------------------------------

  const finalResults =
    Array.isArray(docs.final103.results)
      ? docs.final103.results
      : [];

  assert(
    finalResults.length === 6,
    `FINAL103_EXPECTED_6_ROWS_GOT_${finalResults.length}`,
  );

  const canonicalKeys =
    identitySet(finalResults);

  const factorReadyRows =
    finalResults.filter(
      (row) =>
        factorStatus(row) === 'FACTOR_READY',
    );

  const futurePendingRows =
    finalResults.filter(
      (row) =>
        factorStatus(row) === 'FUTURE_PENDING',
    );

  const structuralRows =
    finalResults.filter(
      (row) =>
        factorStatus(row) === 'STRUCTURAL_BLOCKED',
    );

  const persistableRows =
    finalResults.filter(
      (row) =>
        factorStatus(row) !== 'FUTURE_PENDING',
    );

  if (canonicalKeys.size !== 6) {
    issues.push({
      check: 'final103.uniqueCanonicalIdentities',
      actual: canonicalKeys.size,
      expected: 6,
    });
  }

  if (factorReadyRows.length !== 2) {
    issues.push({
      check: 'final103.factorReady',
      actual: factorReadyRows.length,
      expected: 2,
    });
  }

  if (futurePendingRows.length !== 1) {
    issues.push({
      check: 'final103.futurePending',
      actual: futurePendingRows.length,
      expected: 1,
    });
  }

  if (structuralRows.length !== 3) {
    issues.push({
      check: 'final103.structuralBlocked',
      actual: structuralRows.length,
      expected: 3,
    });
  }

  if (persistableRows.length !== 5) {
    issues.push({
      check: 'final103.persistableRows',
      actual: persistableRows.length,
      expected: 5,
    });
  }

  const expectedFactorKeys =
    identitySet(factorReadyRows);

  const expectedStructuralKeys =
    identitySet(structuralRows);

  const expectedPersistableKeys =
    identitySet(persistableRows);

  // ---------------------------------------------------------------
  // V9.9.11.4 preflight accounting.
  // ---------------------------------------------------------------

  const preflightCounts = {
    totalCanonicalIdentities:
      countField(
        docs.preflight114,
        'totalCanonicalIdentities',
      ),

    persistableNow:
      countField(
        docs.preflight114,
        'persistableNow',
      ),

    factorSupported:
      countField(
        docs.preflight114,
        'factorSupported',
      ),

    structuralBlocked:
      countField(
        docs.preflight114,
        'structuralBlocked',
      ),

    futurePending:
      countField(
        docs.preflight114,
        'futurePending',
      ),

    desiredRowContractFailures:
      countField(
        docs.preflight114,
        'desiredRowContractFailures',
      ),

    wouldInsert:
      countField(
        docs.preflight114,
        'wouldInsert',
      ),

    alreadyCompatible:
      countField(
        docs.preflight114,
        'alreadyCompatible',
      ),

    accountedPersistable:
      countField(
        docs.preflight114,
        'accountedPersistable',
      ),

    conflicts:
      Array.isArray(docs.preflight114.conflicts)
        ? docs.preflight114.conflicts.length
        : countField(
            docs.preflight114,
            'conflicts',
          ),
  };

  const expectedPreflightCounts = {
    totalCanonicalIdentities: 6,
    persistableNow: 5,
    factorSupported: 2,
    structuralBlocked: 3,
    futurePending: 1,
    desiredRowContractFailures: 0,
    conflicts: 0,
  };

  for (
    const [name, expected]
    of Object.entries(expectedPreflightCounts)
  ) {
    const actual =
      preflightCounts[name];

    if (
      actual !== null &&
      actual !== expected
    ) {
      issues.push({
        check: `preflight114.${name}`,
        actual,
        expected,
      });
    }
  }

  // Accounting must close even if historical DB overlap varied.
  if (
    preflightCounts.wouldInsert !== null &&
    preflightCounts.alreadyCompatible !== null &&
    preflightCounts.accountedPersistable !== null
  ) {
    if (
      preflightCounts.wouldInsert +
        preflightCounts.alreadyCompatible !==
      preflightCounts.accountedPersistable
    ) {
      issues.push({
        check:
          'preflight114.insertCompatibleAccounting',
        wouldInsert:
          preflightCounts.wouldInsert,
        alreadyCompatible:
          preflightCounts.alreadyCompatible,
        accountedPersistable:
          preflightCounts.accountedPersistable,
      });
    }

    if (
      preflightCounts.accountedPersistable !== 5
    ) {
      issues.push({
        check:
          'preflight114.accountedPersistable',
        actual:
          preflightCounts.accountedPersistable,
        expected: 5,
      });
    }
  }

  const preflightInsertPreview =
    arrayField(
      docs.preflight114,
      'insertPreview',
      'wouldInsertRows',
    );

  const preflightCompatibleRows =
    arrayField(
      docs.preflight114,
      'compatibleRows',
      'alreadyCompatibleRows',
    );

  const preflightInsertKeys =
    identitySet(preflightInsertPreview);

  const preflightCompatibleKeys =
    identitySet(preflightCompatibleRows);

  const accountedPreflightKeys =
    new Set([
      ...preflightInsertKeys,
      ...preflightCompatibleKeys,
    ]);

  if (accountedPreflightKeys.size > 0) {
    const diff =
      diffSets(
        expectedPersistableKeys,
        accountedPreflightKeys,
      );

    if (
      diff.missing.length > 0 ||
      diff.unexpected.length > 0
    ) {
      issues.push({
        check:
          'preflight114.persistableIdentityAccounting',
        ...diff,
      });
    }
  }

  // ---------------------------------------------------------------
  // V9.9.11.5 dry-run payload.
  // ---------------------------------------------------------------

  const insertPayload =
    arrayField(
      docs.dryrun115,
      'insertPayload',
    );

  const dryrunInsertRows =
    countField(
      docs.dryrun115,
      'insertRows',
    );

  const dryrunBlockers =
    Array.isArray(
      docs.dryrun115.blockers,
    )
      ? docs.dryrun115.blockers
      : [];

  if (
    dryrunInsertRows !== null &&
    dryrunInsertRows !==
      insertPayload.length
  ) {
    issues.push({
      check:
        'dryrun115.insertRowsVsPayload',
      count:
        dryrunInsertRows,
      payload:
        insertPayload.length,
    });
  }

  if (dryrunBlockers.length !== 0) {
    issues.push({
      check:
        'dryrun115.blockers',
      blockers:
        dryrunBlockers,
    });
  }

  const dryrunContractFailures =
    insertPayload.flatMap(
      (row) => {
        const rowIssues =
          productionRowContractIssues(row);

        return rowIssues.length === 0
          ? []
          : [{
              identity:
                rowIdentity(row),
              issues:
                rowIssues,
            }];
      },
    );

  if (
    dryrunContractFailures.length >
    0
  ) {
    issues.push({
      check:
        'dryrun115.productionRowContract',
      rows:
        dryrunContractFailures,
    });
  }

  const dryrunKeys =
    identitySet(
      insertPayload,
    );

  if (
    preflightInsertKeys.size > 0
  ) {
    const diff =
      diffSets(
        preflightInsertKeys,
        dryrunKeys,
      );

    if (
      diff.missing.length > 0 ||
      diff.unexpected.length > 0
    ) {
      issues.push({
        check:
          'preflight114ToDryrun115.insertIdentityChanged',
        ...diff,
      });
    }
  }

  // ---------------------------------------------------------------
  // V9.9.11.5.1 snapshot eligibility at historical 2026-10-04.
  // ---------------------------------------------------------------

  const snapshotAsOf =
    String(
      docs.eligibility1151
        .policy
        ?.evidenceSnapshotAsOf ??
      docs.eligibility1151
        .evidenceSnapshotAsOf ??
      '',
    );

  if (
    snapshotAsOf !==
    SNAPSHOT_AS_OF
  ) {
    issues.push({
      check:
        'eligibility1151.snapshotAsOf',
      actual:
        snapshotAsOf,
      expected:
        SNAPSHOT_AS_OF,
    });
  }

  const eligibleInsertPayload =
    arrayField(
      docs.eligibility1151,
      'eligibleInsertPayload',
    );

  const deferredFutureStructuralRows =
    arrayField(
      docs.eligibility1151,
      'deferredFutureStructuralRows',
    );

  const eligibleKeys =
    identitySet(
      eligibleInsertPayload,
    );

  const deferredKeys =
    identitySet(
      deferredFutureStructuralRows,
    );

  const eligibleDiff =
    diffSets(
      expectedFactorKeys,
      eligibleKeys,
    );

  if (
    eligibleDiff.missing.length > 0 ||
    eligibleDiff.unexpected.length > 0
  ) {
    issues.push({
      check:
        'eligibility1151.eligibleIdentitySet',
      expected:
        [...expectedFactorKeys].sort(),
      actual:
        [...eligibleKeys].sort(),
      ...eligibleDiff,
    });
  }

  const deferredDiff =
    diffSets(
      expectedStructuralKeys,
      deferredKeys,
    );

  if (
    deferredDiff.missing.length > 0 ||
    deferredDiff.unexpected.length > 0
  ) {
    issues.push({
      check:
        'eligibility1151.deferredStructuralIdentitySet',
      expected:
        [...expectedStructuralKeys].sort(),
      actual:
        [...deferredKeys].sort(),
      ...deferredDiff,
    });
  }

  if (
    eligibleInsertPayload.length !==
    2
  ) {
    issues.push({
      check:
        'eligibility1151.eligibleInsertPayload',
      actual:
        eligibleInsertPayload.length,
      expected:
        2,
    });
  }

  if (
    deferredFutureStructuralRows.length !==
    3
  ) {
    issues.push({
      check:
        'eligibility1151.deferredFutureStructuralRows',
      actual:
        deferredFutureStructuralRows.length,
      expected:
        3,
    });
  }

  for (
    const row
    of deferredFutureStructuralRows
  ) {
    if (
      !isIsoDate(
        row.effective_date,
      )
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralEffectiveDate',
        row,
      });
    } else if (
      row.effective_date <=
      SNAPSHOT_AS_OF
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralMustBeFuture',
        row,
        snapshotAsOf:
          SNAPSHOT_AS_OF,
      });
    }
  }

  // Accounting of dry-run inserts must be exactly eligible + deferred.
  if (
    eligibleInsertPayload.length +
      deferredFutureStructuralRows.length !==
    insertPayload.length
  ) {
    issues.push({
      check:
        'eligibility1151.payloadAccounting',
      eligible:
        eligibleInsertPayload.length,
      deferred:
        deferredFutureStructuralRows.length,
      inputInsertPayload:
        insertPayload.length,
    });
  }

  const eligibilityCounts = {
    inputInsertRows:
      countField(
        docs.eligibility1151,
        'inputInsertRows',
        'inputInsertPayload',
      ),

    eligibleInsertRows:
      countField(
        docs.eligibility1151,
        'eligibleInsertRows',
        'eligibleInserts',
      ),

    deferredFutureStructural:
      countField(
        docs.eligibility1151,
        'deferredFutureStructural',
        'futureStructuralDeferred',
      ),

    eligibleTotal:
      countField(
        docs.eligibility1151,
        'eligibleTotal',
      ),
  };

  if (
    eligibilityCounts.eligibleInsertRows !== null &&
    eligibilityCounts.eligibleInsertRows !== 2
  ) {
    issues.push({
      check:
        'eligibility1151.counts.eligibleInsertRows',
      actual:
        eligibilityCounts.eligibleInsertRows,
      expected:
        2,
    });
  }

  if (
    eligibilityCounts.deferredFutureStructural !== null &&
    eligibilityCounts.deferredFutureStructural !== 3
  ) {
    issues.push({
      check:
        'eligibility1151.counts.deferredFutureStructural',
      actual:
        eligibilityCounts.deferredFutureStructural,
      expected:
        3,
    });
  }

  // ---------------------------------------------------------------
  // Stage write safety.
  // ---------------------------------------------------------------

  const stageSafety = {};

  for (
    const [name, doc]
    of [
      ['preflight114', docs.preflight114],
      ['dryrun115', docs.dryrun115],
      ['eligibility1151', docs.eligibility1151],
    ]
  ) {
    const writes =
      databaseWrites(doc);

    stageSafety[name] = {
      status:
        doc.status ?? null,
      version:
        doc.version ?? null,
      databaseWrites:
        writes,
      canonicalEventsInserted:
        countField(
          doc,
          'canonicalEventsInserted',
        ),
      insertRequestsExecuted:
        countField(
          doc,
          'insertRequestsExecuted',
        ),
    };

    if (
      writes !== null &&
      writes !== 0
    ) {
      issues.push({
        check:
          `${name}.databaseWrites`,
        actual:
          writes,
        expected:
          0,
      });
    }
  }

  // ---------------------------------------------------------------
  // 028080 must remain outside V9.9 incremental payloads.
  // ---------------------------------------------------------------

  const relevantRows = [
    ...preflightInsertPreview,
    ...preflightCompatibleRows,
    ...insertPayload,
    ...eligibleInsertPayload,
    ...deferredFutureStructuralRows,
  ];

  if (has028080(relevantRows)) {
    issues.push({
      check:
        '028080InjectedIntoV99CommonStockPersistenceBranch',
      actual:
        true,
      expected:
        false,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    snapshotAsOf:
      SNAPSHOT_AS_OF,

    source: {
      upstreamVersion:
        docs.upstream.version,
      upstreamFingerprint:
        docs.upstream.outputFingerprint ?? null,

      final103Version:
        docs.final103.version ?? null,
      preflight114Version:
        docs.preflight114.version ?? null,
      dryrun115Version:
        docs.dryrun115.version ?? null,
      eligibility1151Version:
        docs.eligibility1151.version ?? null,
    },

    authoritativeDisposition: {
      totalCanonical: 6,
      factorReady: 2,
      futurePending: 1,
      structuralBlocked: 3,
      persistableBeforeSnapshotGate: 5,

      factorReadyKeys:
        [...expectedFactorKeys].sort(),

      structuralKeys:
        [...expectedStructuralKeys].sort(),

      futurePendingKeys:
        [...identitySet(futurePendingRows)].sort(),
    },

    preflight114: {
      counts:
        preflightCounts,

      insertPreviewRows:
        preflightInsertPreview.length,

      compatibleRows:
        preflightCompatibleRows.length,
    },

    dryrun115: {
      insertPayloadRows:
        insertPayload.length,

      insertRowsCountField:
        dryrunInsertRows,

      blockers:
        dryrunBlockers.length,

      contractFailures:
        dryrunContractFailures.length,
    },

    eligibility1151: {
      snapshotAsOf,

      eligibleInsertRows:
        eligibleInsertPayload.length,

      deferredFutureStructuralRows:
        deferredFutureStructuralRows.length,

      eligibleKeys:
        [...eligibleKeys].sort(),

      deferredKeys:
        [...deferredKeys].sort(),

      counts:
        eligibilityCounts,

      deferredRows:
        deferredFutureStructuralRows.map(
          (row) => ({
            providerEventId:
              row.provider_event_id ??
              row.providerEventId ??
              null,

            stockCode:
              row.stock_code ??
              row.stockCode ??
              null,

            actionType:
              row.action_type ??
              row.actionType ??
              null,

            effectiveDate:
              row.effective_date ??
              row.effectiveDate ??
              null,

            disposition:
              row.disposition ??
              null,
          }),
        ),
    },

    stageSafety,

    issues,

    conclusion: {
      historicalV9911_4PreflightReusable:
        reusable,

      historicalV9911_5DryRunReusable:
        reusable,

      historicalV9911_5_1SnapshotEligibilityReusable:
        reusable,

      sixRowCanonicalDispositionPreserved:
        reusable,

      fivePersistableRowsAccounted:
        reusable,

      exactlyTwoSnapshotEligibleInserts:
        reusable &&
        eligibleInsertPayload.length === 2,

      exactlyThreeFutureStructuralDeferred:
        reusable &&
        deferredFutureStructuralRows.length === 3,

      futureCash009970RemainsOutsidePersistence:
        reusable &&
        futurePendingRows.length === 1,

      safeToAdvanceToHistoricalV9_9_11_7_8ReadOnlyPostPersistenceReuseAudit:
        reusable,

      historicalV9911_6ApplyMustNotBeExecuted:
        true,

      networkRefetchRequiredNow:
        false,

      databaseWriteRequiredNow:
        false,

      physical028080RepairStillSeparate:
        true,

      physical028080RepairAddedToIncrementalBranch:
        false,
    },

    safety: {
      networkRequestsNow:
        0,

      databaseReadsNow:
        0,

      databaseWritesNow:
        0,

      productionAppliedNow:
        false,

      historicalApplyStageExecutedNow:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_11_7_11_8_READ_ONLY_POST_PERSISTENCE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        snapshotAsOf:
          report.snapshotAsOf,

        authoritativeDisposition:
          report.authoritativeDisposition,

        preflight114:
          report.preflight114,

        dryrun115:
          report.dryrun115,

        eligibility1151:
          report.eligibility1151,

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

        snapshotAsOf:
          report.snapshotAsOf,

        authoritativeDisposition:
          report.authoritativeDisposition,

        preflight114:
          report.preflight114,

        dryrun115:
          report.dryrun115,

        eligibility1151:
          report.eligibility1151,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow:
          0,

        databaseWritesNow:
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
          'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_REUSE_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow:
          0,

        databaseWritesNow:
          0,

        productionAppliedNow:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
