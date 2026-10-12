/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.3.2 - DB-contract-aware controlled repair dry-run
 *
 * READ-ONLY. No DB writes.
 *
 * Corrected remote DB contract:
 *   corporate_action_events_production_check:
 *     CHECK (production_applied = false)
 *
 * Therefore:
 *   - production namespace is identified by is_validation = false
 *   - production_applied MUST remain false on corporate_action_events
 *   - lifecycle-only mismatches from V9.8.11 are not real conflicts
 *   - only 3 stale semantic rows need repair
 *
 * Inputs:
 *   logs/opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-db-contract-repair-dry-run-v9-8-11-3-2.json
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-3-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'V9_8_11_3_2_DB_CONTRACT_AWARE_CONTROLLED_REPAIR_DRY_RUN';

const INPUT_VERSION =
  'V9_8_11_2_CONTROLLED_CANONICAL_REPAIR_DRY_RUN';

const EXPECTED_ROWS = 5;
const EXPECTED_REPAIR = 3;
const EXPECTED_NOOP = 2;

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

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(value) {
  const s = String(value ?? '').trim().toUpperCase();
  return s || null;
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

async function getArray(url, key) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!response.ok) {
    throw new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error('SUPABASE_ARRAY_RESPONSE_REQUIRED');
  }

  return body;
}

function postgrestIn(values) {
  return (
    '(' +
    values
      .map((value) => `"${String(value).replaceAll('"', '\\"')}"`)
      .join(',') +
    ')'
  );
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

function sameScalar(a, b) {
  const an = num(a);
  const bn = num(b);

  if (an !== null || bn !== null) {
    return an !== null && bn !== null && Math.abs(an - bn) <= 1e-12;
  }

  return a === b;
}

function validateDbChecks(row) {
  const issues = [];

  // corporate_action_events_production_check
  if (row.production_applied !== false) {
    issues.push('PRODUCTION_APPLIED_MUST_REMAIN_FALSE');
  }

  // corporate_action_events_status_check
  const allowedStatuses = new Set([
    'RECORDED',
    'SUPPORTED',
    'UNSUPPORTED',
    'INVALID',
  ]);

  if (!allowedStatuses.has(row.status)) {
    issues.push('STATUS_CHECK_FAILED');
  }

  // corporate_action_events_type_check
  const allowedTypes = new Set([
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
    'CASH_DIVIDEND',
    'STOCK_DIVIDEND',
    'RIGHTS_ISSUE',
    'SPIN_OFF',
    'MERGER',
    'OTHER',
  ]);

  if (!allowedTypes.has(row.action_type)) {
    issues.push('TYPE_CHECK_FAILED');
  }

  // corporate_action_events_split_ratio_check
  if (
    row.action_type === 'STOCK_SPLIT' ||
    row.action_type === 'REVERSE_SPLIT'
  ) {
    if (!(row.ratio_from > 0) || !(row.ratio_to > 0)) {
      issues.push('SPLIT_RATIO_CHECK_FAILED');
    }
  }

  return issues;
}

function canonicalSemanticExpected(plan) {
  // V9.8.11.2 expectedAfter had the desired canonical semantic values,
  // but production_applied=true was invalid under the actual DB constraint.
  return {
    ...plan.expectedAfter,
    production_applied: false,
  };
}

function semanticDiff(current, expected) {
  const fields = [
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
  ];

  const out = [];

  for (const field of fields) {
    const actual =
      field === 'currency'
        ? normalizeCurrency(current[field])
        : current[field];

    const target =
      field === 'currency'
        ? normalizeCurrency(expected[field])
        : expected[field];

    if (!sameScalar(actual, target)) {
      out.push({
        field,
        actual,
        expected: target,
      });
    }
  }

  return out;
}

function buildMinimalPatch(current, expected, diffs) {
  const patch = {};

  for (const diff of diffs) {
    patch[diff.field] = expected[diff.field];
  }

  if (diffs.length > 0) {
    patch.metadata = {
      ...(current.metadata ?? {}),
      canonical_validation_status: 'VALIDATED',
      pipeline_version: 'V9_8',
      canonical_repair_version: VERSION,
      canonical_repair_reason:
        'V9_8_CANONICAL_SEMANTIC_REPAIR_UNDER_REMOTE_DB_CONTRACT',
      canonical_event_production_contract:
        'IS_VALIDATION_FALSE_WITH_PRODUCTION_APPLIED_FALSE',
      canonical_adjusted_bar_policy: 'DO_NOT_DOUBLE_ADJUST',
    };
  }

  return patch;
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-db-contract-repair-dry-run-v9-8-11-3-2.json',
  );

  if (!fs.existsSync(inputFile)) {
    throw new Error(`INPUT_NOT_FOUND:${path.basename(inputFile)}`);
  }

  const input = readJson(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error('INPUT_VERSION_MISMATCH');
  }

  if (!Array.isArray(input.plans) || input.plans.length !== EXPECTED_ROWS) {
    throw new Error('EXPECTED_5_INPUT_PLANS');
  }

  const { url, key } = requireEnv();

  const ids = input.plans.map((p) => p.existingEventId);

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

  const rows = await getArray(
    `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&id=in.${encodeURIComponent(postgrestIn(ids))}` +
      `&order=provider_event_id.asc`,
    key,
  );

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error('CURRENT_DB_ROW_COUNT_MISMATCH');
  }

  const byId = new Map(rows.map((row) => [row.id, normalizeRow(row)]));
  const plans = [];

  for (const oldPlan of input.plans) {
    const current = byId.get(oldPlan.existingEventId);

    if (!current) {
      throw new Error(`CURRENT_ROW_MISSING:${oldPlan.existingEventId}`);
    }

    if (
      current.provider !== 'DART_KRX_CANONICAL' ||
      current.provider_event_id !== oldPlan.providerEventId ||
      current.is_validation !== false
    ) {
      throw new Error(`IDENTITY_GUARD_FAILED:${oldPlan.providerEventId}`);
    }

    if (current.production_applied !== false) {
      throw new Error(
        `REMOTE_DB_PRODUCTION_CHECK_STATE_UNEXPECTED:${oldPlan.providerEventId}`,
      );
    }

    const expected = canonicalSemanticExpected(oldPlan);
    const diffs = semanticDiff(current, expected);
    const patch = buildMinimalPatch(current, expected, diffs);

    const expectedAfter = {
      ...current,
      ...patch,
      production_applied: false,
    };

    const constraintIssues = validateDbChecks(expectedAfter);

    const disposition =
      diffs.length === 0
        ? 'NOOP_ALREADY_CANONICAL_UNDER_DB_CONTRACT'
        : 'PATCH_REQUIRED_CANONICAL_SEMANTIC_REPAIR';

    plans.push({
      providerEventId: oldPlan.providerEventId,
      existingEventId: oldPlan.existingEventId,
      stockCode: oldPlan.stockCode,
      actionType: oldPlan.actionType,
      disposition,
      semanticDiffs: diffs,
      current,
      patch,
      expectedAfter,
      constraintIssues,
    });

    console.log(
      [
        'DB_CONTRACT_DRY_RUN',
        `${plans.length}/${input.plans.length}`,
        `root=${oldPlan.providerEventId}`,
        `event=${oldPlan.existingEventId}`,
        `disposition=${disposition}`,
        `diffs=${diffs.map((d) => d.field).join(',') || '-'}`,
        `constraintIssues=${constraintIssues.length}`,
      ].join(' '),
    );
  }

  const repairPlans = plans.filter(
    (p) => p.disposition === 'PATCH_REQUIRED_CANONICAL_SEMANTIC_REPAIR',
  );

  const noOps = plans.filter(
    (p) => p.disposition === 'NOOP_ALREADY_CANONICAL_UNDER_DB_CONTRACT',
  );

  const issuePlans = plans.filter(
    (p) => p.constraintIssues.length > 0,
  );

  const status =
    repairPlans.length === EXPECTED_REPAIR &&
    noOps.length === EXPECTED_NOOP &&
    issuePlans.length === 0
      ? 'DB_CONTRACT_REPAIR_DRY_RUN_READY'
      : 'DB_CONTRACT_REPAIR_DRY_RUN_INVALID';

  const report = {
    version: VERSION,
    status,

    remoteDbConstraints: {
      corporate_action_events_production_check:
        'CHECK (production_applied = false)',
      corporate_action_events_split_ratio_check:
        "STOCK_SPLIT/REVERSE_SPLIT require positive ratio_from and ratio_to",
      corporate_action_events_status_check:
        'RECORDED|SUPPORTED|UNSUPPORTED|INVALID',
      corporate_action_events_type_check:
        'STOCK_SPLIT|REVERSE_SPLIT|CASH_DIVIDEND|STOCK_DIVIDEND|RIGHTS_ISSUE|SPIN_OFF|MERGER|OTHER',
    },

    correctedContract: {
      productionNamespace:
        'is_validation=false',
      productionApplied:
        'MUST_REMAIN_FALSE_ON_CORPORATE_ACTION_EVENTS',
      canonicalValidity:
        'metadata.canonical_validation_status=VALIDATED',
    },

    counts: {
      inspectedRows: plans.length,
      patchRequired: repairPlans.length,
      alreadyCanonicalNoOp: noOps.length,
      constraintIssueRows: issuePlans.length,
    },

    plans,

    safety: {
      databaseReads: 1,
      databaseWrites: 0,
      patchRequestsExecuted: 0,
      eventRowsUpdated: 0,
      eventRowsDeleted: 0,
      eventRowsInserted: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status === 'DB_CONTRACT_REPAIR_DRY_RUN_READY'
        ? 'BUILD_3_ROW_CONTROLLED_REPAIR_APPLY'
        : 'STOP_AND_REVIEW',
    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        planSummary: plans.map((p) => ({
          providerEventId: p.providerEventId,
          existingEventId: p.existingEventId,
          stockCode: p.stockCode,
          actionType: p.actionType,
          disposition: p.disposition,
          semanticDiffs: p.semanticDiffs,
          patch: p.patch,
          productionAppliedAfter: p.expectedAfter.production_applied,
          constraintIssues: p.constraintIssues,
        })),
        databaseWrites: 0,
        patchRequestsExecuted: 0,
        eventRowsUpdated: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (status !== 'DB_CONTRACT_REPAIR_DRY_RUN_READY') {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'DB_CONTRACT_REPAIR_DRY_RUN_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
        databaseWrites: 0,
        patchRequestsExecuted: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
