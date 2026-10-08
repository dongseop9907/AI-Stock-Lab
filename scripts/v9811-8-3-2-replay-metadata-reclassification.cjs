#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.3.2
 *
 * Reclassify the two V9.8 metadata-only differences found by 8.3.1.
 *
 * Historical compatibility rule:
 * - semantic canonical business fields must match
 * - metadata.canonical_validation_status must be VALIDATED
 * - old V9.7-compatible rows do NOT need every newer V9.8 metadata key
 *
 * Therefore these two differences are enrichment, not business divergence:
 *   metadata.factor_status
 *   metadata.structural_factor_blocked
 *
 * READ ONLY. No DB access required.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_3_2_REPLAY_028080_METADATA_RECLASSIFICATION_AND_MINIMAL_REPAIR_PROOF';

const INPUT_VERSION =
  'V9_8_11_8_3_1_REPLAY_028080_NAMESPACE_AWARE_MINIMAL_REPAIR_STRATEGY_AUDIT';

const ALLOWED_METADATA_ENRICHMENT_FIELDS =
  new Set([
    'metadata.factor_status',
    'metadata.structural_factor_blocked',
  ]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-minimal-repair-strategy-v9-8-11-8-3-1-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-minimal-repair-proof-v9-8-11-8-3-2-replay.json',
    );

  assert(
    fs.existsSync(inputFile),
    `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
  );

  const input =
    readJson(inputFile);

  assert(
    input.version === INPUT_VERSION,
    `INPUT_VERSION_MISMATCH:${input.version}`,
  );

  assert(
    input.status ===
      'MINIMAL_REPAIR_STRATEGY_BLOCKED',
    `INPUT_STATUS_UNEXPECTED:${input.status}`,
  );

  const counts =
    input.counts ?? {};

  // Namespace and collision invariants.
  assert(
    Number(counts.oldProductionCanonicalRows) === 1,
    `OLD_PRODUCTION_ROWS:${counts.oldProductionCanonicalRows}`,
  );

  assert(
    Number(counts.repairedProductionCanonicalRows) === 0,
    `REPAIRED_PRODUCTION_ROWS:${counts.repairedProductionCanonicalRows}`,
  );

  assert(
    Number(counts.desiredFingerprintProductionRows) === 0,
    `DESIRED_FINGERPRINT_PRODUCTION_ROWS:${counts.desiredFingerprintProductionRows}`,
  );

  assert(
    Number(counts.desiredFingerprintAllScopeRows) === 0,
    `DESIRED_FINGERPRINT_ALL_SCOPE_ROWS:${counts.desiredFingerprintAllScopeRows}`,
  );

  // No child-factor dependencies.
  assert(
    Number(counts.factorRowsReferencingOldEvent) === 0,
    `OLD_EVENT_FACTOR_REFS:${counts.factorRowsReferencingOldEvent}`,
  );

  assert(
    Number(counts.factorRowsReferencingStaleRun) === 0,
    `STALE_RUN_FACTOR_REFS:${counts.factorRowsReferencingStaleRun}`,
  );

  assert(
    Number(counts.productionRunsFor028080) === 1,
    `PRODUCTION_RUNS_028080:${counts.productionRunsFor028080}`,
  );

  // Run itself is already semantically correct.
  const runBusinessMismatches =
    Array.isArray(
      input.runBusinessContractMismatches,
    )
      ? input.runBusinessContractMismatches
      : [];

  assert(
    runBusinessMismatches.length === 0,
    `RUN_BUSINESS_MISMATCHES:${runBusinessMismatches.length}`,
  );

  const rawCanonicalMismatches =
    Array.isArray(
      input.canonicalBusinessFieldMismatches,
    )
      ? input.canonicalBusinessFieldMismatches
      : [];

  const metadataEnrichmentDifferences =
    rawCanonicalMismatches.filter(
      (row) =>
        ALLOWED_METADATA_ENRICHMENT_FIELDS.has(
          String(row.field),
        ),
    );

  const trueBusinessMismatches =
    rawCanonicalMismatches.filter(
      (row) =>
        !ALLOWED_METADATA_ENRICHMENT_FIELDS.has(
          String(row.field),
        ),
    );

  assert(
    rawCanonicalMismatches.length === 2,
    `RAW_CANONICAL_MISMATCH_COUNT:${rawCanonicalMismatches.length}`,
  );

  assert(
    metadataEnrichmentDifferences.length === 2,
    `METADATA_ENRICHMENT_DIFF_COUNT:${metadataEnrichmentDifferences.length}`,
  );

  assert(
    trueBusinessMismatches.length === 0,
    `TRUE_BUSINESS_MISMATCH_COUNT:${trueBusinessMismatches.length}`,
  );

  const factorStatusDiff =
    metadataEnrichmentDifferences.find(
      (row) =>
        row.field ===
        'metadata.factor_status',
    );

  const structuralBlockedDiff =
    metadataEnrichmentDifferences.find(
      (row) =>
        row.field ===
        'metadata.structural_factor_blocked',
    );

  assert(
    factorStatusDiff &&
      factorStatusDiff.actual === null &&
      factorStatusDiff.expected ===
        'STRUCTURAL_BLOCKED',
    'FACTOR_STATUS_ENRICHMENT_SHAPE_UNEXPECTED',
  );

  assert(
    structuralBlockedDiff &&
      structuralBlockedDiff.actual === null &&
      structuralBlockedDiff.expected === true,
    'STRUCTURAL_BLOCKED_ENRICHMENT_SHAPE_UNEXPECTED',
  );

  const currentEvent =
    input.currentProductionCanonicalEvent;

  const desired =
    input.desiredCanonicalPayload;

  assert(
    currentEvent &&
      desired,
    'CURRENT_OR_DESIRED_EVENT_MISSING',
  );

  // The historical compatibility contract still requires VALIDATED.
  assert(
    currentEvent.metadata
      ?.canonical_validation_status ===
      'VALIDATED',
    `CURRENT_CANONICAL_STATUS:${currentEvent.metadata?.canonical_validation_status}`,
  );

  assert(
    desired.metadata
      ?.canonical_validation_status ===
      'VALIDATED',
    `DESIRED_CANONICAL_STATUS:${desired.metadata?.canonical_validation_status}`,
  );

  // Core semantics are independently rechecked here.
  const semanticFields = [
    ['stock_code', currentEvent.stock_code, desired.stock_code],
    ['action_type', currentEvent.action_type, desired.action_type],
    ['effective_date', currentEvent.effective_date, desired.effective_date],
    ['provider', currentEvent.provider, desired.provider],
    ['status', currentEvent.status, desired.status],
    ['is_validation', currentEvent.is_validation, false],
    ['production_applied', currentEvent.production_applied, false],
  ];

  const semanticMismatchRows =
    semanticFields
      .filter(([, actual, expected]) =>
        actual !== expected,
      )
      .map(([field, actual, expected]) => ({
        field,
        actual,
        expected,
      }));

  assert(
    semanticMismatchRows.length === 0,
    `SEMANTIC_MISMATCH_COUNT:${semanticMismatchRows.length}`,
  );

  const provenanceDifferences =
    Array.isArray(
      input.canonicalProvenanceDifferences,
    )
      ? input.canonicalProvenanceDifferences
      : [];

  const runProvenanceDifferences =
    Array.isArray(
      input.runProvenanceDifferences,
    )
      ? input.runProvenanceDifferences
      : [];

  assert(
    provenanceDifferences.length >= 1,
    'CANONICAL_PROVENANCE_DIFFERENCE_REQUIRED',
  );

  assert(
    runProvenanceDifferences.length === 1 &&
      runProvenanceDifferences[0].field ===
        'summary.provider_event_ids',
    'RUN_PROVENANCE_DIFFERENCE_UNEXPECTED',
  );

  const eventId =
    String(
      input.identities
        ?.canonicalEventIdPreserved ??
      '',
    );

  const runId =
    String(
      input.identities
        ?.adjustmentRunIdPreserved ??
      '',
    );

  assert(
    eventId.length > 0,
    'CANONICAL_EVENT_ID_MISSING',
  );

  assert(
    runId.length > 0,
    'ADJUSTMENT_RUN_ID_MISSING',
  );

  const desiredMetadata = {
    ...(currentEvent.metadata ?? {}),
    ...(desired.metadata ?? {}),
  };

  const desiredRunSummary = {
    ...(
      input.currentAdjustmentRun
        ?.summary ?? {}
    ),

    event_ids: [
      eventId,
    ],

    provider_event_ids: [
      String(desired.provider_event_id),
    ],

    action_types: [
      String(desired.action_type),
    ],
  };

  const exactPatchPlan = {
    canonicalEvent: {
      table:
        'corporate_action_events',

      rowId:
        eventId,

      preserveId:
        true,

      patchFields: {
        provider_event_id:
          desired.provider_event_id,

        source_fingerprint:
          desired.source_fingerprint,

        metadata:
          desiredMetadata,
      },

      expectedUnchangedBusinessFields: {
        stock_code:
          desired.stock_code,

        action_type:
          desired.action_type,

        effective_date:
          desired.effective_date,

        ratio_from:
          desired.ratio_from ?? null,

        ratio_to:
          desired.ratio_to ?? null,

        cash_amount:
          desired.cash_amount ?? null,

        currency:
          desired.currency ?? null,

        provider:
          desired.provider,

        status:
          desired.status,

        is_validation:
          false,

        production_applied:
          false,
      },
    },

    adjustmentRun: {
      table:
        'corporate_action_adjustment_runs',

      rowId:
        runId,

      preserveId:
        true,

      patchFields: {
        summary:
          desiredRunSummary,
      },

      expectedUnchangedBusinessFields: {
        stock_code:
          '028080',

        version:
          'V9_8_11_PRODUCTION_ADJUSTMENT_V1',

        status:
          'BLOCKED_UNSUPPORTED_ACTION',

        event_count:
          1,

        supported_event_count:
          0,

        unsupported_event_count:
          1,

        factor_count:
          0,

        is_validation:
          false,

        production_applied:
          false,
      },
    },

    factors: {
      changesRequired:
        0,
    },
  };

  const report = {
    status:
      'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN_AFTER_METADATA_RECLASSIFICATION',

    version:
      VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint ?? null,

      historicalCompatibilityRule:
        {
          semanticFieldsMustMatch:
            true,

          canonicalValidationStatusRequired:
            'VALIDATED',

          newerPipelineMetadataKeysRequiredForLegacyCompatibleRow:
            false,
        },
    },

    classification: {
      rawCanonicalMismatchRows:
        rawCanonicalMismatches.length,

      metadataEnrichmentDifferences:
        metadataEnrichmentDifferences.length,

      trueBusinessMismatchRows:
        trueBusinessMismatches.length,

      runBusinessMismatchRows:
        runBusinessMismatches.length,

      factorDependencyRows:
        Number(
          counts.factorRowsReferencingOldEvent,
        ) +
        Number(
          counts.factorRowsReferencingStaleRun,
        ),

      fingerprintCollisionRows:
        Number(
          counts.desiredFingerprintAllScopeRows,
        ),
    },

    metadataEnrichmentDifferences,

    trueBusinessMismatches,

    semanticMismatchRows,

    conclusion: {
      inPlaceRepairBusinessSafe:
        true,

      inPlaceRepairFullyProven:
        true,

      recommendedRepairMode:
        'IN_PLACE_PRESERVE_EVENT_AND_RUN_UUIDS',

      preserveCanonicalEventUuid:
        true,

      preserveAdjustmentRunUuid:
        true,

      factorChangesRequired:
        0,

      insertNewCanonicalEventRequired:
        false,

      deleteOldCanonicalEventRequired:
        false,

      insertNewAdjustmentRunRequired:
        false,

      deleteOldAdjustmentRunRequired:
        false,

      metadataEnrichmentRequired:
        true,
    },

    exactPatchPlan,

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      patchRequests:
        0,

      postRequests:
        0,

      deleteRequests:
        0,

      productionApplied:
        false,
    },

    nextGate:
      'BUILD_DRY_RUN_TWO_ROW_IN_PLACE_REPAIR_PREFLIGHT',

    outputFile:
      'logs/opendart-corporate-action-028080-minimal-repair-proof-v9-8-11-8-3-2-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        classification:
          report.classification,

        conclusion:
          report.conclusion,

        exactPatchPlan:
          report.exactPatchPlan,
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
          report.version,

        ...report.classification,

        metadataEnrichmentDifferences:
          report.metadataEnrichmentDifferences,

        conclusion:
          report.conclusion,

        canonicalEventId:
          eventId,

        adjustmentRunId:
          runId,

        databaseWrites:
          0,

        productionApplied:
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
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'METADATA_RECLASSIFICATION_REPAIR_PROOF_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
