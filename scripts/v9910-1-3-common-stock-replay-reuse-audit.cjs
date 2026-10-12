#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.10.1 / 10.2.1 / 10.3 common-stock structural-date reuse audit
 *
 * READ ONLY.
 *
 * Validates the authoritative structural-date branch for the three
 * structural rows in the six-row V9.9 common-stock batch:
 *   - 001570 SPIN_OFF
 *   - 043910 MERGER
 *   - 469480 MERGER
 *
 * Contract:
 * - all three remain STRUCTURAL_BLOCKED for factor purposes,
 * - 10.1 / 10.2.1 / 10.3 preserve the same structural identities,
 * - 10.3 assigns a valid canonical effective date to each structural row,
 * - all three dates are after evidence snapshot 2026-10-01, matching the
 *   downstream historical contract of 3 future structural rows,
 * - no generic structural factor is created,
 * - no DB writes,
 * - 028080 remains outside this V9.9 incremental branch.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_10_1_10_2_1_10_3_REPLAY_READ_ONLY_COMMON_STOCK_STRUCTURAL_DATE_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_9_10_REPLAY_READ_ONLY_COMMON_STOCK_MULTI_EVENT_CUMULATIVE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_9_10_COMMON_STOCK_MULTI_EVENT_CUMULATIVE_RESULTS_REUSABLE';

const SNAPSHOT_AS_OF = '2026-10-01';

const EXPECTED_STRUCTURAL = new Map([
  ['001570', 'SPIN_OFF'],
  ['043910', 'MERGER'],
  ['469480', 'MERGER'],
]);

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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
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
  const values = [
    doc?.databaseWrites,
    doc?.safety?.databaseWrites,
    doc?.safety?.writesPerformed,
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

function recursiveObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;

  if (!Array.isArray(value)) out.push(value);

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      recursiveObjects(child, out);
    }
  }

  return out;
}

function identity(row) {
  const cp = row?.canonicalPreview ?? {};
  const fv = row?.factorValidation ?? {};
  const finalRow = row?.finalRow ?? {};
  const finalCp = finalRow?.canonicalPreview ?? {};

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
        finalRow.providerEventId,
        finalRow.provider_event_id,
        finalCp.provider_event_id,
      ),
    ),
    stockCode: normalizeStock(
      firstNonEmpty(
        row.stockCode,
        row.stock_code,
        cp.stock_code,
        fv.stockCode,
        fv.stock_code,
        finalRow.stockCode,
        finalRow.stock_code,
        finalCp.stock_code,
      ),
    ),
    actionType: normalizeAction(
      firstNonEmpty(
        row.actionType,
        row.action_type,
        cp.action_type,
        fv.actionType,
        fv.action_type,
        finalRow.actionType,
        finalRow.action_type,
        finalCp.action_type,
      ),
    ),
    sourceReceiptNo: normalizeReceipt(
      firstNonEmpty(
        row.sourceReceiptNo,
        row.source_receipt_no,
        row.receiptNo,
        row.receipt_no,
        cp.metadata?.source_receipt_no,
        finalRow.sourceReceiptNo,
        finalRow.source_receipt_no,
        finalCp.metadata?.source_receipt_no,
      ),
    ),
  };
}

function keyOf(row) {
  const id = identity(row);
  return [
    id.providerEventId,
    id.stockCode,
    id.actionType,
  ].join('|');
}

function isExpectedStructuralIdentity(id) {
  return (
    EXPECTED_STRUCTURAL.get(id.stockCode) === id.actionType
  );
}

function structuralObjects(doc) {
  const seen = new Set();
  const out = [];

  for (const obj of recursiveObjects(doc)) {
    const id = identity(obj);

    if (!isExpectedStructuralIdentity(id)) continue;

    const key = keyOf(obj);
    if (!id.providerEventId) continue;

    const signature = `${key}|${id.sourceReceiptNo}|${JSON.stringify(obj)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    out.push({ obj, id, key });
  }

  return out;
}

function uniqueIdentityMap(doc) {
  const map = new Map();

  for (const row of structuralObjects(doc)) {
    if (!map.has(row.key)) {
      map.set(row.key, row);
    }
  }

  return map;
}

function extractEffectiveDate(obj) {
  const cp = obj?.canonicalPreview ?? {};
  const finalRow = obj?.finalRow ?? {};
  const finalCp = finalRow?.canonicalPreview ?? {};

  return firstNonEmpty(
    finalCp.effective_date,
    finalCp.effectiveDate,
    finalRow.effective_date,
    finalRow.effectiveDate,
    cp.effective_date,
    cp.effectiveDate,
    obj.effective_date,
    obj.effectiveDate,
    obj.strongestCandidate?.date,
    obj.primaryDateCandidate,
  );
}

function extractFactorStatus(obj) {
  return String(
    firstNonEmpty(
      obj.factorValidation?.status,
      obj.factor_validation?.status,
      obj.factorStatus,
      obj.factor_status,
      obj.canonicalPreview?.metadata?.factor_status,
      obj.finalRow?.factorValidation?.status,
      obj.finalRow?.factor_status,
      obj.finalRow?.canonicalPreview?.metadata?.factor_status,
    ) ?? '',
  ).toUpperCase();
}

function extractResolution(obj) {
  return {
    status: firstNonEmpty(
      obj.effectiveDateResolution?.status,
      obj.resolution?.status,
      obj.resolutionStatus,
      obj.status,
    ),
    reason: firstNonEmpty(
      obj.effectiveDateResolution?.reason,
      obj.resolution?.reason,
      obj.resolutionReason,
      obj.reason,
    ),
    basis: firstNonEmpty(
      obj.strongestCandidate?.basis,
      obj.basis,
      obj.dateBasis,
      obj.date_basis,
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

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    upstream: path.join(
      root,
      'logs',
      'opendart-corporate-action-multi-event-cumulative-reuse-v9-9-9-10-common-stock-replay.json',
    ),
    factor8: path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    ),
    audit101: path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-audit-v9-9-10-1-common-stock-scope.json',
    ),
    probe1021: path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-probe-v9-9-10-2-1-common-stock-scope.json',
    ),
    final103: path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-reuse-v9-9-10-1-10-2-1-10-3-common-stock-replay.json',
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
      ?.safeToAdvanceToHistoricalV9910_1_2_1_3StructuralDateReuseAudit === true,
    'UPSTREAM_NOT_READY',
  );

  const issues = [];

  // ------------------------------------------------------------------
  // Structural identity source from common8.
  // ------------------------------------------------------------------

  const factorRows = Array.isArray(docs.factor8.results)
    ? docs.factor8.results
    : [];

  const structuralFactorRows = factorRows
    .map((row) => ({
      ...identity(row),
      factorStatus: extractFactorStatus(row),
    }))
    .filter((row) => isExpectedStructuralIdentity(row));

  if (structuralFactorRows.length !== 3) {
    issues.push({
      check: 'factor8.structuralIdentityCount',
      actual: structuralFactorRows.length,
      expected: 3,
    });
  }

  for (const row of structuralFactorRows) {
    if (row.factorStatus !== 'STRUCTURAL_BLOCKED') {
      issues.push({
        check: 'factor8.structuralMustRemainBlocked',
        row,
        expected: 'STRUCTURAL_BLOCKED',
      });
    }
  }

  const expectedKeys = new Set(
    structuralFactorRows.map((row) => [
      row.providerEventId,
      row.stockCode,
      row.actionType,
    ].join('|')),
  );

  // ------------------------------------------------------------------
  // Stage status/write safety.
  // ------------------------------------------------------------------

  const stageStatus = {};

  for (const name of ['audit101', 'probe1021', 'final103']) {
    const doc = docs[name];
    const writes = safetyWrites(doc);

    stageStatus[name] = {
      version: doc.version ?? null,
      status: doc.status ?? null,
      databaseWrites: writes,
      outputFingerprint: doc.outputFingerprint ?? null,
    };

    if (badStatus(doc.status)) {
      issues.push({
        check: `${name}.status`,
        actual: doc.status ?? null,
        expected: 'NON_FAILED_NON_BLOCKED',
      });
    }

    if (writes !== null && writes !== 0) {
      issues.push({
        check: `${name}.databaseWrites`,
        actual: writes,
        expected: 0,
      });
    }
  }

  // ------------------------------------------------------------------
  // Identity coverage through 10.1 / 10.2.1 / 10.3.
  // ------------------------------------------------------------------

  const maps = {
    audit101: uniqueIdentityMap(docs.audit101),
    probe1021: uniqueIdentityMap(docs.probe1021),
    final103: uniqueIdentityMap(docs.final103),
  };

  const identityCoverage = {};

  for (const [stage, map] of Object.entries(maps)) {
    const present = [...expectedKeys].filter((key) => map.has(key));
    const missing = [...expectedKeys].filter((key) => !map.has(key));
    const unexpected = [...map.keys()].filter((key) => !expectedKeys.has(key));

    identityCoverage[stage] = {
      expected: expectedKeys.size,
      present: present.length,
      missing,
      unexpected,
    };

    if (missing.length > 0) {
      issues.push({
        check: `${stage}.missingStructuralIdentities`,
        missing,
      });
    }

    if (unexpected.length > 0) {
      issues.push({
        check: `${stage}.unexpectedStructuralIdentities`,
        unexpected,
      });
    }
  }

  // ------------------------------------------------------------------
  // Finalization semantics.
  // ------------------------------------------------------------------

  const finalizedStructural = [];

  for (const key of expectedKeys) {
    const holder = maps.final103.get(key);

    if (!holder) continue;

    const date = extractEffectiveDate(holder.obj);
    const factorStatus = extractFactorStatus(holder.obj);
    const resolution = extractResolution(holder.obj);
    const id = holder.id;

    const row = {
      ...id,
      effectiveDate: date === null ? null : String(date),
      factorStatus: factorStatus || null,
      resolution,
      validIsoDate: isIsoDate(date),
      futureAtSnapshot:
        isIsoDate(date) && String(date) > SNAPSHOT_AS_OF,
    };

    finalizedStructural.push(row);

    if (!row.validIsoDate) {
      issues.push({
        check: 'final103.structuralEffectiveDateRequired',
        row,
      });
    }

    if (row.validIsoDate && !row.futureAtSnapshot) {
      issues.push({
        check: 'final103.structuralDateExpectedFutureAtSnapshot',
        row,
        snapshotAsOf: SNAPSHOT_AS_OF,
      });
    }

    // If the finalization artifact exposes factor status, it must remain
    // structural-blocked. If omitted, common8 already proves this contract.
    if (
      row.factorStatus &&
      row.factorStatus !== 'STRUCTURAL_BLOCKED'
    ) {
      issues.push({
        check: 'final103.structuralFactorStatusChanged',
        row,
        expected: 'STRUCTURAL_BLOCKED',
      });
    }
  }

  if (finalizedStructural.length !== 3) {
    issues.push({
      check: 'final103.finalizedStructuralCount',
      actual: finalizedStructural.length,
      expected: 3,
    });
  }

  const actionTypeCounts = countActions(finalizedStructural);

  if (Number(actionTypeCounts.MERGER ?? 0) !== 2) {
    issues.push({
      check: 'final103.mergerCount',
      actual: Number(actionTypeCounts.MERGER ?? 0),
      expected: 2,
    });
  }

  if (Number(actionTypeCounts.SPIN_OFF ?? 0) !== 1) {
    issues.push({
      check: 'final103.spinOffCount',
      actual: Number(actionTypeCounts.SPIN_OFF ?? 0),
      expected: 1,
    });
  }

  // ------------------------------------------------------------------
  // Generic factor creation must remain absent for structural events.
  // ------------------------------------------------------------------

  const structuralGenericFactorLeak = recursiveObjects(docs.final103)
    .filter((obj) => {
      const id = identity(obj);
      if (!isExpectedStructuralIdentity(id)) return false;

      const factorCandidates = [
        obj.event_price_factor,
        obj.eventPriceFactor,
        obj.cumulative_price_factor,
        obj.cumulativePriceFactor,
        obj.factor?.eventPriceFactor,
        obj.factor?.event_price_factor,
      ];

      return factorCandidates.some(
        (value) => Number(value) > 0,
      );
    });

  if (structuralGenericFactorLeak.length > 0) {
    issues.push({
      check: 'final103.genericStructuralFactorLeak',
      rows: structuralGenericFactorLeak.map(identity),
    });
  }

  // 028080 must remain a separate V9.8 virtual repair overlay.
  const contains028080 = ['audit101', 'probe1021', 'final103']
    .some((name) =>
      recursiveObjects(docs[name]).some(
        (obj) => normalizeStock(
          firstNonEmpty(
            obj.stockCode,
            obj.stock_code,
            obj.canonicalPreview?.stock_code,
          ),
        ) === '028080',
      ),
    );

  if (contains028080) {
    issues.push({
      check: '028080InjectedIntoV99StructuralDateBranch',
      actual: true,
      expected: false,
    });
  }

  const allThreeFuture =
    finalizedStructural.length === 3 &&
    finalizedStructural.every((row) => row.futureAtSnapshot);

  const reusable = issues.length === 0;

  const status = reusable
    ? 'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_RESULTS_REUSABLE'
    : 'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,
    evidenceSnapshotAsOf: SNAPSHOT_AS_OF,

    source: {
      upstreamVersion: docs.upstream.version,
      upstreamFingerprint: docs.upstream.outputFingerprint ?? null,
      factor8Version: docs.factor8.version ?? null,
      audit101Version: docs.audit101.version ?? null,
      probe1021Version: docs.probe1021.version ?? null,
      final103Version: docs.final103.version ?? null,
    },

    counts: {
      structuralFactorRows: structuralFactorRows.length,
      expectedStructuralIdentities: expectedKeys.size,
      audit101StructuralIdentitiesPresent:
        identityCoverage.audit101.present,
      probe1021StructuralIdentitiesPresent:
        identityCoverage.probe1021.present,
      final103StructuralIdentitiesPresent:
        identityCoverage.final103.present,
      finalizedStructuralRows: finalizedStructural.length,
      mergerRows: Number(actionTypeCounts.MERGER ?? 0),
      spinOffRows: Number(actionTypeCounts.SPIN_OFF ?? 0),
      validFinalEffectiveDates:
        finalizedStructural.filter((row) => row.validIsoDate).length,
      futureStructuralAtSnapshot:
        finalizedStructural.filter((row) => row.futureAtSnapshot).length,
      structuralGenericFactorLeaks:
        structuralGenericFactorLeak.length,
      issues: issues.length,
    },

    identityCoverage,
    finalizedStructural,
    actionTypeCounts,
    stageStatus,
    issues,

    conclusion: {
      historicalV9910_1StructuralAuditReusable: reusable,
      historicalV9910_2_1StructuralProbeReusable: reusable,
      historicalV9910_3StructuralFinalizationReusable: reusable,

      structuralIdentityStableAcrossBranch:
        reusable &&
        Object.values(identityCoverage)
          .every((row) =>
            row.missing.length === 0 &&
            row.unexpected.length === 0,
          ),

      allThreeStructuralDatesFinalized: reusable,
      allThreeStructuralRowsFutureAt2026_10_01:
        reusable && allThreeFuture,

      genericStructuralFactorsRemainBlocked:
        reusable && structuralGenericFactorLeak.length === 0,

      safeToAdvanceToHistoricalV9_9_11_4_5_5_1ReuseAudit:
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

    nextGate: reusable
      ? 'AUDIT_HISTORICAL_V9_9_11_4_11_5_11_5_1_COMMON_STOCK_REUSE'
      : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-structural-date-reuse-v9-9-10-1-10-2-1-10-3-common-stock-replay.json',
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      evidenceSnapshotAsOf: report.evidenceSnapshotAsOf,
      counts: report.counts,
      identityCoverage: report.identityCoverage,
      finalizedStructural: report.finalizedStructural,
      stageStatus: report.stageStatus,
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
        evidenceSnapshotAsOf: report.evidenceSnapshotAsOf,
        ...report.counts,
        finalizedStructural: report.finalizedStructural,
        stageStatus: report.stageStatus,
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
          'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_REUSE_AUDIT_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
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
