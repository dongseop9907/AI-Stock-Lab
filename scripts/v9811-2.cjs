/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.2 - Controlled repair dry-run plan
 *
 * READ-ONLY. GET only. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-existing-conflict-dependency-probe-v9-8-11-1.json
 *   logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3.json
 *
 * Output:
 *   logs/opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json
 *
 * Purpose:
 *   Build exact PATCH plans for the 5 existing canonical rows.
 *
 * Policy:
 *   - preserve event id
 *   - preserve provider/provider_event_id/is_validation identity
 *   - no DELETE / reinsert
 *   - 2 lifecycle-only rows: promote production_applied only
 *   - 3 stale rows: repair canonical semantic fields, then promote lifecycle
 *   - merge metadata instead of dropping historical keys
 *   - add optimistic current-state guards for later apply stage
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_2_CONTROLLED_CANONICAL_REPAIR_DRY_RUN';

const PROBE_VERSION =
  'V9_8_11_1_EXISTING_CANONICAL_CONFLICT_DEPENDENCY_PROBE';

const FINALIZATION_VERSION =
  'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_ROWS =
  5;

const EXPECTED_LIFECYCLE_ONLY =
  2;

const EXPECTED_STALE =
  3;

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

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date =
    new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
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

function buildDesired(finalRow) {
  const actionType =
    finalRow.actionType;

  return {
    stock_code:
      finalRow.stockCode,

    action_type:
      actionType,

    effective_date:
      finalRow.canonicalPreview
        ?.effective_date ??
      null,

    ratio_from:
      num(
        finalRow.canonicalPreview
          ?.ratio_from,
      ),

    ratio_to:
      num(
        finalRow.canonicalPreview
          ?.ratio_to,
      ),

    cash_amount:
      num(
        finalRow.canonicalPreview
          ?.cash_amount,
      ),

    currency:
      actionType ===
      'CASH_DIVIDEND'
        ? (
            normalizeCurrency(
              finalRow.canonicalPreview
                ?.currency,
            ) ??
            'KRW'
          )
        : null,

    provider:
      PROVIDER,

    provider_event_id:
      finalRow.providerEventId,

    source_fingerprint:
      finalRow.sourceFingerprint,

    status:
      'RECORDED',

    is_validation:
      false,

    production_applied:
      true,

    metadataPatch: {
      canonical_validation_status:
        'VALIDATED',

      pipeline_version:
        'V9_8',

      canonical_repair_version:
        VERSION,

      canonical_repair_reason:
        'V9_8_CANONICAL_CONTRACT_RECONCILIATION',

      source_receipt_no:
        finalRow.sourceReceiptNo,

      source_kind:
        finalRow.sourceKind,

      factor_status:
        finalRow.factorValidation
          ?.status ??
        null,

      structural_factor_blocked:
        finalRow.factorValidation
          ?.status ===
        'STRUCTURAL_BLOCKED',

      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',
    },
  };
}

function normalizeSnapshot(row) {
  return {
    id:
      row.id,

    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      num(
        row.ratio_from,
      ),

    ratio_to:
      num(
        row.ratio_to,
      ),

    cash_amount:
      num(
        row.cash_amount,
      ),

    currency:
      normalizeCurrency(
        row.currency,
      ),

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,

    status:
      row.status,

    metadata:
      row.metadata ??
      {},

    is_validation:
      row.is_validation,

    production_applied:
      row.production_applied,

    created_at:
      row.created_at,
  };
}

function buildPatch(
  classification,
  existing,
  desired,
) {
  const metadata = {
    ...(existing.metadata ?? {}),
    ...desired.metadataPatch,
  };

  if (
    classification ===
    'REUSABLE_CANONICAL_ROW_LIFECYCLE_ONLY'
  ) {
    return {
      production_applied:
        true,

      metadata,
    };
  }

  if (
    classification ===
    'STALE_CANONICAL_ROW_CONTROLLED_REPAIR_REQUIRED'
  ) {
    return {
      stock_code:
        desired.stock_code,

      action_type:
        desired.action_type,

      effective_date:
        desired.effective_date,

      ratio_from:
        desired.ratio_from,

      ratio_to:
        desired.ratio_to,

      cash_amount:
        desired.cash_amount,

      currency:
        desired.currency,

      source_fingerprint:
        desired.source_fingerprint,

      status:
        'RECORDED',

      production_applied:
        true,

      metadata,
    };
  }

  throw new Error(
    `UNSUPPORTED_CLASSIFICATION:${classification}`,
  );
}

function buildExpectedAfter(
  existing,
  patch,
) {
  return {
    ...existing,
    ...patch,
  };
}

function sameValue(a, b) {
  if (
    typeof a === 'number' ||
    typeof b === 'number'
  ) {
    const x =
      num(a);

    const y =
      num(b);

    if (
      x !== null ||
      y !== null
    ) {
      return (
        x !== null &&
        y !== null &&
        Math.abs(x - y) <=
          1e-12
      );
    }
  }

  return a === b;
}

function validateExpected(
  expected,
  desired,
) {
  const issues = [];

  const checks = [
    [
      'stock_code',
      expected.stock_code,
      desired.stock_code,
    ],
    [
      'action_type',
      expected.action_type,
      desired.action_type,
    ],
    [
      'effective_date',
      expected.effective_date,
      desired.effective_date,
    ],
    [
      'ratio_from',
      expected.ratio_from,
      desired.ratio_from,
    ],
    [
      'ratio_to',
      expected.ratio_to,
      desired.ratio_to,
    ],
    [
      'cash_amount',
      expected.cash_amount,
      desired.cash_amount,
    ],
    [
      'currency',
      normalizeCurrency(
        expected.currency,
      ),
      desired.currency,
    ],
    [
      'provider',
      expected.provider,
      desired.provider,
    ],
    [
      'provider_event_id',
      expected.provider_event_id,
      desired.provider_event_id,
    ],
    [
      'source_fingerprint',
      expected.source_fingerprint,
      desired.source_fingerprint,
    ],
    [
      'status',
      expected.status,
      'RECORDED',
    ],
    [
      'is_validation',
      expected.is_validation,
      false,
    ],
    [
      'production_applied',
      expected.production_applied,
      true,
    ],
  ];

  for (
    const [
      field,
      actual,
      target,
    ] of
    checks
  ) {
    if (
      !sameValue(
        actual,
        target,
      )
    ) {
      issues.push({
        field,
        actual,
        expected:
          target,
      });
    }
  }

  if (
    expected.metadata
      ?.canonical_validation_status !==
    'VALIDATED'
  ) {
    issues.push({
      field:
        'metadata.canonical_validation_status',

      actual:
        expected.metadata
          ?.canonical_validation_status ??
        null,

      expected:
        'VALIDATED',
    });
  }

  if (
    expected.metadata
      ?.pipeline_version !==
    'V9_8'
  ) {
    issues.push({
      field:
        'metadata.pipeline_version',

      actual:
        expected.metadata
          ?.pipeline_version ??
        null,

      expected:
        'V9_8',
    });
  }

  return issues;
}

function buildGuardQuery(existing) {
  /*
   * Later apply script should use all immutable identity fields plus current
   * lifecycle and source fingerprint as optimistic-lock guards.
   *
   * Semantic stale values are additionally preserved in expectedBefore,
   * and apply must re-read/compare immediately before PATCH.
   */
  return {
    id:
      existing.id,

    provider:
      existing.provider,

    provider_event_id:
      existing.provider_event_id,

    is_validation:
      existing.is_validation,

    production_applied:
      existing.production_applied,

    source_fingerprint:
      existing.source_fingerprint,
  };
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

  const probeFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-existing-conflict-dependency-probe-v9-8-11-1.json',
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
      'opendart-corporate-action-controlled-repair-dry-run-v9-8-11-2.json',
    );

  for (
    const file of
    [
      probeFile,
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

  const probe =
    readJson(
      probeFile,
    );

  const finalization =
    readJson(
      finalizationFile,
    );

  if (
    probe.version !==
    PROBE_VERSION
  ) {
    throw new Error(
      'PROBE_VERSION_MISMATCH',
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
    probe.status !==
    'CONFLICT_DEPENDENCY_PROBE_READY_FOR_CONTROLLED_REPAIR'
  ) {
    throw new Error(
      'DEPENDENCY_PROBE_NOT_READY',
    );
  }

  if (
    probe.counts
      ?.appliedDependencyRows !==
      0 ||
    probe.counts
      ?.remainingReviewRows !==
      0
  ) {
    throw new Error(
      'DEPENDENCY_BLOCKER_PRESENT',
    );
  }

  if (
    !Array.isArray(
      probe.rows,
    ) ||
    probe.rows.length !==
      EXPECTED_ROWS
  ) {
    throw new Error(
      'EXPECTED_5_REPAIR_ROWS',
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

  const lifecycleCount =
    probe.rows.filter(
      (row) =>
        row.classification ===
        'REUSABLE_CANONICAL_ROW_LIFECYCLE_ONLY',
    ).length;

  const staleCount =
    probe.rows.filter(
      (row) =>
        row.classification ===
        'STALE_CANONICAL_ROW_CONTROLLED_REPAIR_REQUIRED',
    ).length;

  if (
    lifecycleCount !==
      EXPECTED_LIFECYCLE_ONLY ||
    staleCount !==
      EXPECTED_STALE
  ) {
    throw new Error(
      'REPAIR_CLASSIFICATION_COUNT_MISMATCH',
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

  const ids =
    probe.rows.map(
      (row) =>
        row.existingEventId,
    );

  const {
    url,
    key,
  } =
    requireEnv();

  const select =
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

  const currentRows =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&id=in.${encodeURIComponent(postgrestIn(ids))}` +
      `&order=provider_event_id.asc`,
      key,
    );

  if (
    currentRows.length !==
    EXPECTED_ROWS
  ) {
    throw new Error(
      'CURRENT_DB_REPAIR_ROW_COUNT_MISMATCH',
    );
  }

  const currentById =
    new Map(
      currentRows.map(
        (row) => [
          row.id,
          row,
        ],
      ),
    );

  const plans = [];

  for (const probeRow of probe.rows) {
    const current =
      currentById.get(
        probeRow.existingEventId,
      );

    if (!current) {
      throw new Error(
        `CURRENT_ROW_MISSING:${probeRow.existingEventId}`,
      );
    }

    if (
      current.provider !==
        PROVIDER ||
      current.provider_event_id !==
        probeRow.providerEventId ||
      current.is_validation !==
        false ||
      current.production_applied !==
        false
    ) {
      throw new Error(
        `CURRENT_ROW_GUARD_FAILED:${probeRow.providerEventId}`,
      );
    }

    const finalRow =
      finalByProviderEventId.get(
        probeRow.providerEventId,
      );

    if (!finalRow) {
      throw new Error(
        `FINAL_ROW_MISSING:${probeRow.providerEventId}`,
      );
    }

    const desired =
      buildDesired(
        finalRow,
      );

    const expectedBefore =
      normalizeSnapshot(
        current,
      );

    /*
     * Ensure V9.8.11.1's dependency-probe snapshot has not drifted in the
     * meaningful fields before even producing a patch plan.
     */
    const probeExisting =
      probeRow.existing;

    const driftChecks = [
      [
        'stockCode',
        expectedBefore.stock_code,
        probeExisting.stockCode,
      ],
      [
        'actionType',
        expectedBefore.action_type,
        probeExisting.actionType,
      ],
      [
        'effectiveDate',
        expectedBefore.effective_date,
        probeExisting.effectiveDate,
      ],
      [
        'ratioFrom',
        expectedBefore.ratio_from,
        probeExisting.ratioFrom,
      ],
      [
        'ratioTo',
        expectedBefore.ratio_to,
        probeExisting.ratioTo,
      ],
      [
        'cashAmount',
        expectedBefore.cash_amount,
        probeExisting.cashAmount,
      ],
      [
        'sourceFingerprint',
        expectedBefore.source_fingerprint,
        probeExisting.sourceFingerprint,
      ],
      [
        'productionApplied',
        expectedBefore.production_applied,
        probeExisting.productionApplied,
      ],
    ];

    const drift =
      driftChecks
        .filter(
          ([
            ,
            actual,
            expected,
          ]) =>
            !sameValue(
              actual,
              expected,
            ),
        )
        .map(
          ([
            field,
            actual,
            expected,
          ]) => ({
            field,
            actual,
            expected,
          }),
        );

    if (
      drift.length >
      0
    ) {
      throw new Error(
        `CURRENT_ROW_DRIFT_DETECTED:${probeRow.providerEventId}`,
      );
    }

    const patch =
      buildPatch(
        probeRow.classification,
        expectedBefore,
        desired,
      );

    const expectedAfter =
      buildExpectedAfter(
        expectedBefore,
        patch,
      );

    const postPatchIssues =
      validateExpected(
        expectedAfter,
        desired,
      );

    const fieldsChanged =
      Object.keys(
        patch,
      ).filter(
        (field) =>
          !sameValue(
            expectedBefore[field],
            patch[field],
          ),
      );

    plans.push({
      providerEventId:
        probeRow.providerEventId,

      existingEventId:
        probeRow.existingEventId,

      stockCode:
        finalRow.stockCode,

      actionType:
        finalRow.actionType,

      classification:
        probeRow.classification,

      guard: {
        path:
          `/rest/v1/corporate_action_events?id=eq.${probeRow.existingEventId}`,

        optimisticCurrentState:
          buildGuardQuery(
            expectedBefore,
          ),

        requiredPreApplyChecks: [
          'ROW_COUNT_EQUALS_1',
          'CURRENT_ROW_EXACTLY_MATCHES_EXPECTED_BEFORE',
          'NO_FACTOR_REFERENCES',
          'NO_RUN_REFERENCES',
          'NO_PRODUCTION_APPLIED_DEPENDENCY',
        ],
      },

      expectedBefore,

      patch,

      fieldsChanged,

      expectedAfter,

      desiredCanonical: {
        stock_code:
          desired.stock_code,

        action_type:
          desired.action_type,

        effective_date:
          desired.effective_date,

        ratio_from:
          desired.ratio_from,

        ratio_to:
          desired.ratio_to,

        cash_amount:
          desired.cash_amount,

        currency:
          desired.currency,

        provider:
          desired.provider,

        provider_event_id:
          desired.provider_event_id,

        source_fingerprint:
          desired.source_fingerprint,

        status:
          desired.status,

        is_validation:
          desired.is_validation,

        production_applied:
          desired.production_applied,
      },

      postPatchIssues,
    });

    console.log(
      [
        'REPAIR_DRY_RUN',
        `${plans.length}/${probe.rows.length}`,
        `root=${probeRow.providerEventId}`,
        `event=${probeRow.existingEventId}`,
        `classification=${probeRow.classification}`,
        `fields=${fieldsChanged.join(',')}`,
        `postIssues=${postPatchIssues.length}`,
      ].join(' '),
    );
  }

  const lifecyclePlans =
    plans.filter(
      (row) =>
        row.classification ===
        'REUSABLE_CANONICAL_ROW_LIFECYCLE_ONLY',
    );

  const stalePlans =
    plans.filter(
      (row) =>
        row.classification ===
        'STALE_CANONICAL_ROW_CONTROLLED_REPAIR_REQUIRED',
    );

  const plansWithIssues =
    plans.filter(
      (row) =>
        row.postPatchIssues.length >
        0,
    );

  const idStable =
    plans.every(
      (row) =>
        row.expectedBefore.id ===
        row.expectedAfter.id,
    );

  const identityStable =
    plans.every(
      (row) =>
        row.expectedBefore.provider ===
          row.expectedAfter.provider &&
        row.expectedBefore.provider_event_id ===
          row.expectedAfter.provider_event_id &&
        row.expectedBefore.is_validation ===
          row.expectedAfter.is_validation,
    );

  const allBecomeProduction =
    plans.every(
      (row) =>
        row.expectedAfter.production_applied ===
        true,
    );

  const allCanonicalValidated =
    plans.every(
      (row) =>
        row.expectedAfter.metadata
          ?.canonical_validation_status ===
        'VALIDATED',
    );

  const status =
    plans.length ===
      EXPECTED_ROWS &&
    lifecyclePlans.length ===
      EXPECTED_LIFECYCLE_ONLY &&
    stalePlans.length ===
      EXPECTED_STALE &&
    plansWithIssues.length ===
      0 &&
    idStable &&
    identityStable &&
    allBecomeProduction &&
    allCanonicalValidated
      ? 'CONTROLLED_REPAIR_DRY_RUN_READY'
      : 'CONTROLLED_REPAIR_DRY_RUN_INVALID';

  const report = {
    version:
      VERSION,

    status,

    source: {
      probeVersion:
        probe.version,

      probeFingerprint:
        probe.outputFingerprint,

      finalizationVersion:
        finalization.version,

      finalizationFingerprint:
        finalization.outputFingerprint,
    },

    counts: {
      repairRows:
        plans.length,

      lifecycleOnlyPlans:
        lifecyclePlans.length,

      staleCanonicalRepairPlans:
        stalePlans.length,

      plansWithPostPatchIssues:
        plansWithIssues.length,

      idsPreserved:
        plans.filter(
          (row) =>
            row.expectedBefore.id ===
            row.expectedAfter.id,
        ).length,

      identitiesPreserved:
        plans.filter(
          (row) =>
            row.expectedBefore.provider ===
              row.expectedAfter.provider &&
            row.expectedBefore.provider_event_id ===
              row.expectedAfter.provider_event_id &&
            row.expectedBefore.is_validation ===
              row.expectedAfter.is_validation,
        ).length,

      productionAppliedAfter:
        plans.filter(
          (row) =>
            row.expectedAfter.production_applied ===
            true,
        ).length,

      canonicalValidatedAfter:
        plans.filter(
          (row) =>
            row.expectedAfter.metadata
              ?.canonical_validation_status ===
            'VALIDATED',
        ).length,
    },

    plans,

    safety: {
      httpMethodsUsed: [
        'GET',
      ],

      networkRequests:
        1,

      databaseReads:
        1,

      databaseWrites:
        0,

      patchRequestsExecuted:
        0,

      eventRowsUpdated:
        0,

      eventRowsDeleted:
        0,

      eventRowsInserted:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    applyContract: {
      updateStrategy:
        'PATCH_EXISTING_EVENT_ID_IN_PLACE',

      deleteReinsert:
        false,

      optimisticLock:
        'RE_READ_AND_REQUIRE_EXACT_EXPECTED_BEFORE_IMMEDIATELY_BEFORE_EACH_PATCH',

      patchOrder:
        'ONE_ROW_AT_A_TIME_FAIL_FAST',

      returnRepresentation:
        'REQUIRE_PATCH_RETURN_REPRESENTATION_AND_EXACTLY_ONE_ROW',

      postPatchVerification:
        'COMPARE_RETURNED_ROW_TO_EXPECTED_AFTER',

      failureBehavior:
        'STOP_IMMEDIATELY_NO_FURTHER_PATCHES',

      downstreamAdjustmentRows:
        'NONE_EXIST_FOR_THESE_5_EVENTS',

      nextStage:
        'CONTROLLED_REPAIR_APPLY_THEN_RERUN_V9_8_11_PREFLIGHT',
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

        probeFingerprint:
          report.source.probeFingerprint,

        finalizationFingerprint:
          report.source.finalizationFingerprint,

        plans:
          plans.map(
            (row) => [
              row.providerEventId,
              row.existingEventId,
              row.classification,
              row.guard.optimisticCurrentState,
              row.patch,
              row.expectedAfter,
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

        planSummary:
          plans.map(
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

              fieldsChanged:
                row.fieldsChanged,

              effectiveDateBefore:
                row.expectedBefore
                  .effective_date,

              effectiveDateAfter:
                row.expectedAfter
                  .effective_date,

              ratioFromBefore:
                row.expectedBefore
                  .ratio_from,

              ratioFromAfter:
                row.expectedAfter
                  .ratio_from,

              ratioToBefore:
                row.expectedBefore
                  .ratio_to,

              ratioToAfter:
                row.expectedAfter
                  .ratio_to,

              productionAppliedBefore:
                row.expectedBefore
                  .production_applied,

              productionAppliedAfter:
                row.expectedAfter
                  .production_applied,

              postPatchIssues:
                row.postPatchIssues,
            }),
          ),

        networkRequests:
          1,

        databaseWrites:
          0,

        patchRequestsExecuted:
          0,

        eventRowsUpdated:
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
    'CONTROLLED_REPAIR_DRY_RUN_INVALID'
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
