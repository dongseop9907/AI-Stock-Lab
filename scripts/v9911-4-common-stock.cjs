/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.4 - Corrected production canonical-event preflight
 *
 * READ-ONLY. GET only. No DB writes.
 *
 * Correct remote DB contract:
 *   - production namespace: is_validation = false
 *   - corporate_action_events.production_applied MUST remain false
 *   - canonical validity: metadata.canonical_validation_status = VALIDATED
 *
 * Input:
 *   logs/opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json
 *
 * Output:
 *   logs/opendart-corporate-action-production-event-preflight-v9-9-11-4-common-stock-scope.json
 *
 * Expected current batch:
 *   total canonical identities = 159
 *   persistable now           = 158
 *     factor supported        = 121
 *     structural blocked      = 37
 *   future pending            = 1
 *
 * Expected DB overlap after V9.8.11.3.3 repair:
 *   compatible existing       = 5
 *   would insert              = 153
 *   conflicts                 = 0
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-4.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_4_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_TOTAL = 6;
const EXPECTED_PERSISTABLE = 5;
const EXPECTED_FACTOR_SUPPORTED = 2;
const EXPECTED_STRUCTURAL = 3;
const EXPECTED_FUTURE_PENDING = 1;

const SUPPORTED = new Set([
  'CASH_DIVIDEND',
  'STOCK_DIVIDEND',
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
]);

const STRUCTURAL = new Set([
  'MERGER',
  'SPIN_OFF',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key = String(selector(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function sameNumeric(a, b) {
  const x = num(a);
  const y = num(b);

  if (
    x === null ||
    y === null
  ) {
    return (
      x === null &&
      y === null
    );
  }

  return (
    Math.abs(x - y) <=
    1e-12
  );
}

function normalizeCurrency(value) {
  const text =
    String(value ?? '')
      .trim()
      .toUpperCase();

  return text || null;
}

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date =
    new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'SUPABASE_URL_REQUIRED',
    );
  }

  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY_REQUIRED',
    );
  }

  return {
    url:
      String(url).replace(/\/+$/, ''),
    key:
      String(key),
  };
}

async function getArray(url, key) {
  const response =
    await fetch(
      url,
      {
        method:
          'GET',

        headers: {
          apikey:
            key,

          Authorization:
            `Bearer ${key}`,

          Accept:
            'application/json',
        },
      },
    );

  const text =
    await response.text();

  let body;

  try {
    body =
      JSON.parse(text);
  } catch {
    throw new Error(
      'INVALID_SUPABASE_JSON_RESPONSE',
    );
  }

  if (!response.ok) {
    const code =
      body?.code ??
      `HTTP_${response.status}`;

    throw new Error(
      `SUPABASE_READ_FAILED:${String(code)}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_ARRAY_RESPONSE_REQUIRED',
    );
  }

  return body;
}

async function readExistingCanonicalEvents(
  base,
  key,
) {
  const select =
    [
      'id',
      'stock_code',
      'action_type',
      'effective_date',
      'ratio_from',
      'ratio_to',
      'cash_amount',
      'currency',
      'provider',
      'provider_event_id',
      'source_fingerprint',
      'status',
      'metadata',
      'is_validation',
      'production_applied',
      'created_at',
    ].join(',');

  return getArray(
    `${base}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.false` +
    `&order=provider_event_id.asc`,
    key,
  );
}

function buildDesiredRow(row) {
  const effectiveDate =
    row.canonicalPreview
      ?.effective_date ??
    null;

  const ratioFrom =
    num(
      row.canonicalPreview
        ?.ratio_from,
    );

  const ratioTo =
    num(
      row.canonicalPreview
        ?.ratio_to,
    );

  const cashAmount =
    num(
      row.canonicalPreview
        ?.cash_amount,
    );

  const actionType =
    row.actionType;

  const factorStatus =
    row.factorValidation
      ?.status ??
    null;

  return {
    stock_code:
      row.stockCode,

    action_type:
      actionType,

    effective_date:
      effectiveDate,

    ratio_from:
      ratioFrom,

    ratio_to:
      ratioTo,

    cash_amount:
      cashAmount,

    currency:
      actionType ===
      'CASH_DIVIDEND'
        ? (
            normalizeCurrency(
              row.canonicalPreview
                ?.currency,
            ) ??
            'KRW'
          )
        : null,

    provider:
      PROVIDER,

    provider_event_id:
      row.providerEventId,

    source_fingerprint:
      row.sourceFingerprint,

    status:
      'RECORDED',

    metadata: {
      canonical_validation_status:
        'VALIDATED',

      pipeline_version:
        'V9_8',

      source_receipt_no:
        row.sourceReceiptNo,

      source_kind:
        row.sourceKind,

      factor_status:
        factorStatus,

      structural_factor_blocked:
        STRUCTURAL.has(
          actionType,
        ),

      canonical_event_production_contract:
        'IS_VALIDATION_FALSE_WITH_PRODUCTION_APPLIED_FALSE',

      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',
    },

    is_validation:
      false,

    // REQUIRED BY REMOTE CHECK CONSTRAINT.
    production_applied:
      false,
  };
}

function validateDesiredRow(row) {
  const issues = [];

  if (!row.stock_code) {
    issues.push(
      'STOCK_CODE_REQUIRED',
    );
  }

  if (
    !row.provider_event_id
  ) {
    issues.push(
      'PROVIDER_EVENT_ID_REQUIRED',
    );
  }

  if (
    !row.source_fingerprint
  ) {
    issues.push(
      'SOURCE_FINGERPRINT_REQUIRED',
    );
  }

  if (
    !isIsoDate(
      row.effective_date,
    )
  ) {
    issues.push(
      'EFFECTIVE_DATE_REQUIRED',
    );
  }

  if (
    row.provider !==
    PROVIDER
  ) {
    issues.push(
      'PROVIDER_MISMATCH',
    );
  }

  if (
    row.status !==
    'RECORDED'
  ) {
    issues.push(
      'STATUS_MISMATCH',
    );
  }

  if (
    row.is_validation !==
    false
  ) {
    issues.push(
      'VALIDATION_FLAG_MUST_BE_FALSE',
    );
  }

  if (
    row.production_applied !==
    false
  ) {
    issues.push(
      'PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  if (
    SUPPORTED.has(
      row.action_type,
    )
  ) {
    if (
      row.action_type ===
      'CASH_DIVIDEND'
    ) {
      if (
        row.cash_amount ===
          null ||
        !(row.cash_amount >= 0)
      ) {
        issues.push(
          'CASH_AMOUNT_REQUIRED',
        );
      }

      if (
        row.currency !==
        'KRW'
      ) {
        issues.push(
          'CASH_CURRENCY_NOT_KRW',
        );
      }

      if (
        row.ratio_from !==
          null ||
        row.ratio_to !==
          null
      ) {
        issues.push(
          'CASH_RATIO_MUST_BE_NULL',
        );
      }
    } else {
      if (
        !(row.ratio_from > 0) ||
        !(row.ratio_to > 0)
      ) {
        issues.push(
          'RATIO_REQUIRED',
        );
      }

      if (
        row.cash_amount !==
        null
      ) {
        issues.push(
          'RATIO_ACTION_CASH_MUST_BE_NULL',
        );
      }
    }
  } else if (
    STRUCTURAL.has(
      row.action_type,
    )
  ) {
    if (
      row.ratio_from !==
        null ||
      row.ratio_to !==
        null ||
      row.cash_amount !==
        null
    ) {
      issues.push(
        'STRUCTURAL_NUMERIC_FIELDS_MUST_BE_NULL',
      );
    }
  } else {
    issues.push(
      'UNEXPECTED_ACTION_TYPE',
    );
  }

  return issues;
}

function compareExisting(
  existing,
  desired,
) {
  const mismatches = [];

  function check(
    field,
    actual,
    expected,
  ) {
    if (actual !== expected) {
      mismatches.push({
        field,
        actual,
        expected,
      });
    }
  }

  check(
    'stock_code',
    existing.stock_code,
    desired.stock_code,
  );

  check(
    'action_type',
    existing.action_type,
    desired.action_type,
  );

  check(
    'effective_date',
    existing.effective_date,
    desired.effective_date,
  );

  if (
    !sameNumeric(
      existing.ratio_from,
      desired.ratio_from,
    )
  ) {
    mismatches.push({
      field:
        'ratio_from',

      actual:
        existing.ratio_from,

      expected:
        desired.ratio_from,
    });
  }

  if (
    !sameNumeric(
      existing.ratio_to,
      desired.ratio_to,
    )
  ) {
    mismatches.push({
      field:
        'ratio_to',

      actual:
        existing.ratio_to,

      expected:
        desired.ratio_to,
    });
  }

  if (
    !sameNumeric(
      existing.cash_amount,
      desired.cash_amount,
    )
  ) {
    mismatches.push({
      field:
        'cash_amount',

      actual:
        existing.cash_amount,

      expected:
        desired.cash_amount,
    });
  }

  check(
    'currency',
    normalizeCurrency(
      existing.currency,
    ),
    normalizeCurrency(
      desired.currency,
    ),
  );

  check(
    'provider',
    existing.provider,
    desired.provider,
  );

  check(
    'provider_event_id',
    existing.provider_event_id,
    desired.provider_event_id,
  );

  check(
    'source_fingerprint',
    existing.source_fingerprint,
    desired.source_fingerprint,
  );

  check(
    'status',
    existing.status,
    'RECORDED',
  );

  check(
    'is_validation',
    existing.is_validation,
    false,
  );

  // REMOTE DB CONTRACT: must remain false.
  check(
    'production_applied',
    existing.production_applied,
    false,
  );

  // Existing canonical rows from V9.7 are compatible if semantically correct
  // and already marked VALIDATED. We do NOT require metadata.pipeline_version=V9_8.
  const canonicalStatus =
    existing.metadata
      ?.canonical_validation_status ??
    null;

  check(
    'metadata.canonical_validation_status',
    canonicalStatus,
    'VALIDATED',
  );

  return mismatches;
}

async function main() {
  if (
    typeof fetch !==
    'function'
  ) {
    throw new Error(
      'NODE_18_OR_NEWER_REQUIRED',
    );
  }

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-production-event-preflight-v9-9-11-4-common-stock-scope.json',
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(
      inputFile,
    );

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    input.status !==
    'STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW_COMPLETE'
  ) {
    throw new Error(
      'STRUCTURAL_DATE_STAGE_NOT_COMPLETE',
    );
  }

  if (
    !Array.isArray(
      input.results,
    )
  ) {
    throw new Error(
      'INPUT_RESULTS_MISSING',
    );
  }

  if (
    input.results.length !==
    EXPECTED_TOTAL
  ) {
    throw new Error(
      'EXPECTED_159_CANONICAL_IDENTITIES',
    );
  }

  const futurePending =
    input.results.filter(
      (row) =>
        row.factorValidation
          ?.status ===
        'FUTURE_PENDING',
    );

  const persistableSourceRows =
    input.results.filter(
      (row) =>
        row.factorValidation
          ?.status !==
        'FUTURE_PENDING',
    );

  const factorSupported =
    persistableSourceRows.filter(
      (row) =>
        row.factorValidation
          ?.status ===
        'FACTOR_READY',
    );

  const structural =
    persistableSourceRows.filter(
      (row) =>
        row.factorValidation
          ?.status ===
        'STRUCTURAL_BLOCKED',
    );

  if (
    persistableSourceRows.length !==
      EXPECTED_PERSISTABLE ||
    factorSupported.length !==
      EXPECTED_FACTOR_SUPPORTED ||
    structural.length !==
      EXPECTED_STRUCTURAL ||
    futurePending.length !==
      EXPECTED_FUTURE_PENDING
  ) {
    throw new Error(
      'BATCH_COUNT_CONTRACT_FAILED',
    );
  }

  const desiredRows =
    persistableSourceRows.map(
      buildDesiredRow,
    );

  const desiredIssues =
    desiredRows
      .map(
        (row) => ({
          providerEventId:
            row.provider_event_id,

          issues:
            validateDesiredRow(
              row,
            ),
        }),
      )
      .filter(
        (row) =>
          row.issues.length >
          0,
      );

  const desiredIdentityCount =
    new Set(
      desiredRows.map(
        (row) =>
          `${row.provider}|${row.provider_event_id}|${row.is_validation}`,
      ),
    ).size;

  const desiredFingerprintCount =
    new Set(
      desiredRows.map(
        (row) =>
          row.source_fingerprint,
      ),
    ).size;

  const {
    url,
    key,
  } =
    requireEnv();

  const existingRows =
    await readExistingCanonicalEvents(
      url,
      key,
    );

  const existingIdentityGroups =
    new Map();

  for (const row of existingRows) {
    const keyId =
      `${row.provider}|${row.provider_event_id}|${row.is_validation}`;

    if (
      !existingIdentityGroups.has(
        keyId,
      )
    ) {
      existingIdentityGroups.set(
        keyId,
        [],
      );
    }

    existingIdentityGroups
      .get(keyId)
      .push(row);
  }

  const existingDuplicateIdentities =
    [...existingIdentityGroups.entries()]
      .filter(
        ([, rows]) =>
          rows.length >
          1,
      )
      .map(
        ([identity, rows]) => ({
          identity,
          rowCount:
            rows.length,

          ids:
            rows.map(
              (row) =>
                row.id,
            ),
        }),
      );

  const existingByProviderEventId =
    new Map();

  for (const row of existingRows) {
    if (
      !existingByProviderEventId.has(
        row.provider_event_id,
      )
    ) {
      existingByProviderEventId.set(
        row.provider_event_id,
        [],
      );
    }

    existingByProviderEventId
      .get(row.provider_event_id)
      .push(row);
  }

  const wouldInsert = [];
  const alreadyCompatible = [];
  const conflicts = [];

  for (const desired of desiredRows) {
    const matches =
      existingByProviderEventId.get(
        desired.provider_event_id,
      ) ??
      [];

    if (
      matches.length ===
      0
    ) {
      wouldInsert.push(
        desired,
      );

      continue;
    }

    if (
      matches.length >
      1
    ) {
      conflicts.push({
        providerEventId:
          desired.provider_event_id,

        reason:
          'MULTIPLE_EXISTING_PRODUCTION_ROWS_FOR_PROVIDER_EVENT_ID',

        existingIds:
          matches.map(
            (row) =>
              row.id,
          ),
      });

      continue;
    }

    const existing =
      matches[0];

    const mismatches =
      compareExisting(
        existing,
        desired,
      );

    if (
      mismatches.length ===
      0
    ) {
      alreadyCompatible.push({
        providerEventId:
          desired.provider_event_id,

        existingEventId:
          existing.id,

        stockCode:
          desired.stock_code,

        actionType:
          desired.action_type,

        effectiveDate:
          desired.effective_date,

        productionApplied:
          existing.production_applied,

        canonicalValidationStatus:
          existing.metadata
            ?.canonical_validation_status ??
          null,
      });
    } else {
      conflicts.push({
        providerEventId:
          desired.provider_event_id,

        existingEventId:
          existing.id,

        stockCode:
          desired.stock_code,

        actionType:
          desired.action_type,

        reason:
          'EXISTING_PRODUCTION_ROW_DIFFERS_FROM_CORRECTED_CANONICAL_PREVIEW',

        mismatches,
      });
    }
  }

  const pendingExisting = [];

  for (const pending of futurePending) {
    const matches =
      existingByProviderEventId.get(
        pending.providerEventId,
      ) ??
      [];

    if (
      matches.length >
      0
    ) {
      pendingExisting.push({
        providerEventId:
          pending.providerEventId,

        stockCode:
          pending.stockCode,

        actionType:
          pending.actionType,

        recordDate:
          pending.parsed
            ?.recordDate ??
          null,

        existingRows:
          matches.map(
            (row) => ({
              id:
                row.id,

              effectiveDate:
                row.effective_date,

              status:
                row.status,

              productionApplied:
                row.production_applied,

              canonicalValidationStatus:
                row.metadata
                  ?.canonical_validation_status ??
                null,
            }),
          ),
      });
    }
  }

  const targetProviderEventIds =
    new Set(
      input.results.map(
        (row) =>
          row.providerEventId,
      ),
    );

  const unrelatedExistingRows =
    existingRows.filter(
      (row) =>
        !targetProviderEventIds.has(
          row.provider_event_id,
        ),
    );

  const existingTargetRows =
    existingRows.filter(
      (row) =>
        targetProviderEventIds.has(
          row.provider_event_id,
        ),
    );

  const blockers = [];

  if (
    desiredIssues.length >
    0
  ) {
    blockers.push(
      'DESIRED_CANONICAL_ROW_CONTRACT_FAILED',
    );
  }

  if (
    desiredIdentityCount !==
    desiredRows.length
  ) {
    blockers.push(
      'DUPLICATE_DESIRED_CANONICAL_IDENTITY',
    );
  }

  if (
    desiredFingerprintCount !==
    desiredRows.length
  ) {
    blockers.push(
      'DUPLICATE_DESIRED_SOURCE_FINGERPRINT',
    );
  }

  if (
    existingDuplicateIdentities.length >
    0
  ) {
    blockers.push(
      'EXISTING_DB_DUPLICATE_CANONICAL_IDENTITY',
    );
  }

  if (
    conflicts.length >
    0
  ) {
    blockers.push(
      'EXISTING_DB_CANONICAL_CONFLICT',
    );
  }

  if (
    pendingExisting.length >
    0
  ) {
    blockers.push(
      'FUTURE_PENDING_EVENT_ALREADY_IN_PRODUCTION_NAMESPACE',
    );
  }

  const accountedPersistable =
    wouldInsert.length +
    alreadyCompatible.length +
    conflicts.length;

  if (
    accountedPersistable !==
    EXPECTED_PERSISTABLE
  ) {
    blockers.push(
      'PERSISTABLE_ACCOUNTING_MISMATCH',
    );
  }

  const plannedAdjustmentRuns =
    EXPECTED_PERSISTABLE;

  const plannedReadyRuns =
    EXPECTED_FACTOR_SUPPORTED;

  const plannedBlockedStructuralRuns =
    EXPECTED_STRUCTURAL;

  const plannedFactorRows =
    EXPECTED_FACTOR_SUPPORTED;

  const status =
    blockers.length ===
    0
      ? 'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY'
      : 'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_BLOCKED';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    remoteDbContract: {
      productionNamespace:
        'is_validation=false',

      productionAppliedCheck:
        'production_applied=false',

      canonicalValidity:
        'metadata.canonical_validation_status=VALIDATED',
    },

    counts: {
      totalCanonicalIdentities:
        input.results.length,

      persistableNow:
        desiredRows.length,

      factorSupported:
        factorSupported.length,

      structuralBlocked:
        structural.length,

      futurePending:
        futurePending.length,

      desiredRowContractFailures:
        desiredIssues.length,

      uniqueDesiredCanonicalIdentities:
        desiredIdentityCount,

      uniqueDesiredSourceFingerprints:
        desiredFingerprintCount,

      existingProductionNamespaceRows:
        existingRows.length,

      existingRowsInCurrentBatch:
        existingTargetRows.length,

      unrelatedExistingProductionRows:
        unrelatedExistingRows.length,

      wouldInsert:
        wouldInsert.length,

      alreadyCompatible:
        alreadyCompatible.length,

      conflicts:
        conflicts.length,

      pendingAlreadyPersistedUnexpected:
        pendingExisting.length,

      existingDuplicateCanonicalIdentities:
        existingDuplicateIdentities.length,

      accountedPersistable,

      plannedAdjustmentRuns,

      plannedReadyRuns,

      plannedBlockedStructuralRuns,

      plannedFactorRows,
    },

    actionTypeCounts:
      countBy(
        desiredRows,
        (row) =>
          row.action_type,
      ),

    wouldInsertActionTypeCounts:
      countBy(
        wouldInsert,
        (row) =>
          row.action_type,
      ),

    compatibleActionTypeCounts:
      countBy(
        alreadyCompatible,
        (row) =>
          row.actionType,
      ),

    blockers,
    desiredIssues,
    conflicts,
    pendingExisting,
    existingDuplicateIdentities,

    futurePendingRows:
      futurePending.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          recordDate:
            row.parsed
              ?.recordDate ??
            null,

          effectiveDate:
            row.canonicalPreview
              ?.effective_date ??
            null,

          reason:
            row.effectiveDateResolution
              ?.reason ??
            null,
        }),
      ),

    alreadyCompatible,

    insertPreview:
      wouldInsert.map(
        (row) => ({
          stock_code:
            row.stock_code,

          action_type:
            row.action_type,

          effective_date:
            row.effective_date,

          ratio_from:
            row.ratio_from,

          ratio_to:
            row.ratio_to,

          cash_amount:
            row.cash_amount,

          currency:
            row.currency,

          provider:
            row.provider,

          provider_event_id:
            row.provider_event_id,

          source_fingerprint:
            row.source_fingerprint,

          status:
            row.status,

          metadata:
            row.metadata,

          is_validation:
            row.is_validation,

          production_applied:
            row.production_applied,
        }),
      ),

    adjustmentPlan: {
      runPersistenceDeferredUntilEventIdsResolved:
        true,

      plannedRuns:
        plannedAdjustmentRuns,

      plannedReadyRuns,

      plannedBlockedStructuralRuns,

      plannedFactorRows,

      supportedRunStatus:
        'READY',

      structuralRunStatus:
        'BLOCKED_UNSUPPORTED_ACTION',

      factorIdentity:
        'UNIQUE(adjustment_run_id, action_event_id)',

      currentBatchCumulativeRule:
        'SINGLE_EVENT_PER_FACTOR_SUPPORTED_STOCK_CUMULATIVE_EQUALS_EVENT_FACTOR',
    },

    safety: {
      httpMethodsUsed: [
        'GET',
      ],

      networkRequests:
        1,

      databaseReads:
        1,

      databaseWrites:
        0,

      productionAppliedFlagMutations:
        0,

      canonicalEventsInserted:
        0,

      canonicalEventsUpdated:
        0,

      adjustmentRunsInserted:
        0,

      factorRowsInserted:
        0,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      canonicalIdentity:
        'UNIQUE_PROVIDER_PROVIDER_EVENT_ID_IS_VALIDATION',

      desiredLifecycle:
        'RECORDED_IS_VALIDATION_FALSE_PRODUCTION_APPLIED_FALSE',

      canonicalValidity:
        'METADATA_CANONICAL_VALIDATION_STATUS_VALIDATED',

      futurePending:
        'DO_NOT_PERSIST_UNTIL_EFFECTIVE_DATE_RESOLVED',

      structuralEvents:
        'PERSIST_CANONICAL_EVENT_BUT_KEEP_GENERIC_FACTOR_BLOCKED',

      existingCompatible:
        'NO_WRITE_REQUIRED',

      conflict:
        'FAIL_CLOSED_NO_UPDATE_OR_OVERWRITE',

      adjustmentPersistence:
        'DEFER_UNTIL_CANONICAL_EVENT_IDS_ARE_RESOLVED',

      coverage:
        'DO_NOT_ADVANCE_IN_V9_8_11_4',
    },

    outputFile:
      path
        .relative(
          root,
          outputFile,
        )
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source.inputFingerprint,

        status:
          report.status,

        counts:
          report.counts,

        compatible:
          alreadyCompatible.map(
            (row) => [
              row.providerEventId,
              row.existingEventId,
            ],
          ),

        conflicts:
          conflicts.map(
            (row) => [
              row.providerEventId,
              row.reason,
            ],
          ),

        inserts:
          wouldInsert.map(
            (row) => [
              row.provider_event_id,
              row.stock_code,
              row.action_type,
              row.effective_date,
              row.source_fingerprint,
            ],
          ),
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
          VERSION,

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        wouldInsertActionTypeCounts:
          report.wouldInsertActionTypeCounts,

        compatibleActionTypeCounts:
          report.compatibleActionTypeCounts,

        compatibleRows:
          report.alreadyCompatible,

        blockers:
          report.blockers,

        conflicts:
          report.conflicts,

        pendingExisting:
          report.pendingExisting,

        futurePendingRows:
          report.futurePendingRows,

        plannedAdjustmentRuns,
        plannedReadyRuns,
        plannedBlockedStructuralRuns,
        plannedFactorRows,

        networkRequests:
          1,

        databaseWrites:
          0,

        canonicalEventsInserted:
          0,

        adjustmentRunsInserted:
          0,

        factorRowsInserted:
          0,

        coverageWindowAdvanced:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_BLOCKED'
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_FAILED',

          version:
            VERSION,

          error:
            String(
              error?.message ??
              error,
            ),

          databaseWrites:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
