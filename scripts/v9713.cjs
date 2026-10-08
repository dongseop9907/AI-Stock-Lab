'use strict';

// V9.7.13 controlled validation import + live idempotency proof.
//
// Default: dry-run only.
// Actual write requires explicit --apply.
//
// Reads V9.7.10 preview rows and upserts ONLY:
//   provider = DART_KRX_CANONICAL
//   is_validation = true
//   production_applied = false
//
// Then repeats the exact same upsert a second time and proves that:
//   - exactly 15 canonical identities exist
//   - no duplicate provider identities exist
//   - no production_applied row was created
//   - DB payload matches the preview core fields
//
// Requires:
//   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Recommended:
//   node --env-file=.env.local .\scripts\v9713.cjs --apply
//
// Safety:
//   - never touches production_applied=true
//   - aborts on conflicting existing canonical identities
//   - no coverage promotion
//   - no DELETE
//   - no schema migration

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_13_VALIDATION_IMPORT_IDEMPOTENCY_PROOF';
const PREVIEW_VERSION = 'V9_7_10_CONTRACT_AND_MAPPING_PREVIEW';

const TABLE = 'corporate_action_events';
const PROVIDER = 'DART_KRX_CANONICAL';
const EXPECTED_ROWS = 15;
const CONFLICT_TARGET = 'provider,provider_event_id,is_validation';

const CORE_COLUMNS = [
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
  'production_applied'
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_13_IMPORT_FAILED';
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return {
    url: url.replace(/\/+$/, ''),
    key
  };
}

function identity(row) {
  return `${row.provider}|${row.provider_event_id}|${String(row.is_validation)}`;
}

function normalizeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function coreComparable(row) {
  return {
    stock_code: row.stock_code ?? null,
    action_type: row.action_type ?? null,
    effective_date: row.effective_date ?? null,
    ratio_from: normalizeNumber(row.ratio_from),
    ratio_to: normalizeNumber(row.ratio_to),
    cash_amount: normalizeNumber(row.cash_amount),
    currency: row.currency ?? null,
    provider: row.provider ?? null,
    provider_event_id: row.provider_event_id ?? null,
    source_fingerprint: row.source_fingerprint ?? null,
    status: row.status ?? null,
    is_validation: row.is_validation === true,
    production_applied: row.production_applied === true
  };
}

function sameCore(a, b) {
  return JSON.stringify(coreComparable(a)) === JSON.stringify(coreComparable(b));
}

function validatePreview(preview) {
  if (!preview || preview.version !== PREVIEW_VERSION) {
    throw new Error('INVALID_V9_7_10_PREVIEW');
  }

  if (preview.status !== 'CONTRACT_AND_15_ROW_MAPPING_PREVIEW_READY') {
    throw new Error('V9_7_10_PREVIEW_NOT_READY');
  }

  if (!Array.isArray(preview.rows) || preview.rows.length !== EXPECTED_ROWS) {
    throw new Error('PREVIEW_ROW_COUNT_NOT_15');
  }

  const ids = new Set();

  for (const row of preview.rows) {
    if (row.provider !== PROVIDER) throw new Error('UNEXPECTED_PROVIDER');
    if (row.is_validation !== true) throw new Error('NON_VALIDATION_ROW_BLOCKED');
    if (row.production_applied !== false) throw new Error('PRODUCTION_ROW_BLOCKED');
    if (!/^\d{14}$/.test(row.provider_event_id ?? '')) {
      throw new Error('INVALID_PROVIDER_EVENT_ID');
    }
    if (!row.stock_code || !row.action_type || !row.effective_date) {
      throw new Error('REQUIRED_PREVIEW_FIELD_MISSING');
    }

    const key = identity(row);
    if (ids.has(key)) throw new Error('PREVIEW_IDENTITY_DUPLICATE');
    ids.add(key);
  }

  return preview.rows.map(row => {
    const out = {};
    for (const col of CORE_COLUMNS) {
      out[col] = row[col] ?? null;
    }

    // Preserve boolean false rather than replacing with null.
    out.is_validation = true;
    out.production_applied = false;
    out.provider = PROVIDER;

    return out;
  });
}

async function httpJson(url, key, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
    }
  }

  if (!res.ok) {
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    throw new Error(code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  }

  return {
    body,
    status: res.status,
    contentRange: res.headers.get('content-range')
  };
}

function buildIdentityFilter(rows) {
  // Provider is fixed and sample size is only 15, so use provider_event_id=in.(...)
  const ids = rows.map(r => r.provider_event_id);
  return `(${ids.join(',')})`;
}

async function readCanonicalRows(baseUrl, key, previewRows) {
  const select = [
    'id',
    ...CORE_COLUMNS,
    'created_at'
  ].join(',');

  const idFilter = buildIdentityFilter(previewRows);

  const url =
    `${baseUrl}/rest/v1/${TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&provider_event_id=in.${encodeURIComponent(idFilter)}` +
    `&order=provider_event_id.asc`;

  const result = await httpJson(url, key, {
    method: 'GET',
    headers: {
      Prefer: 'count=exact'
    }
  });

  if (!Array.isArray(result.body)) {
    throw new Error('INVALID_CANONICAL_READ_RESPONSE');
  }

  return result.body;
}

function analyzeExisting(previewRows, existingRows) {
  const byId = new Map();

  for (const row of existingRows) {
    const k = identity(row);
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(row);
  }

  const duplicateGroups = [...byId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, count: rows.length, rows }));

  const conflicts = [];
  const exact = [];
  const missing = [];

  for (const preview of previewRows) {
    const k = identity(preview);
    const live = byId.get(k) || [];

    if (live.length === 0) {
      missing.push({
        provider_event_id: preview.provider_event_id,
        stock_code: preview.stock_code,
        action_type: preview.action_type
      });
      continue;
    }

    for (const row of live) {
      if (sameCore(preview, row)) {
        exact.push({
          provider_event_id: preview.provider_event_id,
          id: row.id
        });
      } else {
        conflicts.push({
          provider_event_id: preview.provider_event_id,
          preview: coreComparable(preview),
          live: coreComparable(row),
          liveId: row.id
        });
      }
    }
  }

  return {
    duplicateGroups,
    conflicts,
    exact,
    missing
  };
}

async function upsertRows(baseUrl, key, rows) {
  const url =
    `${baseUrl}/rest/v1/${TABLE}` +
    `?on_conflict=${encodeURIComponent(CONFLICT_TARGET)}`;

  const result = await httpJson(url, key, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });

  if (!Array.isArray(result.body)) {
    throw new Error('INVALID_UPSERT_RESPONSE');
  }

  return result.body;
}

function countProviderIdentityDuplicates(rows) {
  const m = new Map();

  for (const row of rows) {
    const k = identity(row);
    m.set(k, (m.get(k) || 0) + 1);
  }

  return [...m.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const apply = args.includes('--apply');

  const allowed = ['--apply', '--preview=', '--output='];
  if (args.some(a =>
    !allowed.some(p => p.endsWith('=') ? a.startsWith(p) : a === p)
  )) {
    throw new Error('UNKNOWN_OPTION');
  }

  const get = (prefix, fallback) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? path.resolve(a.slice(prefix.length)) : fallback;
  };

  const previewFile = get(
    '--preview=',
    path.join(root, 'logs', 'corporate-action-contract-mapping-preview-v9-7-10.json')
  );

  const outputFile = get(
    '--output=',
    path.join(root, 'logs', 'corporate-action-validation-import-v9-7-13.json')
  );

  const preview = loadJson(previewFile);
  const rows = validatePreview(preview);

  const { url, key } = requireEnv();

  // Read-only preflight even in --apply mode.
  const beforeRows = await readCanonicalRows(url, key, rows);
  const before = analyzeExisting(rows, beforeRows);

  if (before.duplicateGroups.length > 0) {
    throw new Error('LIVE_PROVIDER_IDENTITY_DUPLICATES_EXIST');
  }

  if (before.conflicts.length > 0) {
    throw new Error('LIVE_CANONICAL_IDENTITY_CONFLICT');
  }

  if (!apply) {
    const dry = {
      version: VERSION,
      status: 'DRY_RUN_READY_FOR_APPLY',
      applyRequested: false,
      previewRows: rows.length,
      liveExactBefore: before.exact.length,
      liveMissingBefore: before.missing.length,
      liveConflictsBefore: before.conflicts.length,
      liveDuplicateGroupsBefore: before.duplicateGroups.length,
      safety: {
        writesPerformed: 0,
        eventRowsInserted: 0,
        productionAppliedRowsCreated: 0,
        coveragePromoted: false
      },
      nextCommand:
        'node --env-file=.env.local .\\scripts\\v9713.cjs --apply'
    };

    saveJson(outputFile, dry);
    console.log(JSON.stringify(dry, null, 2));
    console.log('Dry-run only. Add --apply to perform the controlled validation upsert.');
    return;
  }

  // First controlled upsert.
  const firstResponse = await upsertRows(url, key, rows);

  const afterFirstRows = await readCanonicalRows(url, key, rows);
  const afterFirst = analyzeExisting(rows, afterFirstRows);

  if (
    afterFirst.duplicateGroups.length !== 0 ||
    afterFirst.conflicts.length !== 0 ||
    afterFirst.exact.length !== EXPECTED_ROWS ||
    afterFirst.missing.length !== 0
  ) {
    throw new Error('FIRST_UPSERT_INVARIANT_FAILED');
  }

  if (afterFirstRows.some(r => r.production_applied === true)) {
    throw new Error('PRODUCTION_APPLIED_ROW_CREATED');
  }

  // Second identical upsert: the idempotency proof.
  const secondResponse = await upsertRows(url, key, rows);

  const afterSecondRows = await readCanonicalRows(url, key, rows);
  const afterSecond = analyzeExisting(rows, afterSecondRows);

  const duplicateAfterSecond = countProviderIdentityDuplicates(afterSecondRows);

  const finalInvariant =
    afterSecondRows.length === EXPECTED_ROWS &&
    afterSecond.exact.length === EXPECTED_ROWS &&
    afterSecond.missing.length === 0 &&
    afterSecond.conflicts.length === 0 &&
    afterSecond.duplicateGroups.length === 0 &&
    duplicateAfterSecond.length === 0 &&
    afterSecondRows.every(r =>
      r.provider === PROVIDER &&
      r.is_validation === true &&
      r.production_applied === false
    );

  if (!finalInvariant) {
    throw new Error('SECOND_UPSERT_IDEMPOTENCY_INVARIANT_FAILED');
  }

  const state = {
    version: VERSION,
    status: 'VALIDATION_IMPORT_AND_IDEMPOTENCY_PROVEN',
    applyRequested: true,
    targetTable: TABLE,
    conflictTarget: CONFLICT_TARGET,
    previewRows: rows.length,
    before: {
      liveExact: before.exact.length,
      liveMissing: before.missing.length,
      liveConflicts: before.conflicts.length,
      liveDuplicateGroups: before.duplicateGroups.length
    },
    firstUpsert: {
      responseRows: firstResponse.length,
      finalRowsAfterFirst: afterFirstRows.length,
      exactMatchesAfterFirst: afterFirst.exact.length,
      missingAfterFirst: afterFirst.missing.length,
      conflictsAfterFirst: afterFirst.conflicts.length,
      duplicateGroupsAfterFirst: afterFirst.duplicateGroups.length
    },
    secondUpsert: {
      responseRows: secondResponse.length,
      finalRowsAfterSecond: afterSecondRows.length,
      exactMatchesAfterSecond: afterSecond.exact.length,
      missingAfterSecond: afterSecond.missing.length,
      conflictsAfterSecond: afterSecond.conflicts.length,
      duplicateGroupsAfterSecond: afterSecond.duplicateGroups.length,
      providerIdentityDuplicatesAfterSecond: duplicateAfterSecond.length
    },
    finalInvariant: {
      expectedRows: EXPECTED_ROWS,
      actualRows: afterSecondRows.length,
      idempotencyProven: true,
      allValidationRows: afterSecondRows.every(r => r.is_validation === true),
      allProductionAppliedFalse: afterSecondRows.every(r => r.production_applied === false)
    },
    safety: {
      databaseConnected: true,
      networkUsed: true,
      httpMethodsUsed: ['GET', 'POST'],
      deleteUsed: false,
      schemaMigrationAppliedByThisScript: false,
      writesPerformed: 2,
      canonicalValidationRowsPresent: EXPECTED_ROWS,
      productionAppliedRowsCreated: 0,
      coveragePromoted: false,
      serviceRoleKeyEmitted: false
    },
    nextGate:
      'VALIDATE_DOWNSTREAM_ADJUSTMENT_FACTOR_CALCULATION_ON_THE_15_VALIDATION_EVENTS_BEFORE_ANY_PRODUCTION_PROMOTION'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    previewRows: state.previewRows,
    liveExactBefore: state.before.liveExact,
    liveMissingBefore: state.before.liveMissing,
    firstUpsertResponseRows: state.firstUpsert.responseRows,
    rowsAfterFirstUpsert: state.firstUpsert.finalRowsAfterFirst,
    secondUpsertResponseRows: state.secondUpsert.responseRows,
    rowsAfterSecondUpsert: state.secondUpsert.finalRowsAfterSecond,
    providerIdentityDuplicatesAfterSecond:
      state.secondUpsert.providerIdentityDuplicatesAfterSecond,
    idempotencyProven: state.finalInvariant.idempotencyProven,
    allValidationRows: state.finalInvariant.allValidationRows,
    allProductionAppliedFalse: state.finalInvariant.allProductionAppliedFalse,
    eventRowsPresent: state.finalInvariant.actualRows,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
