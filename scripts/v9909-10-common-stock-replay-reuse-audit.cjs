#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.9 / V9.9.10 common-stock historical reuse audit
 *
 * READ ONLY.
 *
 * Validates:
 * - common8 factor-ready topology
 * - common9 multi-event audit
 * - common10 single-event cumulative-factor preview
 *
 * Expected from authoritative six-row common-stock batch:
 *   FACTOR_READY       2
 *     - 032080 REVERSE_SPLIT
 *     - 039830 CASH_DIVIDEND
 *   FUTURE_PENDING     1
 *     - 009970 CASH_DIVIDEND
 *   STRUCTURAL_BLOCKED 3
 *     - 001570 SPIN_OFF
 *     - 043910 MERGER
 *     - 469480 MERGER
 *
 * For common9/common10:
 * - factor-ready stocks = 2
 * - one factor-ready event per stock
 * - multi-event stocks = 0
 * - same-date collisions = 0
 * - cumulative factors equal event factors
 * - all factors positive
 * - future pending 1 and structural blocked 3 preserved
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_9_10_REPLAY_READ_ONLY_COMMON_STOCK_MULTI_EVENT_CUMULATIVE_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_7_7_2_8_REPLAY_V2_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_RESULTS_REUSABLE';

const EXPECTED_FACTOR_READY = 2;
const EXPECTED_FUTURE_PENDING = 1;
const EXPECTED_STRUCTURAL = 3;

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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    text.includes('INVALID') ||
    text.includes('ERROR')
  );
}

function safetyWrites(doc) {
  const candidates = [
    doc?.databaseWrites,
    doc?.safety?.databaseWrites,
    doc?.safety?.writesPerformed,
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

function topCount(doc, ...names) {
  for (const name of names) {
    const candidates = [
      doc?.[name],
      doc?.counts?.[name],
      doc?.summary?.[name],
    ];

    for (const value of candidates) {
      if (value !== undefined && value !== null) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function identityFromRow(row) {
  const cp = row?.canonicalPreview ?? {};
  const fv = row?.factorValidation ?? {};

  return {
    providerEventId: normalizeReceipt(
      firstNonEmpty(
        row.providerEventId,
        row.provider_event_id,
        row.rootReceiptNo,
        row.root_receipt_no,
        cp.provider_event_id,
        fv.providerEventId,
        fv.provider_event_id,
      ),
    ),
    stockCode: normalizeStock(
      firstNonEmpty(
        row.stockCode,
        row.stock_code,
        cp.stock_code,
        fv.stockCode,
        fv.stock_code,
      ),
    ),
    actionType: normalizeAction(
      firstNonEmpty(
        row.actionType,
        row.action_type,
        cp.action_type,
        fv.actionType,
        fv.action_type,
      ),
    ),
  };
}

function keyOfIdentity(row) {
  return [
    row.providerEventId,
    row.stockCode,
    row.actionType,
  ].join('|');
}

function common8Rows(doc) {
  if (Array.isArray(doc.results)) return doc.results;
  return [];
}

function factorStatus(row) {
  return String(
    firstNonEmpty(
      row.factorValidation?.status,
      row.factor_validation?.status,
      row.factorStatus,
      row.factor_status,
    ) ?? '',
  ).toUpperCase();
}

function factorValues(row) {
  const factor =
    row.factorValidation?.factor ??
    row.factor_validation?.factor ??
    {};

  return {
    eventPriceFactor: num(
      firstNonEmpty(
        factor.eventPriceFactor,
        factor.event_price_factor,
      ),
    ),
    eventShareFactor: num(
      firstNonEmpty(
        factor.eventShareFactor,
        factor.event_share_factor,
      ),
    ),
  };
}

function collectObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;

  if (!Array.isArray(value)) out.push(value);

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectObjects(child, out);
    }
  }
  return out;
}

function cumulativeRows(doc) {
  const preferredArrays = [
    'factorRows',
    'factorPreview',
    'factors',
    'results',
  ];

  for (const key of preferredArrays) {
    const rows = doc?.[key];

    if (
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          (
            row.cumulative_price_factor !== undefined ||
            row.cumulativePriceFactor !== undefined ||
            row.event_price_factor !== undefined ||
            row.eventPriceFactor !== undefined
          ),
      )
    ) {
      return rows;
    }
  }

  // fallback: recursively locate unique factor-like objects
  const rows = collectObjects(doc).filter(
    (row) =>
      (
        row.cumulative_price_factor !== undefined ||
        row.cumulativePriceFactor !== undefined
      ) &&
      (
        row.stock_code !== undefined ||
        row.stockCode !== undefined
      ),
  );

  const seen = new Set();
  return rows.filter((row) => {
    const id = JSON.stringify(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function cumulativeView(row) {
  return {
    providerEventId: normalizeReceipt(
      firstNonEmpty(
        row.provider_event_id,
        row.providerEventId,
        row.rootReceiptNo,
        row.root_receipt_no,
        row.metadata?.provider_event_id,
      ),
    ),
    stockCode: normalizeStock(
      firstNonEmpty(
        row.stock_code,
        row.stockCode,
      ),
    ),
    actionType: normalizeAction(
      firstNonEmpty(
        row.action_type,
        row.actionType,
      ),
    ),
    eventPriceFactor: num(
      firstNonEmpty(
        row.event_price_factor,
        row.eventPriceFactor,
      ),
    ),
    eventShareFactor: num(
      firstNonEmpty(
        row.event_share_factor,
        row.eventShareFactor,
      ),
    ),
    cumulativePriceFactor: num(
      firstNonEmpty(
        row.cumulative_price_factor,
        row.cumulativePriceFactor,
      ),
    ),
    cumulativeShareFactor: num(
      firstNonEmpty(
        row.cumulative_share_factor,
        row.cumulativeShareFactor,
      ),
    ),
  };
}

function countActions(rows) {
  const out = {};

  for (const row of rows) {
    const action = row.actionType || 'UNKNOWN';
    out[action] = (out[action] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function boolCheck(doc, name) {
  const value =
    doc?.checks?.[name] ??
    doc?.[name];

  return value === true;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    upstream: path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay-v2.json',
    ),
    common8: path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    ),
    common9: path.join(
      root,
      'logs',
      'opendart-corporate-action-multi-event-audit-v9-9-9-common-stock-scope.json',
    ),
    common10: path.join(
      root,
      'logs',
      'opendart-corporate-action-cumulative-factor-preview-v9-9-10-common-stock-scope.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-multi-event-cumulative-reuse-v9-9-9-10-common-stock-replay.json',
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
    docs.upstream.version === UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstream.version}`,
  );

  assert(
    docs.upstream.status === UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstream.status}`,
  );

  assert(
    docs.upstream.conclusion
      ?.safeToAdvanceToHistoricalV999_10ReuseAudit === true,
    'UPSTREAM_NOT_READY',
  );

  const rows8 = common8Rows(docs.common8);

  assert(
    rows8.length === 6,
    `COMMON8_EXPECTED_6_ROWS_GOT_${rows8.length}`,
  );

  const mapped8 = rows8.map((row) => ({
    ...identityFromRow(row),
    factorStatus: factorStatus(row),
    ...factorValues(row),
  }));

  const factorReady8 =
    mapped8.filter(
      (row) => row.factorStatus === 'FACTOR_READY',
    );

  const future8 =
    mapped8.filter(
      (row) => row.factorStatus === 'FUTURE_PENDING',
    );

  const structural8 =
    mapped8.filter(
      (row) => row.factorStatus === 'STRUCTURAL_BLOCKED',
    );

  const issues = [];

  if (factorReady8.length !== EXPECTED_FACTOR_READY) {
    issues.push({
      check: 'common8.factorReady',
      actual: factorReady8.length,
      expected: EXPECTED_FACTOR_READY,
    });
  }

  if (future8.length !== EXPECTED_FUTURE_PENDING) {
    issues.push({
      check: 'common8.futurePending',
      actual: future8.length,
      expected: EXPECTED_FUTURE_PENDING,
    });
  }

  if (structural8.length !== EXPECTED_STRUCTURAL) {
    issues.push({
      check: 'common8.structuralBlocked',
      actual: structural8.length,
      expected: EXPECTED_STRUCTURAL,
    });
  }

  const expectedFactorReadyKeys =
    new Set([
      '20260708900804|032080|REVERSE_SPLIT',
      '20261002900309|039830|CASH_DIVIDEND',
    ]);

  const actualFactorReadyKeys =
    new Set(
      factorReady8.map(keyOfIdentity),
    );

  const missingFactorReady =
    [...expectedFactorReadyKeys]
      .filter(
        (key) => !actualFactorReadyKeys.has(key),
      );

  const unexpectedFactorReady =
    [...actualFactorReadyKeys]
      .filter(
        (key) => !expectedFactorReadyKeys.has(key),
      );

  if (
    missingFactorReady.length > 0 ||
    unexpectedFactorReady.length > 0
  ) {
    issues.push({
      check: 'common8.factorReadyIdentitySet',
      missing: missingFactorReady,
      unexpected: unexpectedFactorReady,
    });
  }

  for (const row of factorReady8) {
    if (
      !(row.eventPriceFactor > 0) ||
      !(row.eventShareFactor > 0)
    ) {
      issues.push({
        check: 'common8.factorReadyPositiveFactors',
        row,
      });
    }
  }

  // ------------------------------------------------------------------
  // V9.9.9 multi-event audit
  // ------------------------------------------------------------------

  if (badStatus(docs.common9.status)) {
    issues.push({
      check: 'common9.status',
      actual: docs.common9.status,
      expected: 'MULTI_EVENT_AUDIT_COMPLETE',
    });
  }

  const count9 = {
    factorReadyEvents:
      topCount(docs.common9, 'factorReadyEvents'),
    distinctStocks:
      topCount(docs.common9, 'distinctStocks'),
    singleEventStocks:
      topCount(docs.common9, 'singleEventStocks'),
    multiEventStocks:
      topCount(docs.common9, 'multiEventStocks'),
    sameDateCollisionGroups:
      topCount(
        docs.common9,
        'sameDateCollisionGroups',
        'collisionGroups',
      ),
    invalidFactorEvents:
      topCount(docs.common9, 'invalidFactorEvents'),
  };

  const expected9 = {
    factorReadyEvents: 2,
    distinctStocks: 2,
    singleEventStocks: 2,
    multiEventStocks: 0,
    sameDateCollisionGroups: 0,
    invalidFactorEvents: 0,
  };

  for (const [field, expected] of Object.entries(expected9)) {
    const actual = count9[field];

    // If an optional count is not emitted, don't invent a schema blocker.
    if (actual !== null && actual !== expected) {
      issues.push({
        check: `common9.${field}`,
        actual,
        expected,
      });
    }
  }

  if (
    count9.factorReadyEvents === null ||
    count9.distinctStocks === null ||
    count9.multiEventStocks === null ||
    count9.invalidFactorEvents === null
  ) {
    issues.push({
      check: 'common9.requiredCountsMissing',
      counts: count9,
    });
  }

  const writes9 = safetyWrites(docs.common9);

  if (writes9 !== null && writes9 !== 0) {
    issues.push({
      check: 'common9.databaseWrites',
      actual: writes9,
      expected: 0,
    });
  }

  // ------------------------------------------------------------------
  // V9.9.10 cumulative preview
  // ------------------------------------------------------------------

  if (
    docs.common10.status !==
    'SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW_PROVEN'
  ) {
    issues.push({
      check: 'common10.status',
      actual: docs.common10.status,
      expected:
        'SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW_PROVEN',
    });
  }

  const count10 = {
    inputFactorReadyEvents:
      topCount(docs.common10, 'inputFactorReadyEvents'),
    runRows:
      topCount(docs.common10, 'runRows'),
    factorRows:
      topCount(docs.common10, 'factorRows'),
    distinctStocks:
      topCount(docs.common10, 'distinctStocks'),
    uniqueRunIds:
      topCount(docs.common10, 'uniqueRunIds'),
    uniqueFactorIdentities:
      topCount(docs.common10, 'uniqueFactorIdentities'),
    multiEventStocksDetected:
      topCount(docs.common10, 'multiEventStocksDetected'),
    futurePendingPreserved:
      topCount(docs.common10, 'futurePendingPreserved'),
    structuralBlockedPreserved:
      topCount(docs.common10, 'structuralBlockedPreserved'),
  };

  const expected10 = {
    inputFactorReadyEvents: 2,
    runRows: 2,
    factorRows: 2,
    distinctStocks: 2,
    uniqueRunIds: 2,
    uniqueFactorIdentities: 2,
    multiEventStocksDetected: 0,
    futurePendingPreserved: 1,
    structuralBlockedPreserved: 3,
  };

  for (const [field, expected] of Object.entries(expected10)) {
    const actual = count10[field];

    if (actual !== expected) {
      issues.push({
        check: `common10.${field}`,
        actual,
        expected,
      });
    }
  }

  const expectedChecks = [
    'cumulativeEqualsEvent',
    'positiveCumulativeFactors',
    'allSingleEvent',
    'noMultiEventStocks',
    'noSameDateCollisions',
  ];

  const check10 = {};

  for (const name of expectedChecks) {
    check10[name] = boolCheck(docs.common10, name);

    if (!check10[name]) {
      issues.push({
        check: `common10.checks.${name}`,
        actual:
          docs.common10.checks?.[name] ?? null,
        expected: true,
      });
    }
  }

  const actionTypeCounts10 =
    docs.common10.actionTypeCounts ??
    docs.common10.counts?.actionTypeCounts ??
    {};

  const expectedActionTypeCounts10 = {
    CASH_DIVIDEND: 1,
    REVERSE_SPLIT: 1,
  };

  for (const [action, expected] of Object.entries(expectedActionTypeCounts10)) {
    if (Number(actionTypeCounts10[action] ?? 0) !== expected) {
      issues.push({
        check: `common10.actionTypeCounts.${action}`,
        actual: Number(actionTypeCounts10[action] ?? 0),
        expected,
      });
    }
  }

  for (const action of Object.keys(actionTypeCounts10)) {
    if (
      !Object.prototype.hasOwnProperty.call(
        expectedActionTypeCounts10,
        action,
      ) &&
      Number(actionTypeCounts10[action] ?? 0) !== 0
    ) {
      issues.push({
        check: 'common10.unexpectedFactorReadyActionType',
        actionType: action,
        count: Number(actionTypeCounts10[action]),
      });
    }
  }

  const cumulativeRaw =
    cumulativeRows(docs.common10);

  const cumulative =
    cumulativeRaw.map(cumulativeView);

  const cumulativePositive =
    cumulative.every(
      (row) =>
        row.eventPriceFactor > 0 &&
        row.eventShareFactor > 0 &&
        row.cumulativePriceFactor > 0 &&
        row.cumulativeShareFactor > 0,
    );

  const cumulativeEqualsEvent =
    cumulative.every(
      (row) =>
        row.eventPriceFactor === row.cumulativePriceFactor &&
        row.eventShareFactor === row.cumulativeShareFactor,
    );

  if (
    cumulative.length > 0 &&
    cumulative.length !== 2
  ) {
    issues.push({
      check: 'common10.cumulativeRowCount',
      actual: cumulative.length,
      expected: 2,
    });
  }

  if (cumulative.length > 0 && !cumulativePositive) {
    issues.push({
      check: 'common10.cumulativeRowsPositive',
      actual: false,
      expected: true,
      rows: cumulative,
    });
  }

  if (cumulative.length > 0 && !cumulativeEqualsEvent) {
    issues.push({
      check: 'common10.cumulativeEqualsEventRows',
      actual: false,
      expected: true,
      rows: cumulative,
    });
  }

  // If cumulative row identity is exposed, require it to be exactly the
  // factor-ready set from common8.
  const cumulativeWithFullIdentity =
    cumulative.filter(
      (row) =>
        row.providerEventId &&
        row.stockCode &&
        row.actionType,
    );

  if (cumulativeWithFullIdentity.length > 0) {
    const cumulativeKeys =
      new Set(
        cumulativeWithFullIdentity.map(keyOfIdentity),
      );

    const missing =
      [...expectedFactorReadyKeys]
        .filter(
          (key) => !cumulativeKeys.has(key),
        );

    const unexpected =
      [...cumulativeKeys]
        .filter(
          (key) => !expectedFactorReadyKeys.has(key),
        );

    if (
      missing.length > 0 ||
      unexpected.length > 0
    ) {
      issues.push({
        check: 'common10.cumulativeIdentitySet',
        missing,
        unexpected,
      });
    }
  }

  const writes10 = safetyWrites(docs.common10);

  if (writes10 !== null && writes10 !== 0) {
    issues.push({
      check: 'common10.databaseWrites',
      actual: writes10,
      expected: 0,
    });
  }

  if (
    Number(docs.common10.networkRequests ?? 0) !== 0
  ) {
    issues.push({
      check: 'common10.networkRequests',
      actual: docs.common10.networkRequests,
      expected: 0,
    });
  }

  if (docs.common10.productionApplied === true) {
    issues.push({
      check: 'common10.productionApplied',
      actual: true,
      expected: false,
    });
  }

  if (docs.common10.canonicalAdjustedBarsMutated === true) {
    issues.push({
      check: 'common10.canonicalAdjustedBarsMutated',
      actual: true,
      expected: false,
    });
  }

  // 028080 remains entirely separate.
  const any028080 =
    mapped8.some((row) => row.stockCode === '028080') ||
    cumulative.some((row) => row.stockCode === '028080');

  if (any028080) {
    issues.push({
      check: '028080InjectedIntoV99MultiEventOrCumulativeBranch',
      actual: true,
      expected: false,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_9_10_COMMON_STOCK_MULTI_EVENT_CUMULATIVE_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_9_10_COMMON_STOCK_MULTI_EVENT_CUMULATIVE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      upstreamVersion:
        docs.upstream.version,
      upstreamFingerprint:
        docs.upstream.outputFingerprint ?? null,
      common8Version:
        docs.common8.version ?? null,
      common8Fingerprint:
        docs.common8.outputFingerprint ?? null,
      common9Version:
        docs.common9.version ?? null,
      common9Fingerprint:
        docs.common9.outputFingerprint ?? null,
      common10Version:
        docs.common10.version ?? null,
      common10Fingerprint:
        docs.common10.outputFingerprint ?? null,
    },

    counts: {
      common8Rows: mapped8.length,
      common8FactorReady: factorReady8.length,
      common8FuturePending: future8.length,
      common8StructuralBlocked: structural8.length,

      common9FactorReadyEvents: count9.factorReadyEvents,
      common9DistinctStocks: count9.distinctStocks,
      common9SingleEventStocks: count9.singleEventStocks,
      common9MultiEventStocks: count9.multiEventStocks,
      common9SameDateCollisionGroups: count9.sameDateCollisionGroups,
      common9InvalidFactorEvents: count9.invalidFactorEvents,

      common10InputFactorReadyEvents: count10.inputFactorReadyEvents,
      common10RunRows: count10.runRows,
      common10FactorRows: count10.factorRows,
      common10DistinctStocks: count10.distinctStocks,
      common10UniqueRunIds: count10.uniqueRunIds,
      common10UniqueFactorIdentities: count10.uniqueFactorIdentities,
      common10MultiEventStocksDetected: count10.multiEventStocksDetected,
      common10FuturePendingPreserved: count10.futurePendingPreserved,
      common10StructuralBlockedPreserved: count10.structuralBlockedPreserved,

      cumulativeRowsExposed: cumulative.length,

      issues: issues.length,
    },

    common8Disposition: {
      factorReady: factorReady8,
      futurePending: future8,
      structuralBlocked: structural8,
    },

    common9: {
      status: docs.common9.status ?? null,
      counts: count9,
      databaseWrites: writes9,
    },

    common10: {
      status: docs.common10.status ?? null,
      counts: count10,
      checks: check10,
      actionTypeCounts: actionTypeCounts10,
      cumulativeRows: cumulative,
      cumulativeRowsPositive:
        cumulative.length === 0
          ? null
          : cumulativePositive,
      cumulativeRowsEqualEvent:
        cumulative.length === 0
          ? null
          : cumulativeEqualsEvent,
      databaseWrites: writes10,
      networkRequests:
        Number(docs.common10.networkRequests ?? 0),
      productionApplied:
        docs.common10.productionApplied ?? null,
      canonicalAdjustedBarsMutated:
        docs.common10.canonicalAdjustedBarsMutated ?? null,
    },

    issues,

    conclusion: {
      historicalV999MultiEventAuditReusable:
        reusable,

      historicalV9910CumulativePreviewReusable:
        reusable,

      exactlyTwoFactorReadyStocks:
        factorReady8.length === 2,

      factorReadyIdentitySetExact:
        missingFactorReady.length === 0 &&
        unexpectedFactorReady.length === 0,

      noMultiEventStocks:
        count9.multiEventStocks === 0 &&
        count10.multiEventStocksDetected === 0,

      noSameDateCollisions:
        check10.noSameDateCollisions === true,

      cumulativeEqualsEvent:
        check10.cumulativeEqualsEvent === true,

      futureAndStructuralDispositionPreserved:
        count10.futurePendingPreserved === 1 &&
        count10.structuralBlockedPreserved === 3,

      safeToAdvanceToHistoricalV9910_1_2_1_3StructuralDateReuseAudit:
        reusable,

      networkRefetchRequiredNow: false,
      databaseWriteRequiredNow: false,

      physical028080RepairStillSeparate: true,
      physical028080RepairAddedToIncrementalBranch: false,
    },

    safety: {
      networkRequestsNow: 0,
      databaseReadsNow: 0,
      databaseWritesNow: 0,
      productionAppliedNow: false,
      coverageWindowAdvancedNow: false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-multi-event-cumulative-reuse-v9-9-9-10-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        counts: report.counts,
        common8Disposition: report.common8Disposition,
        common9: report.common9,
        common10: report.common10,
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

        ...report.counts,

        factorReady: report.common8Disposition.factorReady,
        futurePending: report.common8Disposition.futurePending,
        structuralBlocked: report.common8Disposition.structuralBlocked,

        common10Checks: report.common10.checks,
        common10ActionTypeCounts: report.common10.actionTypeCounts,

        issues: report.issues,
        conclusion: report.conclusion,

        networkRequestsNow: 0,
        databaseWritesNow: 0,

        nextGate: report.nextGate,
        outputFile: report.outputFile,
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
          'HISTORICAL_V9_9_9_10_COMMON_STOCK_REUSE_AUDIT_FAILED',
        version: VERSION,
        error:
          String(error?.message ?? error),
        networkRequestsNow: 0,
        databaseWritesNow: 0,
        productionAppliedNow: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
