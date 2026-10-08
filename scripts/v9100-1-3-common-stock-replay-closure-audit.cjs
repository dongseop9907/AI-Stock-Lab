#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.10.1 / 10.2 / 10.2.1 / 10.3 common-stock replay closure audit
 *
 * READ ONLY / LOCAL ARTIFACTS ONLY.
 *
 * Purpose:
 *   Prove that the historical V9.10 incremental boundary after the
 *   V9.9 cycle closure remains internally consistent after the upstream
 *   V9.8/V9.9 replay repair.
 *
 * This audit does NOT:
 *   - call OpenDART
 *   - call KIS
 *   - read/write Supabase
 *   - advance a coverage marker
 *   - physically repair 028080
 *
 * It checks:
 *   V9.9 closure (2026-10-04)
 *       ->
 *   V9.10.1 incremental inventory
 *       ->
 *   V9.10.2 detail workset
 *       ->
 *   V9.10.2.1 carry-forward reconciliation
 *       ->
 *   V9.10.3 cycle closure
 *
 * The audit intentionally derives counts from the artifacts rather than
 * hard-coding a guessed V9.10 candidate count.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_10_1_2_2_1_3_REPLAY_READ_ONLY_COMMON_STOCK_CYCLE_CLOSURE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_11_10_TO_13_REPLAY_READ_ONLY_COMMON_STOCK_REFRESH_CLOSURE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_RESULTS_REUSABLE';

const PRIOR_SNAPSHOT = '2026-10-04';
const NEXT_DAY = '2026-10-05';

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

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.counts?.[name],
      doc?.summary?.[name],
      doc?.accounting?.[name],
      doc?.closure?.[name],
      doc?.safety?.[name],
    ];

    for (const value of values) {
      const n = toNumber(value);
      if (n !== null) return n;
    }
  }

  return null;
}

function boolField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.safety?.[name],
      doc?.closure?.[name],
      doc?.coverageCandidate?.[name],
    ];

    for (const value of values) {
      if (typeof value === 'boolean') return value;
    }
  }

  return null;
}

function arrayField(doc, ...names) {
  for (const name of names) {
    const value = doc?.[name];

    if (Array.isArray(value)) return value;
  }

  return [];
}

function nestedArrays(value, pathParts = [], out = []) {
  if (!value || typeof value !== 'object') return out;

  if (Array.isArray(value)) {
    out.push({
      path: pathParts.join('.'),
      rows: value,
    });

    for (let i = 0; i < value.length; i++) {
      nestedArrays(
        value[i],
        [...pathParts, String(i)],
        out,
      );
    }

    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      nestedArrays(
        child,
        [...pathParts, key],
        out,
      );
    }
  }

  return out;
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

function identity(row) {
  return {
    providerEventId:
      normalizeReceipt(
        firstNonEmpty(
          row?.providerEventId,
          row?.provider_event_id,
          row?.rootReceiptNo,
          row?.root_receipt_no,
          row?.receiptNo,
          row?.receipt_no,
          row?.providerEvent?.id,
        ),
      ),

    stockCode:
      normalizeStock(
        firstNonEmpty(
          row?.stockCode,
          row?.stock_code,
          row?.symbol,
        ),
      ),

    actionType:
      normalizeAction(
        firstNonEmpty(
          row?.actionType,
          row?.action_type,
          row?.candidateActionType,
          row?.candidate_action_type,
        ),
      ),
  };
}

function keyOf(row) {
  const id = identity(row);

  if (
    !id.providerEventId ||
    !id.stockCode ||
    !id.actionType
  ) {
    return null;
  }

  return [
    id.providerEventId,
    id.stockCode,
    id.actionType,
  ].join('|');
}

function identitySet(rows) {
  return new Set(
    rows
      .map(keyOf)
      .filter(Boolean),
  );
}

function setDiff(a, b) {
  return [...a]
    .filter((value) => !b.has(value))
    .sort();
}

function union(...sets) {
  return new Set(
    sets.flatMap((s) => [...s]),
  );
}

function collectIdentityArrays(doc) {
  return nestedArrays(doc)
    .map(({ path, rows }) => {
      const ids = identitySet(rows);

      return {
        path,
        rawRows: rows.length,
        identityRows: ids.size,
        identities: ids,
      };
    })
    .filter((x) => x.identityRows > 0);
}

function reportedProblems(doc) {
  const found = [];

  const candidates = [
    ['issues', doc?.issues],
    ['blockers', doc?.blockers],
    ['errors', doc?.errors],
    ['failures', doc?.failures],
    ['conflicts', doc?.conflicts],
    ['unaccounted', doc?.unaccounted],
  ];

  for (const [field, value] of candidates) {
    if (Array.isArray(value) && value.length > 0) {
      found.push({
        field,
        count: value.length,
        sample: value.slice(0, 3),
      });
    }
  }

  return found;
}

function isBadStatus(status) {
  const s = String(status ?? '').toUpperCase();

  return (
    !s ||
    s.includes('FAILED') ||
    s.includes('INVALID') ||
    s.includes('BLOCKED')
  );
}

function extractCarryForwardArrays(doc) {
  const cf = doc?.carryForward ?? doc?.carry_forward ?? {};

  const categoryNames = [
    ['futureRatioActions', 'FUTURE_RATIO'],
    ['futureStructuralActions', 'FUTURE_STRUCTURAL'],
    ['futureCashDividends', 'FUTURE_CASH'],
    ['futureCashDividend', 'FUTURE_CASH'],
    ['futureRatio', 'FUTURE_RATIO'],
    ['futureStructural', 'FUTURE_STRUCTURAL'],
    ['futureCash', 'FUTURE_CASH'],
  ];

  const rows = [];

  for (const [name, category] of categoryNames) {
    const value = cf?.[name];

    if (Array.isArray(value)) {
      for (const row of value) {
        rows.push({
          category,
          row,
          key: keyOf(row),
        });
      }
    } else if (
      value &&
      typeof value === 'object'
    ) {
      rows.push({
        category,
        row: value,
        key: keyOf(value),
      });
    }
  }

  // Fallback: reconciliation artifacts may expose normalized carry rows
  // under queues / carryForwardRows.
  for (const arr of nestedArrays(doc)) {
    if (
      !/carry/i.test(arr.path) ||
      /reconfirmation/i.test(arr.path)
    ) {
      continue;
    }

    for (const row of arr.rows) {
      const key = keyOf(row);

      if (!key) continue;

      const category =
        String(
          firstNonEmpty(
            row?.category,
            row?.carryCategory,
            row?.carry_category,
          ) ?? 'UNCLASSIFIED',
        ).toUpperCase();

      rows.push({
        category,
        row,
        key,
      });
    }
  }

  const dedup = new Map();

  for (const item of rows) {
    if (!item.key) continue;

    const dedupKey =
      `${item.category}|${item.key}`;

    if (!dedup.has(dedupKey)) {
      dedup.set(dedupKey, item);
    }
  }

  return [...dedup.values()];
}

function categoryCounts(items) {
  const counts = {};

  for (const item of items) {
    counts[item.category] =
      (counts[item.category] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
  );
}

function stageSummary(doc) {
  return {
    version: doc?.version ?? null,
    status: doc?.status ?? null,
    startDate:
      firstNonEmpty(
        doc?.startDate,
        doc?.fromDate,
        doc?.coverageStartDate,
        doc?.source?.startDate,
      ),

    throughDate:
      firstNonEmpty(
        doc?.throughDate,
        doc?.endDate,
        doc?.toDate,
        doc?.coverageThroughDate,
        doc?.source?.throughDate,
      ),

    evidenceSnapshotAsOf:
      firstNonEmpty(
        doc?.evidenceSnapshotAsOf,
        doc?.snapshotAsOf,
        doc?.asOfDate,
      ),

    databaseWrites:
      countField(
        doc,
        'databaseWrites',
        'writesPerformed',
      ),

    productionApplied:
      firstDefined(
        doc?.productionApplied,
        doc?.safety?.productionApplied,
      ),

    coverageWindowAdvanced:
      firstDefined(
        doc?.coverageWindowAdvanced,
        doc?.safety?.coverageWindowAdvanced,
        doc?.closure?.globalCoverageMarkerAdvanced,
      ),
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    upstreamReplay:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-refresh-closure-reuse-v9-9-11-10-to-13-common-stock-replay.json',
      ),

    priorClosure:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-cycle-closure-v9-9-11-13-common-stock-scope.json',
      ),

    incremental101:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-incremental-v9-10-1.json',
      ),

    workset102:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-workset-v9-10-2.json',
      ),

    reconciliation1021:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-workset-carryforward-reconciliation-v9-10-2-1.json',
      ),

    closure103:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-cycle-closure-v9-10-3-common-stock-scope.json',
      ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-v9-10-replay-closure-audit.json',
    );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs =
    Object.fromEntries(
      Object.entries(files).map(
        ([name, file]) => [
          name,
          readJson(file),
        ],
      ),
    );

  assert(
    docs.upstreamReplay.version ===
      UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstreamReplay.version}`,
  );

  assert(
    docs.upstreamReplay.status ===
      UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstreamReplay.status}`,
  );

  assert(
    docs.upstreamReplay.conclusion
      ?.safeToAdvanceToV9_10Replay === true,
    'UPSTREAM_NOT_READY',
  );

  const issues = [];

  const summaries = {
    priorClosure:
      stageSummary(docs.priorClosure),

    incremental101:
      stageSummary(docs.incremental101),

    workset102:
      stageSummary(docs.workset102),

    reconciliation1021:
      stageSummary(docs.reconciliation1021),

    closure103:
      stageSummary(docs.closure103),
  };

  // ---------------------------------------------------------------
  // Stage statuses must be successful / non-blocked.
  // ---------------------------------------------------------------

  for (
    const [name, summary]
    of Object.entries(summaries)
  ) {
    if (isBadStatus(summary.status)) {
      issues.push({
        check: `${name}.status`,
        actual: summary.status,
        expected:
          'NON_FAILED_NON_INVALID_NON_BLOCKED_STATUS',
      });
    }
  }

  // Specific semantic status expectations where historical naming is known.
  if (
    docs.incremental101.status !==
    'INCREMENTAL_INVENTORY_COMPLETE'
  ) {
    issues.push({
      check: 'incremental101.statusExact',
      actual: docs.incremental101.status ?? null,
      expected: 'INCREMENTAL_INVENTORY_COMPLETE',
    });
  }

  if (
    docs.workset102.status !==
    'DETAIL_WORKSET_READY'
  ) {
    issues.push({
      check: 'workset102.statusExact',
      actual: docs.workset102.status ?? null,
      expected: 'DETAIL_WORKSET_READY',
    });
  }

  if (
    docs.reconciliation1021.status !==
    'WORKSET_CARRY_FORWARD_RECONCILIATION_READY'
  ) {
    issues.push({
      check: 'reconciliation1021.statusExact',
      actual: docs.reconciliation1021.status ?? null,
      expected:
        'WORKSET_CARRY_FORWARD_RECONCILIATION_READY',
    });
  }

  if (
    !String(docs.closure103.status ?? '')
      .includes('CLOSED')
  ) {
    issues.push({
      check: 'closure103.statusClosed',
      actual: docs.closure103.status ?? null,
      expectedContains: 'CLOSED',
    });
  }

  // ---------------------------------------------------------------
  // Date boundary.
  // ---------------------------------------------------------------

  const priorSnapshot =
    String(
      summaries.priorClosure
        .evidenceSnapshotAsOf ??
      '',
    );

  if (
    priorSnapshot &&
    priorSnapshot !== PRIOR_SNAPSHOT
  ) {
    issues.push({
      check: 'priorClosure.snapshot',
      actual: priorSnapshot,
      expected: PRIOR_SNAPSHOT,
    });
  }

  const startDate =
    String(
      summaries.incremental101.startDate ??
      '',
    );

  const throughDate =
    String(
      summaries.incremental101.throughDate ??
      '',
    );

  if (
    startDate &&
    startDate !== NEXT_DAY
  ) {
    issues.push({
      check: 'incremental101.startDate',
      actual: startDate,
      expected: NEXT_DAY,
    });
  }

  if (
    throughDate &&
    throughDate < NEXT_DAY
  ) {
    issues.push({
      check: 'incremental101.throughDate',
      actual: throughDate,
      expectedAtLeast: NEXT_DAY,
    });
  }

  const closureSnapshot =
    String(
      summaries.closure103
        .evidenceSnapshotAsOf ??
      '',
    );

  if (
    closureSnapshot &&
    closureSnapshot < NEXT_DAY
  ) {
    issues.push({
      check: 'closure103.snapshotMustNotRegress',
      actual: closureSnapshot,
      expectedAtLeast: NEXT_DAY,
    });
  }

  // ---------------------------------------------------------------
  // No writes / no coverage advancement in V9.10 boundary stages.
  // ---------------------------------------------------------------

  for (
    const name
    of [
      'workset102',
      'reconciliation1021',
      'closure103',
    ]
  ) {
    const s = summaries[name];

    if (
      s.databaseWrites !== null &&
      s.databaseWrites !== 0
    ) {
      issues.push({
        check: `${name}.databaseWrites`,
        actual: s.databaseWrites,
        expected: 0,
      });
    }

    if (s.productionApplied === true) {
      issues.push({
        check: `${name}.productionApplied`,
        actual: true,
        expected: false,
      });
    }

    if (s.coverageWindowAdvanced === true) {
      issues.push({
        check: `${name}.coverageWindowAdvanced`,
        actual: true,
        expected: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // No reported blockers/issues.
  // ---------------------------------------------------------------

  const stageProblems = {};

  for (
    const name
    of [
      'incremental101',
      'workset102',
      'reconciliation1021',
      'closure103',
    ]
  ) {
    stageProblems[name] =
      reportedProblems(docs[name]);

    if (stageProblems[name].length > 0) {
      issues.push({
        check: `${name}.reportedProblems`,
        details: stageProblems[name],
      });
    }
  }

  // ---------------------------------------------------------------
  // Basic inventory -> workset accounting.
  // ---------------------------------------------------------------

  const incrementalCandidates =
    arrayField(
      docs.incremental101,
      'candidates',
    );

  const worksetAllRows =
    arrayField(
      docs.workset102,
      'allRows',
    );

  const worksetProductionCandidates =
    arrayField(
      docs.workset102,
      'productionCandidateRows',
    );

  const detailFetchQueue =
    arrayField(
      docs.workset102,
      'detailFetchQueue',
    );

  const chainLookupQueue =
    arrayField(
      docs.workset102,
      'chainLookupQueue',
    );

  const inventoryCounts = {
    disclosures:
      arrayField(
        docs.incremental101,
        'disclosures',
      ).length,

    candidates:
      incrementalCandidates.length,

    duplicateDisclosureIdentities:
      arrayField(
        docs.incremental101,
        'duplicateDisclosureIdentities',
      ).length,
  };

  const worksetCounts = {
    sourceCandidates:
      countField(
        docs.workset102,
        'sourceCandidates',
      ),

    inCurrentCanonicalContract:
      countField(
        docs.workset102,
        'inCurrentCanonicalContract',
      ),

    outOfCurrentCanonicalScope:
      countField(
        docs.workset102,
        'outOfCurrentCanonicalScope',
      ),

    currentlyEligibleStandaloneProductionCandidates:
      countField(
        docs.workset102,
        'currentlyEligibleStandaloneProductionCandidates',
      ),

    allRows:
      worksetAllRows.length,

    productionCandidateRows:
      worksetProductionCandidates.length,

    detailFetchQueue:
      detailFetchQueue.length,

    chainLookupQueue:
      chainLookupQueue.length,
  };

  if (
    worksetCounts.sourceCandidates !== null &&
    inventoryCounts.candidates !==
      worksetCounts.sourceCandidates
  ) {
    issues.push({
      check:
        'incremental101ToWorkset102.sourceCandidateAccounting',
      inventoryCandidates:
        inventoryCounts.candidates,
      worksetSourceCandidates:
        worksetCounts.sourceCandidates,
    });
  }

  if (
    worksetCounts.allRows > 0 &&
    inventoryCounts.candidates !==
      worksetCounts.allRows
  ) {
    issues.push({
      check:
        'incremental101ToWorkset102.allRowsAccounting',
      inventoryCandidates:
        inventoryCounts.candidates,
      worksetAllRows:
        worksetCounts.allRows,
    });
  }

  if (
    worksetCounts.currentlyEligibleStandaloneProductionCandidates !==
      null &&
    worksetCounts.productionCandidateRows !==
      worksetCounts.currentlyEligibleStandaloneProductionCandidates
  ) {
    issues.push({
      check:
        'workset102.productionCandidateRowsAccounting',
      countField:
        worksetCounts.currentlyEligibleStandaloneProductionCandidates,
      arrayRows:
        worksetCounts.productionCandidateRows,
    });
  }

  // ---------------------------------------------------------------
  // Carry-forward continuity.
  // ---------------------------------------------------------------

  const priorCarry =
    extractCarryForwardArrays(
      docs.priorClosure,
    );

  const reconciliationCarry =
    extractCarryForwardArrays(
      docs.reconciliation1021,
    );

  const finalCarry =
    extractCarryForwardArrays(
      docs.closure103,
    );

  const priorCarrySet =
    new Set(
      priorCarry
        .map((x) => x.key)
        .filter(Boolean),
    );

  const reconciliationCarrySet =
    new Set(
      reconciliationCarry
        .map((x) => x.key)
        .filter(Boolean),
    );

  const finalCarrySet =
    new Set(
      finalCarry
        .map((x) => x.key)
        .filter(Boolean),
    );

  const currentCandidateSet =
    union(
      identitySet(incrementalCandidates),
      identitySet(worksetAllRows),
      identitySet(worksetProductionCandidates),
      identitySet(detailFetchQueue),
      identitySet(chainLookupQueue),
    );

  // Any carry identity appearing in final V9.10 closure must be explainable
  // by prior carry-forward OR a current-window candidate.
  if (finalCarrySet.size > 0) {
    const explainable =
      union(
        priorCarrySet,
        currentCandidateSet,
      );

    const unexplainedFinalCarry =
      setDiff(
        finalCarrySet,
        explainable,
      );

    if (unexplainedFinalCarry.length > 0) {
      issues.push({
        check:
          'closure103.unexplainedCarryForwardIdentities',
        rows:
          unexplainedFinalCarry,
      });
    }
  }

  // Reconciliation should not invent unexplained carry identities either.
  if (reconciliationCarrySet.size > 0) {
    const explainable =
      union(
        priorCarrySet,
        currentCandidateSet,
      );

    const unexplainedReconCarry =
      setDiff(
        reconciliationCarrySet,
        explainable,
      );

    if (unexplainedReconCarry.length > 0) {
      issues.push({
        check:
          'reconciliation1021.unexplainedCarryForwardIdentities',
        rows:
          unexplainedReconCarry,
      });
    }
  }

  // If there are zero current canonical production candidates, carry-forward
  // identity must be unchanged end-to-end when the artifacts expose arrays.
  const noNewStandalone =
    worksetCounts.productionCandidateRows === 0;

  let exactCarryPreservationWhenNoNewStandalone = null;

  if (
    noNewStandalone &&
    priorCarrySet.size > 0 &&
    finalCarrySet.size > 0
  ) {
    const missing =
      setDiff(priorCarrySet, finalCarrySet);

    const added =
      setDiff(finalCarrySet, priorCarrySet);

    exactCarryPreservationWhenNoNewStandalone =
      missing.length === 0 &&
      added.length === 0;

    if (
      !exactCarryPreservationWhenNoNewStandalone
    ) {
      issues.push({
        check:
          'closure103.carryForwardChangedDespiteNoNewStandaloneCandidates',
        missing,
        added,
      });
    }
  }

  // ---------------------------------------------------------------
  // Reconciliation accounting from declared count fields.
  // Do not hard-code field names: expose what exists and check obvious sums.
  // ---------------------------------------------------------------

  const reconciliationCounts = {
    priorCarryForward:
      countField(
        docs.reconciliation1021,
        'priorCarryForward',
        'priorCarryForwardItems',
        'priorCarryForwardCount',
      ),

    newSourceCandidates:
      countField(
        docs.reconciliation1021,
        'newSourceCandidates',
        'sourceCandidates',
      ),

    carryForwardReconfirmationQueue:
      countField(
        docs.reconciliation1021,
        'carryForwardReconfirmationQueue',
        'carryForwardReconfirmation',
        'touchedCarryForward',
      ),

    untouchedCarryForward:
      countField(
        docs.reconciliation1021,
        'untouchedCarryForward',
        'untouchedCarry',
      ),

    blockers:
      Array.isArray(
        docs.reconciliation1021.blockers,
      )
        ? docs.reconciliation1021
            .blockers.length
        : countField(
            docs.reconciliation1021,
            'blockers',
          ),
  };

  if (
    reconciliationCounts.blockers !== null &&
    reconciliationCounts.blockers !== 0
  ) {
    issues.push({
      check: 'reconciliation1021.blockers',
      actual: reconciliationCounts.blockers,
      expected: 0,
    });
  }

  // ---------------------------------------------------------------
  // Closure source lineage and accounting.
  // ---------------------------------------------------------------

  const closureCounts = {
    newSourceCandidates:
      countField(
        docs.closure103,
        'newSourceCandidates',
        'sourceCandidates',
      ),

    newInContractCandidates:
      countField(
        docs.closure103,
        'newInContractCandidates',
        'inCurrentCanonicalContract',
      ),

    productionCandidates:
      countField(
        docs.closure103,
        'productionCandidates',
        'currentlyEligibleStandaloneProductionCandidates',
      ),

    carryForward:
      countField(
        docs.closure103,
        'carryForward',
        'carryForwardItems',
        'carryForwardTotal',
      ),

    issues:
      Array.isArray(
        docs.closure103.issues,
      )
        ? docs.closure103.issues.length
        : null,
  };

  if (
    closureCounts.issues !== null &&
    closureCounts.issues !== 0
  ) {
    issues.push({
      check: 'closure103.issues',
      actual: closureCounts.issues,
      expected: 0,
    });
  }

  // If both closure and workset expose production-candidate counts,
  // they must agree.
  if (
    closureCounts.productionCandidates !== null &&
    worksetCounts
      .currentlyEligibleStandaloneProductionCandidates !== null &&
    closureCounts.productionCandidates !==
      worksetCounts
        .currentlyEligibleStandaloneProductionCandidates
  ) {
    issues.push({
      check:
        'workset102ToClosure103.productionCandidateAccounting',
      workset:
        worksetCounts
          .currentlyEligibleStandaloneProductionCandidates,
      closure:
        closureCounts.productionCandidates,
    });
  }

  // Fingerprint lineage: compare ONLY explicit source/output reference fields,
  // never generic "fingerprint" semantics.
  const explicitLineageChecks = [];

  function checkExplicitFingerprint(
    label,
    downstreamValue,
    upstreamValue,
  ) {
    if (
      downstreamValue &&
      upstreamValue
    ) {
      const equal =
        downstreamValue ===
        upstreamValue;

      explicitLineageChecks.push({
        label,
        downstreamValue,
        upstreamValue,
        equal,
      });

      if (!equal) {
        issues.push({
          check: label,
          actual: downstreamValue,
          expected: upstreamValue,
        });
      }
    }
  }

  checkExplicitFingerprint(
    'workset102.source.outputFingerprint',
    firstNonEmpty(
      docs.workset102.source
        ?.inputOutputFingerprint,
      docs.workset102.source
        ?.inventoryOutputFingerprint,
      docs.workset102.source
        ?.sourceOutputFingerprint,
    ),
    docs.incremental101.outputFingerprint,
  );

  checkExplicitFingerprint(
    'reconciliation1021.source.worksetOutputFingerprint',
    firstNonEmpty(
      docs.reconciliation1021.source
        ?.worksetOutputFingerprint,
      docs.reconciliation1021.source
        ?.inputOutputFingerprint,
    ),
    docs.workset102.outputFingerprint,
  );

  checkExplicitFingerprint(
    'closure103.source.reconciliationOutputFingerprint',
    firstNonEmpty(
      docs.closure103.source
        ?.reconciliationOutputFingerprint,
      docs.closure103.sourceFingerprints
        ?.reconciliation,
    ),
    docs.reconciliation1021.outputFingerprint,
  );

  // ---------------------------------------------------------------
  // 028080 stays a separate physical repair.
  // V9.10 may mention it in historical/global context, but it must not
  // become a new current-window candidate due to this replay.
  // ---------------------------------------------------------------

  const currentWindow028080 =
    [...currentCandidateSet]
      .some(
        (key) =>
          key.includes('|028080|'),
      );

  if (currentWindow028080) {
    issues.push({
      check:
        '028080UnexpectedlyAddedToV910CurrentWindowCandidateSet',
      actual: true,
      expected: false,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_REUSABLE'
      : 'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    replayBoundary: {
      priorSnapshot:
        PRIOR_SNAPSHOT,

      nextIncrementalDay:
        NEXT_DAY,

      physical028080RepairStillSeparate:
        true,
    },

    stages: summaries,

    inventory101: {
      counts: inventoryCounts,
    },

    workset102: {
      counts: worksetCounts,
    },

    reconciliation1021: {
      counts:
        reconciliationCounts,

      carryForwardIdentitiesExposed:
        reconciliationCarrySet.size,

      carryForwardCategoryCounts:
        categoryCounts(
          reconciliationCarry,
        ),
    },

    carryForwardContinuity: {
      priorCarryForwardIdentitiesExposed:
        priorCarrySet.size,

      priorCategoryCounts:
        categoryCounts(
          priorCarry,
        ),

      currentWindowCandidateIdentities:
        currentCandidateSet.size,

      reconciliationCarryForwardIdentities:
        reconciliationCarrySet.size,

      finalCarryForwardIdentitiesExposed:
        finalCarrySet.size,

      finalCategoryCounts:
        categoryCounts(
          finalCarry,
        ),

      noNewStandaloneCandidates:
        noNewStandalone,

      exactCarryPreservationWhenNoNewStandalone,
    },

    closure103: {
      counts: closureCounts,
    },

    explicitLineageChecks,

    stageProblems,

    issues,

    conclusion: {
      historicalV9101IncrementalInventoryReusable:
        reusable,

      historicalV9102DetailWorksetReusable:
        reusable,

      historicalV9102_1CarryForwardReconciliationReusable:
        reusable,

      historicalV9103CycleClosureReusable:
        reusable,

      v99ToV910BoundaryContinuous:
        reusable,

      v910CurrentWindowDidNotInject028080:
        reusable &&
        !currentWindow028080,

      physical028080RepairStillSeparate:
        true,

      databaseWriteRequiredNow:
        false,

      networkRefetchRequiredNow:
        false,

      opendartRefetchRequiredNow:
        false,

      kisRefetchRequiredNow:
        false,

      safeToDeclareHistoricalReplayThroughV9_10_0_3Closed:
        reusable,
    },

    safety: {
      networkRequestsNow: 0,
      opendartRequestsNow: 0,
      kisRequestsNow: 0,
      databaseReadsNow: 0,
      databaseWritesNow: 0,
      productionAppliedNow: false,
      coverageWindowAdvancedNow: false,
    },

    nextGate:
      reusable
        ? 'GLOBAL_REPLAY_CONSISTENCY_AUDIT_BEFORE_028080_PHYSICAL_PATCH'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-v9-10-replay-closure-audit.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        replayBoundary:
          report.replayBoundary,

        stages:
          report.stages,

        inventory101:
          report.inventory101,

        workset102:
          report.workset102,

        reconciliation1021:
          report.reconciliation1021,

        carryForwardContinuity:
          report.carryForwardContinuity,

        closure103:
          report.closure103,

        explicitLineageChecks:
          report.explicitLineageChecks,

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

        replayBoundary:
          report.replayBoundary,

        stages:
          report.stages,

        inventory101:
          report.inventory101,

        workset102:
          report.workset102,

        reconciliation1021:
          report.reconciliation1021,

        carryForwardContinuity:
          report.carryForwardContinuity,

        closure103:
          report.closure103,

        explicitLineageChecks:
          report.explicitLineageChecks,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,

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
          'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_REPLAY_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow: 0,
        opendartRequestsNow: 0,
        kisRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,
        productionAppliedNow: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
