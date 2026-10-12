'use strict';

// V9.7.11 read-only live DB preflight for corporate_action_events.
//
// Requires environment variables already loaded into the Node process:
//   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Recommended PowerShell invocation from project root:
//   node --env-file=.env.local .\scripts\v9711.cjs
//
// Safety:
//   - HTTP GET only
//   - NO INSERT / UPDATE / DELETE / UPSERT
//   - NO migration execution
//   - secrets are never printed or written to the report
//   - compares live DB state with V9.7.10 15-row preview

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_11_LIVE_DB_PREFLIGHT';
const PREVIEW_VERSION = 'V9_7_10_CONTRACT_AND_MAPPING_PREVIEW';
const TABLE = 'corporate_action_events';
const PAGE_SIZE = 1000;

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  if (/SUPABASE_SERVICE_ROLE_KEY/i.test(m)) return 'SUPABASE_SERVICE_ROLE_KEY_REQUIRED';
  if (/SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL/i.test(m)) return 'SUPABASE_URL_REQUIRED';
  return /^[A-Z0-9_]+$/.test(m) ? m : 'LIVE_DB_PREFLIGHT_FAILED';
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
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
  return `${row.provider ?? ''}|${row.provider_event_id ?? ''}|${String(row.is_validation)}`;
}

function legacyIdentity(row) {
  return [
    row.stock_code ?? '',
    row.action_type ?? '',
    row.effective_date ?? '',
    row.provider ?? '',
    row.source_fingerprint ?? '',
    String(row.is_validation)
  ].join('|');
}

function groupDuplicates(rows, keyFn, allowNullProviderEventId = false) {
  const groups = new Map();

  for (const row of rows) {
    if (!allowNullProviderEventId && !row.provider_event_id) continue;

    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      count: items.length,
      rows: items
    }));
}

async function fetchPage(baseUrl, serviceKey, from, to) {
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
    'is_validation',
    'production_applied',
    'created_at'
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/${TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&order=created_at.asc`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
      Range: `${from}-${to}`,
      Prefer: 'count=exact'
    }
  });

  const text = await res.text();

  if (!res.ok) {
    let code = 'SUPABASE_READ_FAILED';
    try {
      const body = JSON.parse(text);
      if (body?.code) code = String(body.code);
    } catch {}
    throw new Error(code);
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  const contentRange = res.headers.get('content-range');
  let total = null;

  if (contentRange) {
    const m = contentRange.match(/\/(\d+|\*)$/);
    if (m && m[1] !== '*') total = Number(m[1]);
  }

  return {
    rows,
    total,
    contentRange
  };
}

async function fetchAllRows(baseUrl, serviceKey) {
  const rows = [];
  let from = 0;
  let total = null;
  let pages = 0;

  while (true) {
    const page = await fetchPage(
      baseUrl,
      serviceKey,
      from,
      from + PAGE_SIZE - 1
    );

    pages++;
    rows.push(...page.rows);

    if (page.total !== null) total = page.total;

    if (page.rows.length < PAGE_SIZE) break;
    if (total !== null && rows.length >= total) break;

    from += PAGE_SIZE;

    if (pages > 10000) {
      throw new Error('PAGINATION_SAFETY_LIMIT_REACHED');
    }
  }

  return {
    rows,
    total: total ?? rows.length,
    pages
  };
}

function comparePreviewToLive(previewRows, liveRows) {
  const liveByIdentity = new Map();

  for (const row of liveRows) {
    if (!row.provider_event_id) continue;
    const key = identity(row);
    if (!liveByIdentity.has(key)) liveByIdentity.set(key, []);
    liveByIdentity.get(key).push(row);
  }

  const exactExisting = [];
  const conflictingExisting = [];
  const missingFromLive = [];

  for (const preview of previewRows) {
    const key = identity(preview);
    const existing = liveByIdentity.get(key) || [];

    if (existing.length === 0) {
      missingFromLive.push({
        provider: preview.provider,
        provider_event_id: preview.provider_event_id,
        is_validation: preview.is_validation,
        stock_code: preview.stock_code,
        action_type: preview.action_type,
        effective_date: preview.effective_date
      });
      continue;
    }

    for (const live of existing) {
      const sameEconomicIdentity =
        live.stock_code === preview.stock_code &&
        live.action_type === preview.action_type;

      const sameCorePayload =
        sameEconomicIdentity &&
        live.effective_date === preview.effective_date &&
        Number(live.ratio_from ?? 0) === Number(preview.ratio_from ?? 0) &&
        Number(live.ratio_to ?? 0) === Number(preview.ratio_to ?? 0) &&
        Number(live.cash_amount ?? 0) === Number(preview.cash_amount ?? 0) &&
        (live.currency ?? null) === (preview.currency ?? null) &&
        live.source_fingerprint === preview.source_fingerprint;

      if (sameCorePayload) {
        exactExisting.push({
          previewIdentity: key,
          liveId: live.id
        });
      } else {
        conflictingExisting.push({
          previewIdentity: key,
          live: {
            id: live.id,
            stock_code: live.stock_code,
            action_type: live.action_type,
            effective_date: live.effective_date,
            ratio_from: live.ratio_from,
            ratio_to: live.ratio_to,
            cash_amount: live.cash_amount,
            currency: live.currency,
            source_fingerprint: live.source_fingerprint,
            status: live.status,
            production_applied: live.production_applied
          },
          preview: {
            stock_code: preview.stock_code,
            action_type: preview.action_type,
            effective_date: preview.effective_date,
            ratio_from: preview.ratio_from,
            ratio_to: preview.ratio_to,
            cash_amount: preview.cash_amount,
            currency: preview.currency,
            source_fingerprint: preview.source_fingerprint
          }
        });
      }
    }
  }

  return {
    exactExisting,
    conflictingExisting,
    missingFromLive
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--preview=', '--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
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
    path.join(root, 'logs', 'corporate-action-live-db-preflight-v9-7-11.json')
  );

  const preview = loadJson(previewFile);

  if (!preview || preview.version !== PREVIEW_VERSION) {
    throw new Error('INVALID_V9_7_10_PREVIEW');
  }

  if (preview.status !== 'CONTRACT_AND_15_ROW_MAPPING_PREVIEW_READY') {
    throw new Error('V9_7_10_PREVIEW_NOT_READY');
  }

  if (!Array.isArray(preview.rows) || preview.rows.length !== 15) {
    throw new Error('V9_7_10_ROW_INVARIANT_FAILED');
  }

  const { url, key } = requireEnv();
  const live = await fetchAllRows(url, key);

  const providerIdentityDuplicates = groupDuplicates(
    live.rows,
    identity,
    false
  );

  const legacyIdentityDuplicates = groupDuplicates(
    live.rows,
    legacyIdentity,
    true
  );

  const providerEventIdNullRows = live.rows.filter(
    r => r.provider_event_id == null || r.provider_event_id === ''
  );

  const providerSummaryMap = new Map();
  for (const row of live.rows) {
    const k = `${row.provider ?? 'NULL'}|${String(row.is_validation)}`;
    if (!providerSummaryMap.has(k)) {
      providerSummaryMap.set(k, {
        provider: row.provider ?? null,
        is_validation: row.is_validation,
        rows: 0,
        missingProviderEventId: 0,
        productionApplied: 0
      });
    }
    const s = providerSummaryMap.get(k);
    s.rows++;
    if (!row.provider_event_id) s.missingProviderEventId++;
    if (row.production_applied) s.productionApplied++;
  }

  const previewComparison = comparePreviewToLive(
    preview.rows,
    live.rows
  );

  const previewIdentityDuplicates = groupDuplicates(
    preview.rows,
    identity,
    false
  );

  const migrationBlockers = [];

  if (providerIdentityDuplicates.length > 0) {
    migrationBlockers.push('LIVE_PROVIDER_EVENT_ID_DUPLICATES_EXIST');
  }

  if (previewIdentityDuplicates.length > 0) {
    migrationBlockers.push('PREVIEW_PROVIDER_EVENT_ID_DUPLICATES_EXIST');
  }

  if (previewComparison.conflictingExisting.length > 0) {
    migrationBlockers.push('PREVIEW_IDENTITIES_CONFLICT_WITH_EXISTING_ROWS');
  }

  let status;
  if (migrationBlockers.length > 0) {
    status = 'LIVE_DB_PREFLIGHT_REVIEW_REQUIRED';
  } else {
    status = 'LIVE_DB_PREFLIGHT_SAFE_FOR_UNIQUE_INDEX';
  }

  const state = {
    version: VERSION,
    status,
    scope: 'LIVE_DATABASE_READ_ONLY_PREFLIGHT',
    table: TABLE,
    liveDatabase: {
      rowsRead: live.rows.length,
      exactCount: live.total,
      pagesRead: live.pages,
      providerEventIdNullRows: providerEventIdNullRows.length,
      providerIdentityDuplicateGroups: providerIdentityDuplicates,
      legacyIdentityDuplicateGroups: legacyIdentityDuplicates,
      providerSummary: [...providerSummaryMap.values()]
    },
    previewComparison: {
      previewRows: preview.rows.length,
      previewIdentityDuplicateGroups: previewIdentityDuplicates,
      exactExisting: previewComparison.exactExisting,
      conflictingExisting: previewComparison.conflictingExisting,
      missingFromLive: previewComparison.missingFromLive
    },
    migrationAssessment: {
      proposedUniqueIndex:
        'unique(provider, provider_event_id, is_validation) where provider_event_id is not null',
      blockers: migrationBlockers,
      safeToApplyUniqueIndex:
        status === 'LIVE_DB_PREFLIGHT_SAFE_FOR_UNIQUE_INDEX'
    },
    safety: {
      databaseConnected: true,
      connectionMode: 'SUPABASE_REST_GET_ONLY',
      serviceRoleKeyUsed: true,
      serviceRoleKeyEmitted: false,
      networkUsed: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      migrationsApplied: 0,
      eventRowsInserted: 0,
      coveragePromoted: false
    },
    nextGate:
      status === 'LIVE_DB_PREFLIGHT_SAFE_FOR_UNIQUE_INDEX'
        ? 'REVIEW_AND_APPLY_V9_7_10_UNIQUE_INDEX_MIGRATION_SEPARATELY'
        : 'RESOLVE_LIVE_DB_CONFLICTS_BEFORE_ANY_MIGRATION'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status,
    liveRows: live.rows.length,
    providerEventIdNullRows: providerEventIdNullRows.length,
    providerIdentityDuplicateGroups: providerIdentityDuplicates.length,
    legacyIdentityDuplicateGroups: legacyIdentityDuplicates.length,
    previewRows: preview.rows.length,
    previewExactExisting: previewComparison.exactExisting.length,
    previewConflictingExisting: previewComparison.conflictingExisting.length,
    previewMissingFromLive: previewComparison.missingFromLive.length,
    safeToApplyUniqueIndex:
      state.migrationAssessment.safeToApplyUniqueIndex,
    writesPerformed: 0,
    migrationsApplied: 0,
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
  );

  if (status !== 'LIVE_DB_PREFLIGHT_SAFE_FOR_UNIQUE_INDEX') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
