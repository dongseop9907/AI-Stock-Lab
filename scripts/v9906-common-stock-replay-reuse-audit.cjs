#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.6 authoritative field-extraction branch reuse audit
 *
 * READ ONLY.
 *
 * Historical V9.9 has TWO branches:
 *
 *   early/original:
 *     6 -> 6.1 -> 6.3 -> 7 -> 7.2 -> 8
 *
 *   later authoritative:
 *     6.1-patched-test
 *       -> 6.1-common-stock-scope
 *       -> 6.3-common-stock-scope
 *       -> 7-common-stock-scope
 *       -> 7.2-common-stock-scope
 *       -> 8-common-stock-scope
 *       -> ...
 *
 * This audit does NOT assume a hard-coded common-stock row count.
 * It proves the authoritative branch by downstream lineage and identity
 * continuity instead.
 *
 * Checks:
 * 1) previous V9.9.5/5.1 reuse audit passed;
 * 2) common-stock 6.1 and 6.3 artifacts exist and are non-blocked/read-only;
 * 3) every common-stock row is a subset of canonical V9.9.5.1 identities;
 * 4) common-stock 6.1 -> 6.3 identity set is stable;
 * 5) downstream 7-common-stock-scope consumes the 6.3 common-stock branch
 *    by explicit version/file/fingerprint evidence when exposed;
 * 6) downstream 7-common results preserve the same identity set;
 * 7) 001570 / SPIN_OFF root 20260909000291 remains present when it belongs
 *    to the common-stock branch;
 * 8) any REVERSE_SPLIT row surviving to 6.3 has valid positive ratio fields
 *    unless explicitly structural/review/future status says ratio is not ready;
 * 9) 028080 is never injected into this incremental branch.
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_6_REPLAY_READ_ONLY_AUTHORITATIVE_COMMON_STOCK_FIELD_EXTRACTION_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_5_5_1_REPLAY_READ_ONLY_HISTORICAL_CANONICAL_SOURCE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_5_5_1_CANONICAL_SOURCE_RESULTS_REUSABLE';

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

function arrayField(doc, ...names) {
  for (const name of names) {
    if (Array.isArray(doc?.[name])) {
      return doc[name];
    }
  }
  return [];
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

function candidateRows(doc) {
  const preferred = [
    'results',
    'repairedRows',
    'rows',
    'outputRows',
    'events',
    'canonicalRows',
  ];

  for (const key of preferred) {
    if (Array.isArray(doc?.[key])) {
      return doc[key];
    }
  }

  // Fallback: select the largest top-level array containing stock/action-ish rows.
  const arrays = Object.entries(doc ?? {})
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({
      key,
      value,
      score: value.filter(
        (row) =>
          row &&
          typeof row === 'object' &&
          (
            row.stockCode ||
            row.stock_code
          ) &&
          (
            row.actionType ||
            row.action_type
          ),
      ).length,
    }))
    .sort((a, b) => b.score - a.score);

  if (arrays[0]?.score > 0) {
    return arrays[0].value;
  }

  return [];
}

function canonicalIdentity(row) {
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

  const sourceReceiptNo = normalizeReceipt(
    firstNonEmpty(
      row.sourceReceiptNo,
      row.source_receipt_no,
      row.receiptNo,
      row.receipt_no,
      row.latestValidReceiptNo,
      row.latest_valid_receipt_no,
    ),
  );

  return {
    providerEventId,
    stockCode,
    actionType,
    sourceReceiptNo,
  };
}

function keyOf(row) {
  return [
    row.providerEventId,
    row.stockCode,
    row.actionType,
  ].join('|');
}

function countActions(rows) {
  const counts = {};

  for (const row of rows) {
    const action =
      row.actionType || 'UNKNOWN';

    counts[action] =
      (counts[action] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function collectStrings(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') {
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;

    if (typeof child === 'string') {
      out.push({
        path: p,
        key,
        value: child,
      });
    } else if (child && typeof child === 'object') {
      collectStrings(child, p, out);
    }
  }

  return out;
}

function collectHashes(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') {
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;

    if (
      typeof child === 'string' &&
      /^[0-9a-f]{64}$/i.test(child.trim())
    ) {
      out.push({
        path: p,
        key,
        value: child.trim(),
      });
    } else if (child && typeof child === 'object') {
      collectHashes(child, p, out);
    }
  }

  return out;
}

function lineageEvidence(downstream, upstream, upstreamFileBasename) {
  const strings =
    collectStrings(downstream?.source ?? {});

  const sourceVersionMatches =
    strings.filter(
      (row) =>
        /version/i.test(row.key) &&
        String(row.value) ===
          String(upstream.version),
    );

  const sourceFileMatches =
    strings.filter(
      (row) =>
        /file|path/i.test(row.key) &&
        String(row.value)
          .replaceAll('\\', '/')
          .endsWith(upstreamFileBasename),
    );

  const hashes =
    collectHashes(downstream?.source ?? {});

  const fingerprintMatches =
    hashes.filter(
      (row) =>
        upstream.outputFingerprint &&
        String(row.value) ===
          String(upstream.outputFingerprint),
    );

  return {
    sourceVersionMatches,
    sourceFileMatches,
    fingerprintMatches,
    proven:
      sourceVersionMatches.length > 0 ||
      sourceFileMatches.length > 0 ||
      fingerprintMatches.length > 0,
  };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratioInfo(row) {
  return {
    ratioFrom: num(
      firstNonEmpty(
        row.ratioFrom,
        row.ratio_from,
        row.facts?.ratioFrom,
        row.facts?.ratio_from,
      ),
    ),
    ratioTo: num(
      firstNonEmpty(
        row.ratioTo,
        row.ratio_to,
        row.facts?.ratioTo,
        row.facts?.ratio_to,
      ),
    ),
    parseStatus: String(
      firstNonEmpty(
        row.parseStatus,
        row.parse_status,
        row.status,
        row.fieldStatus,
        row.field_status,
      ) ?? '',
    ),
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    upstreamAudit: path.join(
      root,
      'logs',
      'opendart-corporate-action-historical-canonical-source-reuse-v9-9-5-5-1-replay.json',
    ),

    canonical51: path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-9-5-1.json',
    ),

    original61: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-1.json',
    ),

    original63: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3.json',
    ),

    patchedTest61: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-1-patched-test.json',
    ),

    common61: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-1-common-stock-scope.json',
    ),

    common63: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3-common-stock-scope.json',
    ),

    common7: path.join(
      root,
      'logs',
      'opendart-corporate-action-market-effective-date-v9-9-7-common-stock-scope.json',
    ),

    common72: path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-finalization-v9-9-7-2-common-stock-scope.json',
    ),

    common8: path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-authoritative-field-extraction-reuse-v9-9-6-common-stock-replay.json',
    );

  for (const [name, file] of Object.entries(files)) {
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
    docs.upstreamAudit.version ===
      UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstreamAudit.version}`,
  );

  assert(
    docs.upstreamAudit.status ===
      UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstreamAudit.status}`,
  );

  assert(
    docs.upstreamAudit.conclusion
      ?.safeToAdvanceToHistoricalV996FieldExtractionReuseAudit === true,
    'UPSTREAM_NOT_READY_FOR_FIELD_EXTRACTION_REUSE_AUDIT',
  );

  const canonicalRows =
    arrayField(
      docs.canonical51,
      'activeChains',
    ).map(canonicalIdentity);

  assert(
    canonicalRows.length > 0,
    'CANONICAL_5_1_ACTIVE_CHAINS_MISSING',
  );

  const canonicalSet =
    new Set(
      canonicalRows.map(keyOf),
    );

  const rows61 =
    candidateRows(docs.common61)
      .map(canonicalIdentity);

  const rows63 =
    candidateRows(docs.common63)
      .map(canonicalIdentity);

  const rows7 =
    candidateRows(docs.common7)
      .map(canonicalIdentity);

  assert(
    rows61.length > 0,
    'COMMON_6_1_RESULTS_MISSING',
  );

  assert(
    rows63.length > 0,
    'COMMON_6_3_RESULTS_MISSING',
  );

  assert(
    rows7.length > 0,
    'COMMON_7_RESULTS_MISSING',
  );

  const issues = [];

  // ------------------------------------------------------------------
  // Stage health / write safety
  // ------------------------------------------------------------------

  const stageNames = [
    'original61',
    'original63',
    'patchedTest61',
    'common61',
    'common63',
    'common7',
    'common72',
    'common8',
  ];

  const stageStatus = {};

  for (const name of stageNames) {
    const doc = docs[name];
    const writes = safetyWrites(doc);

    stageStatus[name] = {
      version: doc.version ?? null,
      status: doc.status ?? null,
      databaseWrites: writes,
      outputFingerprint:
        doc.outputFingerprint ?? null,
    };

    if (
      ['common61', 'common63', 'common7', 'common72', 'common8']
        .includes(name) &&
      badStatus(doc.status)
    ) {
      issues.push({
        check: `${name}.status`,
        actual: doc.status ?? null,
        expected: 'NON_FAILED_NON_BLOCKED',
      });
    }

    if (
      writes !== null &&
      writes !== 0
    ) {
      issues.push({
        check: `${name}.databaseWrites`,
        actual: writes,
        expected: 0,
      });
    }
  }

  // ------------------------------------------------------------------
  // Common branch must be a subset of canonical V9.9.5.1.
  // ------------------------------------------------------------------

  const subsetViolations61 =
    rows61.filter(
      (row) =>
        !canonicalSet.has(keyOf(row)),
    );

  const subsetViolations63 =
    rows63.filter(
      (row) =>
        !canonicalSet.has(keyOf(row)),
    );

  if (subsetViolations61.length > 0) {
    issues.push({
      check:
        'common61.identityOutsideCanonical5_1',
      rows:
        subsetViolations61,
    });
  }

  if (subsetViolations63.length > 0) {
    issues.push({
      check:
        'common63.identityOutsideCanonical5_1',
      rows:
        subsetViolations63,
    });
  }

  const set61 =
    new Set(rows61.map(keyOf));

  const set63 =
    new Set(rows63.map(keyOf));

  const set7 =
    new Set(rows7.map(keyOf));

  const only61 =
    [...set61].filter(
      (key) => !set63.has(key),
    );

  const only63 =
    [...set63].filter(
      (key) => !set61.has(key),
    );

  if (
    only61.length > 0 ||
    only63.length > 0
  ) {
    issues.push({
      check:
        'common61To63.identitySetChanged',
      onlyIn61:
        only61,
      onlyIn63:
        only63,
    });
  }

  const only63Not7 =
    [...set63].filter(
      (key) => !set7.has(key),
    );

  const only7Not63 =
    [...set7].filter(
      (key) => !set63.has(key),
    );

  if (
    only63Not7.length > 0 ||
    only7Not63.length > 0
  ) {
    issues.push({
      check:
        'common63To7.identitySetChanged',
      onlyIn63:
        only63Not7,
      onlyIn7:
        only7Not63,
    });
  }

  const duplicate61 =
    rows61.length - set61.size;

  const duplicate63 =
    rows63.length - set63.size;

  const duplicate7 =
    rows7.length - set7.size;

  if (
    duplicate61 !== 0 ||
    duplicate63 !== 0 ||
    duplicate7 !== 0
  ) {
    issues.push({
      check:
        'duplicateCanonicalIdentities',
      common61:
        duplicate61,
      common63:
        duplicate63,
      common7:
        duplicate7,
    });
  }

  // ------------------------------------------------------------------
  // Prove authoritative downstream lineage from 6.3-common -> 7-common.
  // ------------------------------------------------------------------

  const lineage63To7 =
    lineageEvidence(
      docs.common7,
      docs.common63,
      path.basename(files.common63),
    );

  if (!lineage63To7.proven) {
    issues.push({
      check:
        'common7.sourceDoesNotProveCommon63Lineage',
      source:
        docs.common7.source ?? null,
      common63Version:
        docs.common63.version ?? null,
      common63OutputFingerprint:
        docs.common63.outputFingerprint ?? null,
      common63File:
        path.basename(files.common63),
    });
  }

  // Also inspect later branch continuity. These are positive lineage proofs,
  // not hard-coded version assumptions.
  const lineage7To72 =
    lineageEvidence(
      docs.common72,
      docs.common7,
      path.basename(files.common7),
    );

  const lineage72To8 =
    lineageEvidence(
      docs.common8,
      docs.common72,
      path.basename(files.common72),
    );

  if (!lineage7To72.proven) {
    issues.push({
      check:
        'common72.sourceDoesNotProveCommon7Lineage',
      source:
        docs.common72.source ?? null,
    });
  }

  if (!lineage72To8.proven) {
    issues.push({
      check:
        'common8.sourceDoesNotProveCommon72Lineage',
      source:
        docs.common8.source ?? null,
    });
  }

  // ------------------------------------------------------------------
  // 001570 structural chain continuity if it is in common-stock scope.
  // ------------------------------------------------------------------

  const find001570 =
    (rows) =>
      rows.filter(
        (row) =>
          row.stockCode === '001570' &&
          row.actionType === 'SPIN_OFF',
      );

  const r001570_61 =
    find001570(rows61);

  const r001570_63 =
    find001570(rows63);

  const r001570_7 =
    find001570(rows7);

  const commonBranchContains001570 =
    r001570_61.length > 0 ||
    r001570_63.length > 0 ||
    r001570_7.length > 0;

  if (commonBranchContains001570) {
    if (
      r001570_61.length !== 1 ||
      r001570_63.length !== 1 ||
      r001570_7.length !== 1
    ) {
      issues.push({
        check:
          '001570.identityContinuityAcrossCommonBranch',
        common61:
          r001570_61.length,
        common63:
          r001570_63.length,
        common7:
          r001570_7.length,
      });
    }

    for (
      const [stage, rows]
      of [
        ['common61', r001570_61],
        ['common63', r001570_63],
        ['common7', r001570_7],
      ]
    ) {
      if (
        rows.length === 1 &&
        rows[0].providerEventId !==
          '20260909000291'
      ) {
        issues.push({
          check:
            `${stage}.001570Root`,
          actual:
            rows[0].providerEventId,
          expected:
            '20260909000291',
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // REVERSE_SPLIT field quality on final extraction stage.
  // ------------------------------------------------------------------

  const raw63 =
    candidateRows(
      docs.common63,
    );

  const reverseSplitRows63 =
    raw63.filter(
      (row) =>
        normalizeAction(
          firstNonEmpty(
            row.actionType,
            row.action_type,
          ),
        ) ===
        'REVERSE_SPLIT',
    );

  const reverseSplitChecks =
    reverseSplitRows63.map(
      (row) => {
        const id =
          canonicalIdentity(row);

        const ratio =
          ratioInfo(row);

        const ready =
          ratio.ratioFrom !== null &&
          ratio.ratioTo !== null &&
          ratio.ratioFrom > 0 &&
          ratio.ratioTo > 0;

        return {
          ...id,
          ...ratio,
          ratioReady:
            ready,
        };
      },
    );

  const invalidReverseSplitRows =
    reverseSplitChecks.filter(
      (row) =>
        !row.ratioReady &&
        !/INCOMPLETE|REVIEW|UNRESOLVED|PENDING/i.test(
          row.parseStatus,
        ),
    );

  if (
    invalidReverseSplitRows.length > 0
  ) {
    issues.push({
      check:
        'common63.reverseSplitRatioInvalidWithoutExplicitReviewStatus',
      rows:
        invalidReverseSplitRows,
    });
  }

  // ------------------------------------------------------------------
  // 028080 must remain separate from this incremental branch.
  // ------------------------------------------------------------------

  const contains028080 =
    [...rows61, ...rows63, ...rows7]
      .some(
        (row) =>
          row.stockCode ===
          '028080',
      );

  if (contains028080) {
    issues.push({
      check:
        '028080InjectedIntoV99CommonStockIncrementalBranch',
      actual:
        true,
      expected:
        false,
    });
  }

  // ------------------------------------------------------------------
  // Scope summary: do not hard-code row count, but explain what was excluded
  // from the 7 V9.9 canonical chains by the authoritative common-stock branch.
  // ------------------------------------------------------------------

  const commonKeys =
    new Set(
      rows63.map(keyOf),
    );

  const excludedFromCommonScope =
    canonicalRows.filter(
      (row) =>
        !commonKeys.has(
          keyOf(row),
        ),
    );

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_6_COMMON_STOCK_FIELD_EXTRACTION_BRANCH_REUSABLE'
      : 'HISTORICAL_V9_9_6_COMMON_STOCK_FIELD_EXTRACTION_BRANCH_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      upstreamAuditVersion:
        docs.upstreamAudit.version,
      upstreamAuditFingerprint:
        docs.upstreamAudit.outputFingerprint ??
        null,

      canonical51Version:
        docs.canonical51.version ??
        null,
      canonical51Fingerprint:
        docs.canonical51.outputFingerprint ??
        null,

      common61Version:
        docs.common61.version ??
        null,
      common61Fingerprint:
        docs.common61.outputFingerprint ??
        null,

      common63Version:
        docs.common63.version ??
        null,
      common63Fingerprint:
        docs.common63.outputFingerprint ??
        null,

      common7Version:
        docs.common7.version ??
        null,
      common7Fingerprint:
        docs.common7.outputFingerprint ??
        null,
    },

    branchSelection: {
      originalBranchPresent:
        true,

      patchedTestPresent:
        true,

      commonStockBranchPresent:
        true,

      authoritativeBranch:
        'COMMON_STOCK_SCOPE',

      authorityProof:
        'DOWNSTREAM_COMMON_STOCK_7_7_2_8_LINEAGE_REFERENCES_COMMON_STOCK_BRANCH',

      originalBranchReuseForDownstream:
        false,

      commonStockBranchReuseForDownstream:
        reusable,
    },

    counts: {
      canonical5_1ActiveChains:
        canonicalRows.length,

      common61Rows:
        rows61.length,

      common63Rows:
        rows63.length,

      common7Rows:
        rows7.length,

      excludedFromCommonScope:
        excludedFromCommonScope.length,

      common61DuplicateIdentities:
        duplicate61,

      common63DuplicateIdentities:
        duplicate63,

      common7DuplicateIdentities:
        duplicate7,

      common61OutsideCanonical5_1:
        subsetViolations61.length,

      common63OutsideCanonical5_1:
        subsetViolations63.length,

      common61To63IdentityDelta:
        only61.length +
        only63.length,

      common63To7IdentityDelta:
        only63Not7.length +
        only7Not63.length,

      reverseSplitRowsInCommon63:
        reverseSplitChecks.length,

      reverseSplitInvalidWithoutExplicitReview:
        invalidReverseSplitRows.length,

      issues:
        issues.length,
    },

    actionTypeCounts: {
      canonical5_1:
        countActions(canonicalRows),

      common61:
        countActions(rows61),

      common63:
        countActions(rows63),

      common7:
        countActions(rows7),
    },

    excludedFromCommonScope,

    identityContinuity: {
      onlyInCommon61:
        only61,

      onlyInCommon63:
        only63,

      onlyInCommon63Not7:
        only63Not7,

      onlyInCommon7Not63:
        only7Not63,
    },

    lineage: {
      common63To7:
        lineage63To7,

      common7To72:
        lineage7To72,

      common72To8:
        lineage72To8,
    },

    structural001570: {
      commonBranchContains001570,

      common61Rows:
        r001570_61,

      common63Rows:
        r001570_63,

      common7Rows:
        r001570_7,

      expectedRoot:
        '20260909000291',
    },

    reverseSplitChecks,

    stageStatus,

    issues,

    conclusion: {
      historicalCommonStockV9961Reusable:
        reusable,

      historicalCommonStockV9963Reusable:
        reusable,

      historicalCommonStockV997InputLineageReusable:
        reusable,

      originalV996BranchIsAuthoritative:
        false,

      commonStockScopeBranchIsAuthoritative:
        reusable,

      safeToAdvanceToHistoricalV997_7_2_8ReuseAudit:
        reusable,

      networkRefetchRequired:
        false,

      physical028080RepairStillSeparate:
        true,

      physical028080RepairAddedToIncrementalBranch:
        false,
    },

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-authoritative-field-extraction-reuse-v9-9-6-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        branchSelection:
          report.branchSelection,

        counts:
          report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        excludedFromCommonScope:
          report.excludedFromCommonScope,

        identityContinuity:
          report.identityContinuity,

        lineage:
          report.lineage,

        structural001570:
          report.structural001570,

        reverseSplitChecks:
          report.reverseSplitChecks,

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

        branchSelection:
          report.branchSelection,

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        excludedFromCommonScope:
          report.excludedFromCommonScope,

        lineageProof: {
          common63To7:
            report.lineage
              .common63To7.proven,

          common7To72:
            report.lineage
              .common7To72.proven,

          common72To8:
            report.lineage
              .common72To8.proven,
        },

        structural001570:
          report.structural001570,

        reverseSplitChecks:
          report.reverseSplitChecks,

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
          'HISTORICAL_V9_9_6_COMMON_STOCK_FIELD_EXTRACTION_REUSE_AUDIT_FAILED',

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
