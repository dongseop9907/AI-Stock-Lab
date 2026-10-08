/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8 - 128 adjustment-run / 121 factor persistence preflight
 *
 * READ-ONLY. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-128-event-id-map-v9-8-11-7.json
 *
 * Output:
 *   logs/opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8.json
 *
 * Remote DB contract confirmed:
 *
 * corporate_action_adjustment_runs
 *   production_applied = false
 *   status in RUNNING | READY | BLOCKED_UNSUPPORTED_ACTION | FAILED
 *   event_count / supported_event_count / unsupported_event_count / factor_count >= 0
 *   stock_code FK -> stock_universe_securities(stock_code)
 *
 * corporate_action_adjustment_factors
 *   event_price_factor > 0
 *   event_share_factor > 0
 *   cumulative_price_factor > 0
 *   cumulative_share_factor > 0
 *   production_applied = false
 *   action_event_id FK -> corporate_action_events(id)
 *   adjustment_run_id FK -> corporate_action_adjustment_runs(id)
 *   stock_code FK -> stock_universe_securities(stock_code)
 *   UNIQUE(adjustment_run_id, action_event_id)
 *
 * Current batch contract:
 *   128 production-eligible canonical events
 *   121 FACTOR_READY, each on a distinct stock
 *   7 STRUCTURAL_BLOCKED, each on a distinct stock
 *   1 event per stock in current eligible batch
 *
 * This preflight:
 *   - rechecks event-map shape
 *   - verifies all 128 stock codes exist in stock_universe_securities
 *   - probes existing non-validation runs/factors
 *   - blocks logical duplicate production runs for this exact event set/version
 *   - derives 121 factor payloads
 *   - validates all positive-factor CHECK constraints
 *   - builds 128 run previews and 121 factor previews
 *   - writes NOTHING
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-8.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_ADJUSTMENT_RUN_FACTOR_PERSISTENCE_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_11_7_POST_INSERT_128_EVENT_CANONICAL_VERIFICATION_AND_UUID_MAP';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const EXPECTED_EVENTS =
  128;

const EXPECTED_FACTOR_READY =
  121;

const EXPECTED_STRUCTURAL =
  7;

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

function firstFinite(...values) {
  for (const value of values) {
    const n = num(value);

    if (n !== null) {
      return n;
    }
  }

  return null;
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
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
      );

    error.details = {
      status:
        response.status,

      code:
        body?.code ??
        null,

      message:
        body?.message ??
        null,

      details:
        body?.details ??
        null,

      hint:
        body?.hint ??
        null,
    };

    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_ARRAY_RESPONSE_REQUIRED',
    );
  }

  return body;
}

function postgrestIn(values) {
  return (
    '(' +
    values
      .map(
        (value) =>
          `"${String(value).replaceAll('"', '\\"')}"`,
      )
      .join(',') +
    ')'
  );
}

function extractFactorValues(event) {
  const fv =
    event.factorValidation ??
    {};

  const actionType =
    event.actionType;

  let eventPriceFactor =
    firstFinite(
      fv.eventPriceFactor,
      fv.event_price_factor,
      fv.priceFactor,
      fv.price_factor,
      fv.factor?.price,
      fv.factor?.priceFactor,
      fv.factor?.eventPriceFactor,
      fv.factors?.price,
      fv.factors?.eventPriceFactor,
    );

  let eventShareFactor =
    firstFinite(
      fv.eventShareFactor,
      fv.event_share_factor,
      fv.shareFactor,
      fv.share_factor,
      fv.factor?.share,
      fv.factor?.shareFactor,
      fv.factor?.eventShareFactor,
      fv.factors?.share,
      fv.factors?.eventShareFactor,
    );

  // Deterministic fallback from canonical event contract.
  if (
    eventPriceFactor === null ||
    eventShareFactor === null
  ) {
    if (
      actionType === 'STOCK_SPLIT' ||
      actionType === 'REVERSE_SPLIT'
    ) {
      const from =
        num(event.ratioFrom);

      const to =
        num(event.ratioTo);

      if (
        from !== null &&
        to !== null &&
        from > 0 &&
        to > 0
      ) {
        eventPriceFactor =
          eventPriceFactor ??
          (from / to);

        eventShareFactor =
          eventShareFactor ??
          (to / from);
      }
    }

    if (
      actionType ===
      'CASH_DIVIDEND'
    ) {
      eventPriceFactor =
        eventPriceFactor ??
        firstFinite(
          fv.cashPriceFactor,
          fv.cash_price_factor,
          fv.factor,
          fv.eventFactor,
          fv.event_factor,
        );

      eventShareFactor =
        eventShareFactor ??
        1;
    }
  }

  return {
    eventPriceFactor,
    eventShareFactor,
  };
}

function buildRunPreview(event) {
  const factorReady =
    event.factorStatus ===
    'FACTOR_READY';

  const structural =
    event.factorStatus ===
    'STRUCTURAL_BLOCKED';

  if (
    !factorReady &&
    !structural
  ) {
    throw new Error(
      `UNEXPECTED_FACTOR_STATUS:${event.providerEventId}:${event.factorStatus}`,
    );
  }

  return {
    stock_code:
      event.stockCode,

    version:
      RUN_VERSION,

    status:
      factorReady
        ? 'READY'
        : 'BLOCKED_UNSUPPORTED_ACTION',

    event_count:
      1,

    supported_event_count:
      factorReady
        ? 1
        : 0,

    unsupported_event_count:
      structural
        ? 1
        : 0,

    factor_count:
      factorReady
        ? 1
        : 0,

    summary: {
      pipeline_version:
        'V9_8',

      persistence_version:
        VERSION,

      provider:
        'DART_KRX_CANONICAL',

      provider_event_ids: [
        event.providerEventId,
      ],

      event_ids: [
        event.eventId,
      ],

      action_types: [
        event.actionType,
      ],

      effective_dates: [
        event.effectiveDate,
      ],

      factor_status:
        event.factorStatus,

      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',

      production_namespace_contract:
        'IS_VALIDATION_FALSE_WITH_PRODUCTION_APPLIED_FALSE',
    },

    is_validation:
      false,

    production_applied:
      false,
  };
}

function buildFactorPreview(event) {
  const {
    eventPriceFactor,
    eventShareFactor,
  } =
    extractFactorValues(
      event,
    );

  return {
    adjustment_run_id:
      null,

    stock_code:
      event.stockCode,

    effective_date:
      event.effectiveDate,

    action_event_id:
      event.eventId,

    action_type:
      event.actionType,

    event_price_factor:
      eventPriceFactor,

    event_share_factor:
      eventShareFactor,

    // Current eligible factor-ready set is one event per stock.
    cumulative_price_factor:
      eventPriceFactor,

    cumulative_share_factor:
      eventShareFactor,

    metadata: {
      pipeline_version:
        'V9_8',

      persistence_version:
        VERSION,

      provider_event_id:
        event.providerEventId,

      source_fingerprint:
        event.sourceFingerprint,

      factor_status:
        event.factorStatus,

      cumulative_rule:
        'SINGLE_EVENT_STOCK_CUMULATIVE_EQUALS_EVENT_FACTOR',

      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',
    },

    flags: {
      canonical_adjusted_bars_not_modified:
        true,

      structural_factor:
        false,
    },

    is_validation:
      false,

    production_applied:
      false,
  };
}

function validateRun(row) {
  const issues = [];

  if (!row.stock_code) {
    issues.push(
      'STOCK_CODE_REQUIRED',
    );
  }

  if (!row.version) {
    issues.push(
      'VERSION_REQUIRED',
    );
  }

  if (
    ![
      'RUNNING',
      'READY',
      'BLOCKED_UNSUPPORTED_ACTION',
      'FAILED',
    ].includes(
      row.status,
    )
  ) {
    issues.push(
      'RUN_STATUS_CHECK_FAILED',
    );
  }

  for (
    const field of
    [
      'event_count',
      'supported_event_count',
      'unsupported_event_count',
      'factor_count',
    ]
  ) {
    if (
      !Number.isInteger(
        row[field],
      ) ||
      row[field] < 0
    ) {
      issues.push(
        `RUN_COUNT_INVALID:${field}`,
      );
    }
  }

  if (
    row.event_count !==
    (
      row.supported_event_count +
      row.unsupported_event_count
    )
  ) {
    issues.push(
      'RUN_EVENT_COUNT_ACCOUNTING_MISMATCH',
    );
  }

  if (
    row.status ===
      'READY' &&
    (
      row.supported_event_count !== 1 ||
      row.unsupported_event_count !== 0 ||
      row.factor_count !== 1
    )
  ) {
    issues.push(
      'READY_RUN_COUNT_CONTRACT_FAILED',
    );
  }

  if (
    row.status ===
      'BLOCKED_UNSUPPORTED_ACTION' &&
    (
      row.supported_event_count !== 0 ||
      row.unsupported_event_count !== 1 ||
      row.factor_count !== 0
    )
  ) {
    issues.push(
      'BLOCKED_RUN_COUNT_CONTRACT_FAILED',
    );
  }

  if (
    row.is_validation !==
    false
  ) {
    issues.push(
      'RUN_IS_VALIDATION_MUST_BE_FALSE',
    );
  }

  if (
    row.production_applied !==
    false
  ) {
    issues.push(
      'RUN_PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  return issues;
}

function validateFactor(row) {
  const issues = [];

  if (!row.stock_code) {
    issues.push(
      'STOCK_CODE_REQUIRED',
    );
  }

  if (!row.action_event_id) {
    issues.push(
      'ACTION_EVENT_ID_REQUIRED',
    );
  }

  if (!row.effective_date) {
    issues.push(
      'EFFECTIVE_DATE_REQUIRED',
    );
  }

  for (
    const field of
    [
      'event_price_factor',
      'event_share_factor',
      'cumulative_price_factor',
      'cumulative_share_factor',
    ]
  ) {
    const value =
      num(
        row[field],
      );

    if (
      value === null ||
      !(value > 0)
    ) {
      issues.push(
        `FACTOR_POSITIVE_CHECK_FAILED:${field}`,
      );
    }
  }

  if (
    row.is_validation !==
    false
  ) {
    issues.push(
      'FACTOR_IS_VALIDATION_MUST_BE_FALSE',
    );
  }

  if (
    row.production_applied !==
    false
  ) {
    issues.push(
      'FACTOR_PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  if (
    row.cumulative_price_factor !==
    row.event_price_factor
  ) {
    issues.push(
      'SINGLE_EVENT_PRICE_CUMULATIVE_MISMATCH',
    );
  }

  if (
    row.cumulative_share_factor !==
    row.event_share_factor
  ) {
    issues.push(
      'SINGLE_EVENT_SHARE_CUMULATIVE_MISMATCH',
    );
  }

  return issues;
}

function existingRunReferencesEvent(
  run,
  event,
) {
  const eventIds =
    run.summary
      ?.event_ids;

  const providerEventIds =
    run.summary
      ?.provider_event_ids;

  return (
    (
      Array.isArray(eventIds) &&
      eventIds.includes(
        event.eventId,
      )
    ) ||
    (
      Array.isArray(providerEventIds) &&
      providerEventIds.includes(
        event.providerEventId,
      )
    )
  );
}

async function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-128-event-id-map-v9-8-11-7.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8.json',
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
    'POST_INSERT_128_EVENT_VERIFICATION_COMPLETE'
  ) {
    throw new Error(
      'EVENT_MAP_STAGE_NOT_COMPLETE',
    );
  }

  if (
    input.counts
      ?.eventMapRows !==
      EXPECTED_EVENTS ||
    input.counts
      ?.factorReadyEvents !==
      EXPECTED_FACTOR_READY ||
    input.counts
      ?.structuralBlockedEvents !==
      EXPECTED_STRUCTURAL ||
    input.counts
      ?.multiEventStocks !==
      0 ||
    input.counts
      ?.factorStructuralOverlapStocks !==
      0
  ) {
    throw new Error(
      'INPUT_COUNT_CONTRACT_FAILED',
    );
  }

  if (
    input.checks
      ?.baseVerificationPass !==
      true ||
    input.checks
      ?.adjustmentGroupingReady !==
      true ||
    input.checks
      ?.singleEventPerFactorReadyStock !==
      true
  ) {
    throw new Error(
      'INPUT_GROUPING_CHECK_FAILED',
    );
  }

  if (
    !Array.isArray(
      input.eventMap,
    ) ||
    input.eventMap.length !==
      EXPECTED_EVENTS
  ) {
    throw new Error(
      'EXPECTED_128_EVENT_MAP_ROWS',
    );
  }

  const eventMap =
    input.eventMap;

  const factorReady =
    eventMap.filter(
      (row) =>
        row.factorStatus ===
        'FACTOR_READY',
    );

  const structuralBlocked =
    eventMap.filter(
      (row) =>
        row.factorStatus ===
        'STRUCTURAL_BLOCKED',
    );

  const runPreview =
    eventMap.map(
      buildRunPreview,
    );

  const factorPreview =
    factorReady.map(
      buildFactorPreview,
    );

  const runIssues =
    runPreview
      .map(
        (row) => ({
          stockCode:
            row.stock_code,

          providerEventId:
            row.summary
              ?.provider_event_ids?.[0] ??
            null,

          issues:
            validateRun(
              row,
            ),
        }),
      )
      .filter(
        (row) =>
          row.issues.length >
          0,
      );

  const factorIssues =
    factorPreview
      .map(
        (row) => ({
          stockCode:
            row.stock_code,

          actionEventId:
            row.action_event_id,

          providerEventId:
            row.metadata
              ?.provider_event_id ??
            null,

          issues:
            validateFactor(
              row,
            ),
        }),
      )
      .filter(
        (row) =>
          row.issues.length >
          0,
      );

  const stockCodes =
    [
      ...new Set(
        eventMap.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ].sort();

  const {
    url,
    key,
  } =
    requireEnv();

  // 1) FK stock universe coverage.
  const stockRows =
    await getArray(
      `${url}/rest/v1/stock_universe_securities` +
      `?select=${encodeURIComponent('stock_code')}` +
      `&stock_code=in.${encodeURIComponent(postgrestIn(stockCodes))}`,
      key,
    );

  const existingStocks =
    new Set(
      stockRows.map(
        (row) =>
          row.stock_code,
      ),
    );

  const missingStockUniverse =
    stockCodes.filter(
      (stockCode) =>
        !existingStocks.has(
          stockCode,
        ),
    );

  // 2) Existing production/non-validation runs.
  const existingRuns =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(
        [
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
          'created_at',
        ].join(','),
      )}` +
      `&is_validation=eq.false` +
      `&order=created_at.asc`,
      key,
    );

  // 3) Existing production/non-validation factors.
  const existingFactors =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_factors` +
      `?select=${encodeURIComponent(
        [
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
          'flags',
          'is_validation',
          'production_applied',
          'created_at',
        ].join(','),
      )}` +
      `&is_validation=eq.false` +
      `&order=created_at.asc`,
      key,
    );

  const targetEventIds =
    new Set(
      eventMap.map(
        (row) =>
          row.eventId,
      ),
    );

  const targetProviderEventIds =
    new Set(
      eventMap.map(
        (row) =>
          row.providerEventId,
      ),
    );

  const targetStocks =
    new Set(
      stockCodes,
    );

  const existingRunEventRefs =
    [];

  for (const run of existingRuns) {
    for (const event of eventMap) {
      if (
        existingRunReferencesEvent(
          run,
          event,
        )
      ) {
        existingRunEventRefs.push({
          runId:
            run.id,

          runStockCode:
            run.stock_code,

          runVersion:
            run.version,

          runStatus:
            run.status,

          eventId:
            event.eventId,

          providerEventId:
            event.providerEventId,

          eventStockCode:
            event.stockCode,
        });
      }
    }
  }

  const existingFactorsForTargetEvents =
    existingFactors
      .filter(
        (row) =>
          targetEventIds.has(
            row.action_event_id,
          ),
      )
      .map(
        (row) => ({
          factorId:
            row.id,

          adjustmentRunId:
            row.adjustment_run_id,

          stockCode:
            row.stock_code,

          actionEventId:
            row.action_event_id,

          actionType:
            row.action_type,

          productionApplied:
            row.production_applied,
        }),
      );

  const existingSameVersionRuns =
    existingRuns
      .filter(
        (run) =>
          run.version ===
          RUN_VERSION &&
          targetStocks.has(
            run.stock_code,
          ),
      )
      .map(
        (run) => ({
          id:
            run.id,

          stockCode:
            run.stock_code,

          version:
            run.version,

          status:
            run.status,

          summary:
            run.summary,
        }),
      );

  const targetProductionAppliedViolations =
    [
      ...existingRuns
        .filter(
          (row) =>
            row.production_applied !==
            false,
        )
        .map(
          (row) => ({
            table:
              'corporate_action_adjustment_runs',

            id:
              row.id,

            productionApplied:
              row.production_applied,
          }),
        ),

      ...existingFactors
        .filter(
          (row) =>
            row.production_applied !==
            false,
        )
        .map(
          (row) => ({
            table:
              'corporate_action_adjustment_factors',

            id:
              row.id,

            productionApplied:
              row.production_applied,
          }),
        ),
    ];

  const eventIdSet =
    new Set(
      factorPreview.map(
        (row) =>
          row.action_event_id,
      ),
    );

  const factorStockSet =
    new Set(
      factorPreview.map(
        (row) =>
          row.stock_code,
      ),
    );

  const factorIdentityDuplicates =
    factorPreview.length -
    eventIdSet.size;

  const factorStockDuplicates =
    factorPreview.length -
    factorStockSet.size;

  const blockers = [];

  if (
    runIssues.length >
    0
  ) {
    blockers.push(
      'RUN_PREVIEW_CONTRACT_FAILED',
    );
  }

  if (
    factorIssues.length >
    0
  ) {
    blockers.push(
      'FACTOR_PREVIEW_CONTRACT_FAILED',
    );
  }

  if (
    missingStockUniverse.length >
    0
  ) {
    blockers.push(
      'STOCK_UNIVERSE_FK_MISSING',
    );
  }

  if (
    existingRunEventRefs.length >
    0
  ) {
    blockers.push(
      'TARGET_EVENT_ALREADY_REFERENCED_BY_PRODUCTION_RUN',
    );
  }

  if (
    existingFactorsForTargetEvents.length >
    0
  ) {
    blockers.push(
      'TARGET_EVENT_ALREADY_HAS_PRODUCTION_FACTOR',
    );
  }

  if (
    existingSameVersionRuns.length >
    0
  ) {
    blockers.push(
      'SAME_VERSION_PRODUCTION_RUN_ALREADY_EXISTS',
    );
  }

  if (
    targetProductionAppliedViolations.length >
    0
  ) {
    blockers.push(
      'EXISTING_PRODUCTION_APPLIED_CONTRACT_VIOLATION',
    );
  }

  if (
    factorIdentityDuplicates !==
    0
  ) {
    blockers.push(
      'DUPLICATE_FACTOR_ACTION_EVENT_ID',
    );
  }

  if (
    factorStockDuplicates !==
    0
  ) {
    blockers.push(
      'MULTI_FACTOR_EVENT_PER_STOCK_UNEXPECTED',
    );
  }

  const status =
    blockers.length ===
    0
      ? 'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY'
      : 'ADJUSTMENT_PERSISTENCE_PREFLIGHT_BLOCKED';

  const report = {
    version:
      VERSION,

    status,

    runVersion:
      RUN_VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    remoteDbContract: {
      runs: {
        productionApplied:
          'MUST_BE_FALSE',

        allowedStatuses: [
          'RUNNING',
          'READY',
          'BLOCKED_UNSUPPORTED_ACTION',
          'FAILED',
        ],

        counts:
          'ALL_NONNEGATIVE',

        stockCodeFk:
          'stock_universe_securities(stock_code)',
      },

      factors: {
        positiveFactors:
          'event_price_factor,event_share_factor,cumulative_price_factor,cumulative_share_factor > 0',

        productionApplied:
          'MUST_BE_FALSE',

        actionEventFk:
          'corporate_action_events(id) ON DELETE RESTRICT',

        adjustmentRunFk:
          'corporate_action_adjustment_runs(id) ON DELETE CASCADE',

        stockCodeFk:
          'stock_universe_securities(stock_code)',

        uniqueIdentity:
          'UNIQUE(adjustment_run_id,action_event_id)',
      },
    },

    counts: {
      inputEvents:
        eventMap.length,

      runPreviewRows:
        runPreview.length,

      readyRunRows:
        runPreview.filter(
          (row) =>
            row.status ===
            'READY',
        ).length,

      blockedStructuralRunRows:
        runPreview.filter(
          (row) =>
            row.status ===
            'BLOCKED_UNSUPPORTED_ACTION',
        ).length,

      factorPreviewRows:
        factorPreview.length,

      stockUniverseRequired:
        stockCodes.length,

      stockUniverseFound:
        existingStocks.size,

      stockUniverseMissing:
        missingStockUniverse.length,

      runPreviewIssueRows:
        runIssues.length,

      factorPreviewIssueRows:
        factorIssues.length,

      existingNonValidationRuns:
        existingRuns.length,

      existingNonValidationFactors:
        existingFactors.length,

      targetEventExistingRunRefs:
        existingRunEventRefs.length,

      targetEventExistingFactorRows:
        existingFactorsForTargetEvents.length,

      sameVersionTargetStockRuns:
        existingSameVersionRuns.length,

      productionAppliedContractViolations:
        targetProductionAppliedViolations.length,

      duplicateFactorActionEventIds:
        factorIdentityDuplicates,

      duplicateFactorStocks:
        factorStockDuplicates,
    },

    factorValueRanges: {
      eventPriceFactorMin:
        factorPreview.length
          ? Math.min(
              ...factorPreview.map(
                (row) =>
                  row.event_price_factor,
              ),
            )
          : null,

      eventPriceFactorMax:
        factorPreview.length
          ? Math.max(
              ...factorPreview.map(
                (row) =>
                  row.event_price_factor,
              ),
            )
          : null,

      eventShareFactorMin:
        factorPreview.length
          ? Math.min(
              ...factorPreview.map(
                (row) =>
                  row.event_share_factor,
              ),
            )
          : null,

      eventShareFactorMax:
        factorPreview.length
          ? Math.max(
              ...factorPreview.map(
                (row) =>
                  row.event_share_factor,
              ),
            )
          : null,
    },

    blockers,
    missingStockUniverse,
    runIssues,
    factorIssues,
    existingRunEventRefs,
    existingFactorsForTargetEvents,
    existingSameVersionRuns,
    targetProductionAppliedViolations,

    runPreview,
    factorPreview,

    safety: {
      networkRequests:
        3,

      databaseReads:
        3,

      databaseWrites:
        0,

      runRowsInserted:
        0,

      factorRowsInserted:
        0,

      canonicalEventsModified:
        0,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      status ===
      'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY'
        ? 'BUILD_V9_8_11_9_128_RUN_121_FACTOR_APPLY'
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

        runVersion:
          RUN_VERSION,

        inputFingerprint:
          report.source
            .inputFingerprint,

        status:
          report.status,

        runs:
          runPreview.map(
            (row) => [
              row.stock_code,
              row.version,
              row.status,
              row.summary
                ?.event_ids?.[0],
            ],
          ),

        factors:
          factorPreview.map(
            (row) => [
              row.stock_code,
              row.action_event_id,
              row.action_type,
              row.effective_date,
              row.event_price_factor,
              row.event_share_factor,
              row.cumulative_price_factor,
              row.cumulative_share_factor,
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

        runVersion:
          RUN_VERSION,

        ...report.counts,

        factorValueRanges:
          report.factorValueRanges,

        blockers:
          report.blockers,

        missingStockUniverse:
          report.missingStockUniverse,

        runIssues:
          report.runIssues,

        factorIssues:
          report.factorIssues,

        existingRunEventRefs:
          report.existingRunEventRefs,

        existingFactorsForTargetEvents:
          report.existingFactorsForTargetEvents,

        existingSameVersionRuns:
          report.existingSameVersionRuns,

        productionAppliedContractViolations:
          report.targetProductionAppliedViolations,

        databaseWrites:
          0,

        runRowsInserted:
          0,

        factorRowsInserted:
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
    status !==
    'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY'
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
            'ADJUSTMENT_PERSISTENCE_PREFLIGHT_FAILED',

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
