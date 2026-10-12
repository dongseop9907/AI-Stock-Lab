/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.9 - 128 adjustment runs + 121 factors APPLY
 *
 * WRITES:
 *   corporate_action_adjustment_runs
 *   corporate_action_adjustment_factors
 *
 * Input:
 *   logs/opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1.json
 *   logs/opendart-corporate-action-128-event-id-map-v9-8-11-7.json
 *
 * Output:
 *   logs/opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json
 *
 * Strategy:
 *   Phase A: 128 run rows in ONE bulk POST.
 *   Verify exact returned + DB state.
 *
 *   Phase B: Resolve each run UUID by stock/event identity.
 *   121 factor rows in ONE bulk POST.
 *   Verify exact returned + DB state.
 *
 * Important:
 *   PostgREST cannot make the two-table sequence one atomic request.
 *   Therefore this script is intentionally resume-safe:
 *     - 0 target runs -> insert all 128
 *     - 128 exact target runs -> reuse them
 *     - any partial/conflicting target-run state -> FAIL CLOSED
 *     - 0 target factors -> insert all 121
 *     - 121 exact target factors -> reuse them
 *     - any partial/conflicting factor state -> FAIL CLOSED
 *
 * No automatic delete/rollback is attempted after a committed phase.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-9.cjs --apply
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_9_128_RUN_121_FACTOR_PERSISTENCE_APPLY';

const PREFLIGHT_VERSION =
  'V9_8_11_8_1_SCHEMA_AWARE_ADJUSTMENT_RUN_FACTOR_PERSISTENCE_PREFLIGHT';

const EVENT_MAP_VERSION =
  'V9_8_11_7_POST_INSERT_128_EVENT_CANONICAL_VERIFICATION_AND_UUID_MAP';

const EXPECTED_RUNS = 128;
const EXPECTED_FACTORS = 121;
const RUN_VERSION = 'V9_8_11_PRODUCTION_ADJUSTMENT_V1';
const PROVIDER = 'DART_KRX_CANONICAL';

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

function deepStable(value) {
  if (Array.isArray(value)) {
    return value.map(deepStable);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, deepStable(value[key])]),
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

  if (x === null || y === null) {
    return x === null && y === null;
  }

  return Math.abs(x - y) <= 1e-12;
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

  const response = await fetch(url, {
    method,
    headers,
    body:
      body !== undefined
        ? JSON.stringify(body)
        : undefined,
  });

  const text = await response.text();

  let parsed = [];

  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `INVALID_JSON_RESPONSE:${method}:${response.status}`,
      );
    }
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

function normalizeRun(row) {
  return {
    id: row.id,
    stock_code: row.stock_code,
    version: row.version,
    status: row.status,
    event_count: row.event_count,
    supported_event_count: row.supported_event_count,
    unsupported_event_count: row.unsupported_event_count,
    factor_count: row.factor_count,
    summary: row.summary ?? {},
    is_validation: row.is_validation,
    production_applied: row.production_applied,
    started_at: row.started_at,
    finished_at: row.finished_at,
    error_message: row.error_message,
  };
}

function normalizeFactor(row) {
  return {
    id: row.id,
    adjustment_run_id: row.adjustment_run_id,
    stock_code: row.stock_code,
    effective_date: row.effective_date,
    action_event_id: row.action_event_id,
    action_type: row.action_type,
    event_price_factor: num(row.event_price_factor),
    event_share_factor: num(row.event_share_factor),
    cumulative_price_factor: num(row.cumulative_price_factor),
    cumulative_share_factor: num(row.cumulative_share_factor),
    metadata: row.metadata ?? {},
    is_validation: row.is_validation,
    production_applied: row.production_applied,
    created_at: row.created_at,
  };
}

function compareRun(actual, expected) {
  const mismatches = [];

  for (const field of [
    'stock_code',
    'version',
    'status',
    'event_count',
    'supported_event_count',
    'unsupported_event_count',
    'factor_count',
    'is_validation',
    'production_applied',
  ]) {
    if (actual[field] !== expected[field]) {
      mismatches.push({
        field,
        actual: actual[field],
        expected: expected[field],
      });
    }
  }

  if (!sameJson(actual.summary ?? {}, expected.summary ?? {})) {
    mismatches.push({
      field: 'summary',
      actual: actual.summary ?? {},
      expected: expected.summary ?? {},
    });
  }

  return mismatches;
}

function compareFactor(actual, expected) {
  const mismatches = [];

  for (const field of [
    'adjustment_run_id',
    'stock_code',
    'effective_date',
    'action_event_id',
    'action_type',
    'is_validation',
    'production_applied',
  ]) {
    if (actual[field] !== expected[field]) {
      mismatches.push({
        field,
        actual: actual[field],
        expected: expected[field],
      });
    }
  }

  for (const field of [
    'event_price_factor',
    'event_share_factor',
    'cumulative_price_factor',
    'cumulative_share_factor',
  ]) {
    if (!sameNumeric(actual[field], expected[field])) {
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

async function readRuns(base, key) {
  const select = [
    'id',
    'stock_code',
    'version',
    'status',
    'event_count',
    'supported_event_count',
    'unsupported_event_count',
    'factor_count',
    'summary',
    'is_validation',
    'production_applied',
    'started_at',
    'finished_at',
    'error_message',
  ].join(',');

  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(select)}` +
      `&is_validation=eq.false` +
      `&order=started_at.asc`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error('RUN_RESPONSE_NOT_ARRAY');
  }

  return rows.map(normalizeRun);
}

async function readFactors(base, key) {
  const select = [
    'id',
    'adjustment_run_id',
    'stock_code',
    'effective_date',
    'action_event_id',
    'action_type',
    'event_price_factor',
    'event_share_factor',
    'cumulative_price_factor',
    'cumulative_share_factor',
    'metadata',
    'is_validation',
    'production_applied',
    'created_at',
  ].join(',');

  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_adjustment_factors` +
      `?select=${encodeURIComponent(select)}` +
      `&is_validation=eq.false` +
      `&order=created_at.asc`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error('FACTOR_RESPONSE_NOT_ARRAY');
  }

  return rows.map(normalizeFactor);
}

async function readCanonicalEvents(base, key) {
  const select = [
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'provider',
    'provider_event_id',
    'source_fingerprint',
    'is_validation',
    'production_applied',
    'metadata',
  ].join(',');

  const rows = await requestJson(
    `${base}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false`,
    key,
  );

  if (!Array.isArray(rows)) {
    throw new Error('EVENT_RESPONSE_NOT_ARRAY');
  }

  return rows;
}

function indexTargetRuns(existingRuns, runPreview) {
  const targetStocks =
    new Set(runPreview.map((row) => row.stock_code));

  return existingRuns.filter(
    (run) =>
      run.version === RUN_VERSION &&
      targetStocks.has(run.stock_code),
  );
}

function verifyRunSet(rows, runPreview) {
  const byStock = new Map();

  for (const row of rows) {
    if (!byStock.has(row.stock_code)) {
      byStock.set(row.stock_code, []);
    }

    byStock.get(row.stock_code).push(row);
  }

  const issues = [];
  const exact = [];

  for (const expected of runPreview) {
    const matches =
      byStock.get(expected.stock_code) ?? [];

    if (matches.length !== 1) {
      issues.push({
        stockCode: expected.stock_code,
        reason: 'EXPECTED_EXACTLY_ONE_TARGET_RUN',
        rowCount: matches.length,
        runIds: matches.map((row) => row.id),
      });
      continue;
    }

    const actual = matches[0];
    const mismatches = compareRun(actual, expected);

    if (mismatches.length > 0) {
      issues.push({
        stockCode: expected.stock_code,
        runId: actual.id,
        reason: 'RUN_CANONICAL_MISMATCH',
        mismatches,
      });
      continue;
    }

    exact.push(actual);
  }

  return {
    issues,
    exact,
  };
}

function buildFactorPayload(factorPreview, runRows) {
  const runByStock =
    new Map(
      runRows.map((row) => [
        row.stock_code,
        row,
      ]),
    );

  return factorPreview.map((row) => {
    const run =
      runByStock.get(row.stock_code);

    if (!run) {
      throw new Error(
        `RUN_ID_MISSING_FOR_FACTOR_STOCK:${row.stock_code}`,
      );
    }

    return {
      adjustment_run_id:
        run.id,

      stock_code:
        row.stock_code,

      effective_date:
        row.effective_date,

      action_event_id:
        row.action_event_id,

      action_type:
        row.action_type,

      event_price_factor:
        row.event_price_factor,

      event_share_factor:
        row.event_share_factor,

      cumulative_price_factor:
        row.cumulative_price_factor,

      cumulative_share_factor:
        row.cumulative_share_factor,

      metadata:
        row.metadata ?? {},

      is_validation:
        false,

      production_applied:
        false,
    };
  });
}

function verifyFactorSet(rows, factorPayload) {
  const targetEventIds =
    new Set(
      factorPayload.map(
        (row) => row.action_event_id,
      ),
    );

  const targetRows =
    rows.filter(
      (row) =>
        targetEventIds.has(
          row.action_event_id,
        ),
    );

  const byEventId = new Map();

  for (const row of targetRows) {
    if (!byEventId.has(row.action_event_id)) {
      byEventId.set(row.action_event_id, []);
    }

    byEventId
      .get(row.action_event_id)
      .push(row);
  }

  const issues = [];
  const exact = [];

  for (const expected of factorPayload) {
    const matches =
      byEventId.get(expected.action_event_id) ?? [];

    if (matches.length !== 1) {
      issues.push({
        actionEventId: expected.action_event_id,
        stockCode: expected.stock_code,
        reason: 'EXPECTED_EXACTLY_ONE_TARGET_FACTOR',
        rowCount: matches.length,
        factorIds: matches.map((row) => row.id),
      });
      continue;
    }

    const actual = matches[0];
    const mismatches =
      compareFactor(actual, expected);

    if (mismatches.length > 0) {
      issues.push({
        actionEventId: expected.action_event_id,
        stockCode: expected.stock_code,
        factorId: actual.id,
        reason: 'FACTOR_CANONICAL_MISMATCH',
        mismatches,
      });
      continue;
    }

    exact.push(actual);
  }

  return {
    targetRows,
    issues,
    exact,
  };
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
    path.resolve(__dirname, '..');

  const preflightFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1.json',
    );

  const eventMapFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-128-event-id-map-v9-8-11-7.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json',
    );

  for (const file of [preflightFile, eventMapFile]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const preflight =
    readJson(preflightFile);

  const eventMap =
    readJson(eventMapFile);

  if (
    preflight.version !==
    PREFLIGHT_VERSION
  ) {
    throw new Error(
      'PREFLIGHT_VERSION_MISMATCH',
    );
  }

  if (
    eventMap.version !==
    EVENT_MAP_VERSION
  ) {
    throw new Error(
      'EVENT_MAP_VERSION_MISMATCH',
    );
  }

  if (
    preflight.status !==
    'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY'
  ) {
    throw new Error(
      'PREFLIGHT_NOT_READY',
    );
  }

  if (
    eventMap.status !==
    'POST_INSERT_128_EVENT_VERIFICATION_COMPLETE'
  ) {
    throw new Error(
      'EVENT_MAP_NOT_COMPLETE',
    );
  }

  if (
    preflight.runVersion !==
    RUN_VERSION
  ) {
    throw new Error(
      'RUN_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(preflight.runPreview) ||
    preflight.runPreview.length !==
      EXPECTED_RUNS
  ) {
    throw new Error(
      'EXPECTED_128_RUN_PREVIEW_ROWS',
    );
  }

  if (
    !Array.isArray(preflight.factorPreview) ||
    preflight.factorPreview.length !==
      EXPECTED_FACTORS
  ) {
    throw new Error(
      'EXPECTED_121_FACTOR_PREVIEW_ROWS',
    );
  }

  const runPreview =
    preflight.runPreview;

  const factorPreview =
    preflight.factorPreview;

  const {
    url,
    key,
  } =
    requireEnv();

  let databaseReads = 0;
  let databaseWrites = 0;
  let runInsertRequests = 0;
  let factorInsertRequests = 0;

  // ---- Guard canonical events before any write.
  const canonicalRows =
    await readCanonicalEvents(url, key);

  databaseReads += 1;

  const eventById =
    new Map(
      canonicalRows.map((row) => [
        row.id,
        row,
      ]),
    );

  const canonicalIssues = [];

  for (const event of eventMap.eventMap) {
    const current =
      eventById.get(event.eventId);

    if (!current) {
      canonicalIssues.push({
        eventId: event.eventId,
        providerEventId: event.providerEventId,
        reason: 'CANONICAL_EVENT_MISSING',
      });
      continue;
    }

    if (
      current.provider_event_id !==
        event.providerEventId ||
      current.stock_code !==
        event.stockCode ||
      current.action_type !==
        event.actionType ||
      current.effective_date !==
        event.effectiveDate ||
      current.is_validation !==
        false ||
      current.production_applied !==
        false ||
      current.metadata
        ?.canonical_validation_status !==
        'VALIDATED'
    ) {
      canonicalIssues.push({
        eventId: event.eventId,
        providerEventId: event.providerEventId,
        reason: 'CANONICAL_EVENT_DRIFT',
        current,
      });
    }
  }

  if (canonicalIssues.length > 0) {
    const error =
      new Error(
        'CANONICAL_EVENT_DRIFT_BEFORE_ADJUSTMENT_WRITE',
      );

    error.details =
      canonicalIssues;

    throw error;
  }

  // ---- Phase A: run rows.
  let allRuns =
    await readRuns(url, key);

  databaseReads += 1;

  let targetRuns =
    indexTargetRuns(
      allRuns,
      runPreview,
    );

  let runPhaseOutcome;

  if (targetRuns.length === 0) {
    const insertedRaw =
      await requestJson(
        `${url}/rest/v1/corporate_action_adjustment_runs`,
        key,
        {
          method: 'POST',
          body: runPreview,
          preferRepresentation: true,
        },
      );

    databaseWrites += 1;
    runInsertRequests += 1;

    if (
      !Array.isArray(insertedRaw) ||
      insertedRaw.length !==
        EXPECTED_RUNS
    ) {
      throw new Error(
        `RUN_BULK_INSERT_RETURN_COUNT_MISMATCH:${Array.isArray(insertedRaw) ? insertedRaw.length : 'NON_ARRAY'}`,
      );
    }

    const inserted =
      insertedRaw.map(
        normalizeRun,
      );

    const returnedCheck =
      verifyRunSet(
        inserted,
        runPreview,
      );

    if (
      returnedCheck.issues.length >
      0
    ) {
      const error =
        new Error(
          'RUN_BULK_INSERT_RETURN_MISMATCH',
        );

      error.details =
        returnedCheck.issues;

      throw error;
    }

    allRuns =
      await readRuns(url, key);

    databaseReads += 1;

    targetRuns =
      indexTargetRuns(
        allRuns,
        runPreview,
      );

    runPhaseOutcome =
      '128_RUNS_INSERTED_AND_RETURN_VERIFIED';
  } else if (
    targetRuns.length ===
    EXPECTED_RUNS
  ) {
    runPhaseOutcome =
      '128_RUNS_ALREADY_PRESENT_RESUME_CHECK';
  } else {
    const error =
      new Error(
        `PARTIAL_TARGET_RUN_STATE:${targetRuns.length}`,
      );

    error.details =
      targetRuns.map((row) => ({
        id: row.id,
        stockCode: row.stock_code,
        status: row.status,
      }));

    throw error;
  }

  const runDbCheck =
    verifyRunSet(
      targetRuns,
      runPreview,
    );

  if (
    runDbCheck.issues.length >
    0 ||
    runDbCheck.exact.length !==
      EXPECTED_RUNS
  ) {
    const error =
      new Error(
        'RUN_DB_VERIFICATION_FAILED',
      );

    error.details =
      runDbCheck.issues;

    throw error;
  }

  const verifiedRuns =
    runDbCheck.exact;

  // ---- Phase B: factor rows.
  const factorPayload =
    buildFactorPayload(
      factorPreview,
      verifiedRuns,
    );

  let allFactors =
    await readFactors(url, key);

  databaseReads += 1;

  let factorDbCheck =
    verifyFactorSet(
      allFactors,
      factorPayload,
    );

  let factorPhaseOutcome;

  if (
    factorDbCheck.targetRows.length ===
    0
  ) {
    const insertedRaw =
      await requestJson(
        `${url}/rest/v1/corporate_action_adjustment_factors`,
        key,
        {
          method: 'POST',
          body: factorPayload,
          preferRepresentation: true,
        },
      );

    databaseWrites += 1;
    factorInsertRequests += 1;

    if (
      !Array.isArray(insertedRaw) ||
      insertedRaw.length !==
        EXPECTED_FACTORS
    ) {
      throw new Error(
        `FACTOR_BULK_INSERT_RETURN_COUNT_MISMATCH:${Array.isArray(insertedRaw) ? insertedRaw.length : 'NON_ARRAY'}`,
      );
    }

    const inserted =
      insertedRaw.map(
        normalizeFactor,
      );

    const returnedCheck =
      verifyFactorSet(
        inserted,
        factorPayload,
      );

    if (
      returnedCheck.issues.length >
        0 ||
      returnedCheck.exact.length !==
        EXPECTED_FACTORS
    ) {
      const error =
        new Error(
          'FACTOR_BULK_INSERT_RETURN_MISMATCH',
        );

      error.details =
        returnedCheck.issues;

      throw error;
    }

    allFactors =
      await readFactors(url, key);

    databaseReads += 1;

    factorDbCheck =
      verifyFactorSet(
        allFactors,
        factorPayload,
      );

    factorPhaseOutcome =
      '121_FACTORS_INSERTED_AND_RETURN_VERIFIED';
  } else if (
    factorDbCheck.targetRows.length ===
    EXPECTED_FACTORS
  ) {
    factorPhaseOutcome =
      '121_FACTORS_ALREADY_PRESENT_RESUME_CHECK';
  } else {
    const error =
      new Error(
        `PARTIAL_TARGET_FACTOR_STATE:${factorDbCheck.targetRows.length}`,
      );

    error.details =
      factorDbCheck.targetRows.map((row) => ({
        id: row.id,
        adjustmentRunId: row.adjustment_run_id,
        stockCode: row.stock_code,
        actionEventId: row.action_event_id,
      }));

    throw error;
  }

  if (
    factorDbCheck.issues.length >
      0 ||
    factorDbCheck.exact.length !==
      EXPECTED_FACTORS
  ) {
    const error =
      new Error(
        'FACTOR_DB_VERIFICATION_FAILED',
      );

    error.details =
      factorDbCheck.issues;

    throw error;
  }

  const verifiedFactors =
    factorDbCheck.exact;

  // ---- Cross-table final verification.
  const runIds =
    new Set(
      verifiedRuns.map(
        (row) => row.id,
      ),
    );

  const factorRunIds =
    new Set(
      verifiedFactors.map(
        (row) =>
          row.adjustment_run_id,
      ),
    );

  const orphanFactorRunIds =
    [...factorRunIds].filter(
      (id) => !runIds.has(id),
    );

  const readyRuns =
    verifiedRuns.filter(
      (row) =>
        row.status === 'READY',
    );

  const blockedRuns =
    verifiedRuns.filter(
      (row) =>
        row.status ===
        'BLOCKED_UNSUPPORTED_ACTION',
    );

  const readyRunIds =
    new Set(
      readyRuns.map(
        (row) => row.id,
      ),
    );

  const factorRunCoverageMissing =
    [...readyRunIds].filter(
      (id) => !factorRunIds.has(id),
    );

  const factorsOnBlockedRuns =
    verifiedFactors.filter(
      (factor) =>
        !readyRunIds.has(
          factor.adjustment_run_id,
        ),
    );

  if (
    readyRuns.length !== 121 ||
    blockedRuns.length !== 7 ||
    orphanFactorRunIds.length !== 0 ||
    factorRunCoverageMissing.length !== 0 ||
    factorsOnBlockedRuns.length !== 0
  ) {
    const error =
      new Error(
        'FINAL_CROSS_TABLE_ACCOUNTING_FAILED',
      );

    error.details = {
      readyRuns: readyRuns.length,
      blockedRuns: blockedRuns.length,
      orphanFactorRunIds,
      factorRunCoverageMissing,
      factorsOnBlockedRuns: factorsOnBlockedRuns.map(
        (row) => row.id,
      ),
    };

    throw error;
  }

  const status =
    'ADJUSTMENT_PERSISTENCE_APPLY_COMPLETE';

  const report = {
    version: VERSION,
    status,
    runVersion: RUN_VERSION,

    source: {
      preflightVersion:
        preflight.version,
      preflightFingerprint:
        preflight.outputFingerprint,
      eventMapVersion:
        eventMap.version,
      eventMapFingerprint:
        eventMap.outputFingerprint,
    },

    phaseOutcomes: {
      runs: runPhaseOutcome,
      factors: factorPhaseOutcome,
    },

    counts: {
      verifiedCanonicalEvents:
        eventMap.eventMap.length,

      verifiedRuns:
        verifiedRuns.length,

      readyRuns:
        readyRuns.length,

      blockedStructuralRuns:
        blockedRuns.length,

      verifiedFactors:
        verifiedFactors.length,

      uniqueRunIds:
        new Set(
          verifiedRuns.map(
            (row) => row.id,
          ),
        ).size,

      uniqueFactorIds:
        new Set(
          verifiedFactors.map(
            (row) => row.id,
          ),
        ).size,

      uniqueFactorEventIds:
        new Set(
          verifiedFactors.map(
            (row) =>
              row.action_event_id,
          ),
        ).size,

      uniqueFactorRunIds:
        factorRunIds.size,

      orphanFactorRunIds:
        orphanFactorRunIds.length,

      readyRunFactorCoverageMissing:
        factorRunCoverageMissing.length,

      factorsOnBlockedRuns:
        factorsOnBlockedRuns.length,
    },

    runMap:
      verifiedRuns
        .map((row) => ({
          runId: row.id,
          stockCode: row.stock_code,
          version: row.version,
          status: row.status,
          eventId:
            row.summary?.event_ids?.[0] ??
            null,
          providerEventId:
            row.summary?.provider_event_ids?.[0] ??
            null,
          productionApplied:
            row.production_applied,
          startedAt:
            row.started_at,
          finishedAt:
            row.finished_at,
        }))
        .sort((a, b) =>
          a.stockCode.localeCompare(b.stockCode),
        ),

    factorMap:
      verifiedFactors
        .map((row) => ({
          factorId: row.id,
          runId: row.adjustment_run_id,
          stockCode: row.stock_code,
          eventId: row.action_event_id,
          actionType: row.action_type,
          effectiveDate: row.effective_date,
          eventPriceFactor:
            row.event_price_factor,
          eventShareFactor:
            row.event_share_factor,
          cumulativePriceFactor:
            row.cumulative_price_factor,
          cumulativeShareFactor:
            row.cumulative_share_factor,
          productionApplied:
            row.production_applied,
        }))
        .sort((a, b) =>
          a.stockCode.localeCompare(b.stockCode),
        ),

    checks: {
      canonicalEventsStillValid:
        true,

      exact128Runs:
        verifiedRuns.length === 128,

      exact121Factors:
        verifiedFactors.length === 121,

      exact121ReadyRuns:
        readyRuns.length === 121,

      exact7BlockedRuns:
        blockedRuns.length === 7,

      noOrphanFactors:
        orphanFactorRunIds.length === 0,

      everyReadyRunHasFactor:
        factorRunCoverageMissing.length === 0,

      noBlockedRunHasFactor:
        factorsOnBlockedRuns.length === 0,

      productionAppliedRemainsFalse:
        verifiedRuns.every(
          (row) =>
            row.production_applied === false,
        ) &&
        verifiedFactors.every(
          (row) =>
            row.production_applied === false,
        ),
    },

    safety: {
      explicitApplyFlag: true,
      databaseReads,
      databaseWrites,
      runInsertRequests,
      factorInsertRequests,
      rowByRowInsertUsed: false,
      automaticDeleteRollbackUsed: false,
      canonicalEventsModified: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      'BUILD_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_PLAN',

    outputFile:
      path
        .relative(root, outputFile)
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        runVersion: RUN_VERSION,
        status: report.status,
        runs: report.runMap.map(
          (row) => [
            row.runId,
            row.stockCode,
            row.status,
            row.eventId,
          ],
        ),
        factors: report.factorMap.map(
          (row) => [
            row.factorId,
            row.runId,
            row.stockCode,
            row.eventId,
            row.eventPriceFactor,
            row.eventShareFactor,
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
        status: report.status,
        version: VERSION,
        runVersion: RUN_VERSION,
        phaseOutcomes:
          report.phaseOutcomes,
        ...report.counts,
        checks: report.checks,
        databaseReads:
          report.safety.databaseReads,
        databaseWrites:
          report.safety.databaseWrites,
        runInsertRequests:
          report.safety.runInsertRequests,
        factorInsertRequests:
          report.safety.factorInsertRequests,
        rowByRowInsertUsed: false,
        automaticDeleteRollbackUsed: false,
        coverageWindowAdvanced: false,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'ADJUSTMENT_PERSISTENCE_APPLY_ABORTED',
        version: VERSION,
        error:
          String(error?.message ?? error),
        details:
          error?.details ?? null,
        databaseSafety:
          'FAIL_CLOSED_RESUME_SAFE_NO_AUTOMATIC_DELETE',
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
