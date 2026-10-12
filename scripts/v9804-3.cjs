#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.3 - First-party chain evidence integration
 *
 * Purpose
 * - Derive a new chain-resolution file from V9.8.4.2.
 * - Promote ONLY first-party HIGH-confidence reconciled mappings.
 * - Keep Korea Carbon external-mirror corroboration as AMBIGUOUS/MEDIUM metadata.
 * - Keep OTHER_ENTITY rows out of parent-security canonical use without forcing a root.
 *
 * Safety
 * - no network
 * - no DB
 * - no production writes
 * - never modifies V9.8.4.2 in place
 *
 * Inputs
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *   logs/v9804-2-evidence-reconciliation.json
 *
 * Output
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-3.json
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const INPUT = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

const RECON = path.join(
  root,
  'logs',
  'v9804-2-evidence-reconciliation.json',
);

const OUTPUT = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-3.json',
);

const VERSION =
  'V9_8_4_3_FIRST_PARTY_CHAIN_EVIDENCE_INTEGRATION';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8'),
  );
}

function countBy(rows, getter) {
  const out = {};

  for (const row of rows) {
    const key = getter(row);
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }

  return out;
}

const input = readJson(INPUT);
const recon = readJson(RECON);

if (
  input.version !==
  'V9_8_4_2_OPENDART_TARGET_CLASSIFICATION_CONSISTENCY_FIX'
) {
  throw new Error(
    `INPUT_VERSION_MISMATCH:${input.version}`,
  );
}

if (
  recon.version !==
  'V9_8_4_2_EVIDENCE_RECONCILIATION'
) {
  throw new Error(
    `RECONCILIATION_VERSION_MISMATCH:${recon.version}`,
  );
}

if (
  recon.status !==
  'ALL_CURRENT_AMBIGUITIES_ACCOUNTED'
) {
  throw new Error(
    `RECONCILIATION_NOT_READY:${recon.status}`,
  );
}

if (
  Number(recon.counts?.validationFailures ?? -1) !== 0 ||
  Number(recon.counts?.unaccounted ?? -1) !== 0
) {
  throw new Error(
    'RECONCILIATION_HAS_VALIDATION_FAILURES_OR_UNACCOUNTED_ROWS',
  );
}

const highMap = new Map(
  (recon.firstPartyHigh ?? []).map(
    (row) => [String(row.receiptNo), row],
  ),
);

const externalMap = new Map(
  (recon.externalMedium ?? []).map(
    (row) => [String(row.receiptNo), row],
  ),
);

const scopeMap = new Map(
  (recon.parentScopeExcluded ?? []).map(
    (row) => [String(row.receiptNo), row],
  ),
);

let promotedFirstPartyHigh = 0;
let annotatedExternalMedium = 0;
let annotatedParentScopeExcluded = 0;

const resolutions = (input.resolutions ?? []).map(
  (sourceRow) => {
    const row = structuredClone(sourceRow);
    const receiptNo = String(row.receiptNo);

    const high = highMap.get(receiptNo);
    if (high) {
      if (row.resolutionStatus !== 'AMBIGUOUS') {
        throw new Error(
          `HIGH_MAPPING_TARGET_NOT_AMBIGUOUS:${receiptNo}:${row.resolutionStatus}`,
        );
      }

      const plausibleRoots =
        (row.plausibleRoots ?? []).map(String);

      if (
        !plausibleRoots.includes(
          String(high.rootReceiptNo),
        )
      ) {
        throw new Error(
          `HIGH_MAPPING_ROOT_NOT_PLAUSIBLE:${receiptNo}:${high.rootReceiptNo}`,
        );
      }

      row.resolutionStatus = 'RESOLVED';
      row.rootReceiptNo = high.rootReceiptNo;
      row.resolutionReason = high.reason;
      row.confidence = 'HIGH';

      row.evidenceIntegration = {
        sourceStage: VERSION,
        provenance: 'FIRST_PARTY',
        confidence: 'HIGH',
        evidenceSource:
          high.evidenceSource ?? null,
        productionEligibility:
          'CHAIN_MAPPING_ELIGIBLE_FOR_NEXT_STAGE_ONLY',
      };

      promotedFirstPartyHigh += 1;
      return row;
    }

    const external = externalMap.get(receiptNo);
    if (external) {
      /*
       * Intentionally do not resolve provider-014 Korea Carbon rows
       * from mirror evidence alone.
       */
      row.externalCorroboration = {
        sourceStage: VERSION,
        proposedRootReceiptNo:
          external.rootReceiptNo,
        counterparty:
          external.counterparty ?? null,
        reason:
          external.reason ?? null,
        confidence: 'MEDIUM',
        provenance: 'EXTERNAL_PUBLIC_DISCLOSURE_MIRROR',
        productionEligible: false,
        disposition:
          'KEEP_AMBIGUOUS_PENDING_FIRST_PARTY_CONFIRMATION',
      };

      annotatedExternalMedium += 1;
      return row;
    }

    const scope = scopeMap.get(receiptNo);
    if (scope) {
      /*
       * Scope exclusion is a downstream disposition, not proof of a
       * unique chain root. Keep the chain row ambiguous.
       */
      row.downstreamDisposition = {
        sourceStage: VERSION,
        disposition:
          'PARENT_SECURITY_SCOPE_EXCLUDED',
        reason:
          scope.reason ?? 'OTHER_ENTITY_SCOPE_REVIEW',
        productionEligibleForParentSecurity: false,
        chainRootStillRequiredForIndependentAudit: true,
      };

      annotatedParentScopeExcluded += 1;
      return row;
    }

    return row;
  },
);

if (
  promotedFirstPartyHigh !==
  Number(recon.counts?.firstPartyHighResolved ?? -1)
) {
  throw new Error(
    `PROMOTION_COUNT_MISMATCH:${promotedFirstPartyHigh}:${recon.counts?.firstPartyHighResolved}`,
  );
}

if (
  annotatedExternalMedium !==
  Number(recon.counts?.externalCorroboratedMedium ?? -1)
) {
  throw new Error(
    `EXTERNAL_COUNT_MISMATCH:${annotatedExternalMedium}:${recon.counts?.externalCorroboratedMedium}`,
  );
}

if (
  annotatedParentScopeExcluded !==
  Number(recon.counts?.parentSecurityScopeExcluded ?? -1)
) {
  throw new Error(
    `SCOPE_COUNT_MISMATCH:${annotatedParentScopeExcluded}:${recon.counts?.parentSecurityScopeExcluded}`,
  );
}

const resolvedRows = resolutions.filter(
  (row) => row.resolutionStatus === 'RESOLVED',
);

const ambiguousRows = resolutions.filter(
  (row) => row.resolutionStatus === 'AMBIGUOUS',
);

const unresolvedRows = resolutions.filter(
  (row) => row.resolutionStatus === 'UNRESOLVED',
);

const highRows = resolvedRows.filter(
  (row) => row.confidence === 'HIGH',
);

const mediumRows = resolvedRows.filter(
  (row) => row.confidence === 'MEDIUM',
);

const lowRows = resolvedRows.filter(
  (row) => row.confidence === 'LOW',
);

const correctionRows = resolutions.filter(
  (row) => row.correction === true,
);

const withdrawalRows = resolutions.filter(
  (row) => row.withdrawal === true,
);

const selfRootOriginals = resolvedRows.filter(
  (row) =>
    row.rootReceiptNo != null &&
    String(row.rootReceiptNo) ===
      String(row.receiptNo),
).length;

const resolutionReasonCounts = countBy(
  resolutions,
  (row) =>
    row.resolutionStatus === 'RESOLVED'
      ? row.resolutionReason
      : row.resolutionReason,
);

const confidenceCounts = {
  HIGH: highRows.length,
  MEDIUM: mediumRows.length,
  LOW: lowRows.length,
  NONE:
    resolutions.filter(
      (row) =>
        row.resolutionStatus !== 'RESOLVED',
    ).length,
};

const output = {
  ...input,

  status:
    ambiguousRows.length > 0 ||
    unresolvedRows.length > 0
      ? 'CHAIN_RESOLUTION_REVIEW_REQUIRED'
      : 'CHAIN_RESOLUTION_COMPLETE',

  version: VERSION,

  source: {
    ...(input.source ?? {}),
    parentVersion:
      input.version,
    reconciliationVersion:
      recon.version,
    policy:
      'PROMOTE_FIRST_PARTY_HIGH_ONLY_EXTERNAL_MEDIUM_REMAINS_AMBIGUOUS',
  },

  chainTargets:
    resolutions.length,

  resolved:
    resolvedRows.length,

  ambiguous:
    ambiguousRows.length,

  unresolved:
    unresolvedRows.length,

  highConfidence:
    highRows.length,

  mediumConfidence:
    mediumRows.length,

  lowConfidence:
    lowRows.length,

  correctionTargets:
    correctionRows.length,

  correctionResolved:
    correctionRows.filter(
      (row) =>
        row.resolutionStatus === 'RESOLVED',
    ).length,

  withdrawalTargets:
    withdrawalRows.length,

  withdrawalResolved:
    withdrawalRows.filter(
      (row) =>
        row.resolutionStatus === 'RESOLVED',
    ).length,

  selfRootOriginals,

  resolutionReasonCounts,
  confidenceCounts,

  evidenceIntegrationSummary: {
    promotedFirstPartyHigh,
    annotatedExternalMedium,
    annotatedParentScopeExcluded,

    remainingAmbiguous: {
      total: ambiguousRows.length,
      externalCorroboratedPendingFirstParty:
        ambiguousRows.filter(
          (row) =>
            row.externalCorroboration != null,
        ).length,
      parentSecurityScopeExcluded:
        ambiguousRows.filter(
          (row) =>
            row.downstreamDisposition?.disposition ===
            'PARENT_SECURITY_SCOPE_EXCLUDED',
        ).length,
    },
  },

  networkRequests: 0,
  databaseWrites: 0,
  productionApplied: false,
  canonicalEventsCreated: 0,
  providerEventIdsPersisted: 0,
  coverageWindowAdvanced: false,

  outputFile:
    'logs/opendart-corporate-action-chain-resolution-v9-8-4-3.json',

  resolutions,
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    output,
    null,
    2,
  ),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        output.status,
      version:
        output.version,
      chainTargets:
        output.chainTargets,
      resolved:
        output.resolved,
      ambiguous:
        output.ambiguous,
      unresolved:
        output.unresolved,
      highConfidence:
        output.highConfidence,
      mediumConfidence:
        output.mediumConfidence,
      lowConfidence:
        output.lowConfidence,
      correctionTargets:
        output.correctionTargets,
      correctionResolved:
        output.correctionResolved,
      withdrawalTargets:
        output.withdrawalTargets,
      withdrawalResolved:
        output.withdrawalResolved,
      selfRootOriginals:
        output.selfRootOriginals,
      evidenceIntegrationSummary:
        output.evidenceIntegrationSummary,
      networkRequests: 0,
      databaseWrites: 0,
      productionApplied: false,
      outputFile:
        output.outputFile,
    },
    null,
    2,
  ),
);
