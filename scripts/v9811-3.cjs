/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.3 - Controlled canonical repair APPLY
 *
 * WRITES TO corporate_action_events.
 *
 * Required input:
 *   logs/opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-controlled-repair-apply-v9-8-11-3.json
 *
 * Safety:
 *   - requires explicit --apply
 *   - one row at a time
 *   - re-read immediately before each patch
 *   - require exact expectedBefore OR already-equal expectedAfter
 *   - re-check zero adjustment factor references
 *   - re-check zero non-validation run references
 *   - PATCH by immutable identity + current lifecycle guards
 *   - Prefer: return=representation
 *   - require exactly one returned row
 *   - fail fast
 *
 * Resume behavior:
 *   If a previous run successfully patched some rows and then stopped,
 *   rows already equal to expectedAfter are counted as alreadyApplied and
 *   safely skipped.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-3.cjs --apply
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_3_CONTROLLED_CANONICAL_REPAIR_APPLY';

const INPUT_VERSION =
  'V9_8_11_2_CONTROLLED_CANONICAL_REPAIR_DRY_RUN';

const EXPECTED_ROWS = 5;

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

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function requestJson(url, key, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body !== undefined
        ? {
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          }
        : {}),
    },
    body:
      options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  const text = await response.text();

  let body = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `INVALID_JSON_RESPONSE:${options.method ?? 'GET'}:${response.status}`,
      );
    }
  } else {
    body = [];
  }

  if (!response.ok) {
    const code =
      body?.code ??
      body?.message ??
      `HTTP_${response.status}`;

    throw new Error(
      `SUPABASE_REQUEST_FAILED:${options.method ?? 'GET'}:${String(code)}`,
    );
  }

  return body;
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
  return JSON.stringify(deepStable(a)) === JSON.stringify(deepStable(b));
}

function sameScalar(a, b) {
  const an = num(a);
  const bn = num(b);

  if (
    an !== null ||
    bn !== null
  ) {
    if (
      an !== null &&
      bn !== null
    ) {
      return Math.abs(an - bn) <= 1e-12;
    }
  }

  return a === b;
}

function normalizeDbRow(row) {
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

function compareSnapshot(actual, expected, { ignoreCreatedAt = false } = {}) {
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
  ];

  if (!ignoreCreatedAt) {
    fields.push('created_at');
  }

  const mismatches = [];

  for (const field of fields) {
    if (!sameScalar(actual[field], expected[field])) {
      mismatches.push({
        field,
        actual: actual[field],
        expected: expected[field],
      });
    }
  }

  if (!sameJson(actual.metadata ?? {}, expected.metadata ?? {})) {
    mismatches.push({
      field: 'metadata',
      actual: actual.metadata ?? {},
      expected: expected.metadata ?? {},
    });
  }

  return mismatches;
}

function runReferencesEvent(run, eventId, providerEventId) {
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

async function readEvent(base, key, id) {
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

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      `EVENT_READ_EXPECTED_ONE:${id}:${Array.isArray(rows) ? rows.length : 'NON_ARRAY'}`,
    );
  }

  return normalizeDbRow(rows[0]);
}

async function readFactorRefs(base, key, eventId) {
  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_adjustment_factors` +
      `?select=id,adjustment_run_id,action_event_id,is_validation,production_applied` +
      `&action_event_id=eq.${encodeURIComponent(eventId)}`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error('FACTOR_REF_RESPONSE_NOT_ARRAY');
  }

  return rows;
}

async function readNonValidationRuns(base, key) {
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
    throw new Error('RUN_RESPONSE_NOT_ARRAY');
  }

  return rows;
}

async function patchEvent(
  base,
  key,
  plan,
) {
  const before =
    plan.expectedBefore;

  const query =
    `${base}/rest/v1/corporate_action_events` +
    `?id=eq.${encodeURIComponent(plan.existingEventId)}` +
    `&provider=eq.${encodeURIComponent(before.provider)}` +
    `&provider_event_id=eq.${encodeURIComponent(before.provider_event_id)}` +
    `&is_validation=eq.false` +
    `&production_applied=eq.false` +
    `&source_fingerprint=eq.${encodeURIComponent(before.source_fingerprint)}`;

  const rows = await requestJson(
    query,
    key,
    {
      method: 'PATCH',
      body: plan.patch,
    },
  );

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      `PATCH_EXPECTED_ONE_ROW:${plan.providerEventId}:${Array.isArray(rows) ? rows.length : 'NON_ARRAY'}`,
    );
  }

  return normalizeDbRow(rows[0]);
}

async function main() {
  const args = process.argv.slice(2);

  if (
    args.length !== 1 ||
    args[0] !== '--apply'
  ) {
    throw new Error(
      'EXPLICIT_APPLY_FLAG_REQUIRED_USE_--apply',
    );
  }

  const root = path.resolve(__dirname, '..');

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-controlled-repair-apply-v9-8-11-3.json',
  );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input = readJson(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error('INPUT_VERSION_MISMATCH');
  }

  if (input.status !== 'CONTROLLED_REPAIR_DRY_RUN_READY') {
    throw new Error('DRY_RUN_NOT_READY');
  }

  if (
    !Array.isArray(input.plans) ||
    input.plans.length !== EXPECTED_ROWS
  ) {
    throw new Error('EXPECTED_5_REPAIR_PLANS');
  }

  if (
    input.counts?.plansWithPostPatchIssues !== 0 ||
    input.counts?.idsPreserved !== EXPECTED_ROWS ||
    input.counts?.identitiesPreserved !== EXPECTED_ROWS
  ) {
    throw new Error('DRY_RUN_SAFETY_CONTRACT_FAILED');
  }

  const { url, key } = requireEnv();

  const results = [];
  let getRequests = 0;
  let patchRequests = 0;

  for (
    let index = 0;
    index < input.plans.length;
    index += 1
  ) {
    const plan = input.plans[index];

    // 1. Re-read current row.
    const current = await readEvent(
      url,
      key,
      plan.existingEventId,
    );
    getRequests += 1;

    const expectedBefore =
      normalizeDbRow(plan.expectedBefore);

    const expectedAfter =
      normalizeDbRow(plan.expectedAfter);

    const beforeMismatch =
      compareSnapshot(
        current,
        expectedBefore,
      );

    const afterMismatch =
      compareSnapshot(
        current,
        expectedAfter,
      );

    // Safe resume: already patched to exact expectedAfter.
    if (afterMismatch.length === 0) {
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
          'REPAIR_APPLY',
          `${index + 1}/${input.plans.length}`,
          `root=${plan.providerEventId}`,
          `event=${plan.existingEventId}`,
          'outcome=ALREADY_APPLIED_EXACT_MATCH',
        ].join(' '),
      );

      continue;
    }

    if (beforeMismatch.length > 0) {
      const err = new Error(
        `EXPECTED_BEFORE_DRIFT:${plan.providerEventId}`,
      );
      err.details = beforeMismatch;
      throw err;
    }

    // 2. Re-check zero factor refs.
    const factorRefs = await readFactorRefs(
      url,
      key,
      plan.existingEventId,
    );
    getRequests += 1;

    if (factorRefs.length !== 0) {
      throw new Error(
        `FACTOR_REFERENCE_APPEARED:${plan.providerEventId}:${factorRefs.length}`,
      );
    }

    // 3. Re-check zero non-validation run refs.
    const runs = await readNonValidationRuns(
      url,
      key,
    );
    getRequests += 1;

    const runRefs = runs.filter(
      (run) =>
        runReferencesEvent(
          run,
          plan.existingEventId,
          plan.providerEventId,
        ),
    );

    if (runRefs.length !== 0) {
      throw new Error(
        `RUN_REFERENCE_APPEARED:${plan.providerEventId}:${runRefs.length}`,
      );
    }

    // 4. PATCH one row with guards.
    const returned = await patchEvent(
      url,
      key,
      plan,
    );
    patchRequests += 1;

    const returnedMismatch =
      compareSnapshot(
        returned,
        expectedAfter,
      );

    if (returnedMismatch.length > 0) {
      const err = new Error(
        `PATCH_RETURN_MISMATCH:${plan.providerEventId}`,
      );
      err.details = returnedMismatch;
      throw err;
    }

    // 5. Re-read after PATCH.
    const reread = await readEvent(
      url,
      key,
      plan.existingEventId,
    );
    getRequests += 1;

    const rereadMismatch =
      compareSnapshot(
        reread,
        expectedAfter,
      );

    if (rereadMismatch.length > 0) {
      const err = new Error(
        `POST_PATCH_REREAD_MISMATCH:${plan.providerEventId}`,
      );
      err.details = rereadMismatch;
      throw err;
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

      fieldsChanged:
        plan.fieldsChanged,

      currentAfter:
        reread,
    });

    console.log(
      [
        'REPAIR_APPLY',
        `${index + 1}/${input.plans.length}`,
        `root=${plan.providerEventId}`,
        `event=${plan.existingEventId}`,
        'outcome=PATCHED_AND_VERIFIED',
        `fields=${plan.fieldsChanged.join(',')}`,
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

  const verified =
    results.every(
      (row) =>
        row.currentAfter
          ?.production_applied ===
        true &&
        row.currentAfter
          ?.metadata
          ?.canonical_validation_status ===
        'VALIDATED' &&
        row.currentAfter
          ?.metadata
          ?.pipeline_version ===
        'V9_8',
    );

  const idsPreserved =
    results.every(
      (row) =>
        row.currentAfter
          ?.id ===
        row.existingEventId,
    );

  const status =
    results.length === EXPECTED_ROWS &&
    patched.length + alreadyApplied.length === EXPECTED_ROWS &&
    verified &&
    idsPreserved
      ? 'CONTROLLED_REPAIR_APPLY_COMPLETE'
      : 'CONTROLLED_REPAIR_APPLY_INVALID';

  const report = {
    version: VERSION,
    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    counts: {
      repairPlans:
        input.plans.length,

      completedRows:
        results.length,

      patchedAndVerified:
        patched.length,

      alreadyAppliedExactMatch:
        alreadyApplied.length,

      idsPreserved:
        results.filter(
          (row) =>
            row.currentAfter?.id ===
            row.existingEventId,
        ).length,

      canonicalValidated:
        results.filter(
          (row) =>
            row.currentAfter
              ?.metadata
              ?.canonical_validation_status ===
            'VALIDATED',
        ).length,

      productionApplied:
        results.filter(
          (row) =>
            row.currentAfter
              ?.production_applied ===
            true,
        ).length,
    },

    checks: {
      allFinalRowsVerified:
        verified,

      allIdsPreserved:
        idsPreserved,
    },

    results,

    safety: {
      explicitApplyFlag:
        true,

      databaseReads:
        getRequests,

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
      'CONTROLLED_REPAIR_APPLY_COMPLETE'
        ? 'RERUN_V9_8_11_PRODUCTION_EVENT_PREFLIGHT'
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

        inputFingerprint:
          report.source.inputFingerprint,

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
              row.currentAfter
                ?.metadata
                ?.canonical_validation_status,
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
          getRequests,

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
    'CONTROLLED_REPAIR_APPLY_COMPLETE'
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
            'CONTROLLED_REPAIR_APPLY_ABORTED',

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
