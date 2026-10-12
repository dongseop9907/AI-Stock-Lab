#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.10.1 / 10.2.1 / 10.3 common-stock structural-date reuse audit V2
 *
 * Fixes one audit-method defect from V1:
 *
 * V1 incorrectly required ALL 3 structural identities to appear in V9.9.10.2.1.
 * Historical 10.2.1 explicitly consumes audit.reviewQueue, so only the subset
 * that 10.1 sends to review/probe is expected in 10.2.1.
 *
 * V2 contract:
 * - common8 contains exactly 3 structural rows, all STRUCTURAL_BLOCKED
 * - 10.1 covers all 3 structural identities
 * - derive current-batch review targets from audit101.reviewQueue
 * - 10.2.1 must cover every review target (NOT every structural row)
 * - 10.3 must finalize all 3 structural identities
 * - all 3 final effective dates are ISO dates and > 2026-10-01
 * - no generic structural factor leak
 * - no DB writes / no network in this audit
 * - 028080 remains separate
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_10_1_10_2_1_10_3_REPLAY_V2_REVIEW_QUEUE_AWARE_COMMON_STOCK_STRUCTURAL_DATE_REUSE_AUDIT';

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

const ALLOWED_PROBE_BASES = new Set([
  'STRUCTURED_EXACT_SOURCE_RECEIPT',
  'STRUCTURED_EXACT_CANONICAL_ROOT_RECEIPT',
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
  const text =
    String(value ?? '').trim();

  return /^\d{14}$/.test(text)
    ? text
    : '';
}

function normalizeStock(value) {
  const text =
    String(value ?? '').trim();

  return text
    ? text.padStart(6, '0')
    : '';
}

function normalizeAction(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/
    .test(String(value ?? ''));
}

function badStageStatus(value) {
  const text =
    String(value ?? '')
      .toUpperCase();

  return (
    text.includes('FAILED') ||
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

function recursiveObjects(
  value,
  out = [],
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return out;
  }

  if (!Array.isArray(value)) {
    out.push(value);
  }

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === 'object'
    ) {
      recursiveObjects(child, out);
    }
  }

  return out;
}

function identity(row) {
  const cp =
    row?.canonicalPreview ?? {};

  const fv =
    row?.factorValidation ?? {};

  const finalRow =
    row?.finalRow ?? {};

  const finalCp =
    finalRow?.canonicalPreview ?? {};

  return {
    providerEventId:
      normalizeReceipt(
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

    stockCode:
      normalizeStock(
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

    actionType:
      normalizeAction(
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

    sourceReceiptNo:
      normalizeReceipt(
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

function keyFromId(id) {
  return [
    id.providerEventId,
    id.stockCode,
    id.actionType,
  ].join('|');
}

function keyOf(row) {
  return keyFromId(identity(row));
}

function isExpectedStructuralIdentity(id) {
  return (
    EXPECTED_STRUCTURAL.get(
      id.stockCode,
    ) === id.actionType
  );
}

function currentStructuralObjects(doc) {
  const out = [];

  for (const obj of recursiveObjects(doc)) {
    const id = identity(obj);

    if (
      !id.providerEventId ||
      !isExpectedStructuralIdentity(id)
    ) {
      continue;
    }

    out.push({
      obj,
      id,
      key:
        keyFromId(id),
    });
  }

  return out;
}

function uniqueIdentityMap(doc) {
  const map =
    new Map();

  for (
    const row
    of currentStructuralObjects(doc)
  ) {
    if (!map.has(row.key)) {
      map.set(
        row.key,
        row,
      );
    }
  }

  return map;
}

function extractFactorStatus(obj) {
  return String(
    firstNonEmpty(
      obj.factorValidation?.status,
      obj.factor_validation?.status,
      obj.factorStatus,
      obj.factor_status,
      obj.canonicalPreview
        ?.metadata
        ?.factor_status,
      obj.finalRow
        ?.factorValidation
        ?.status,
      obj.finalRow
        ?.factor_status,
      obj.finalRow
        ?.canonicalPreview
        ?.metadata
        ?.factor_status,
    ) ?? '',
  ).toUpperCase();
}

function extractEffectiveDate(obj) {
  const cp =
    obj?.canonicalPreview ?? {};

  const finalRow =
    obj?.finalRow ?? {};

  const finalCp =
    finalRow?.canonicalPreview ?? {};

  return firstNonEmpty(
    finalCp.effective_date,
    finalCp.effectiveDate,
    finalRow.effective_date,
    finalRow.effectiveDate,
    cp.effective_date,
    cp.effectiveDate,
    obj.effective_date,
    obj.effectiveDate,
    obj.finalEffectiveDate,
    obj.final_effective_date,
  );
}

function extractPrimaryDateCandidate(obj) {
  return firstNonEmpty(
    obj.primaryDateCandidate,
    obj.primary_date_candidate,
  );
}

function extractProbeBasis(obj) {
  return firstNonEmpty(
    obj.strongestCandidate?.basis,
    obj.strongest_candidate?.basis,
    obj.resolutionBasis,
    obj.resolution_basis,
    obj.basis,
  );
}

function extractProbeDate(obj) {
  return firstNonEmpty(
    obj.strongestCandidate?.date,
    obj.strongest_candidate?.date,
    obj.resolvedDate,
    obj.resolved_date,
    obj.effectiveDate,
    obj.effective_date,
  );
}

function arrayOf(doc, ...names) {
  for (const name of names) {
    if (Array.isArray(doc?.[name])) {
      return doc[name];
    }
  }

  return [];
}

function countActions(rows) {
  const out = {};

  for (const row of rows) {
    const action =
      row.actionType ||
      'UNKNOWN';

    out[action] =
      (out[action] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    upstream:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-multi-event-cumulative-reuse-v9-9-9-10-common-stock-replay.json',
      ),

    factor8:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
      ),

    audit101:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-structural-date-audit-v9-9-10-1-common-stock-scope.json',
      ),

    probe1021:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-structural-date-probe-v9-9-10-2-1-common-stock-scope.json',
      ),

    final103:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
      ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-reuse-v9-9-10-1-10-2-1-10-3-common-stock-replay-v2.json',
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
    docs.upstream.version ===
      UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstream.version}`,
  );

  assert(
    docs.upstream.status ===
      UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstream.status}`,
  );

  assert(
    docs.upstream.conclusion
      ?.safeToAdvanceToHistoricalV9910_1_2_1_3StructuralDateReuseAudit ===
      true,
    'UPSTREAM_NOT_READY',
  );

  const issues = [];

  // ---------------------------------------------------------------
  // Exact structural identity set comes from factor8.
  // ---------------------------------------------------------------

  const factorRows =
    Array.isArray(
      docs.factor8.results,
    )
      ? docs.factor8.results
      : [];

  const structuralFactorRows =
    factorRows
      .map(
        (row) => ({
          ...identity(row),

          factorStatus:
            extractFactorStatus(row),
        }),
      )
      .filter(
        (row) =>
          isExpectedStructuralIdentity(
            row,
          ),
      );

  if (
    structuralFactorRows.length !==
    3
  ) {
    issues.push({
      check:
        'factor8.structuralIdentityCount',

      actual:
        structuralFactorRows.length,

      expected:
        3,
    });
  }

  for (
    const row
    of structuralFactorRows
  ) {
    if (
      row.factorStatus !==
      'STRUCTURAL_BLOCKED'
    ) {
      issues.push({
        check:
          'factor8.structuralMustRemainBlocked',

        row,

        expected:
          'STRUCTURAL_BLOCKED',
      });
    }
  }

  const expectedKeys =
    new Set(
      structuralFactorRows
        .map(keyFromId),
    );

  // ---------------------------------------------------------------
  // 10.1 covers all three and defines which rows need probe.
  // ---------------------------------------------------------------

  const auditMap =
    uniqueIdentityMap(
      docs.audit101,
    );

  const auditMissing =
    [...expectedKeys]
      .filter(
        (key) =>
          !auditMap.has(key),
      );

  if (
    auditMissing.length > 0
  ) {
    issues.push({
      check:
        'audit101.missingStructuralIdentities',

      missing:
        auditMissing,
    });
  }

  const reviewQueue =
    arrayOf(
      docs.audit101,
      'reviewQueue',
    );

  assert(
    Array.isArray(reviewQueue),
    'AUDIT101_REVIEW_QUEUE_MISSING',
  );

  const currentReviewRows =
    reviewQueue
      .map(
        (row) => ({
          ...identity(row),

          primaryDateCandidate:
            extractPrimaryDateCandidate(
              row,
            ),
        }),
      )
      .filter(
        (row) =>
          expectedKeys.has(
            keyFromId(row),
          ),
      );

  const reviewKeys =
    new Set(
      currentReviewRows
        .map(keyFromId),
    );

  const auditSafeKeys =
    new Set(
      [...expectedKeys]
        .filter(
          (key) =>
            !reviewKeys.has(key),
        ),
    );

  // Every expected structural row must be exactly one of:
  // audit-safe OR review/probe.
  if (
    auditSafeKeys.size +
      reviewKeys.size !==
    expectedKeys.size
  ) {
    issues.push({
      check:
        'audit101.safeReviewPartition',

      expected:
        expectedKeys.size,

      auditSafe:
        auditSafeKeys.size,

      review:
        reviewKeys.size,
    });
  }

  // Review rows should not be considered directly promotable by 10.1.
  for (
    const row
    of currentReviewRows
  ) {
    if (
      row.primaryDateCandidate &&
      !isIsoDate(
        row.primaryDateCandidate,
      )
    ) {
      issues.push({
        check:
          'audit101.reviewPrimaryDateMalformed',

        row,
      });
    }
  }

  // ---------------------------------------------------------------
  // 10.2.1 is REVIEW-QUEUE ONLY.
  // ---------------------------------------------------------------

  const probeMap =
    uniqueIdentityMap(
      docs.probe1021,
    );

  const missingReviewProbeKeys =
    [...reviewKeys]
      .filter(
        (key) =>
          !probeMap.has(key),
      );

  if (
    missingReviewProbeKeys.length >
    0
  ) {
    issues.push({
      check:
        'probe1021.missingReviewQueueTargets',

      missing:
        missingReviewProbeKeys,
    });
  }

  // It is allowed for diagnostic content to mention other current structural
  // rows, but only reviewQueue targets are REQUIRED.
  const probeRequiredRows = [];

  for (
    const key
    of reviewKeys
  ) {
    const holder =
      probeMap.get(key);

    if (!holder) continue;

    const basis =
      extractProbeBasis(
        holder.obj,
      );

    const date =
      extractProbeDate(
        holder.obj,
      );

    const row = {
      ...holder.id,

      strongestCandidateBasis:
        basis === null
          ? null
          : String(basis),

      strongestCandidateDate:
        date === null
          ? null
          : String(date),

      allowedBasis:
        basis === null
          ? null
          : ALLOWED_PROBE_BASES
              .has(
                String(basis),
              ),

      validDate:
        isIsoDate(date),
    };

    probeRequiredRows.push(
      row,
    );

    // 10.3 historical contract only accepts an exact structured basis when
    // the probe is actually used for finalization.
    if (
      basis &&
      !ALLOWED_PROBE_BASES.has(
        String(basis),
      )
    ) {
      issues.push({
        check:
          'probe1021.reviewTargetBasisNotAllowed',

        row,
      });
    }

    if (
      date &&
      !isIsoDate(date)
    ) {
      issues.push({
        check:
          'probe1021.reviewTargetDateMalformed',

        row,
      });
    }
  }

  // ---------------------------------------------------------------
  // 10.3 MUST converge all three rows back into one finalized set.
  // ---------------------------------------------------------------

  const finalMap =
    uniqueIdentityMap(
      docs.final103,
    );

  const finalMissing =
    [...expectedKeys]
      .filter(
        (key) =>
          !finalMap.has(key),
      );

  if (
    finalMissing.length > 0
  ) {
    issues.push({
      check:
        'final103.missingStructuralIdentities',

      missing:
        finalMissing,
    });
  }

  const finalizedStructural = [];

  for (
    const key
    of expectedKeys
  ) {
    const holder =
      finalMap.get(key);

    if (!holder) continue;

    const date =
      extractEffectiveDate(
        holder.obj,
      );

    const factorStatus =
      extractFactorStatus(
        holder.obj,
      );

    const row = {
      ...holder.id,

      path:
        reviewKeys.has(key)
          ? 'REVIEW_QUEUE_PROBE'
          : 'AUDIT_SAFE',

      effectiveDate:
        date === null
          ? null
          : String(date),

      factorStatus:
        factorStatus ||
        null,

      validIsoDate:
        isIsoDate(date),

      futureAtSnapshot:
        isIsoDate(date) &&
        String(date) >
          SNAPSHOT_AS_OF,
    };

    finalizedStructural.push(
      row,
    );

    if (!row.validIsoDate) {
      issues.push({
        check:
          'final103.structuralEffectiveDateRequired',

        row,
      });
    }

    if (
      row.validIsoDate &&
      !row.futureAtSnapshot
    ) {
      issues.push({
        check:
          'final103.structuralDateExpectedFutureAtSnapshot',

        row,

        snapshotAsOf:
          SNAPSHOT_AS_OF,
      });
    }

    if (
      row.factorStatus &&
      row.factorStatus !==
        'STRUCTURAL_BLOCKED'
    ) {
      issues.push({
        check:
          'final103.structuralFactorStatusChanged',

        row,

        expected:
          'STRUCTURAL_BLOCKED',
      });
    }
  }

  if (
    finalizedStructural.length !==
    3
  ) {
    issues.push({
      check:
        'final103.finalizedStructuralCount',

      actual:
        finalizedStructural.length,

      expected:
        3,
    });
  }

  const actionTypeCounts =
    countActions(
      finalizedStructural,
    );

  if (
    Number(
      actionTypeCounts.MERGER ??
      0,
    ) !== 2
  ) {
    issues.push({
      check:
        'final103.mergerCount',

      actual:
        Number(
          actionTypeCounts.MERGER ??
          0,
        ),

      expected:
        2,
    });
  }

  if (
    Number(
      actionTypeCounts.SPIN_OFF ??
      0,
    ) !== 1
  ) {
    issues.push({
      check:
        'final103.spinOffCount',

      actual:
        Number(
          actionTypeCounts.SPIN_OFF ??
          0,
        ),

      expected:
        1,
    });
  }

  // ---------------------------------------------------------------
  // No generic factor leak.
  // ---------------------------------------------------------------

  const structuralGenericFactorLeak =
    recursiveObjects(
      docs.final103,
    )
      .filter(
        (obj) => {
          const id =
            identity(obj);

          if (
            !isExpectedStructuralIdentity(
              id,
            )
          ) {
            return false;
          }

          const factorCandidates = [
            obj.event_price_factor,
            obj.eventPriceFactor,
            obj.cumulative_price_factor,
            obj.cumulativePriceFactor,
            obj.factor?.eventPriceFactor,
            obj.factor?.event_price_factor,
          ];

          return factorCandidates
            .some(
              (value) =>
                Number(value) >
                0,
            );
        },
      );

  if (
    structuralGenericFactorLeak.length >
    0
  ) {
    issues.push({
      check:
        'final103.genericStructuralFactorLeak',

      rows:
        structuralGenericFactorLeak
          .map(identity),
    });
  }

  // ---------------------------------------------------------------
  // Stage status / no writes.
  // ---------------------------------------------------------------

  const stageStatus = {};

  for (
    const name
    of [
      'audit101',
      'probe1021',
      'final103',
    ]
  ) {
    const doc =
      docs[name];

    const writes =
      safetyWrites(doc);

    stageStatus[name] = {
      version:
        doc.version ??
        null,

      status:
        doc.status ??
        null,

      databaseWrites:
        writes,

      outputFingerprint:
        doc.outputFingerprint ??
        null,
    };

    if (
      badStageStatus(
        doc.status,
      )
    ) {
      issues.push({
        check:
          `${name}.status`,

        actual:
          doc.status ??
          null,

        expected:
          'NON_FAILED_NON_INVALID',
      });
    }

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

  // 028080 remains outside current V9.9 incremental branch.
  const contains028080 =
    ['audit101', 'probe1021', 'final103']
      .some(
        (name) =>
          recursiveObjects(
            docs[name],
          )
            .some(
              (obj) =>
                normalizeStock(
                  firstNonEmpty(
                    obj.stockCode,
                    obj.stock_code,
                    obj.canonicalPreview
                      ?.stock_code,
                  ),
                ) ===
                '028080',
            ),
      );

  if (contains028080) {
    issues.push({
      check:
        '028080InjectedIntoV99StructuralDateBranch',

      actual:
        true,

      expected:
        false,
    });
  }

  const allThreeFuture =
    finalizedStructural.length ===
      3 &&
    finalizedStructural
      .every(
        (row) =>
          row.futureAtSnapshot,
      );

  const partitionComplete =
    auditSafeKeys.size +
      reviewKeys.size ===
      expectedKeys.size;

  const probeCoverageCorrect =
    missingReviewProbeKeys.length ===
    0;

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_RESULTS_REUSABLE_AFTER_REVIEW_QUEUE_SEMANTICS'
      : 'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_STRUCTURAL_DATE_REUSE_V2_BLOCKED';

  const report = {
    status,
    version: VERSION,

    evidenceSnapshotAsOf:
      SNAPSHOT_AS_OF,

    source: {
      upstreamVersion:
        docs.upstream.version,

      upstreamFingerprint:
        docs.upstream
          .outputFingerprint ??
        null,

      factor8Version:
        docs.factor8.version ??
        null,

      audit101Version:
        docs.audit101.version ??
        null,

      probe1021Version:
        docs.probe1021.version ??
        null,

      final103Version:
        docs.final103.version ??
        null,
    },

    counts: {
      structuralFactorRows:
        structuralFactorRows.length,

      expectedStructuralIdentities:
        expectedKeys.size,

      audit101StructuralIdentitiesPresent:
        [...expectedKeys]
          .filter(
            (key) =>
              auditMap.has(key),
          )
          .length,

      auditSafeStructuralRows:
        auditSafeKeys.size,

      reviewQueueStructuralRows:
        reviewKeys.size,

      probeRequiredStructuralRows:
        reviewKeys.size,

      probeRequiredStructuralRowsPresent:
        reviewKeys.size -
        missingReviewProbeKeys.length,

      final103StructuralIdentitiesPresent:
        [...expectedKeys]
          .filter(
            (key) =>
              finalMap.has(key),
          )
          .length,

      finalizedStructuralRows:
        finalizedStructural.length,

      mergerRows:
        Number(
          actionTypeCounts.MERGER ??
          0,
        ),

      spinOffRows:
        Number(
          actionTypeCounts.SPIN_OFF ??
          0,
        ),

      validFinalEffectiveDates:
        finalizedStructural
          .filter(
            (row) =>
              row.validIsoDate,
          )
          .length,

      futureStructuralAtSnapshot:
        finalizedStructural
          .filter(
            (row) =>
              row.futureAtSnapshot,
          )
          .length,

      structuralGenericFactorLeaks:
        structuralGenericFactorLeak.length,

      issues:
        issues.length,
    },

    structuralPathPartition: {
      auditSafeKeys:
        [...auditSafeKeys],

      reviewQueueKeys:
        [...reviewKeys],

      partitionComplete,
    },

    reviewQueueStructuralRows:
      currentReviewRows,

    probeRequiredRows,

    finalizedStructural,

    actionTypeCounts,

    stageStatus,

    issues,

    conclusion: {
      historicalV9910_1StructuralAuditReusable:
        reusable,

      historicalV9910_2_1StructuralProbeReusable:
        reusable,

      historicalV9910_3StructuralFinalizationReusable:
        reusable,

      v1BlockWasProbeScopeAuditMethodFalsePositive:
        reusable,

      probeIsReviewQueueScoped:
        true,

      structuralSafeReviewPartitionComplete:
        reusable &&
        partitionComplete,

      requiredReviewTargetsAllProbed:
        reusable &&
        probeCoverageCorrect,

      allThreeStructuralDatesFinalized:
        reusable &&
        finalizedStructural.length ===
          3,

      allThreeStructuralRowsFutureAt2026_10_01:
        reusable &&
        allThreeFuture,

      genericStructuralFactorsRemainBlocked:
        reusable &&
        structuralGenericFactorLeak.length ===
          0,

      safeToAdvanceToHistoricalV9_9_11_4_5_5_1ReuseAudit:
        reusable,

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

      coverageWindowAdvancedNow:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_11_4_11_5_11_5_1_COMMON_STOCK_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-structural-date-reuse-v9-9-10-1-10-2-1-10-3-common-stock-replay-v2.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        evidenceSnapshotAsOf:
          report.evidenceSnapshotAsOf,

        counts:
          report.counts,

        structuralPathPartition:
          report.structuralPathPartition,

        reviewQueueStructuralRows:
          report.reviewQueueStructuralRows,

        probeRequiredRows:
          report.probeRequiredRows,

        finalizedStructural:
          report.finalizedStructural,

        stageStatus:
          report.stageStatus,

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

        evidenceSnapshotAsOf:
          report.evidenceSnapshotAsOf,

        ...report.counts,

        structuralPathPartition:
          report.structuralPathPartition,

        probeRequiredRows:
          report.probeRequiredRows,

        finalizedStructural:
          report.finalizedStructural,

        stageStatus:
          report.stageStatus,

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
          'HISTORICAL_V9_9_10_1_10_2_1_10_3_COMMON_STOCK_REUSE_V2_AUDIT_FAILED',

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
