/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.3.3 - DB-contract-aware controlled canonical repair APPLY
 *
 * WRITES exactly the 3 stale corporate_action_events rows when all guards pass.
 *
 * Input:
 *   logs/opendart-corporate-action-db-contract-repair-dry-run-v9-8-11-3-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-db-contract-repair-apply-v9-8-11-3-3.json
 *
 * Correct remote DB contract:
 *   corporate_action_events_production_check:
 *     CHECK (production_applied = false)
 *
 * Safety:
 *   - explicit --apply required
 *   - only plans with disposition=PATCH_REQUIRED_CANONICAL_SEMANTIC_REPAIR
 *   - expected repair rows = 3
 *   - re-read current row immediately before each patch
 *   - require exact current snapshot from dry-run, or exact expectedAfter for resume
 *   - require production_applied=false
 *   - re-check zero factor references
 *   - re-check zero non-validation run references
 *   - PATCH one row at a time
 *   - require exactly one returned row
 *   - re-read and verify expectedAfter
 *   - fail fast
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-3-3.cjs --apply
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_3_3_DB_CONTRACT_AWARE_CONTROLLED_CANONICAL_REPAIR_APPLY';

const INPUT_VERSION =
  'V9_8_11_3_2_DB_CONTRACT_AWARE_CONTROLLED_REPAIR_DRY_RUN';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_REPAIR_ROWS = 3;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
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
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(value) {
  const text =
    String(value ?? '')
      .trim()
      .toUpperCase();

  return text || null;
}

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL_REQUIRED');
  }

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
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
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';

    if (preferRepresentation) {
      headers.Prefer = 'return=representation';
    }
  }

  const response = await fetch(
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

  const text = await response.text();

  let parsed = null;

  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `INVALID_JSON_RESPONSE:${method}:${response.status}`,
      );
    }
  } else {
    parsed = [];
  }

  if (!response.ok) {
    const error = new Error(
      `SUPABASE_REQUEST_FAILED:${method}:${parsed?.code ?? response.status}`,
    );

    error.details = {
      status: response.status,
      code: parsed?.code ?? null,
      message: parsed?.message ?? null,
      details: parsed?.details ?? null,
      hint: parsed?.hint ?? null,
    };

    throw error;
  }

  return parsed;
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
        .map(
          (key) => [
            key,
            deepStable(value[key]),
          ],
        ),
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

function sameScalar(a, b) {
  const an = num(a);
  const bn = num(b);

  if (
    an !== null ||
    bn !== null
  ) {
    return (
      an !== null &&
      bn !== null &&
      Math.abs(an - bn) <= 1e-12
    );
  }

  return a === b;
}

function normalizeRow(row) {
  return {
    id: row.id,
    stock_code: row.stock_code,
    action_type: row.action_type,
    effective_date: row.effective_date,
    ratio_from: num(row.ratio_from),
    ratio_to: num(row.ratio_to),
    cash_amount: num(row.cash_amount),
    currency: normalizeCurrency(row.currency),
    provider: row.provider,
    provider_event_id: row.provider_event_id,
    source_fingerprint: row.source_fingerprint,
    status: row.status,
    metadata: row.metadata ?? {},
    is_validation: row.is_validation,
    production_applied: row.production_applied,
    created_at: row.created_at,
  };
}

function compareRows(actual, expected) {
  const fields = [
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
    'is_validation',
    'production_applied',
    'created_at',
  ];

  const mismatches = [];

  for (const field of fields) {
    if (
      !sameScalar(
        actual[field],
        expected[field],
      )
    ) {
      mismatches.push({
        field,
        actual: actual[field],
        expected: expected[field],
      });
    }
  }

  if (
    !sameJson(
      actual.metadata ?? {},
      expected.metadata ?? {},
    )
  ) {
    mismatches.push({
      field: 'metadata',
      actual: actual.metadata ?? {},
      expected: expected.metadata ?? {},
    });
  }

  return mismatches;
}

function validateRemoteChecks(row) {
  const issues = [];

  if (row.production_applied !== false) {
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
    ].includes(row.status)
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
    ].includes(row.action_type)
  ) {
    issues.push(
      'TYPE_CHECK_FAILED',
    );
  }

  if (
    row.action_type === 'STOCK_SPLIT' ||
    row.action_type === 'REVERSE_SPLIT'
  ) {
    if (
      !(row.ratio_from > 0) ||
      !(row.ratio_to > 0)
    ) {
      issues.push(
        'SPLIT_RATIO_CHECK_FAILED',
      );
    }
  }

  return issues;
}

function runReferencesEvent(
  run,
  eventId,
  providerEventId,
) {
  const eventIds =
    run.summary?.event_ids;

  const providerEventIds =
    run.summary?.provider_event_ids;

  return (
    (
      Array.isArray(eventIds) &&
      eventIds.some(
        (value) =>
          String(value) ===
          String(eventId),
      )
    ) ||
    (
      Array.isArray(providerEventIds) &&
      providerEventIds.some(
        (value) =>
          String(value) ===
          String(providerEventId),
      )
    )
  );
}

async function readEvent(
  base,
  key,
  id,
) {
  const select = [
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

  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&id=eq.${encodeURIComponent(id)}`,
    key,
  );

  if (
    !Array.isArray(rows) ||
    rows.length !== 1
  ) {
    throw new Error(
      `EVENT_READ_EXPECTED_ONE:${id}:${Array.isArray(rows) ? rows.length : 'NON_ARRAY'}`,
    );
  }

  return normalizeRow(
    rows[0],
  );
}

async function readFactorRefs(
  base,
  key,
  eventId,
) {
  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_adjustment_factors` +
      `?select=id,adjustment_run_id,action_event_id,is_validation,production_applied` +
      `&action_event_id=eq.${encodeURIComponent(eventId)}`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error(
      'FACTOR_REF_RESPONSE_NOT_ARRAY',
    );
  }

  return rows;
}

async function readNonValidationRuns(
  base,
  key,
) {
  const select = [
    'id',
    'stock_code',
    'version',
    'status',
    'summary',
    'is_validation',
    'production_applied',
  ].join(',');

  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(select)}` +
      `&is_validation=eq.false`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error(
      'RUN_RESPONSE_NOT_ARRAY',
    );
  }

  return rows;
}

async function patchEvent(
  base,
  key,
  plan,
) {
  const before =
    plan.current;

  const query =
    `${base}/rest/v1/corporate_action_events` +
    `?id=eq.${encodeURIComponent(plan.existingEventId)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&provider_event_id=eq.${encodeURIComponent(plan.providerEventId)}` +
    `&is_validation=eq.false` +
    `&production_applied=eq.false` +
    `&source_fingerprint=eq.${encodeURIComponent(before.source_fingerprint)}`;

  const rows = await requestJson(
    query,
    key,
    {
      method: 'PATCH',
      body: plan.patch,
      preferRepresentation: true,
    },
  );

  if (
    !Array.isArray(rows) ||
    rows.length !== 1
  ) {
    throw new Error(
      `PATCH_EXPECTED_ONE_ROW:${plan.providerEventId}:${Array.isArray(rows) ? rows.length : 'NON_ARRAY'}`,
    );
  }

  return normalizeRow(
    rows[0],
  );
}

async function main() {
  const args =
    process.argv.slice(2);

  if (
    args.length !== 1 ||
    args[0] !== '--apply'
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

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-db-contract-repair-dry-run-v9-8-11-3-2.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-db-contract-repair-apply-v9-8-11-3-3.json',
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
    'DB_CONTRACT_REPAIR_DRY_RUN_READY'
  ) {
    throw new Error(
      'DRY_RUN_NOT_READY',
    );
  }

  if (
    input.counts?.patchRequired !==
      EXPECTED_REPAIR_ROWS ||
    input.counts
      ?.constraintIssueRows !==
      0
  ) {
    throw new Error(
      'DRY_RUN_COUNT_CONTRACT_FAILED',
    );
  }

  const repairPlans =
    input.plans.filter(
      (plan) =>
        plan.disposition ===
        'PATCH_REQUIRED_CANONICAL_SEMANTIC_REPAIR',
    );

  if (
    repairPlans.length !==
    EXPECTED_REPAIR_ROWS
  ) {
    throw new Error(
      'EXPECTED_3_REPAIR_PLANS',
    );
  }

  for (const plan of repairPlans) {
    if (
      plan.expectedAfter
        ?.production_applied !==
      false
    ) {
      throw new Error(
        `EXPECTED_AFTER_VIOLATES_PRODUCTION_CHECK:${plan.providerEventId}`,
      );
    }

    if (
      Array.isArray(
        plan.constraintIssues,
      ) &&
      plan.constraintIssues.length >
        0
    ) {
      throw new Error(
        `DRY_RUN_CONSTRAINT_ISSUE:${plan.providerEventId}`,
      );
    }
  }

  const {
    url,
    key,
  } =
    requireEnv();

  const results = [];

  let databaseReads = 0;
  let patchRequests = 0;

  for (
    let index = 0;
    index < repairPlans.length;
    index += 1
  ) {
    const plan =
      repairPlans[index];

    const expectedBefore =
      normalizeRow(
        plan.current,
      );

    const expectedAfter =
      normalizeRow(
        plan.expectedAfter,
      );

    // 1) Re-read current row.
    const current =
      await readEvent(
        url,
        key,
        plan.existingEventId,
      );

    databaseReads += 1;

    const afterMismatch =
      compareRows(
        current,
        expectedAfter,
      );

    // Safe resume.
    if (
      afterMismatch.length ===
      0
    ) {
      results.push({
        providerEventId:
          plan.providerEventId,

        existingEventId:
          plan.existingEventId,

        stockCode:
          plan.stockCode,

        actionType:
          plan.actionType,

        outcome:
          'ALREADY_APPLIED_EXACT_MATCH',

        patched:
          false,

        currentAfter:
          current,
      });

      console.log(
        [
          'DB_CONTRACT_REPAIR_APPLY',
          `${index + 1}/${repairPlans.length}`,
          `root=${plan.providerEventId}`,
          `event=${plan.existingEventId}`,
          'outcome=ALREADY_APPLIED_EXACT_MATCH',
        ].join(' '),
      );

      continue;
    }

    const beforeMismatch =
      compareRows(
        current,
        expectedBefore,
      );

    if (
      beforeMismatch.length >
      0
    ) {
      const error =
        new Error(
          `EXPECTED_BEFORE_DRIFT:${plan.providerEventId}`,
        );

      error.details =
        beforeMismatch;

      throw error;
    }

    const prePatchConstraintIssues =
      validateRemoteChecks(
        expectedAfter,
      );

    if (
      prePatchConstraintIssues.length >
      0
    ) {
      const error =
        new Error(
          `EXPECTED_AFTER_CONSTRAINT_FAILURE:${plan.providerEventId}`,
        );

      error.details =
        prePatchConstraintIssues;

      throw error;
    }

    // 2) Re-check factor references.
    const factorRefs =
      await readFactorRefs(
        url,
        key,
        plan.existingEventId,
      );

    databaseReads += 1;

    if (
      factorRefs.length !==
      0
    ) {
      throw new Error(
        `FACTOR_REFERENCE_APPEARED:${plan.providerEventId}:${factorRefs.length}`,
      );
    }

    // 3) Re-check non-validation runs.
    const runs =
      await readNonValidationRuns(
        url,
        key,
      );

    databaseReads += 1;

    const runRefs =
      runs.filter(
        (run) =>
          runReferencesEvent(
            run,
            plan.existingEventId,
            plan.providerEventId,
          ),
      );

    if (
      runRefs.length !==
      0
    ) {
      throw new Error(
        `RUN_REFERENCE_APPEARED:${plan.providerEventId}:${runRefs.length}`,
      );
    }

    // 4) PATCH exactly one guarded row.
    const returned =
      await patchEvent(
        url,
        key,
        plan,
      );

    patchRequests += 1;

    const returnedMismatch =
      compareRows(
        returned,
        expectedAfter,
      );

    if (
      returnedMismatch.length >
      0
    ) {
      const error =
        new Error(
          `PATCH_RETURN_MISMATCH:${plan.providerEventId}`,
        );

      error.details =
        returnedMismatch;

      throw error;
    }

    // 5) Re-read and verify.
    const reread =
      await readEvent(
        url,
        key,
        plan.existingEventId,
      );

    databaseReads += 1;

    const rereadMismatch =
      compareRows(
        reread,
        expectedAfter,
      );

    if (
      rereadMismatch.length >
      0
    ) {
      const error =
        new Error(
          `POST_PATCH_REREAD_MISMATCH:${plan.providerEventId}`,
        );

      error.details =
        rereadMismatch;

      throw error;
    }

    const finalConstraintIssues =
      validateRemoteChecks(
        reread,
      );

    if (
      finalConstraintIssues.length >
      0
    ) {
      const error =
        new Error(
          `POST_PATCH_CONSTRAINT_MODEL_MISMATCH:${plan.providerEventId}`,
        );

      error.details =
        finalConstraintIssues;

      throw error;
    }

    results.push({
      providerEventId:
        plan.providerEventId,

      existingEventId:
        plan.existingEventId,

      stockCode:
        plan.stockCode,

      actionType:
        plan.actionType,

      outcome:
        'PATCHED_AND_VERIFIED',

      patched:
        true,

      semanticDiffs:
        plan.semanticDiffs,

      fieldsPatched:
        Object.keys(
          plan.patch,
        ),

      currentAfter:
        reread,
    });

    console.log(
      [
        'DB_CONTRACT_REPAIR_APPLY',
        `${index + 1}/${repairPlans.length}`,
        `root=${plan.providerEventId}`,
        `event=${plan.existingEventId}`,
        'outcome=PATCHED_AND_VERIFIED',
        `fields=${Object.keys(plan.patch).join(',')}`,
      ].join(' '),
    );
  }

  const patched =
    results.filter(
      (row) =>
        row.outcome ===
        'PATCHED_AND_VERIFIED',
    );

  const alreadyApplied =
    results.filter(
      (row) =>
        row.outcome ===
        'ALREADY_APPLIED_EXACT_MATCH',
    );

  const allVerified =
    results.every(
      (row) =>
        row.currentAfter
          ?.id ===
          row.existingEventId &&
        row.currentAfter
          ?.provider ===
          PROVIDER &&
        row.currentAfter
          ?.provider_event_id ===
          row.providerEventId &&
        row.currentAfter
          ?.is_validation ===
          false &&
        row.currentAfter
          ?.production_applied ===
          false &&
        row.currentAfter
          ?.metadata
          ?.canonical_validation_status ===
          'VALIDATED' &&
        row.currentAfter
          ?.metadata
          ?.pipeline_version ===
          'V9_8'
    );

  const status =
    results.length ===
      EXPECTED_REPAIR_ROWS &&
    patched.length +
      alreadyApplied.length ===
      EXPECTED_REPAIR_ROWS &&
    allVerified
      ? 'DB_CONTRACT_REPAIR_APPLY_COMPLETE'
      : 'DB_CONTRACT_REPAIR_APPLY_INVALID';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,
    },

    remoteDbContract: {
      productionCheck:
        'production_applied=false',

      productionNamespace:
        'is_validation=false',
    },

    counts: {
      repairPlans:
        repairPlans.length,

      completedRows:
        results.length,

      patchedAndVerified:
        patched.length,

      alreadyAppliedExactMatch:
        alreadyApplied.length,

      finalProductionAppliedFalse:
        results.filter(
          (row) =>
            row.currentAfter
              ?.production_applied ===
            false,
        ).length,

      canonicalValidated:
        results.filter(
          (row) =>
            row.currentAfter
              ?.metadata
              ?.canonical_validation_status ===
            'VALIDATED',
        ).length,

      idsPreserved:
        results.filter(
          (row) =>
            row.currentAfter
              ?.id ===
            row.existingEventId,
        ).length,
    },

    checks: {
      allFinalRowsVerified:
        allVerified,

      noDeletes:
        true,

      noInserts:
        true,

      productionAppliedRemainedFalse:
        results.every(
          (row) =>
            row.currentAfter
              ?.production_applied ===
            false,
        ),
    },

    results,

    safety: {
      explicitApplyFlag:
        true,

      databaseReads,

      patchRequestsExecuted:
        patchRequests,

      databaseWrites:
        patchRequests,

      eventRowsUpdated:
        patched.length,

      eventRowsDeleted:
        0,

      eventRowsInserted:
        0,

      adjustmentFactorRowsModified:
        0,

      adjustmentRunRowsModified:
        0,

      coverageWindowAdvanced:
        false,

      failFast:
        true,
    },

    nextGate:
      status ===
      'DB_CONTRACT_REPAIR_APPLY_COMPLETE'
        ? 'BUILD_CORRECTED_V9_8_11_PRODUCTION_PREFLIGHT'
        : 'STOP_AND_REVIEW',

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

        status:
          report.status,

        results:
          results.map(
            (row) => [
              row.providerEventId,
              row.existingEventId,
              row.outcome,
              row.currentAfter
                ?.effective_date,
              row.currentAfter
                ?.ratio_from,
              row.currentAfter
                ?.ratio_to,
              row.currentAfter
                ?.production_applied,
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

        checks:
          report.checks,

        results:
          report.results.map(
            (row) => ({
              providerEventId:
                row.providerEventId,

              existingEventId:
                row.existingEventId,

              stockCode:
                row.stockCode,

              actionType:
                row.actionType,

              outcome:
                row.outcome,

              effectiveDate:
                row.currentAfter
                  ?.effective_date,

              ratioFrom:
                row.currentAfter
                  ?.ratio_from,

              ratioTo:
                row.currentAfter
                  ?.ratio_to,

              productionApplied:
                row.currentAfter
                  ?.production_applied,

              canonicalValidationStatus:
                row.currentAfter
                  ?.metadata
                  ?.canonical_validation_status,
            }),
          ),

        databaseReads:
          report.safety
            .databaseReads,

        patchRequestsExecuted:
          report.safety
            .patchRequestsExecuted,

        databaseWrites:
          report.safety
            .databaseWrites,

        eventRowsUpdated:
          report.safety
            .eventRowsUpdated,

        eventRowsDeleted:
          0,

        eventRowsInserted:
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

  if (
    status !==
    'DB_CONTRACT_REPAIR_APPLY_COMPLETE'
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            'DB_CONTRACT_REPAIR_APPLY_ABORTED',

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
            'FAIL_FAST_NO_FURTHER_PATCHES',
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
