'use strict';

// V9.7.20 controlled validation adjustment persistence.
//
// Writes only with --apply:
//   corporate_action_adjustment_runs   : 15 per-stock validation runs
//   corporate_action_adjustment_factors: 11 supported factor rows
//
// Idempotency:
//   run identity   -> deterministic UUID primary key (id)
//   factor identity-> UNIQUE(adjustment_run_id, action_event_id)
//
// Structural exclusions:
//   MERGER x3 / SPIN_OFF x1
//   -> run status BLOCKED_UNSUPPORTED_ACTION
//   -> factor_count = 0
//   -> NO factor row inserted
//
// Current validation sample has exactly one event per stock, therefore:
//   cumulative_price_factor = event_price_factor
//   cumulative_share_factor = event_share_factor
//
// IMPORTANT:
//   Multi-event cumulative ordering remains NOT PROVEN and is not promoted.
//
// Run:
//   node --env-file=.env.local .\scripts\v9720.cjs
//   node --env-file=.env.local .\scripts\v9720.cjs --apply

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_20_CONTROLLED_VALIDATION_ADJUSTMENT_PERSISTENCE';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';
const PROVIDER = 'DART_KRX_CANONICAL';

const RUN_TABLE = 'corporate_action_adjustment_runs';
const FACTOR_TABLE = 'corporate_action_adjustment_factors';

const EXPECTED_EVENTS = 15;
const EXPECTED_RUNS = 15;
const EXPECTED_READY = 11;
const EXPECTED_BLOCKED = 4;
const EXPECTED_FACTORS = 11;

const SUPPORTED = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'STOCK_DIVIDEND',
  'CASH_DIVIDEND'
]);

const STRUCTURAL = new Set([
  'MERGER',
  'SPIN_OFF'
]);

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_20_FAILED';
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

async function requestJson(url, key, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('SUPABASE_INVALID_JSON');
    }
  }

  if (!res.ok) {
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    const err = new Error(
      `SUPABASE_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.supabase = {
      httpStatus: res.status,
      code: body?.code ?? null,
      message: body?.message ?? null,
      details: body?.details ?? null,
      hint: body?.hint ?? null
    };
    throw err;
  }

  return body;
}

async function getArray(url, key) {
  const body = await requestJson(url, key);
  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

async function readEvents(base, key) {
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
    'production_applied'
  ].join(',');

  return getArray(
    `${base}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`,
    key
  );
}

async function readPriorBar(base, key, stockCode, effectiveDate) {
  const select = 'stock_code,trading_date,close_price,source,adjusted_price';

  return getArray(
    `${base}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
    `&order=trading_date.desc&limit=1`,
    key
  );
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundFactor(v) {
  return Number(Number(v).toPrecision(15));
}

function deterministicUuid(input) {
  const bytes = crypto.createHash('sha256').update(input).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20)
  ].join('-');
}

function groupEvents(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.stock_code)) map.set(e.stock_code, []);
    map.get(e.stock_code).push(e);
  }
  return [...map.entries()]
    .map(([stockCode, rows]) => ({
      stockCode,
      events: rows.slice().sort((a, b) =>
        `${a.effective_date}|${a.provider_event_id}`
          .localeCompare(`${b.effective_date}|${b.provider_event_id}`)
      )
    }))
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode));
}

async function computeFactor(event, base, key) {
  const rf = num(event.ratio_from);
  const rt = num(event.ratio_to);
  const cash = num(event.cash_amount);

  if (
    event.action_type === 'STOCK_SPLIT' ||
    event.action_type === 'REVERSE_SPLIT' ||
    event.action_type === 'STOCK_DIVIDEND'
  ) {
    if (!(rf > 0) || !(rt > 0)) {
      throw new Error('RATIO_EVENT_MISSING_POSITIVE_RATIO');
    }

    return {
      eventPriceFactor: roundFactor(rf / rt),
      eventShareFactor: roundFactor(rt / rf),
      metadata: {
        factor_source: 'EXPLICIT_EVENT_RATIO',
        ratio_from: rf,
        ratio_to: rt,
        ratio_contract: 'PRE_ACTION_UNITS_TO_POST_ACTION_UNITS'
      }
    };
  }

  if (event.action_type === 'CASH_DIVIDEND') {
    const bars = await readPriorBar(base, key, event.stock_code, event.effective_date);
    if (bars.length !== 1) throw new Error('CASH_REFERENCE_BAR_REQUIRED');

    const reference = bars[0];
    const p = num(reference.close_price);

    if (!(cash >= 0) || !(p > cash)) {
      throw new Error('INVALID_CASH_REFERENCE_FACTOR_INPUT');
    }

    return {
      eventPriceFactor: roundFactor((p - cash) / p),
      eventShareFactor: 1,
      metadata: {
        factor_source: 'LATEST_PRIOR_MARKET_CLOSE',
        reference_trading_date: reference.trading_date,
        reference_close_price: p,
        reference_source: reference.source,
        reference_adjusted_price_flag: reference.adjusted_price,
        cash_amount_per_share: cash,
        currency: event.currency || 'KRW'
      }
    };
  }

  throw new Error('FACTOR_REQUESTED_FOR_UNSUPPORTED_ACTION');
}

async function buildRows(base, key) {
  const events = await readEvents(base, key);

  if (events.length !== EXPECTED_EVENTS) {
    throw new Error('EXPECTED_15_VALIDATION_EVENTS');
  }

  for (const e of events) {
    if (
      e.provider !== PROVIDER ||
      e.status !== 'RECORDED' ||
      e.is_validation !== true ||
      e.production_applied !== false
    ) {
      throw new Error('INVALID_EVENT_LIFECYCLE_STATE');
    }
  }

  const groups = groupEvents(events);

  if (groups.length !== EXPECTED_RUNS) {
    throw new Error('EXPECTED_15_STOCK_GROUPS');
  }

  if (groups.some(g => g.events.length !== 1)) {
    throw new Error('MULTI_EVENT_GROUP_REQUIRES_SEPARATE_ACCUMULATION_CONTRACT');
  }

  const runRows = [];
  const factorRows = [];

  for (const group of groups) {
    const event = group.events[0];

    const eventSetKey = group.events.map(e => e.id).sort().join(',');
    const runIdentity =
      `${RUN_VERSION}|${group.stockCode}|VALIDATION|${eventSetKey}`;
    const runId = deterministicUuid(runIdentity);

    if (SUPPORTED.has(event.action_type)) {
      const factor = await computeFactor(event, base, key);

      runRows.push({
        id: runId,
        stock_code: group.stockCode,
        version: RUN_VERSION,
        status: 'READY',
        event_count: 1,
        supported_event_count: 1,
        unsupported_event_count: 0,
        factor_count: 1,
        summary: {
          validation_contract_version: VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [event.id],
          provider_event_ids: [event.provider_event_id],
          action_types: [event.action_type],
          single_event_cumulative_rule: 'CUMULATIVE_EQUALS_EVENT_FACTOR',
          multi_event_accumulation_policy: 'NOT_PROVEN'
        },
        is_validation: true,
        production_applied: false,
        finished_at: null,
        error_message: null
      });

      factorRows.push({
        adjustment_run_id: runId,
        stock_code: event.stock_code,
        effective_date: event.effective_date,
        action_event_id: event.id,
        action_type: event.action_type,
        event_price_factor: factor.eventPriceFactor,
        event_share_factor: factor.eventShareFactor,
        cumulative_price_factor: factor.eventPriceFactor,
        cumulative_share_factor: factor.eventShareFactor,
        metadata: {
          ...factor.metadata,
          validation_contract_version: VERSION,
          cumulative_rule: 'SINGLE_EVENT_GROUP_CUMULATIVE_EQUALS_EVENT_FACTOR'
        },
        is_validation: true,
        production_applied: false
      });

      continue;
    }

    if (STRUCTURAL.has(event.action_type)) {
      runRows.push({
        id: runId,
        stock_code: group.stockCode,
        version: RUN_VERSION,
        status: 'BLOCKED_UNSUPPORTED_ACTION',
        event_count: 1,
        supported_event_count: 0,
        unsupported_event_count: 1,
        factor_count: 0,
        summary: {
          validation_contract_version: VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [event.id],
          provider_event_ids: [event.provider_event_id],
          action_types: [event.action_type],
          block_reason:
            event.action_type === 'MERGER'
              ? 'MERGER_SECURITY_CONTINUITY_POLICY_REQUIRED'
              : 'SPIN_OFF_VALUE_ALLOCATION_POLICY_REQUIRED',
          factor_rows_suppressed: true,
          multi_event_accumulation_policy: 'NOT_PROVEN'
        },
        is_validation: true,
        production_applied: false,
        finished_at: null,
        error_message: null
      });

      continue;
    }

    throw new Error('UNEXPECTED_ACTION_TYPE');
  }

  if (
    runRows.length !== EXPECTED_RUNS ||
    runRows.filter(r => r.status === 'READY').length !== EXPECTED_READY ||
    runRows.filter(r => r.status === 'BLOCKED_UNSUPPORTED_ACTION').length !== EXPECTED_BLOCKED ||
    factorRows.length !== EXPECTED_FACTORS
  ) {
    throw new Error('MAPPED_ROW_INVARIANT_FAILED');
  }

  return { runRows, factorRows };
}

async function readRunsByIds(base, key, ids) {
  const select = [
    'id','stock_code','version','status','event_count',
    'supported_event_count','unsupported_event_count','factor_count',
    'summary','is_validation','production_applied',
    'finished_at','error_message'
  ].join(',');

  const encodedIds = ids.join(',');
  return getArray(
    `${base}/rest/v1/${RUN_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&id=in.(${encodedIds})` +
    `&order=stock_code.asc`,
    key
  );
}

async function readFactorsByRunIds(base, key, runIds) {
  const select = [
    'adjustment_run_id','stock_code','effective_date','action_event_id',
    'action_type','event_price_factor','event_share_factor',
    'cumulative_price_factor','cumulative_share_factor',
    'metadata','is_validation','production_applied'
  ].join(',');

  return getArray(
    `${base}/rest/v1/${FACTOR_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&adjustment_run_id=in.(${runIds.join(',')})` +
    `&order=stock_code.asc,effective_date.asc`,
    key
  );
}

function normalizeRun(row) {
  return {
    id: String(row.id),
    stock_code: String(row.stock_code),
    version: String(row.version),
    status: String(row.status),
    event_count: Number(row.event_count),
    supported_event_count: Number(row.supported_event_count),
    unsupported_event_count: Number(row.unsupported_event_count),
    factor_count: Number(row.factor_count),
    summary: row.summary ?? {},
    is_validation: row.is_validation === true,
    production_applied: row.production_applied === true,
    finished_at: row.finished_at ?? null,
    error_message: row.error_message ?? null
  };
}

function normalizeFactor(row) {
  return {
    adjustment_run_id: String(row.adjustment_run_id),
    stock_code: String(row.stock_code),
    effective_date: String(row.effective_date),
    action_event_id: String(row.action_event_id),
    action_type: String(row.action_type),
    event_price_factor: Number(row.event_price_factor),
    event_share_factor: Number(row.event_share_factor),
    cumulative_price_factor: Number(row.cumulative_price_factor),
    cumulative_share_factor: Number(row.cumulative_share_factor),
    metadata: row.metadata ?? {},
    is_validation: row.is_validation === true,
    production_applied: row.production_applied === true
  };
}

function classifyRuns(live, expected) {
  const exp = new Map(expected.map(r => [r.id, normalizeRun(r)]));
  let exact = 0, conflicts = 0;
  const conflictRows = [];

  for (const row of live) {
    const normalized = normalizeRun(row);
    const want = exp.get(normalized.id);

    if (!want) {
      conflicts++;
      conflictRows.push({
        id: normalized.id,
        reason: 'UNEXPECTED_LIVE_RUN'
      });
      continue;
    }

    if (JSON.stringify(normalized) === JSON.stringify(want)) {
      exact++;
    } else {
      conflicts++;
      conflictRows.push({
        id: normalized.id,
        reason: 'LIVE_RUN_DIFFERS',
        live: normalized,
        expected: want
      });
    }
  }

  return {
    exact,
    missing: expected.length - exact,
    conflicts,
    conflictRows
  };
}

function classifyFactors(live, expected) {
  const keyOf = r => `${r.adjustment_run_id}|${r.action_event_id}`;
  const exp = new Map(expected.map(r => [keyOf(r), normalizeFactor(r)]));
  let exact = 0, conflicts = 0;
  const conflictRows = [];

  for (const row of live) {
    const normalized = normalizeFactor(row);
    const key = keyOf(normalized);
    const want = exp.get(key);

    if (!want) {
      conflicts++;
      conflictRows.push({ key, reason: 'UNEXPECTED_LIVE_FACTOR' });
      continue;
    }

    if (JSON.stringify(normalized) === JSON.stringify(want)) {
      exact++;
    } else {
      conflicts++;
      conflictRows.push({
        key,
        reason: 'LIVE_FACTOR_DIFFERS',
        live: normalized,
        expected: want
      });
    }
  }

  return {
    exact,
    missing: expected.length - exact,
    conflicts,
    conflictRows
  };
}

async function upsertRuns(base, key, rows) {
  const body = await requestJson(
    `${base}/rest/v1/${RUN_TABLE}?on_conflict=id`,
    key,
    {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation'
    }
  );

  if (!Array.isArray(body)) throw new Error('RUN_UPSERT_RESPONSE_NOT_ARRAY');
  return body;
}

async function upsertFactors(base, key, rows) {
  const body = await requestJson(
    `${base}/rest/v1/${FACTOR_TABLE}` +
    `?on_conflict=${encodeURIComponent('adjustment_run_id,action_event_id')}`,
    key,
    {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation'
    }
  );

  if (!Array.isArray(body)) throw new Error('FACTOR_UPSERT_RESPONSE_NOT_ARRAY');
  return body;
}

async function snapshot(base, key, runRows, factorRows) {
  const runIds = runRows.map(r => r.id);
  const [liveRuns, liveFactors] = await Promise.all([
    readRunsByIds(base, key, runIds),
    readFactorsByRunIds(base, key, runIds)
  ]);

  return {
    liveRuns,
    liveFactors,
    runClass: classifyRuns(liveRuns, runRows),
    factorClass: classifyFactors(liveFactors, factorRows)
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  for (const a of args) {
    if (a !== '--apply' && !a.startsWith('--output=')) {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'validation-adjustment-persistence-v9-7-20.json'
      );

  const { url, key } = requireEnv();
  const { runRows, factorRows } = await buildRows(url, key);

  const before = await snapshot(url, key, runRows, factorRows);

  if (before.runClass.conflicts > 0) {
    throw new Error('LIVE_RUN_CONFLICT_BEFORE_APPLY');
  }

  if (before.factorClass.conflicts > 0) {
    throw new Error('LIVE_FACTOR_CONFLICT_BEFORE_APPLY');
  }

  if (!apply) {
    const report = {
      version: VERSION,
      status: 'DRY_RUN_READY_FOR_APPLY',
      applyRequested: false,
      mappedRuns: runRows.length,
      mappedFactors: factorRows.length,
      readyRuns: runRows.filter(r => r.status === 'READY').length,
      blockedRuns:
        runRows.filter(r => r.status === 'BLOCKED_UNSUPPORTED_ACTION').length,
      liveRunsExactBefore: before.runClass.exact,
      liveRunsMissingBefore: before.runClass.missing,
      liveRunsConflictsBefore: before.runClass.conflicts,
      liveFactorsExactBefore: before.factorClass.exact,
      liveFactorsMissingBefore: before.factorClass.missing,
      liveFactorsConflictsBefore: before.factorClass.conflicts,
      safety: {
        writesPerformed: 0,
        adjustmentRunsInsertedOrMerged: 0,
        adjustmentFactorsInsertedOrMerged: 0,
        eventRowsUpdated: 0,
        productionAppliedRowsCreated: 0,
        coveragePromoted: false
      },
      nextCommand:
        'node --env-file=.env.local .\\scripts\\v9720.cjs --apply'
    };

    saveJson(outputFile, report);

    console.log(JSON.stringify({
      status: report.status,
      mappedRuns: report.mappedRuns,
      mappedFactors: report.mappedFactors,
      readyRuns: report.readyRuns,
      blockedRuns: report.blockedRuns,
      liveRunsExactBefore: report.liveRunsExactBefore,
      liveRunsMissingBefore: report.liveRunsMissingBefore,
      liveRunsConflictsBefore: report.liveRunsConflictsBefore,
      liveFactorsExactBefore: report.liveFactorsExactBefore,
      liveFactorsMissingBefore: report.liveFactorsMissingBefore,
      liveFactorsConflictsBefore: report.liveFactorsConflictsBefore,
      writesPerformed: 0,
      coveragePromoted: false,
      nextCommand: report.nextCommand
    }, null, 2));

    console.log('Dry-run only. Add --apply to persist validation runs/factors.');
    console.log(
      'Upload only this report (never upload .env files): ' + outputFile
    );
    return;
  }

  const firstRuns = await upsertRuns(url, key, runRows);
  const firstFactors = await upsertFactors(url, key, factorRows);
  const afterFirst = await snapshot(url, key, runRows, factorRows);

  if (
    afterFirst.liveRuns.length !== EXPECTED_RUNS ||
    afterFirst.runClass.exact !== EXPECTED_RUNS ||
    afterFirst.runClass.conflicts !== 0 ||
    afterFirst.liveFactors.length !== EXPECTED_FACTORS ||
    afterFirst.factorClass.exact !== EXPECTED_FACTORS ||
    afterFirst.factorClass.conflicts !== 0
  ) {
    throw new Error('FIRST_ADJUSTMENT_PERSISTENCE_VERIFICATION_FAILED');
  }

  const secondRuns = await upsertRuns(url, key, runRows);
  const secondFactors = await upsertFactors(url, key, factorRows);
  const afterSecond = await snapshot(url, key, runRows, factorRows);

  const idempotencyProven =
    afterSecond.liveRuns.length === EXPECTED_RUNS &&
    afterSecond.runClass.exact === EXPECTED_RUNS &&
    afterSecond.runClass.conflicts === 0 &&
    afterSecond.liveFactors.length === EXPECTED_FACTORS &&
    afterSecond.factorClass.exact === EXPECTED_FACTORS &&
    afterSecond.factorClass.conflicts === 0;

  if (!idempotencyProven) {
    throw new Error('SECOND_ADJUSTMENT_PERSISTENCE_IDEMPOTENCY_FAILED');
  }

  const productionAppliedRuns =
    afterSecond.liveRuns.filter(r => r.production_applied === true).length;

  const productionAppliedFactors =
    afterSecond.liveFactors.filter(r => r.production_applied === true).length;

  const report = {
    version: VERSION,
    status: 'VALIDATION_ADJUSTMENT_PERSISTENCE_AND_IDEMPOTENCY_PROVEN',
    applyRequested: true,
    mappedRuns: runRows.length,
    mappedFactors: factorRows.length,
    readyRuns: runRows.filter(r => r.status === 'READY').length,
    blockedRuns:
      runRows.filter(r => r.status === 'BLOCKED_UNSUPPORTED_ACTION').length,
    before: {
      runsExact: before.runClass.exact,
      runsMissing: before.runClass.missing,
      runsConflicts: before.runClass.conflicts,
      factorsExact: before.factorClass.exact,
      factorsMissing: before.factorClass.missing,
      factorsConflicts: before.factorClass.conflicts
    },
    firstUpsert: {
      runResponseRows: firstRuns.length,
      factorResponseRows: firstFactors.length,
      liveRuns: afterFirst.liveRuns.length,
      exactRuns: afterFirst.runClass.exact,
      runConflicts: afterFirst.runClass.conflicts,
      liveFactors: afterFirst.liveFactors.length,
      exactFactors: afterFirst.factorClass.exact,
      factorConflicts: afterFirst.factorClass.conflicts
    },
    secondUpsert: {
      runResponseRows: secondRuns.length,
      factorResponseRows: secondFactors.length,
      liveRuns: afterSecond.liveRuns.length,
      exactRuns: afterSecond.runClass.exact,
      runConflicts: afterSecond.runClass.conflicts,
      liveFactors: afterSecond.liveFactors.length,
      exactFactors: afterSecond.factorClass.exact,
      factorConflicts: afterSecond.factorClass.conflicts
    },
    idempotencyProven,
    allValidationRuns:
      afterSecond.liveRuns.every(r => r.is_validation === true),
    allValidationFactors:
      afterSecond.liveFactors.every(r => r.is_validation === true),
    productionAppliedRuns,
    productionAppliedFactors,
    safety: {
      writesPerformed: 4,
      runUpsertOperations: 2,
      factorUpsertOperations: 2,
      deleteOperations: 0,
      schemaMigrations: 0,
      eventRowsUpdated: 0,
      productionAppliedRowsCreated:
        productionAppliedRuns + productionAppliedFactors,
      coveragePromoted: false
    },
    nextGate:
      'VALIDATE_FACTOR_CONSUMPTION_WITH_ADJUSTED_PRICE_SERIES_IN_SHADOW_MODE_BEFORE_ANY_PRODUCTION_PROMOTION'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    mappedRuns: report.mappedRuns,
    mappedFactors: report.mappedFactors,
    readyRuns: report.readyRuns,
    blockedRuns: report.blockedRuns,
    firstRunResponseRows: report.firstUpsert.runResponseRows,
    firstFactorResponseRows: report.firstUpsert.factorResponseRows,
    liveRunsAfterFirst: report.firstUpsert.liveRuns,
    liveFactorsAfterFirst: report.firstUpsert.liveFactors,
    secondRunResponseRows: report.secondUpsert.runResponseRows,
    secondFactorResponseRows: report.secondUpsert.factorResponseRows,
    liveRunsAfterSecond: report.secondUpsert.liveRuns,
    liveFactorsAfterSecond: report.secondUpsert.liveFactors,
    runConflictsAfterSecond: report.secondUpsert.runConflicts,
    factorConflictsAfterSecond: report.secondUpsert.factorConflicts,
    idempotencyProven: report.idempotencyProven,
    allValidationRuns: report.allValidationRuns,
    allValidationFactors: report.allValidationFactors,
    productionAppliedRuns: report.productionAppliedRuns,
    productionAppliedFactors: report.productionAppliedFactors,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );
}

main().catch(error => {
  if (error?.supabase) {
    console.error(JSON.stringify({
      error: safeError(error),
      supabase: error.supabase
    }, null, 2));
  } else {
    console.error(safeError(error));
  }
  process.exitCode = 1;
});
