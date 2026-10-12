#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * 028080 controlled physical repair - LIVE DB PRECONDITION RECHECK
 *
 * READ ONLY.
 *
 * This is the write gate immediately after:
 * GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED_AFTER_AUDIT_METHOD_FIX
 *
 * It performs live Supabase REST GETs only.
 * It NEVER issues POST/PATCH/PUT/DELETE.
 *
 * Outcomes:
 *
 * LIVE_PRECONDITION_EXACT_STALE_STATE_READY_FOR_CONTROLLED_PATCH
 *   -> current DB is still the exact stale lineage we intend to patch.
 *
 * LIVE_PRECONDITION_ALREADY_REPAIRED_NO_WRITE_NEEDED
 *   -> target event/run already reflect desired lineage; stop, do not patch.
 *
 * LIVE_PRECONDITION_BLOCKED_BY_DRIFT
 *   -> DB changed / partial repair / competing identity / factor dependency.
 *      Stop, do not patch.
 *
 * Target:
 *   stock 028080
 *   MERGER
 *   effective_date 2026-10-01
 *   event UUID 16d168c5-069a-44c2-bf5a-e5c57dcb5446
 *   run UUID   e295cb01-db1f-4a8e-b109-0a464b7869fa
 *   stale provider_event_id  20260630001117
 *   desired provider_event_id 20221013000451
 *
 * No writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_028080_LIVE_DB_PRECONDITION_RECHECK_V2_RUN_SCHEMA_FIELD_FIX_BEFORE_CONTROLLED_PHYSICAL_PATCH';

const GLOBAL_STATUS =
  'GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED_AFTER_AUDIT_METHOD_FIX';

const TARGET = Object.freeze({
  stockCode: '028080',
  actionType: 'MERGER',
  effectiveDate: '2026-10-01',

  eventUuid:
    '16d168c5-069a-44c2-bf5a-e5c57dcb5446',

  runUuid:
    'e295cb01-db1f-4a8e-b109-0a464b7869fa',

  oldProviderEventId:
    '20260630001117',

  desiredProviderEventId:
    '20221013000451',

  sourceReceiptNo:
    '20260811000452',

  desiredSourceFingerprint:
    '3e3679a37260de07c69997b00e358936888aa3d68fa564b4e9a4834ec537d793',
});

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

async function getArray(base, key, table, query) {
  const target =
    `${base}/rest/v1/${table}?${query}`;

  const res = await fetch(target, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await res.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${table}:HTTP_${res.status}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `SUPABASE_READ_FAILED:${table}:${body?.code ?? `HTTP_${res.status}`}:${body?.message ?? ''}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(
      `EXPECTED_ARRAY_RESPONSE:${table}`,
    );
  }

  return body;
}

function q(value) {
  return encodeURIComponent(String(value));
}

function eq(column, value) {
  return `${column}=eq.${q(value)}`;
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

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function canonicalValidationStatus(event) {
  return firstNonEmpty(
    event?.metadata?.canonical_validation_status,
    event?.metadata?.canonicalValidationStatus,
  );
}

function factorStatus(event) {
  return firstNonEmpty(
    event?.metadata?.factor_status,
    event?.metadata?.factorStatus,
  );
}

function structuralFactorBlocked(event) {
  const value = firstNonEmpty(
    event?.metadata?.structural_factor_blocked,
    event?.metadata?.structuralFactorBlocked,
  );

  return value === true || value === 'true';
}

function sourceReceiptNo(event) {
  return firstNonEmpty(
    event?.metadata?.source_receipt_no,
    event?.metadata?.sourceReceiptNo,
  );
}

function sourceKind(event) {
  return firstNonEmpty(
    event?.metadata?.source_kind,
    event?.metadata?.sourceKind,
  );
}

function summaryProviderEventIds(run) {
  const value =
    run?.summary?.provider_event_ids ??
    run?.summary?.providerEventIds ??
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function summaryEventIds(run) {
  const value =
    run?.summary?.event_ids ??
    run?.summary?.eventIds ??
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function summaryActionTypes(run) {
  const value =
    run?.summary?.action_types ??
    run?.summary?.actionTypes ??
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function expectedEventSemantics(event) {
  const issues = [];

  if (event.id !== TARGET.eventUuid) {
    issues.push('EVENT_UUID_MISMATCH');
  }

  if (event.stock_code !== TARGET.stockCode) {
    issues.push('STOCK_CODE_MISMATCH');
  }

  if (event.action_type !== TARGET.actionType) {
    issues.push('ACTION_TYPE_MISMATCH');
  }

  if (event.effective_date !== TARGET.effectiveDate) {
    issues.push('EFFECTIVE_DATE_MISMATCH');
  }

  if (event.is_validation !== false) {
    issues.push('IS_VALIDATION_MUST_BE_FALSE');
  }

  if (event.production_applied !== false) {
    issues.push('PRODUCTION_APPLIED_MUST_BE_FALSE');
  }

  if (
    canonicalValidationStatus(event) !==
    'VALIDATED'
  ) {
    issues.push(
      'CANONICAL_VALIDATION_STATUS_MUST_BE_VALIDATED',
    );
  }

  return issues;
}

function expectedRunSemantics(run) {
  const issues = [];

  if (run.id !== TARGET.runUuid) {
    issues.push('RUN_UUID_MISMATCH');
  }

  if (run.stock_code !== TARGET.stockCode) {
    issues.push('RUN_STOCK_CODE_MISMATCH');
  }

  if (run.status !== 'BLOCKED_UNSUPPORTED_ACTION') {
    issues.push(
      'RUN_STATUS_MUST_BE_BLOCKED_UNSUPPORTED_ACTION',
    );
  }

  if (Number(run.event_count) !== 1) {
    issues.push('RUN_EVENT_COUNT_MUST_BE_1');
  }

  if (Number(run.supported_event_count) !== 0) {
    issues.push(
      'RUN_SUPPORTED_EVENT_COUNT_MUST_BE_0',
    );
  }

  if (Number(run.unsupported_event_count) !== 1) {
    issues.push(
      'RUN_UNSUPPORTED_EVENT_COUNT_MUST_BE_1',
    );
  }

  if (Number(run.factor_count) !== 0) {
    issues.push('RUN_FACTOR_COUNT_MUST_BE_0');
  }

  if (run.is_validation !== false) {
    issues.push('RUN_IS_VALIDATION_MUST_BE_FALSE');
  }

  if (run.production_applied !== false) {
    issues.push(
      'RUN_PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  const eventIds =
    summaryEventIds(run);

  if (
    eventIds.length !== 1 ||
    eventIds[0] !== TARGET.eventUuid
  ) {
    issues.push(
      'RUN_SUMMARY_EVENT_IDS_MISMATCH',
    );
  }

  const actionTypes =
    summaryActionTypes(run);

  if (
    actionTypes.length !== 1 ||
    actionTypes[0] !== TARGET.actionType
  ) {
    issues.push(
      'RUN_SUMMARY_ACTION_TYPES_MISMATCH',
    );
  }

  return issues;
}

function classifyLineage(event, run) {
  const eventProvider =
    String(event.provider_event_id ?? '');

  const runProviders =
    summaryProviderEventIds(run);

  const runProvider =
    runProviders.length === 1
      ? runProviders[0]
      : null;

  const eventStale =
    eventProvider ===
    TARGET.oldProviderEventId;

  const runStale =
    runProvider ===
    TARGET.oldProviderEventId;

  const eventDesired =
    eventProvider ===
    TARGET.desiredProviderEventId;

  const runDesired =
    runProvider ===
    TARGET.desiredProviderEventId;

  if (eventStale && runStale) {
    return 'STALE';
  }

  if (eventDesired && runDesired) {
    return 'DESIRED';
  }

  return 'PARTIAL_OR_DRIFTED';
}

function sanitizeEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    stock_code: row.stock_code,
    action_type: row.action_type,
    effective_date: row.effective_date,
    provider: row.provider,
    provider_event_id: row.provider_event_id,
    source_fingerprint: row.source_fingerprint,
    status: row.status,
    metadata: row.metadata,
    is_validation: row.is_validation,
    production_applied: row.production_applied,
    created_at: row.created_at,
  };
}

function sanitizeRun(row) {
  if (!row) return null;

  return {
    id: row.id,
    stock_code: row.stock_code,
    version: row.version,
    status: row.status,
    event_count: row.event_count,
    supported_event_count:
      row.supported_event_count,
    unsupported_event_count:
      row.unsupported_event_count,
    factor_count: row.factor_count,
    summary: row.summary,
    is_validation: row.is_validation,
    production_applied: row.production_applied,
    started_at: row.started_at,
    finished_at: row.finished_at,
    error_message: row.error_message,
  };
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const logs =
    path.join(root, 'logs');

  const globalFile =
    path.join(
      logs,
      'opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
    );

  const outputFile =
    path.join(
      logs,
      'opendart-corporate-action-028080-live-precondition-before-physical-patch-v2.json',
    );

  assert(
    fs.existsSync(globalFile),
    'GLOBAL_REPLAY_V2_REPORT_NOT_FOUND',
  );

  const global =
    readJson(globalFile);

  assert(
    global.status === GLOBAL_STATUS,
    `GLOBAL_REPLAY_NOT_GREEN:${global.status}`,
  );

  assert(
    global.conclusion
      ?.safeToPrepareControlled028080PhysicalPatch ===
      true,
    'GLOBAL_REPLAY_DOES_NOT_ALLOW_PATCH_PREPARATION',
  );

  assert(
    global.conclusion
      ?.physical028080PatchStillNotApplied ===
      true,
    'GLOBAL_REPLAY_EXPECTS_PATCH_ALREADY_APPLIED',
  );

  const { url, key } =
    requireEnv();

  let databaseReads = 0;

  async function read(table, query) {
    databaseReads += 1;

    return getArray(
      url,
      key,
      table,
      query,
    );
  }

  const eventSelect = encodeURIComponent([
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
  ].join(','));

  const runSelect = encodeURIComponent([
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
  ].join(','));

  const factorSelect = encodeURIComponent([
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
  ].join(','));

  // 1. Exact target event UUID.
  const targetEvents =
    await read(
      'corporate_action_events',
      [
        `select=${eventSelect}`,
        eq('id', TARGET.eventUuid),
      ].join('&'),
    );

  // 2. Exact target run UUID.
  const targetRuns =
    await read(
      'corporate_action_adjustment_runs',
      [
        `select=${runSelect}`,
        eq('id', TARGET.runUuid),
      ].join('&'),
    );

  // 3. All production/non-validation events on target semantic surface.
  const semanticSurfaceEvents =
    await read(
      'corporate_action_events',
      [
        `select=${eventSelect}`,
        eq('stock_code', TARGET.stockCode),
        eq('action_type', TARGET.actionType),
        eq('effective_date', TARGET.effectiveDate),
        'is_validation=eq.false',
      ].join('&'),
    );

  // 4. Any production/non-validation row already occupying desired provider identity.
  const desiredIdentityEvents =
    await read(
      'corporate_action_events',
      [
        `select=${eventSelect}`,
        eq(
          'provider_event_id',
          TARGET.desiredProviderEventId,
        ),
        'is_validation=eq.false',
      ].join('&'),
    );

  // 5. All production/non-validation runs for 028080.
  const stockRuns =
    await read(
      'corporate_action_adjustment_runs',
      [
        `select=${runSelect}`,
        eq('stock_code', TARGET.stockCode),
        'is_validation=eq.false',
      ].join('&'),
    );

  // 6. Factor rows referencing event UUID.
  const eventFactors =
    await read(
      'corporate_action_adjustment_factors',
      [
        `select=${factorSelect}`,
        eq(
          'action_event_id',
          TARGET.eventUuid,
        ),
        'is_validation=eq.false',
      ].join('&'),
    );

  // 7. Factor rows referencing run UUID.
  const runFactors =
    await read(
      'corporate_action_adjustment_factors',
      [
        `select=${factorSelect}`,
        eq(
          'adjustment_run_id',
          TARGET.runUuid,
        ),
        'is_validation=eq.false',
      ].join('&'),
    );

  const issues = [];

  if (targetEvents.length !== 1) {
    issues.push({
      check: 'targetEventRows',
      actual: targetEvents.length,
      expected: 1,
    });
  }

  if (targetRuns.length !== 1) {
    issues.push({
      check: 'targetRunRows',
      actual: targetRuns.length,
      expected: 1,
    });
  }

  const event =
    targetEvents[0] ?? null;

  const run =
    targetRuns[0] ?? null;

  const eventSemanticIssues =
    event
      ? expectedEventSemantics(event)
      : ['TARGET_EVENT_MISSING'];

  const runSemanticIssues =
    run
      ? expectedRunSemantics(run)
      : ['TARGET_RUN_MISSING'];

  if (eventSemanticIssues.length > 0) {
    issues.push({
      check: 'targetEventSemanticContract',
      issues: eventSemanticIssues,
    });
  }

  if (runSemanticIssues.length > 0) {
    issues.push({
      check: 'targetRunSemanticContract',
      issues: runSemanticIssues,
    });
  }

  const lineage =
    event && run
      ? classifyLineage(event, run)
      : 'MISSING';

  // Exact target semantic surface must contain only the preserved UUID.
  const competingSurfaceEvents =
    semanticSurfaceEvents.filter(
      (row) =>
        row.id !== TARGET.eventUuid,
    );

  if (competingSurfaceEvents.length !== 0) {
    issues.push({
      check:
        'competingProductionEventsOnTargetSemanticSurface',
      actual:
        competingSurfaceEvents.length,
      expected: 0,
      ids:
        competingSurfaceEvents.map(
          (row) => row.id,
        ),
    });
  }

  // Desired provider identity is allowed only if it is the target UUID and
  // the target is already fully repaired.
  const competingDesiredIdentityEvents =
    desiredIdentityEvents.filter(
      (row) =>
        row.id !== TARGET.eventUuid,
    );

  if (
    competingDesiredIdentityEvents.length !== 0
  ) {
    issues.push({
      check:
        'competingDesiredProviderIdentityEvents',
      actual:
        competingDesiredIdentityEvents.length,
      expected: 0,
      ids:
        competingDesiredIdentityEvents.map(
          (row) => row.id,
        ),
    });
  }

  const otherStockRuns =
    stockRuns.filter(
      (row) =>
        row.id !== TARGET.runUuid,
    );

  // Other old production runs for same stock are not automatically illegal
  // because historical versions can coexist. Only flag a logical competitor
  // that explicitly references this event UUID or either lineage ID.
  const logicalCompetingRuns =
    otherStockRuns.filter((row) => {
      const eventIds =
        summaryEventIds(row);

      const providers =
        summaryProviderEventIds(row);

      return (
        eventIds.includes(TARGET.eventUuid) ||
        providers.includes(
          TARGET.oldProviderEventId,
        ) ||
        providers.includes(
          TARGET.desiredProviderEventId,
        )
      );
    });

  if (logicalCompetingRuns.length !== 0) {
    issues.push({
      check: 'logicalCompetingRuns',
      actual: logicalCompetingRuns.length,
      expected: 0,
      ids:
        logicalCompetingRuns.map(
          (row) => row.id,
        ),
    });
  }

  if (eventFactors.length !== 0) {
    issues.push({
      check: 'factorRowsReferencingEvent',
      actual: eventFactors.length,
      expected: 0,
    });
  }

  if (runFactors.length !== 0) {
    issues.push({
      check: 'factorRowsReferencingRun',
      actual: runFactors.length,
      expected: 0,
    });
  }

  // Detect partial mutations.
  if (event) {
    const provider =
      String(event.provider_event_id ?? '');

    const sourceFingerprint =
      String(event.source_fingerprint ?? '');

    if (
      provider === TARGET.oldProviderEventId &&
      sourceFingerprint ===
        TARGET.desiredSourceFingerprint
    ) {
      issues.push({
        check: 'partialRepairEventFingerprintOnly',
        actual: {
          provider_event_id: provider,
          source_fingerprint:
            sourceFingerprint,
        },
        expected:
          'OLD_PROVIDER_WITH_OLD_FINGERPRINT_OR_FULL_DESIRED_STATE',
      });
    }
  }

  const desiredMetadataCompatible =
    event
      ? (
          canonicalValidationStatus(event) ===
            'VALIDATED' &&
          (
            sourceReceiptNo(event) === null ||
            sourceReceiptNo(event) ===
              TARGET.sourceReceiptNo
          ) &&
          (
            sourceKind(event) === null ||
            sourceKind(event) ===
              'DOCUMENT_XML_ZIP'
          ) &&
          (
            factorStatus(event) === null ||
            factorStatus(event) ===
              'STRUCTURAL_BLOCKED'
          ) &&
          (
            structuralFactorBlocked(event) ===
              false ||
            structuralFactorBlocked(event) ===
              true
          )
        )
      : false;

  // If already desired, require all desired event enrichment and run lineage.
  let alreadyRepairedContract = false;

  if (
    lineage === 'DESIRED' &&
    event &&
    run
  ) {
    alreadyRepairedContract =
      event.source_fingerprint ===
        TARGET.desiredSourceFingerprint &&
      sourceReceiptNo(event) ===
        TARGET.sourceReceiptNo &&
      sourceKind(event) ===
        'DOCUMENT_XML_ZIP' &&
      factorStatus(event) ===
        'STRUCTURAL_BLOCKED' &&
      structuralFactorBlocked(event) ===
        true &&
      canonicalValidationStatus(event) ===
        'VALIDATED' &&
      summaryProviderEventIds(run).length ===
        1 &&
      summaryProviderEventIds(run)[0] ===
        TARGET.desiredProviderEventId;

    if (!alreadyRepairedContract) {
      issues.push({
        check:
          'desiredLineageButDesiredRepairContractIncomplete',
        actual: {
          source_fingerprint:
            event.source_fingerprint,
          source_receipt_no:
            sourceReceiptNo(event),
          source_kind:
            sourceKind(event),
          factor_status:
            factorStatus(event),
          structural_factor_blocked:
            structuralFactorBlocked(event),
          canonical_validation_status:
            canonicalValidationStatus(event),
          run_provider_event_ids:
            summaryProviderEventIds(run),
        },
      });
    }
  }

  const staleReadyContract =
    lineage === 'STALE' &&
    eventSemanticIssues.length === 0 &&
    runSemanticIssues.length === 0 &&
    semanticSurfaceEvents.length === 1 &&
    competingDesiredIdentityEvents.length === 0 &&
    logicalCompetingRuns.length === 0 &&
    eventFactors.length === 0 &&
    runFactors.length === 0 &&
    desiredMetadataCompatible &&
    issues.length === 0;

  const alreadyRepaired =
    lineage === 'DESIRED' &&
    alreadyRepairedContract &&
    competingSurfaceEvents.length === 0 &&
    competingDesiredIdentityEvents.length === 0 &&
    logicalCompetingRuns.length === 0 &&
    eventFactors.length === 0 &&
    runFactors.length === 0 &&
    issues.length === 0;

  const status =
    staleReadyContract
      ? 'LIVE_PRECONDITION_EXACT_STALE_STATE_READY_FOR_CONTROLLED_PATCH'
      : alreadyRepaired
        ? 'LIVE_PRECONDITION_ALREADY_REPAIRED_NO_WRITE_NEEDED'
        : 'LIVE_PRECONDITION_BLOCKED_BY_DRIFT';

  const report = {
    status,
    version: VERSION,

    globalReplayGate: {
      sourceFile:
        'logs/opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
      status: global.status,
      outputFingerprint:
        global.outputFingerprint ?? null,
      safeToPrepareControlledPatch:
        global.conclusion
          ?.safeToPrepareControlled028080PhysicalPatch ===
        true,
    },

    target: TARGET,

    liveCounts: {
      targetEventRows:
        targetEvents.length,
      targetRunRows:
        targetRuns.length,
      semanticSurfaceEvents:
        semanticSurfaceEvents.length,
      competingSurfaceEvents:
        competingSurfaceEvents.length,
      desiredIdentityEvents:
        desiredIdentityEvents.length,
      competingDesiredIdentityEvents:
        competingDesiredIdentityEvents.length,
      productionRunsForStock:
        stockRuns.length,
      logicalCompetingRuns:
        logicalCompetingRuns.length,
      factorRowsReferencingEvent:
        eventFactors.length,
      factorRowsReferencingRun:
        runFactors.length,
    },

    liveState: {
      lineage,
      targetEvent:
        sanitizeEvent(event),
      targetRun:
        sanitizeRun(run),
      desiredMetadataCompatible,
      staleReadyContract,
      alreadyRepairedContract,
    },

    issues,

    conclusion: {
      globalReplayStillAuthoritative:
        true,

      exactStaleStateReadyForControlledPatch:
        staleReadyContract,

      alreadyRepairedNoWriteNeeded:
        alreadyRepaired,

      driftDetected:
        status ===
        'LIVE_PRECONDITION_BLOCKED_BY_DRIFT',

      patchMustRemainExactlyTwoRows:
        staleReadyContract,

      eventUuidMustBePreserved:
        true,

      runUuidMustBePreserved:
        true,

      insertAllowed:
        false,

      deleteAllowed:
        false,

      factorMutationAllowed:
        false,

      databaseWriteExecutedNow:
        false,

      safeToGenerateControlledPatchScript:
        staleReadyContract,

      safeToExecutePatchNow:
        false,
    },

    safety: {
      networkRequestsNow:
        databaseReads,
      databaseReadsNow:
        databaseReads,
      databaseWritesNow: 0,
      opendartRequestsNow: 0,
      kisRequestsNow: 0,
      productionAppliedNow: false,
      physical028080PatchExecutedNow:
        false,
    },

    nextGate:
      staleReadyContract
        ? 'GENERATE_CONTROLLED_028080_TWO_ROW_PATCH_WITH_COMPARE_AND_SWAP_GUARDS'
        : alreadyRepaired
          ? 'POST_REPAIR_VERIFICATION_ONLY'
          : 'STOP_AND_REVIEW_LIVE_DB_DRIFT',

    outputFile:
      'logs/opendart-corporate-action-028080-live-precondition-before-physical-patch-v2.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        globalReplayGate:
          report.globalReplayGate,
        target: report.target,
        liveCounts:
          report.liveCounts,
        liveState:
          report.liveState,
        issues: report.issues,
        conclusion:
          report.conclusion,
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  // Keep console reasonably compact; complete rows remain in output file.
  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        version:
          report.version,

        liveCounts:
          report.liveCounts,

        liveState: {
          lineage:
            report.liveState.lineage,

          event: event
            ? {
                id:
                  event.id,
                stock_code:
                  event.stock_code,
                action_type:
                  event.action_type,
                effective_date:
                  event.effective_date,
                provider_event_id:
                  event.provider_event_id,
                source_fingerprint:
                  event.source_fingerprint,
                canonical_validation_status:
                  canonicalValidationStatus(
                    event,
                  ),
                source_receipt_no:
                  sourceReceiptNo(event),
                source_kind:
                  sourceKind(event),
                factor_status:
                  factorStatus(event),
                structural_factor_blocked:
                  structuralFactorBlocked(
                    event,
                  ),
                is_validation:
                  event.is_validation,
                production_applied:
                  event.production_applied,
              }
            : null,

          run: run
            ? {
                id:
                  run.id,
                stock_code:
                  run.stock_code,
                status:
                  run.status,
                event_count:
                  run.event_count,
                supported_event_count:
                  run.supported_event_count,
                unsupported_event_count:
                  run.unsupported_event_count,
                factor_count:
                  run.factor_count,
                provider_event_ids:
                  summaryProviderEventIds(
                    run,
                  ),
                event_ids:
                  summaryEventIds(
                    run,
                  ),
                action_types:
                  summaryActionTypes(
                    run,
                  ),
                is_validation:
                  run.is_validation,
                production_applied:
                  run.production_applied,
              }
            : null,

          staleReadyContract:
            report.liveState
              .staleReadyContract,

          alreadyRepairedContract:
            report.liveState
              .alreadyRepairedContract,
        },

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        databaseReadsNow:
          databaseReads,

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

  if (
    status ===
    'LIVE_PRECONDITION_BLOCKED_BY_DRIFT'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'LIVE_PRECONDITION_RECHECK_FAILED',
        version: VERSION,
        error:
          String(
            error?.message ??
            error,
          ),
        databaseWritesNow: 0,
        opendartRequestsNow: 0,
        kisRequestsNow: 0,
        physical028080PatchExecutedNow:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
