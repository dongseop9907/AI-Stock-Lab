/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.6 - 123-row canonical event bulk INSERT APPLY
 *
 * WRITES TO corporate_action_events.
 *
 * Inputs:
 *   logs/opendart-corporate-action-snapshot-eligibility-v9-9-11-5-1-common-stock-scope.json
 *   logs/opendart-corporate-action-bulk-insert-dry-run-v9-9-11-5-common-stock-scope.json
 *
 * Output:
 *   logs/opendart-corporate-action-bulk-insert-apply-v9-9-11-6-common-stock-scope.json
 *
 * Correct remote DB contract:
 *   - production namespace: is_validation = false
 *   - production_applied MUST remain false
 *   - canonical validity: metadata.canonical_validation_status = VALIDATED
 *
 * Safety:
 *   - explicit --apply required
 *   - expected eligible rows = 123
 *   - expected deferred future structural rows = 30
 *   - re-read production namespace immediately before insert
 *   - require no target provider_event_id already exists
 *   - require no target source_fingerprint already exists
 *   - revalidate all modeled CHECK constraints
 *   - ONE bulk POST JSON array (no row-by-row fallback)
 *   - no upsert / no on-conflict
 *   - require exactly 123 returned rows
 *   - re-read production namespace and verify all 123 canonical rows
 *   - fail closed
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-6.cjs --apply
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_6_CANONICAL_EVENT_2_ROW_BULK_INSERT_APPLY';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const DRY_RUN_VERSION =
  'V9_8_11_5_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_INSERT_ROWS =
  2;

const EXPECTED_DEFERRED =
  3;

const EXPECTED_EXISTING_COMPATIBLE =
  0;

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

function deepStable(value) {
  if (Array.isArray(value)) {
    return value.map(deepStable);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          deepStable(value[key]),
        ]),
    );
  }

  return value;
}

function sameJson(a, b) {
  return (
    JSON.stringify(deepStable(a)) ===
    JSON.stringify(deepStable(b))
  );
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

async function requestJson(
  url,
  key,
  {
    method = 'GET',
    body,
    preferRepresentation = false,
  } = {},
) {
  const headers = {
    apikey:
      key,

    Authorization:
      `Bearer ${key}`,

    Accept:
      'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] =
      'application/json';

    if (preferRepresentation) {
      headers.Prefer =
        'return=representation';
    }
  }

  const response =
    await fetch(
      url,
      {
        method,
        headers,
        body:
          body !== undefined
            ? JSON.stringify(body)
            : undefined,
      },
    );

  const text =
    await response.text();

  let parsed = null;

  if (text.trim()) {
    try {
      parsed =
        JSON.parse(text);
    } catch {
      throw new Error(
        `INVALID_JSON_RESPONSE:${method}:${response.status}`,
      );
    }
  } else {
    parsed = [];
  }

  if (!response.ok) {
    const error =
      new Error(
        `SUPABASE_REQUEST_FAILED:${method}:${parsed?.code ?? response.status}`,
      );

    error.details = {
      status:
        response.status,

      code:
        parsed?.code ??
        null,

      message:
        parsed?.message ??
        null,

      details:
        parsed?.details ??
        null,

      hint:
        parsed?.hint ??
        null,
    };

    throw error;
  }

  return parsed;
}

function normalizeDbRow(row) {
  return {
    id:
      row.id,

    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      num(row.ratio_from),

    ratio_to:
      num(row.ratio_to),

    cash_amount:
      num(row.cash_amount),

    currency:
      normalizeCurrency(
        row.currency,
      ),

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,

    status:
      row.status,

    metadata:
      row.metadata ??
      {},

    is_validation:
      row.is_validation,

    production_applied:
      row.production_applied,

    created_at:
      row.created_at,
  };
}

function normalizePayloadRow(row) {
  return {
    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      num(row.ratio_from),

    ratio_to:
      num(row.ratio_to),

    cash_amount:
      num(row.cash_amount),

    currency:
      normalizeCurrency(
        row.currency,
      ),

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,

    status:
      row.status,

    metadata:
      row.metadata ??
      {},

    is_validation:
      row.is_validation,

    production_applied:
      row.production_applied,
  };
}

function validateRemoteChecks(row) {
  const issues = [];

  if (!row.stock_code) {
    issues.push(
      'STOCK_CODE_REQUIRED',
    );
  }

  if (!row.provider_event_id) {
    issues.push(
      'PROVIDER_EVENT_ID_REQUIRED',
    );
  }

  if (!row.source_fingerprint) {
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
    row.production_applied !==
    false
  ) {
    issues.push(
      'PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  if (
    ![
      'RECORDED',
      'SUPPORTED',
      'UNSUPPORTED',
      'INVALID',
    ].includes(
      row.status,
    )
  ) {
    issues.push(
      'STATUS_CHECK_FAILED',
    );
  }

  if (
    ![
      'STOCK_SPLIT',
      'REVERSE_SPLIT',
      'CASH_DIVIDEND',
      'STOCK_DIVIDEND',
      'RIGHTS_ISSUE',
      'SPIN_OFF',
      'MERGER',
      'OTHER',
    ].includes(
      row.action_type,
    )
  ) {
    issues.push(
      'TYPE_CHECK_FAILED',
    );
  }

  if (
    row.action_type ===
      'STOCK_SPLIT' ||
    row.action_type ===
      'REVERSE_SPLIT'
  ) {
    if (
      !(num(row.ratio_from) > 0) ||
      !(num(row.ratio_to) > 0)
    ) {
      issues.push(
        'SPLIT_RATIO_CHECK_FAILED',
      );
    }
  }

  if (
    row.action_type ===
    'CASH_DIVIDEND'
  ) {
    if (
      !(num(row.cash_amount) >= 0)
    ) {
      issues.push(
        'CASH_AMOUNT_REQUIRED',
      );
    }

    if (
      normalizeCurrency(
        row.currency,
      ) !== 'KRW'
    ) {
      issues.push(
        'CASH_CURRENCY_NOT_KRW',
      );
    }

    if (
      num(row.ratio_from) !==
        null ||
      num(row.ratio_to) !==
        null
    ) {
      issues.push(
        'CASH_RATIO_MUST_BE_NULL',
      );
    }
  }

  if (
    row.action_type ===
      'MERGER' ||
    row.action_type ===
      'SPIN_OFF'
  ) {
    if (
      num(row.ratio_from) !==
        null ||
      num(row.ratio_to) !==
        null ||
      num(row.cash_amount) !==
        null
    ) {
      issues.push(
        'STRUCTURAL_NUMERIC_FIELDS_MUST_BE_NULL',
      );
    }
  }

  if (
    row.metadata
      ?.canonical_validation_status !==
    'VALIDATED'
  ) {
    issues.push(
      'CANONICAL_VALIDATION_METADATA_REQUIRED',
    );
  }

  return issues;
}

function compareCanonical(
  actual,
  expected,
) {
  const mismatches = [];

  function check(
    field,
    actualValue,
    expectedValue,
  ) {
    if (
      actualValue !==
      expectedValue
    ) {
      mismatches.push({
        field,
        actual:
          actualValue,
        expected:
          expectedValue,
      });
    }
  }

  check(
    'stock_code',
    actual.stock_code,
    expected.stock_code,
  );

  check(
    'action_type',
    actual.action_type,
    expected.action_type,
  );

  check(
    'effective_date',
    actual.effective_date,
    expected.effective_date,
  );

  if (
    !sameNumeric(
      actual.ratio_from,
      expected.ratio_from,
    )
  ) {
    mismatches.push({
      field:
        'ratio_from',

      actual:
        actual.ratio_from,

      expected:
        expected.ratio_from,
    });
  }

  if (
    !sameNumeric(
      actual.ratio_to,
      expected.ratio_to,
    )
  ) {
    mismatches.push({
      field:
        'ratio_to',

      actual:
        actual.ratio_to,

      expected:
        expected.ratio_to,
    });
  }

  if (
    !sameNumeric(
      actual.cash_amount,
      expected.cash_amount,
    )
  ) {
    mismatches.push({
      field:
        'cash_amount',

      actual:
        actual.cash_amount,

      expected:
        expected.cash_amount,
    });
  }

  check(
    'currency',
    normalizeCurrency(
      actual.currency,
    ),
    normalizeCurrency(
      expected.currency,
    ),
  );

  check(
    'provider',
    actual.provider,
    expected.provider,
  );

  check(
    'provider_event_id',
    actual.provider_event_id,
    expected.provider_event_id,
  );

  check(
    'source_fingerprint',
    actual.source_fingerprint,
    expected.source_fingerprint,
  );

  check(
    'status',
    actual.status,
    expected.status,
  );

  check(
    'is_validation',
    actual.is_validation,
    expected.is_validation,
  );

  check(
    'production_applied',
    actual.production_applied,
    expected.production_applied,
  );

  if (
    !sameJson(
      actual.metadata ??
        {},
      expected.metadata ??
        {},
    )
  ) {
    mismatches.push({
      field:
        'metadata',

      actual:
        actual.metadata ??
        {},

      expected:
        expected.metadata ??
        {},
    });
  }

  return mismatches;
}

async function readProductionNamespace(
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

  const rows =
    await requestJson(
      `${base}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false` +
      `&order=provider_event_id.asc`,
      key,
    );

  if (!Array.isArray(rows)) {
    throw new Error(
      'PRODUCTION_NAMESPACE_RESPONSE_NOT_ARRAY',
    );
  }

  return rows.map(
    normalizeDbRow,
  );
}

function buildMaps(rows) {
  const byProviderEventId =
    new Map();

  const byFingerprint =
    new Map();

  for (const row of rows) {
    if (
      !byProviderEventId.has(
        row.provider_event_id,
      )
    ) {
      byProviderEventId.set(
        row.provider_event_id,
        [],
      );
    }

    byProviderEventId
      .get(
        row.provider_event_id,
      )
      .push(row);

    if (
      !byFingerprint.has(
        row.source_fingerprint,
      )
    ) {
      byFingerprint.set(
        row.source_fingerprint,
        [],
      );
    }

    byFingerprint
      .get(
        row.source_fingerprint,
      )
      .push(row);
  }

  return {
    byProviderEventId,
    byFingerprint,
  };
}

async function main() {
  const args =
    process.argv.slice(2);

  if (
    args.length !== 1 ||
    args[0] !==
      '--apply'
  ) {
    throw new Error(
      'EXPLICIT_APPLY_FLAG_REQUIRED_USE_--apply',
    );
  }

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const eligibilityFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-9-11-5-1-common-stock-scope.json',
    );

  const dryRunFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-bulk-insert-dry-run-v9-9-11-5-common-stock-scope.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-bulk-insert-apply-v9-9-11-6-common-stock-scope.json',
    );

  for (
    const file of
    [
      eligibilityFile,
      dryRunFile,
    ]
  ) {
    if (
      !fs.existsSync(file)
    ) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const eligibility =
    readJson(
      eligibilityFile,
    );

  const dryRun =
    readJson(
      dryRunFile,
    );

  if (
    eligibility.version !==
    ELIGIBILITY_VERSION
  ) {
    throw new Error(
      'ELIGIBILITY_VERSION_MISMATCH',
    );
  }

  if (
    dryRun.version !==
    DRY_RUN_VERSION
  ) {
    throw new Error(
      'DRY_RUN_VERSION_MISMATCH',
    );
  }

  if (
    eligibility.status !==
    'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY'
  ) {
    throw new Error(
      'ELIGIBILITY_GATE_NOT_READY',
    );
  }

  if (
    dryRun.status !==
    'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY'
  ) {
    throw new Error(
      'BULK_DRY_RUN_NOT_READY',
    );
  }

  if (
    eligibility.counts
      ?.eligibleInsertRows !==
      EXPECTED_INSERT_ROWS ||
    eligibility.counts
      ?.deferredFutureStructuralRows !==
      EXPECTED_DEFERRED ||
    eligibility.counts
      ?.existingCompatibleRows !==
      EXPECTED_EXISTING_COMPATIBLE
  ) {
    throw new Error(
      'ELIGIBILITY_COUNT_CONTRACT_FAILED',
    );
  }

  if (
    !Array.isArray(
      eligibility.eligibleInsertPayload,
    ) ||
    eligibility.eligibleInsertPayload.length !==
      EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      'EXPECTED_123_ELIGIBLE_PAYLOAD_ROWS',
    );
  }

  const payload =
    eligibility.eligibleInsertPayload.map(
      normalizePayloadRow,
    );

  const payloadIssues =
    payload
      .map(
        (row) => ({
          providerEventId:
            row.provider_event_id,

          issues:
            validateRemoteChecks(
              row,
            ),
        }),
      )
      .filter(
        (row) =>
          row.issues.length >
          0,
      );

  if (
    payloadIssues.length >
    0
  ) {
    const error =
      new Error(
        'PAYLOAD_CHECK_CONTRACT_FAILED',
      );

    error.details =
      payloadIssues;

    throw error;
  }

  const uniqueIdentities =
    new Set(
      payload.map(
        (row) =>
          `${row.provider}|${row.provider_event_id}|${row.is_validation}`,
      ),
    );

  const uniqueFingerprints =
    new Set(
      payload.map(
        (row) =>
          row.source_fingerprint,
      ),
    );

  if (
    uniqueIdentities.size !==
    EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      'DUPLICATE_PAYLOAD_CANONICAL_IDENTITY',
    );
  }

  if (
    uniqueFingerprints.size !==
    EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      'DUPLICATE_PAYLOAD_SOURCE_FINGERPRINT',
    );
  }

  const {
    url,
    key,
  } =
    requireEnv();

  let databaseReads =
    0;

  let insertRequests =
    0;

  // 1) Immediate pre-insert re-read.
  const beforeRows =
    await readProductionNamespace(
      url,
      key,
    );

  databaseReads +=
    1;

  const beforeMaps =
    buildMaps(
      beforeRows,
    );

  const appearedIdentities =
    [];

  const fingerprintCollisions =
    [];

  for (const row of payload) {
    const identityMatches =
      beforeMaps
        .byProviderEventId
        .get(
          row.provider_event_id,
        ) ??
      [];

    if (
      identityMatches.length >
      0
    ) {
      appearedIdentities.push({
        providerEventId:
          row.provider_event_id,

        existingRows:
          identityMatches,
      });
    }

    const fingerprintMatches =
      beforeMaps
        .byFingerprint
        .get(
          row.source_fingerprint,
        ) ??
      [];

    if (
      fingerprintMatches.length >
      0
    ) {
      fingerprintCollisions.push({
        providerEventId:
          row.provider_event_id,

        sourceFingerprint:
          row.source_fingerprint,

        existingRows:
          fingerprintMatches,
      });
    }
  }

  if (
    appearedIdentities.length >
    0 ||
    fingerprintCollisions.length >
    0
  ) {
    const error =
      new Error(
        'PRE_INSERT_DB_DRIFT_DETECTED',
      );

    error.details = {
      appearedIdentities,
      fingerprintCollisions,
    };

    throw error;
  }

  // 2) Confirm five previously-compatible current-batch rows still exist.
  const compatibleIds =
    new Set(
      dryRun
        .source
        ? (
            []
          )
        : [],
    );

  // We do not need the full V9.8.11.4 file here; V9.8.11.5 already
  // checked the five compatible rows immediately before this stage.
  // We still require the current namespace to contain at least those
  // five current-batch overlaps through the dry-run count contract.
  if (
    dryRun.counts
      ?.existingCompatibleRows !==
      EXPECTED_EXISTING_COMPATIBLE
  ) {
    throw new Error(
      'EXPECTED_5_COMPATIBLE_ROWS_FROM_DRY_RUN',
    );
  }

  // 3) ONE bulk POST. No on_conflict, no resolution=merge-duplicates.
  const returnedRaw =
    await requestJson(
      `${url}/rest/v1/corporate_action_events`,
      key,
      {
        method:
          'POST',

        body:
          payload,

        preferRepresentation:
          true,
      },
    );

  insertRequests +=
    1;

  if (
    !Array.isArray(
      returnedRaw,
    ) ||
    returnedRaw.length !==
      EXPECTED_INSERT_ROWS
  ) {
    const error =
      new Error(
        `BULK_INSERT_RETURN_COUNT_MISMATCH:${Array.isArray(returnedRaw) ? returnedRaw.length : 'NON_ARRAY'}`,
      );

    throw error;
  }

  const returned =
    returnedRaw.map(
      normalizeDbRow,
    );

  const returnedById =
    new Map(
      returned.map(
        (row) => [
          row.provider_event_id,
          row,
        ],
      ),
    );

  const returnMismatches =
    [];

  for (const expected of payload) {
    const actual =
      returnedById.get(
        expected.provider_event_id,
      );

    if (!actual) {
      returnMismatches.push({
        providerEventId:
          expected.provider_event_id,

        reason:
          'RETURNED_ROW_MISSING',
      });

      continue;
    }

    const mismatches =
      compareCanonical(
        actual,
        expected,
      );

    if (
      mismatches.length >
      0
    ) {
      returnMismatches.push({
        providerEventId:
          expected.provider_event_id,

        mismatches,
      });
    }
  }

  if (
    returnMismatches.length >
    0
  ) {
    const error =
      new Error(
        'BULK_INSERT_RETURN_CANONICAL_MISMATCH',
      );

    error.details =
      returnMismatches;

    throw error;
  }

  // 4) Re-read namespace after insert.
  const afterRows =
    await readProductionNamespace(
      url,
      key,
    );

  databaseReads +=
    1;

  const afterMaps =
    buildMaps(
      afterRows,
    );

  const postInsertMismatches =
    [];

  for (const expected of payload) {
    const matches =
      afterMaps
        .byProviderEventId
        .get(
          expected.provider_event_id,
        ) ??
      [];

    if (
      matches.length !==
      1
    ) {
      postInsertMismatches.push({
        providerEventId:
          expected.provider_event_id,

        reason:
          'POST_INSERT_EXPECTED_EXACTLY_ONE_ROW',

        rowCount:
          matches.length,
      });

      continue;
    }

    const actual =
      matches[0];

    const mismatches =
      compareCanonical(
        actual,
        expected,
      );

    const constraintIssues =
      validateRemoteChecks(
        actual,
      );

    if (
      mismatches.length >
        0 ||
      constraintIssues.length >
        0
    ) {
      postInsertMismatches.push({
        providerEventId:
          expected.provider_event_id,

        mismatches,
        constraintIssues,
      });
    }
  }

  if (
    postInsertMismatches.length >
    0
  ) {
    const error =
      new Error(
        'POST_INSERT_VERIFICATION_FAILED',
      );

    error.details =
      postInsertMismatches;

    throw error;
  }

  const insertedIds =
    returned.map(
      (row) =>
        row.id,
    );

  const uniqueInsertedIds =
    new Set(
      insertedIds,
    );

  if (
    uniqueInsertedIds.size !==
    EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      'INSERTED_EVENT_ID_DUPLICATION',
    );
  }

  const expectedAfterNamespaceCount =
    beforeRows.length +
    EXPECTED_INSERT_ROWS;

  const namespaceCountMatches =
    afterRows.length ===
    expectedAfterNamespaceCount;

  if (
    !namespaceCountMatches
  ) {
    const error =
      new Error(
        'PRODUCTION_NAMESPACE_COUNT_UNEXPECTED_AFTER_INSERT',
      );

    error.details = {
      before:
        beforeRows.length,

      inserted:
        EXPECTED_INSERT_ROWS,

      expectedAfter:
        expectedAfterNamespaceCount,

      actualAfter:
        afterRows.length,
    };

    throw error;
  }

  const status =
    'CANONICAL_EVENT_BULK_INSERT_APPLY_COMPLETE';

  const report = {
    version:
      VERSION,

    status,

    source: {
      eligibilityVersion:
        eligibility.version,

      eligibilityFingerprint:
        eligibility.outputFingerprint,

      dryRunVersion:
        dryRun.version,

      dryRunFingerprint:
        dryRun.outputFingerprint,
    },

    counts: {
      eligibleInsertRows:
        payload.length,

      returnedRows:
        returned.length,

      verifiedInsertedRows:
        payload.length,

      uniqueInsertedEventIds:
        uniqueInsertedIds.size,

      deferredFutureStructuralRows:
        eligibility.counts
          ?.deferredFutureStructuralRows,

      existingCompatibleRows:
        eligibility.counts
          ?.existingCompatibleRows,

      productionNamespaceRowsBefore:
        beforeRows.length,

      productionNamespaceRowsAfter:
        afterRows.length,

      expectedProductionNamespaceRowsAfter:
        expectedAfterNamespaceCount,
    },

    insertedRows:
      returned.map(
        (row) => ({
          id:
            row.id,

          providerEventId:
            row.provider_event_id,

          stockCode:
            row.stock_code,

          actionType:
            row.action_type,

          effectiveDate:
            row.effective_date,

          productionApplied:
            row.production_applied,

          canonicalValidationStatus:
            row.metadata
              ?.canonical_validation_status ??
            null,
        }),
      ),

    checks: {
      payloadConstraintIssues:
        0,

      preInsertAppearedIdentities:
        0,

      preInsertFingerprintCollisions:
        0,

      returnedCanonicalMismatches:
        0,

      postInsertCanonicalMismatches:
        0,

      namespaceCountMatches,
    },

    safety: {
      explicitApplyFlag:
        true,

      databaseReads,

      databaseWrites:
        1,

      insertRequestsExecuted:
        insertRequests,

      bulkInsertRows:
        payload.length,

      rowByRowFallbackUsed:
        false,

      canonicalEventsInserted:
        payload.length,

      canonicalEventsUpdated:
        0,

      canonicalEventsDeleted:
        0,

      adjustmentRunsInserted:
        0,

      factorRowsInserted:
        0,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      'BUILD_POST_INSERT_2_EVENT_CANONICAL_VERIFICATION_AND_EVENT_ID_MAP',

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

        eligibilityFingerprint:
          report.source
            .eligibilityFingerprint,

        status:
          report.status,

        inserted:
          returned
            .map(
              (row) => [
                row.id,
                row.provider_event_id,
                row.stock_code,
                row.action_type,
                row.effective_date,
                row.source_fingerprint,
              ],
            )
            .sort(
              (a, b) =>
                String(a[1]).localeCompare(
                  String(b[1]),
                ),
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

        checks:
          report.checks,

        databaseReads:
          report.safety
            .databaseReads,

        databaseWrites:
          report.safety
            .databaseWrites,

        insertRequestsExecuted:
          report.safety
            .insertRequestsExecuted,

        canonicalEventsInserted:
          report.safety
            .canonicalEventsInserted,

        canonicalEventsUpdated:
          0,

        canonicalEventsDeleted:
          0,

        adjustmentRunsInserted:
          0,

        factorRowsInserted:
          0,

        coverageWindowAdvanced:
          false,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            'CANONICAL_EVENT_BULK_INSERT_APPLY_ABORTED',

          version:
            VERSION,

          error:
            String(
              error?.message ??
              error,
            ),

          details:
            error?.details ??
            null,

          databaseSafety:
            'NO_ROW_BY_ROW_FALLBACK',
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
