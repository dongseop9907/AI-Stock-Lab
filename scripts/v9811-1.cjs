/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.1 - Existing canonical conflict dependency probe
 *
 * READ-ONLY. GET only. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-production-event-preflight-v9-8-11.json
 *   logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3.json
 *
 * Output:
 *   logs/opendart-corporate-action-existing-conflict-dependency-probe-v9-8-11-1.json
 *
 * Purpose:
 *   Inspect the 5 existing production-namespace canonical rows that conflict
 *   with V9.8 canonical preview, and determine whether they are safe candidates
 *   for a later controlled repair.
 *
 * Checks:
 *   - current event lifecycle / metadata
 *   - corporate_action_adjustment_factors references
 *   - corporate_action_adjustment_runs references through summary.event_ids
 *     or summary.provider_event_ids
 *   - any production_applied=true downstream dependency
 *
 * No DELETE / PATCH / POST / UPSERT is performed.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_1_EXISTING_CANONICAL_CONFLICT_DEPENDENCY_PROBE';

const PREFLIGHT_VERSION =
  'V9_8_11_PRODUCTION_CANONICAL_EVENT_PERSISTENCE_PREFLIGHT';

const FINALIZATION_VERSION =
  'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_CONFLICTS =
  5;

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
    const code =
      body?.code ??
      `HTTP_${response.status}`;

    throw new Error(
      `SUPABASE_READ_FAILED:${String(code)}`,
    );
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

function buildDesired(row) {
  return {
    stock_code:
      row.stockCode,

    action_type:
      row.actionType,

    effective_date:
      row.canonicalPreview
        ?.effective_date ??
      null,

    ratio_from:
      num(
        row.canonicalPreview
          ?.ratio_from,
      ),

    ratio_to:
      num(
        row.canonicalPreview
          ?.ratio_to,
      ),

    cash_amount:
      num(
        row.canonicalPreview
          ?.cash_amount,
      ),

    currency:
      row.actionType ===
      'CASH_DIVIDEND'
        ? (
            normalizeCurrency(
              row.canonicalPreview
                ?.currency,
            ) ??
            'KRW'
          )
        : null,

    provider:
      PROVIDER,

    provider_event_id:
      row.providerEventId,

    source_fingerprint:
      row.sourceFingerprint,

    status:
      'RECORDED',

    is_validation:
      false,

    production_applied:
      true,
  };
}

function semanticMismatches(
  existing,
  desired,
) {
  const mismatches = [];

  function eq(
    field,
    actual,
    expected,
  ) {
    if (actual !== expected) {
      mismatches.push({
        field,
        actual,
        expected,
      });
    }
  }

  function eqNum(
    field,
    actual,
    expected,
  ) {
    const a =
      num(actual);

    const e =
      num(expected);

    const same =
      a === null ||
      e === null
        ? (
            a === null &&
            e === null
          )
        : (
            Math.abs(
              a - e,
            ) <=
            1e-12
          );

    if (!same) {
      mismatches.push({
        field,
        actual,
        expected,
      });
    }
  }

  eq(
    'stock_code',
    existing.stock_code,
    desired.stock_code,
  );

  eq(
    'action_type',
    existing.action_type,
    desired.action_type,
  );

  eq(
    'effective_date',
    existing.effective_date,
    desired.effective_date,
  );

  eqNum(
    'ratio_from',
    existing.ratio_from,
    desired.ratio_from,
  );

  eqNum(
    'ratio_to',
    existing.ratio_to,
    desired.ratio_to,
  );

  eqNum(
    'cash_amount',
    existing.cash_amount,
    desired.cash_amount,
  );

  eq(
    'currency',
    normalizeCurrency(
      existing.currency,
    ),
    normalizeCurrency(
      desired.currency,
    ),
  );

  eq(
    'provider',
    existing.provider,
    desired.provider,
  );

  eq(
    'provider_event_id',
    existing.provider_event_id,
    desired.provider_event_id,
  );

  eq(
    'source_fingerprint',
    existing.source_fingerprint,
    desired.source_fingerprint,
  );

  eq(
    'status',
    existing.status,
    'RECORDED',
  );

  eq(
    'is_validation',
    existing.is_validation,
    false,
  );

  return mismatches;
}

function arrayContains(
  value,
  target,
) {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        String(item) ===
        String(target),
    )
  );
}

function ratioEquivalent(
  existing,
  desired,
) {
  const er =
    num(
      existing.ratio_from,
    );

  const et =
    num(
      existing.ratio_to,
    );

  const dr =
    num(
      desired.ratio_from,
    );

  const dt =
    num(
      desired.ratio_to,
    );

  if (
    !(er > 0) ||
    !(et > 0) ||
    !(dr > 0) ||
    !(dt > 0)
  ) {
    return false;
  }

  return (
    Math.abs(
      er / et -
      dr / dt,
    ) <=
    1e-12
  );
}

async function main() {
  if (
    typeof fetch !==
    'function'
  ) {
    throw new Error(
      'NODE_18_OR_NEWER_REQUIRED',
    );
  }

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const preflightFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-production-event-preflight-v9-8-11.json',
    );

  const finalizationFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-finalization-v9-8-10-3.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-existing-conflict-dependency-probe-v9-8-11-1.json',
    );

  for (
    const file of
    [
      preflightFile,
      finalizationFile,
    ]
  ) {
    if (
      !fs.existsSync(
        file,
      )
    ) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const preflight =
    readJson(
      preflightFile,
    );

  const finalization =
    readJson(
      finalizationFile,
    );

  if (
    preflight.version !==
    PREFLIGHT_VERSION
  ) {
    throw new Error(
      'PREFLIGHT_VERSION_MISMATCH',
    );
  }

  if (
    finalization.version !==
    FINALIZATION_VERSION
  ) {
    throw new Error(
      'FINALIZATION_VERSION_MISMATCH',
    );
  }

  if (
    preflight.status !==
    'PRODUCTION_EVENT_PREFLIGHT_BLOCKED'
  ) {
    throw new Error(
      'PREFLIGHT_NOT_BLOCKED_AS_EXPECTED',
    );
  }

  if (
    !Array.isArray(
      preflight.conflicts,
    ) ||
    preflight.conflicts.length !==
    EXPECTED_CONFLICTS
  ) {
    throw new Error(
      'EXPECTED_5_CONFLICTS',
    );
  }

  if (
    !Array.isArray(
      finalization.results,
    )
  ) {
    throw new Error(
      'FINALIZATION_RESULTS_MISSING',
    );
  }

  const finalByProviderEventId =
    new Map(
      finalization.results.map(
        (row) => [
          row.providerEventId,
          row,
        ],
      ),
    );

  const conflictIds =
    preflight.conflicts.map(
      (row) =>
        row.existingEventId,
    );

  const conflictProviderEventIds =
    preflight.conflicts.map(
      (row) =>
        row.providerEventId,
    );

  const {
    url,
    key,
  } =
    requireEnv();

  const eventSelect =
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

  const existingEvents =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(eventSelect)}` +
      `&id=in.${encodeURIComponent(postgrestIn(conflictIds))}` +
      `&order=provider_event_id.asc`,
      key,
    );

  const factorSelect =
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
      'is_validation',
      'production_applied',
      'created_at',
    ].join(',');

  const factorRefs =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_factors` +
      `?select=${encodeURIComponent(factorSelect)}` +
      `&action_event_id=in.${encodeURIComponent(postgrestIn(conflictIds))}` +
      `&order=created_at.asc`,
      key,
    );

  const runSelect =
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
      'started_at',
      'finished_at',
      'error_message',
    ].join(',');

  /*
   * Read only non-validation adjustment runs. Structural runs may have no
   * factor row, so dependency detection must also inspect summary.event_ids /
   * summary.provider_event_ids rather than relying only on factor rows.
   */
  const nonValidationRuns =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(runSelect)}` +
      `&is_validation=eq.false` +
      `&order=started_at.asc`,
      key,
    );

  const eventById =
    new Map(
      existingEvents.map(
        (row) => [
          row.id,
          row,
        ],
      ),
    );

  const factorsByEventId =
    new Map();

  for (const factor of factorRefs) {
    if (
      !factorsByEventId.has(
        factor.action_event_id,
      )
    ) {
      factorsByEventId.set(
        factor.action_event_id,
        [],
      );
    }

    factorsByEventId
      .get(
        factor.action_event_id,
      )
      .push(
        factor,
      );
  }

  const rows = [];

  for (const conflict of preflight.conflicts) {
    const existing =
      eventById.get(
        conflict.existingEventId,
      );

    if (!existing) {
      throw new Error(
        `EXISTING_CONFLICT_EVENT_NOT_FOUND:${conflict.existingEventId}`,
      );
    }

    const finalRow =
      finalByProviderEventId.get(
        conflict.providerEventId,
      );

    if (!finalRow) {
      throw new Error(
        `FINAL_CANONICAL_ROW_NOT_FOUND:${conflict.providerEventId}`,
      );
    }

    const desired =
      buildDesired(
        finalRow,
      );

    const semantic =
      semanticMismatches(
        existing,
        desired,
      );

    const factors =
      factorsByEventId.get(
        existing.id,
      ) ??
      [];

    const runs =
      nonValidationRuns.filter(
        (run) =>
          arrayContains(
            run.summary
              ?.event_ids,
            existing.id,
          ) ||
          arrayContains(
            run.summary
              ?.provider_event_ids,
            existing.provider_event_id,
          ) ||
          factors.some(
            (factor) =>
              factor.adjustment_run_id ===
              run.id,
          ),
      );

    const anyAppliedFactor =
      factors.some(
        (factor) =>
          factor.production_applied ===
          true,
      );

    const anyAppliedRun =
      runs.some(
        (run) =>
          run.production_applied ===
          true,
      );

    const eventApplied =
      existing.production_applied ===
      true;

    const hasAppliedDependency =
      eventApplied ||
      anyAppliedFactor ||
      anyAppliedRun;

    const semanticFields =
      new Set(
        semantic.map(
          (row) =>
            row.field,
        ),
      );

    const lifecycleOnly =
      semantic.length ===
      0 &&
      existing.production_applied ===
      false;

    const sameEconomicRatio =
      ratioEquivalent(
        existing,
        desired,
      );

    let classification =
      null;

    if (
      hasAppliedDependency
    ) {
      classification =
        'BLOCKED_APPLIED_DEPENDENCY_EXISTS';
    } else if (
      lifecycleOnly
    ) {
      classification =
        'REUSABLE_CANONICAL_ROW_LIFECYCLE_ONLY';
    } else if (
      semanticFields.has(
        'effective_date',
      ) ||
      semanticFields.has(
        'action_type',
      ) ||
      semanticFields.has(
        'stock_code',
      ) ||
      semanticFields.has(
        'source_fingerprint',
      ) ||
      semanticFields.has(
        'ratio_from',
      ) ||
      semanticFields.has(
        'ratio_to',
      ) ||
      semanticFields.has(
        'cash_amount',
      ) ||
      semanticFields.has(
        'currency',
      )
    ) {
      classification =
        'STALE_CANONICAL_ROW_CONTROLLED_REPAIR_REQUIRED';
    } else {
      classification =
        'REVIEW_REQUIRED';
    }

    rows.push({
      providerEventId:
        conflict.providerEventId,

      existingEventId:
        existing.id,

      stockCode:
        desired.stock_code,

      actionType:
        desired.action_type,

      classification,

      existing: {
        stockCode:
          existing.stock_code,

        actionType:
          existing.action_type,

        effectiveDate:
          existing.effective_date,

        ratioFrom:
          num(
            existing.ratio_from,
          ),

        ratioTo:
          num(
            existing.ratio_to,
          ),

        cashAmount:
          num(
            existing.cash_amount,
          ),

        currency:
          normalizeCurrency(
            existing.currency,
          ),

        sourceFingerprint:
          existing.source_fingerprint,

        status:
          existing.status,

        canonicalValidationStatus:
          existing.metadata
            ?.canonical_validation_status ??
          null,

        isValidation:
          existing.is_validation,

        productionApplied:
          existing.production_applied,

        createdAt:
          existing.created_at,
      },

      desired: {
        stockCode:
          desired.stock_code,

        actionType:
          desired.action_type,

        effectiveDate:
          desired.effective_date,

        ratioFrom:
          desired.ratio_from,

        ratioTo:
          desired.ratio_to,

        cashAmount:
          desired.cash_amount,

        currency:
          desired.currency,

        sourceFingerprint:
          desired.source_fingerprint,

        status:
          desired.status,

        isValidation:
          desired.is_validation,

        productionApplied:
          desired.production_applied,
      },

      semanticMismatches:
        semantic,

      sameEconomicRatio,

      dependencies: {
        factorRefCount:
          factors.length,

        runRefCount:
          runs.length,

        eventProductionApplied:
          eventApplied,

        anyFactorProductionApplied:
          anyAppliedFactor,

        anyRunProductionApplied:
          anyAppliedRun,

        hasAppliedDependency,

        factors:
          factors.map(
            (factor) => ({
              id:
                factor.id,

              adjustmentRunId:
                factor.adjustment_run_id,

              actionType:
                factor.action_type,

              effectiveDate:
                factor.effective_date,

              eventPriceFactor:
                num(
                  factor.event_price_factor,
                ),

              eventShareFactor:
                num(
                  factor.event_share_factor,
                ),

              cumulativePriceFactor:
                num(
                  factor.cumulative_price_factor,
                ),

              cumulativeShareFactor:
                num(
                  factor.cumulative_share_factor,
                ),

              isValidation:
                factor.is_validation,

              productionApplied:
                factor.production_applied,

              createdAt:
                factor.created_at,
            }),
          ),

        runs:
          runs.map(
            (run) => ({
              id:
                run.id,

              stockCode:
                run.stock_code,

              version:
                run.version,

              status:
                run.status,

              eventCount:
                run.event_count,

              supportedEventCount:
                run.supported_event_count,

              unsupportedEventCount:
                run.unsupported_event_count,

              factorCount:
                run.factor_count,

              isValidation:
                run.is_validation,

              productionApplied:
                run.production_applied,

              startedAt:
                run.started_at,

              finishedAt:
                run.finished_at,

              summary:
                run.summary,
            }),
          ),
      },
    });

    console.log(
      [
        'CONFLICT_PROBE',
        `${rows.length}/${preflight.conflicts.length}`,
        `root=${conflict.providerEventId}`,
        `event=${existing.id}`,
        `classification=${classification}`,
        `semantic=${semantic.length}`,
        `sameRatio=${sameEconomicRatio}`,
        `factorRefs=${factors.length}`,
        `runRefs=${runs.length}`,
        `appliedDependency=${hasAppliedDependency}`,
      ].join(' '),
    );
  }

  const appliedDependencyRows =
    rows.filter(
      (row) =>
        row.dependencies
          .hasAppliedDependency,
    );

  const lifecycleOnlyRows =
    rows.filter(
      (row) =>
        row.classification ===
        'REUSABLE_CANONICAL_ROW_LIFECYCLE_ONLY',
    );

  const repairRows =
    rows.filter(
      (row) =>
        row.classification ===
        'STALE_CANONICAL_ROW_CONTROLLED_REPAIR_REQUIRED',
    );

  const reviewRows =
    rows.filter(
      (row) =>
        row.classification ===
          'REVIEW_REQUIRED' ||
        row.classification ===
          'BLOCKED_APPLIED_DEPENDENCY_EXISTS',
    );

  const nonAppliedDependentRows =
    rows.filter(
      (row) =>
        !row.dependencies
          .hasAppliedDependency &&
        (
          row.dependencies
            .factorRefCount >
            0 ||
          row.dependencies
            .runRefCount >
            0
        ),
    );

  const status =
    rows.length !==
      EXPECTED_CONFLICTS
      ? 'CONFLICT_DEPENDENCY_PROBE_INVALID'
      : appliedDependencyRows.length >
        0
        ? 'CONFLICT_DEPENDENCY_PROBE_BLOCKED_APPLIED_DEPENDENCY'
        : reviewRows.length >
          0
          ? 'CONFLICT_DEPENDENCY_PROBE_COMPLETE_WITH_REVIEW'
          : 'CONFLICT_DEPENDENCY_PROBE_READY_FOR_CONTROLLED_REPAIR';

  const report = {
    version:
      VERSION,

    status,

    source: {
      preflightVersion:
        preflight.version,

      preflightFingerprint:
        preflight.outputFingerprint,

      finalizationVersion:
        finalization.version,

      finalizationFingerprint:
        finalization.outputFingerprint,
    },

    counts: {
      conflictTargets:
        preflight.conflicts.length,

      existingEventsRead:
        existingEvents.length,

      factorRefsRead:
        factorRefs.length,

      nonValidationRunsRead:
        nonValidationRuns.length,

      lifecycleOnlyReusable:
        lifecycleOnlyRows.length,

      controlledRepairRequired:
        repairRows.length,

      appliedDependencyRows:
        appliedDependencyRows.length,

      nonAppliedDependentRows:
        nonAppliedDependentRows.length,

      remainingReviewRows:
        reviewRows.length,
    },

    classificationCounts:
      Object.fromEntries(
        [
          ...new Set(
            rows.map(
              (row) =>
                row.classification,
            ),
          ),
        ]
          .sort()
          .map(
            (classification) => [
              classification,
              rows.filter(
                (row) =>
                  row.classification ===
                  classification,
              ).length,
            ],
          ),
      ),

    rows,

    blockers:
      appliedDependencyRows.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          existingEventId:
            row.existingEventId,

          classification:
            row.classification,

          dependencies:
            row.dependencies,
        }),
      ),

    controlledRepairCandidates:
      rows
        .filter(
          (row) =>
            !row.dependencies
              .hasAppliedDependency,
        )
        .map(
          (row) => ({
            providerEventId:
              row.providerEventId,

            existingEventId:
              row.existingEventId,

            stockCode:
              row.stockCode,

            actionType:
              row.actionType,

            classification:
              row.classification,

            semanticMismatches:
              row.semanticMismatches,

            sameEconomicRatio:
              row.sameEconomicRatio,

            factorRefCount:
              row.dependencies
                .factorRefCount,

            runRefCount:
              row.dependencies
                .runRefCount,
          }),
        ),

    safety: {
      httpMethodsUsed: [
        'GET',
      ],

      networkRequests:
        3,

      databaseReads:
        3,

      databaseWrites:
        0,

      eventRowsUpdated:
        0,

      eventRowsDeleted:
        0,

      factorRowsUpdated:
        0,

      factorRowsDeleted:
        0,

      runRowsUpdated:
        0,

      runRowsDeleted:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      appliedDependency:
        'FAIL_CLOSED_DO_NOT_MUTATE',

      lifecycleOnly:
        'EXISTING_CANONICAL_ROW_MAY_BE_REUSED_AFTER_CONTROLLED_LIFECYCLE_PROMOTION',

      staleCanonical:
        'CONTROLLED_REPAIR_REQUIRED_BEFORE_PRODUCTION_APPLY',

      nonAppliedDependencies:
        'MUST_BE_RECONCILED_OR_REBUILT_WITH_REPAIRED_EVENT_BEFORE_PRODUCTION_APPLY',

      ratioNormalization:
        'ECONOMICALLY_EQUIVALENT_RATIO_DOES_NOT_OVERRIDE_CANONICAL_INTEGER_RATIO_CONTRACT',

      writes:
        'NO_WRITES_IN_V9_8_11_1',
    },

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

        preflightFingerprint:
          report.source.preflightFingerprint,

        finalizationFingerprint:
          report.source.finalizationFingerprint,

        rows:
          rows.map(
            (row) => [
              row.providerEventId,
              row.existingEventId,
              row.classification,
              row.semanticMismatches,
              row.sameEconomicRatio,
              row.dependencies
                .factorRefCount,
              row.dependencies
                .runRefCount,
              row.dependencies
                .hasAppliedDependency,
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

        classificationCounts:
          report.classificationCounts,

        controlledRepairCandidates:
          report.controlledRepairCandidates,

        blockers:
          report.blockers,

        networkRequests:
          3,

        databaseWrites:
          0,

        eventRowsUpdated:
          0,

        eventRowsDeleted:
          0,

        factorRowsUpdated:
          0,

        factorRowsDeleted:
          0,

        runRowsUpdated:
          0,

        runRowsDeleted:
          0,

        coverageWindowAdvanced:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
      'CONFLICT_DEPENDENCY_PROBE_INVALID' ||
    status ===
      'CONFLICT_DEPENDENCY_PROBE_BLOCKED_APPLIED_DEPENDENCY'
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      String(
        error?.message ??
        error,
      ),
    );

    process.exitCode =
      1;
  },
);
