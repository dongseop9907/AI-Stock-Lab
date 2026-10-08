#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.10 replay closure audit V2
 *
 * Fixes V1 audit-method false blocker:
 * V1 expected V9.9 historical cycle-closure artifact to expose carry-forward
 * identity arrays. That artifact can expose carry-forward accounting without
 * directly exposing the 3 deferred structural identity rows.
 *
 * V2 uses the already-proven V9.9 replay snapshot eligibility artifact as the
 * authoritative prior carry-forward identity baseline:
 *
 *   V9.9.11.5.1 replay deferredKeys
 *      == 3 FUTURE_STRUCTURAL identities
 *
 * Then requires exact identity equality against:
 *   V9.10.2.1 reconciliation carry-forward
 *   V9.10.3 closure carry-forward
 *
 * Because V9.10.1/10.2 contain ZERO new candidates, the three sets must be
 * exactly equal. This is stricter than the V1 fallback and does not relax
 * business semantics.
 *
 * No network.
 * No OpenDART.
 * No KIS.
 * No DB reads/writes.
 * No production patch.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_10_1_2_2_1_3_REPLAY_V2_PRIOR_CARRY_BASELINE_AWARE_COMMON_STOCK_CLOSURE_AUDIT';

const EXPECTED_V99_SNAPSHOT_VERSION =
  'V9_9_11_4_5_5_1_REPLAY_V2_DEFERRED_EFFECTIVE_DATE_FIELD_PATH_AWARE_COMMON_STOCK_REUSE_AUDIT';

const EXPECTED_V99_SNAPSHOT_STATUS =
  'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE_AFTER_EFFECTIVE_DATE_FIELD_PATH_FIX';

const EXPECTED_V99_REFRESH_VERSION =
  'V9_9_11_10_TO_13_REPLAY_READ_ONLY_COMMON_STOCK_REFRESH_CLOSURE_REUSE_AUDIT';

const EXPECTED_V99_REFRESH_STATUS =
  'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_RESULTS_REUSABLE';

const PRIOR_SNAPSHOT = '2026-10-04';
const V910_DAY = '2026-10-05';

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

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countField(doc, ...names) {
  for (const name of names) {
    const candidates = [
      doc?.[name],
      doc?.counts?.[name],
      doc?.summary?.[name],
      doc?.accounting?.[name],
      doc?.closure?.[name],
      doc?.safety?.[name],
    ];

    for (const value of candidates) {
      if (value !== undefined && value !== null) {
        const n = numberOrNull(value);
        if (n !== null) return n;
      }
    }
  }

  return null;
}

function normalizeReceipt(value) {
  const s = String(value ?? '').trim();
  return /^\d{14}$/.test(s) ? s : '';
}

function normalizeStock(value) {
  const s = String(value ?? '').trim();
  return s ? s.padStart(6, '0') : '';
}

function normalizeAction(value) {
  return String(value ?? '').trim().toUpperCase();
}

function identity(row) {
  return {
    providerEventId: normalizeReceipt(
      firstNonEmpty(
        row?.providerEventId,
        row?.provider_event_id,
        row?.rootReceiptNo,
        row?.root_receipt_no,
        row?.receiptNo,
        row?.receipt_no,
      ),
    ),

    stockCode: normalizeStock(
      firstNonEmpty(
        row?.stockCode,
        row?.stock_code,
      ),
    ),

    actionType: normalizeAction(
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

function parseKey(key) {
  const parts = String(key ?? '').split('|');

  if (parts.length !== 3) return null;

  const [providerEventId, stockCode, actionType] = parts;

  const normalized = [
    normalizeReceipt(providerEventId),
    normalizeStock(stockCode),
    normalizeAction(actionType),
  ];

  if (normalized.some((x) => !x)) return null;

  return normalized.join('|');
}

function setOfKeys(values) {
  return new Set(
    values
      .map(parseKey)
      .filter(Boolean),
  );
}

function setDiff(a, b) {
  return [...a]
    .filter((x) => !b.has(x))
    .sort();
}

function setEqual(a, b) {
  return (
    a.size === b.size &&
    setDiff(a, b).length === 0
  );
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

function extractCarryRows(doc) {
  const found = [];

  for (const arr of nestedArrays(doc)) {
    // Include only arrays whose path semantically indicates carry-forward.
    if (!/carry/i.test(arr.path)) continue;

    for (const row of arr.rows) {
      if (!row || typeof row !== 'object') continue;

      const key = keyOf(row);
      if (!key) continue;

      const category =
        String(
          firstNonEmpty(
            row.category,
            row.carryCategory,
            row.carry_category,
            /structural/i.test(arr.path)
              ? 'FUTURE_STRUCTURAL'
              : /ratio/i.test(arr.path)
                ? 'FUTURE_RATIO'
                : /cash/i.test(arr.path)
                  ? 'FUTURE_CASH'
                  : 'UNCLASSIFIED',
          ),
        ).toUpperCase();

      found.push({
        path: arr.path,
        category,
        key,
        row,
      });
    }
  }

  const dedup = new Map();

  for (const item of found) {
    const dedupKey = `${item.category}|${item.key}`;

    if (!dedup.has(dedupKey)) {
      dedup.set(dedupKey, item);
    }
  }

  return [...dedup.values()];
}

function categoryCounts(items) {
  const out = {};

  for (const item of items) {
    out[item.category] =
      (out[item.category] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function stageSummary(doc) {
  return {
    version: doc.version ?? null,
    status: doc.status ?? null,

    startDate:
      firstNonEmpty(
        doc.startDate,
        doc.fromDate,
        doc.source?.startDate,
      ),

    throughDate:
      firstNonEmpty(
        doc.throughDate,
        doc.endDate,
        doc.source?.throughDate,
      ),

    evidenceSnapshotAsOf:
      firstNonEmpty(
        doc.evidenceSnapshotAsOf,
        doc.snapshotAsOf,
        doc.asOfDate,
      ),

    databaseWrites:
      countField(
        doc,
        'databaseWrites',
        'writesPerformed',
      ),

    productionApplied:
      firstNonEmpty(
        doc.productionApplied,
        doc.safety?.productionApplied,
      ),

    coverageWindowAdvanced:
      firstNonEmpty(
        doc.coverageWindowAdvanced,
        doc.safety?.coverageWindowAdvanced,
        doc.closure?.globalCoverageMarkerAdvanced,
      ),
  };
}

function reportedArrayCount(doc, field) {
  return Array.isArray(doc?.[field])
    ? doc[field].length
    : null;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    v99SnapshotReplay: path.join(
      root,
      'logs',
      'opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay-v2.json',
    ),

    v99RefreshReplay: path.join(
      root,
      'logs',
      'opendart-corporate-action-refresh-closure-reuse-v9-9-11-10-to-13-common-stock-replay.json',
    ),

    priorHistoricalClosure: path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-9-11-13-common-stock-scope.json',
    ),

    incremental101: path.join(
      root,
      'logs',
      'opendart-corporate-action-incremental-v9-10-1.json',
    ),

    workset102: path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-workset-v9-10-2.json',
    ),

    reconciliation1021: path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-10-2-1.json',
    ),

    closure103: path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-10-3-common-stock-scope.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-v9-10-replay-closure-audit-v2.json',
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
    docs.v99SnapshotReplay.version ===
      EXPECTED_V99_SNAPSHOT_VERSION,
    `V99_SNAPSHOT_REPLAY_VERSION_MISMATCH:${docs.v99SnapshotReplay.version}`,
  );

  assert(
    docs.v99SnapshotReplay.status ===
      EXPECTED_V99_SNAPSHOT_STATUS,
    `V99_SNAPSHOT_REPLAY_STATUS_MISMATCH:${docs.v99SnapshotReplay.status}`,
  );

  assert(
    Array.isArray(docs.v99SnapshotReplay.issues) &&
      docs.v99SnapshotReplay.issues.length === 0,
    'V99_SNAPSHOT_REPLAY_HAS_ISSUES',
  );

  assert(
    docs.v99RefreshReplay.version ===
      EXPECTED_V99_REFRESH_VERSION,
    `V99_REFRESH_REPLAY_VERSION_MISMATCH:${docs.v99RefreshReplay.version}`,
  );

  assert(
    docs.v99RefreshReplay.status ===
      EXPECTED_V99_REFRESH_STATUS,
    `V99_REFRESH_REPLAY_STATUS_MISMATCH:${docs.v99RefreshReplay.status}`,
  );

  assert(
    docs.v99RefreshReplay.conclusion
      ?.safeToAdvanceToV9_10Replay === true,
    'V99_REFRESH_REPLAY_NOT_READY',
  );

  const issues = [];

  // ------------------------------------------------------------------
  // Authoritative prior carry-forward baseline:
  // V9.9 snapshot eligibility deferred structural keys.
  // ------------------------------------------------------------------

  const priorDeferredKeysRaw =
    docs.v99SnapshotReplay
      .eligibility1151
      ?.deferredKeys ?? [];

  assert(
    Array.isArray(priorDeferredKeysRaw),
    'V99_DEFERRED_KEYS_NOT_ARRAY',
  );

  const priorCarrySet =
    setOfKeys(priorDeferredKeysRaw);

  if (priorCarrySet.size !== 3) {
    issues.push({
      check:
        'v99SnapshotReplay.priorFutureStructuralIdentityCount',

      actual:
        priorCarrySet.size,

      expected:
        3,

      rows:
        [...priorCarrySet].sort(),
    });
  }

  for (const key of priorCarrySet) {
    if (
      !key.endsWith('|MERGER') &&
      !key.endsWith('|SPIN_OFF')
    ) {
      issues.push({
        check:
          'v99SnapshotReplay.priorCarryMustBeStructural',

        key,
      });
    }
  }

  // Exact historically-proven V9.9 structural set.
  const expectedStructuralSet =
    new Set([
      '20260909000291|001570|SPIN_OFF',
      '20261002000418|043910|MERGER',
      '20260619000664|469480|MERGER',
    ]);

  if (!setEqual(priorCarrySet, expectedStructuralSet)) {
    issues.push({
      check:
        'v99SnapshotReplay.priorCarryIdentitySet',

      expected:
        [...expectedStructuralSet].sort(),

      actual:
        [...priorCarrySet].sort(),

      missing:
        setDiff(
          expectedStructuralSet,
          priorCarrySet,
        ),

      unexpected:
        setDiff(
          priorCarrySet,
          expectedStructuralSet,
        ),
    });
  }

  // ------------------------------------------------------------------
  // V9.10 zero-new-event boundary.
  // ------------------------------------------------------------------

  const stages = {
    priorHistoricalClosure:
      stageSummary(
        docs.priorHistoricalClosure,
      ),

    incremental101:
      stageSummary(
        docs.incremental101,
      ),

    workset102:
      stageSummary(
        docs.workset102,
      ),

    reconciliation1021:
      stageSummary(
        docs.reconciliation1021,
      ),

    closure103:
      stageSummary(
        docs.closure103,
      ),
  };

  const priorSnapshot =
    String(
      stages.priorHistoricalClosure
        .evidenceSnapshotAsOf ??
      '',
    );

  if (
    priorSnapshot !==
    PRIOR_SNAPSHOT
  ) {
    issues.push({
      check:
        'priorHistoricalClosure.snapshot',

      actual:
        priorSnapshot,

      expected:
        PRIOR_SNAPSHOT,
    });
  }

  if (
    docs.incremental101.status !==
    'INCREMENTAL_INVENTORY_COMPLETE'
  ) {
    issues.push({
      check:
        'incremental101.status',

      actual:
        docs.incremental101.status,

      expected:
        'INCREMENTAL_INVENTORY_COMPLETE',
    });
  }

  if (
    String(
      stages.incremental101.startDate,
    ) !== V910_DAY ||
    String(
      stages.incremental101.throughDate,
    ) !== V910_DAY
  ) {
    issues.push({
      check:
        'incremental101.dateBoundary',

      startDate:
        stages.incremental101.startDate,

      throughDate:
        stages.incremental101.throughDate,

      expected:
        V910_DAY,
    });
  }

  const disclosures =
    Array.isArray(
      docs.incremental101.disclosures,
    )
      ? docs.incremental101.disclosures.length
      : countField(
          docs.incremental101,
          'disclosures',
        );

  const candidates =
    Array.isArray(
      docs.incremental101.candidates,
    )
      ? docs.incremental101.candidates.length
      : countField(
          docs.incremental101,
          'candidates',
        );

  const duplicateDisclosureIdentities =
    Array.isArray(
      docs.incremental101
        .duplicateDisclosureIdentities,
    )
      ? docs.incremental101
          .duplicateDisclosureIdentities
          .length
      : countField(
          docs.incremental101,
          'duplicateDisclosureIdentities',
        );

  if (disclosures !== 0) {
    issues.push({
      check:
        'incremental101.disclosures',

      actual:
        disclosures,

      expected:
        0,
    });
  }

  if (candidates !== 0) {
    issues.push({
      check:
        'incremental101.candidates',

      actual:
        candidates,

      expected:
        0,
    });
  }

  if (
    duplicateDisclosureIdentities !==
    0
  ) {
    issues.push({
      check:
        'incremental101.duplicateDisclosureIdentities',

      actual:
        duplicateDisclosureIdentities,

      expected:
        0,
    });
  }

  // ------------------------------------------------------------------
  // Workset must remain exactly empty.
  // ------------------------------------------------------------------

  if (
    docs.workset102.status !==
    'DETAIL_WORKSET_READY'
  ) {
    issues.push({
      check:
        'workset102.status',

      actual:
        docs.workset102.status,

      expected:
        'DETAIL_WORKSET_READY',
    });
  }

  const worksetCounts = {
    sourceCandidates:
      countField(
        docs.workset102,
        'sourceCandidates',
      ) ?? 0,

    inCurrentCanonicalContract:
      countField(
        docs.workset102,
        'inCurrentCanonicalContract',
      ) ?? 0,

    outOfCurrentCanonicalScope:
      countField(
        docs.workset102,
        'outOfCurrentCanonicalScope',
      ) ?? 0,

    currentlyEligibleStandaloneProductionCandidates:
      countField(
        docs.workset102,
        'currentlyEligibleStandaloneProductionCandidates',
      ) ?? 0,

    allRows:
      Array.isArray(
        docs.workset102.allRows,
      )
        ? docs.workset102.allRows.length
        : 0,

    productionCandidateRows:
      Array.isArray(
        docs.workset102
          .productionCandidateRows,
      )
        ? docs.workset102
            .productionCandidateRows
            .length
        : 0,

    detailFetchQueue:
      Array.isArray(
        docs.workset102
          .detailFetchQueue,
      )
        ? docs.workset102
            .detailFetchQueue
            .length
        : 0,

    chainLookupQueue:
      Array.isArray(
        docs.workset102
          .chainLookupQueue,
      )
        ? docs.workset102
            .chainLookupQueue
            .length
        : 0,
  };

  for (
    const [field, value]
    of Object.entries(worksetCounts)
  ) {
    if (value !== 0) {
      issues.push({
        check:
          `workset102.${field}`,

        actual:
          value,

        expected:
          0,
      });
    }
  }

  // ------------------------------------------------------------------
  // Reconciliation exact-set continuity.
  // ------------------------------------------------------------------

  if (
    docs.reconciliation1021.status !==
    'WORKSET_CARRY_FORWARD_RECONCILIATION_READY'
  ) {
    issues.push({
      check:
        'reconciliation1021.status',

      actual:
        docs.reconciliation1021.status,

      expected:
        'WORKSET_CARRY_FORWARD_RECONCILIATION_READY',
    });
  }

  const reconCarryRows =
    extractCarryRows(
      docs.reconciliation1021,
    );

  const reconCarrySet =
    new Set(
      reconCarryRows
        .map((x) => x.key),
    );

  if (!setEqual(reconCarrySet, priorCarrySet)) {
    issues.push({
      check:
        'reconciliation1021.carryForwardExactIdentitySet',

      expected:
        [...priorCarrySet].sort(),

      actual:
        [...reconCarrySet].sort(),

      missing:
        setDiff(
          priorCarrySet,
          reconCarrySet,
        ),

      unexpected:
        setDiff(
          reconCarrySet,
          priorCarrySet,
        ),
    });
  }

  const reconCategoryCounts =
    categoryCounts(
      reconCarryRows,
    );

  if (
    reconCarrySet.size === 3 &&
    Number(
      reconCategoryCounts
        .FUTURE_STRUCTURAL ??
      0,
    ) !== 3
  ) {
    issues.push({
      check:
        'reconciliation1021.futureStructuralCategoryCount',

      actual:
        reconCategoryCounts,

      expected: {
        FUTURE_STRUCTURAL: 3,
      },
    });
  }

  const reconReconfirmationQueue =
    countField(
      docs.reconciliation1021,
      'carryForwardReconfirmationQueue',
      'carryForwardReconfirmation',
      'touchedCarryForward',
    );

  if (
    reconReconfirmationQueue !==
      null &&
    reconReconfirmationQueue !== 0
  ) {
    issues.push({
      check:
        'reconciliation1021.reconfirmationQueue',

      actual:
        reconReconfirmationQueue,

      expected:
        0,
    });
  }

  const reconNewSourceCandidates =
    countField(
      docs.reconciliation1021,
      'newSourceCandidates',
      'sourceCandidates',
    );

  if (
    reconNewSourceCandidates !==
      null &&
    reconNewSourceCandidates !== 0
  ) {
    issues.push({
      check:
        'reconciliation1021.newSourceCandidates',

      actual:
        reconNewSourceCandidates,

      expected:
        0,
    });
  }

  const reconBlockers =
    Array.isArray(
      docs.reconciliation1021.blockers,
    )
      ? docs.reconciliation1021
          .blockers.length
      : countField(
          docs.reconciliation1021,
          'blockers',
        );

  if (
    reconBlockers !== null &&
    reconBlockers !== 0
  ) {
    issues.push({
      check:
        'reconciliation1021.blockers',

      actual:
        reconBlockers,

      expected:
        0,
    });
  }

  // ------------------------------------------------------------------
  // V9.10.3 exact zero-new-event closure.
  // ------------------------------------------------------------------

  if (
    docs.closure103.version !==
    'V9_10_3_ZERO_NEW_EVENT_CYCLE_CLOSURE_AUDIT'
  ) {
    issues.push({
      check:
        'closure103.version',

      actual:
        docs.closure103.version,

      expected:
        'V9_10_3_ZERO_NEW_EVENT_CYCLE_CLOSURE_AUDIT',
    });
  }

  if (
    docs.closure103.status !==
    'V9_10_CURRENT_CYCLE_CLOSED_AT_2026_10_05'
  ) {
    issues.push({
      check:
        'closure103.status',

      actual:
        docs.closure103.status,

      expected:
        'V9_10_CURRENT_CYCLE_CLOSED_AT_2026_10_05',
    });
  }

  if (
    String(
      docs.closure103
        .evidenceSnapshotAsOf ??
      '',
    ) !==
    V910_DAY
  ) {
    issues.push({
      check:
        'closure103.evidenceSnapshotAsOf',

      actual:
        docs.closure103
          .evidenceSnapshotAsOf ??
        null,

      expected:
        V910_DAY,
    });
  }

  const finalCarryRows =
    extractCarryRows(
      docs.closure103,
    );

  const finalCarrySet =
    new Set(
      finalCarryRows
        .map((x) => x.key),
    );

  if (!setEqual(finalCarrySet, priorCarrySet)) {
    issues.push({
      check:
        'closure103.carryForwardExactIdentitySet',

      expected:
        [...priorCarrySet].sort(),

      actual:
        [...finalCarrySet].sort(),

      missing:
        setDiff(
          priorCarrySet,
          finalCarrySet,
        ),

      unexpected:
        setDiff(
          finalCarrySet,
          priorCarrySet,
        ),
    });
  }

  const finalCategoryCounts =
    categoryCounts(
      finalCarryRows,
    );

  if (
    finalCarrySet.size === 3 &&
    Number(
      finalCategoryCounts
        .FUTURE_STRUCTURAL ??
      0,
    ) !== 3
  ) {
    issues.push({
      check:
        'closure103.futureStructuralCategoryCount',

      actual:
        finalCategoryCounts,

      expected: {
        FUTURE_STRUCTURAL: 3,
      },
    });
  }

  const closureIssues =
    Array.isArray(
      docs.closure103.issues,
    )
      ? docs.closure103
          .issues.length
      : null;

  if (
    closureIssues !== null &&
    closureIssues !== 0
  ) {
    issues.push({
      check:
        'closure103.issues',

      actual:
        closureIssues,

      expected:
        0,
    });
  }

  // ------------------------------------------------------------------
  // No writes / no coverage-marker advancement.
  // ------------------------------------------------------------------

  const stageSafety = {};

  for (
    const [name, doc]
    of [
      ['incremental101', docs.incremental101],
      ['workset102', docs.workset102],
      ['reconciliation1021', docs.reconciliation1021],
      ['closure103', docs.closure103],
    ]
  ) {
    const writes =
      countField(
        doc,
        'databaseWrites',
        'writesPerformed',
      );

    const productionApplied =
      firstNonEmpty(
        doc.productionApplied,
        doc.safety?.productionApplied,
      );

    const coverageWindowAdvanced =
      firstNonEmpty(
        doc.coverageWindowAdvanced,
        doc.safety?.coverageWindowAdvanced,
        doc.closure?.globalCoverageMarkerAdvanced,
      );

    stageSafety[name] = {
      databaseWrites:
        writes,

      productionApplied:
        productionApplied === null
          ? null
          : productionApplied,

      coverageWindowAdvanced:
        coverageWindowAdvanced === null
          ? null
          : coverageWindowAdvanced,
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

    if (
      productionApplied === true
    ) {
      issues.push({
        check:
          `${name}.productionApplied`,

        actual:
          true,

        expected:
          false,
      });
    }

    if (
      coverageWindowAdvanced === true
    ) {
      issues.push({
        check:
          `${name}.coverageWindowAdvanced`,

        actual:
          true,

        expected:
          false,
      });
    }
  }

  // 028080 must not be in any current V9.10 carry/candidate set.
  const contains028080 =
    [...priorCarrySet]
      .some(
        (key) =>
          key.includes('|028080|'),
      ) ||
    [...reconCarrySet]
      .some(
        (key) =>
          key.includes('|028080|'),
      ) ||
    [...finalCarrySet]
      .some(
        (key) =>
          key.includes('|028080|'),
      );

  if (contains028080) {
    issues.push({
      check:
        '028080MustRemainSeparateFromV910CarryForward',

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
      ? 'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_REUSABLE_AFTER_PRIOR_CARRY_BASELINE_FIX'
      : 'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_V2_BLOCKED';

  const report = {
    status,
    version: VERSION,

    replayBoundary: {
      priorSnapshot:
        PRIOR_SNAPSHOT,

      v910Day:
        V910_DAY,

      zeroNewEvents:
        disclosures === 0 &&
        candidates === 0 &&
        Object.values(
          worksetCounts,
        ).every((x) => x === 0),

      physical028080RepairStillSeparate:
        true,
    },

    priorCarryBaseline: {
      source:
        'V9_9_11_5_1_REPLAY_DEFERRED_STRUCTURAL_KEYS',

      identityCount:
        priorCarrySet.size,

      identities:
        [...priorCarrySet].sort(),

      expectedExactSet:
        [...expectedStructuralSet].sort(),

      exactExpectedSet:
        setEqual(
          priorCarrySet,
          expectedStructuralSet,
        ),
    },

    stages,

    inventory101: {
      disclosures,
      candidates,
      duplicateDisclosureIdentities,
    },

    workset102:
      worksetCounts,

    reconciliation1021: {
      carryForwardIdentityCount:
        reconCarrySet.size,

      carryForwardIdentities:
        [...reconCarrySet].sort(),

      categoryCounts:
        reconCategoryCounts,

      newSourceCandidates:
        reconNewSourceCandidates,

      reconfirmationQueue:
        reconReconfirmationQueue,

      blockers:
        reconBlockers,

      exactPriorCarryMatch:
        setEqual(
          reconCarrySet,
          priorCarrySet,
        ),
    },

    closure103: {
      carryForwardIdentityCount:
        finalCarrySet.size,

      carryForwardIdentities:
        [...finalCarrySet].sort(),

      categoryCounts:
        finalCategoryCounts,

      issues:
        closureIssues,

      exactPriorCarryMatch:
        setEqual(
          finalCarrySet,
          priorCarrySet,
        ),

      exactReconciliationMatch:
        setEqual(
          finalCarrySet,
          reconCarrySet,
        ),
    },

    stageSafety,

    issues,

    conclusion: {
      v1BlockWasPriorClosureIdentityExposureFalsePositive:
        reusable,

      authoritativePriorCarryBaselineRecoveredFromV99Replay:
        reusable,

      historicalV9101IncrementalInventoryReusable:
        reusable,

      historicalV9102DetailWorksetReusable:
        reusable,

      historicalV9102_1CarryForwardReconciliationReusable:
        reusable,

      historicalV9103CycleClosureReusable:
        reusable,

      zeroNewEventBoundaryConfirmed:
        reusable &&
        disclosures === 0 &&
        candidates === 0,

      threeFutureStructuralCarryForwardPreservedExactly:
        reusable &&
        priorCarrySet.size === 3 &&
        setEqual(
          priorCarrySet,
          reconCarrySet,
        ) &&
        setEqual(
          priorCarrySet,
          finalCarrySet,
        ),

      v99ToV910BoundaryContinuous:
        reusable,

      v910CurrentWindowDidNotInject028080:
        reusable &&
        !contains028080,

      physical028080RepairStillSeparate:
        true,

      networkRefetchRequiredNow:
        false,

      opendartRefetchRequiredNow:
        false,

      kisRefetchRequiredNow:
        false,

      databaseReadRequiredNow:
        false,

      databaseWriteRequiredNow:
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
      physical028080PatchExecutedNow: false,
      coverageWindowAdvancedNow: false,
    },

    nextGate:
      reusable
        ? 'GLOBAL_REPLAY_CONSISTENCY_AUDIT_BEFORE_028080_PHYSICAL_PATCH'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-v9-10-replay-closure-audit-v2.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        replayBoundary:
          report.replayBoundary,

        priorCarryBaseline:
          report.priorCarryBaseline,

        inventory101:
          report.inventory101,

        workset102:
          report.workset102,

        reconciliation1021:
          report.reconciliation1021,

        closure103:
          report.closure103,

        stageSafety:
          report.stageSafety,

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

        priorCarryBaseline:
          report.priorCarryBaseline,

        inventory101:
          report.inventory101,

        workset102:
          report.workset102,

        reconciliation1021:
          report.reconciliation1021,

        closure103:
          report.closure103,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow:
          0,

        databaseReadsNow:
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
          'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_REPLAY_V2_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow:
          0,

        opendartRequestsNow:
          0,

        kisRequestsNow:
          0,

        databaseReadsNow:
          0,

        databaseWritesNow:
          0,

        productionAppliedNow:
          false,

        physical028080PatchExecutedNow:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
