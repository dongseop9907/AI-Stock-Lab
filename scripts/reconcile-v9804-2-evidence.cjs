#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.2 evidence reconciliation report
 *
 * READ-ONLY:
 * - no network
 * - no DB
 * - no production writes
 * - does not modify current V9.8.4.2 output
 *
 * Produces a provenance-aware accounting of the 13 current ambiguous rows.
 *
 * Categories:
 * 1) FIRST_PARTY_HIGH_RESOLUTION
 *    - legacy precision mappings backed by DART reference-date evidence
 *    - Huons mappings backed by locally fetched OpenDART document.xml text
 *
 * 2) EXTERNAL_CORROBORATED_MEDIUM
 *    - Korea Carbon provider-014 corrections whose mapping was corroborated
 *      by a public disclosure mirror linking each correction to its original.
 *    - NOT promoted to first-party HIGH.
 *
 * 3) PARENT_SECURITY_SCOPE_EXCLUDED
 *    - OTHER_ENTITY rows that should not create a parent-security canonical event.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const currentFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

const outputFile = path.join(
  root,
  'logs',
  'v9804-2-evidence-reconciliation.json',
);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8'),
  );
}

const current = readJson(currentFile);

const ambiguousRows = (current.resolutions ?? []).filter(
  (row) => row.resolutionStatus === 'AMBIGUOUS',
);

const byReceipt = new Map(
  ambiguousRows.map(
    (row) => [String(row.receiptNo), row],
  ),
);

const FIRST_PARTY_HIGH = [
  {
    receiptNo: '20260811800009',
    rootReceiptNo: '20260810800458',
    reason: 'LEGACY_PRECISION_REFERENCE_DATE_UNIQUE_ROOT',
    confidence: 'HIGH',
    evidenceSource:
      'V9_8_5 legacy active chain; V9_8_4_2 final precision reason VIEWER_OR_DOCUMENT_REFERENCE_DATE_UNIQUE_ROOT',
  },
  {
    receiptNo: '20260825900206',
    rootReceiptNo: '20260626900506',
    reason: 'LEGACY_PRECISION_CORRECTION_REFERENCE_DATE_CHAIN',
    confidence: 'HIGH',
    evidenceSource:
      'V9_8_5 legacy active chain; V9_8_4_1 precision reason CORRECTION_REFERENCE_DATE_CHAIN',
  },
  {
    receiptNo: '20260831900403',
    rootReceiptNo: '20260731900541',
    reason: 'LEGACY_PRECISION_CORRECTION_REFERENCE_DATE_CHAIN',
    confidence: 'HIGH',
    evidenceSource:
      'V9_8_5 legacy active chain; V9_8_4_1 precision reason CORRECTION_REFERENCE_DATE_CHAIN',
  },

  // Huons Global / Huons Lab merger chain
  {
    receiptNo: '20260804900492',
    rootReceiptNo: '20260518900970',
    reason: 'OPENDART_DOCUMENT_INITIAL_SUBMISSION_DATE_AND_COUNTERPARTY_UNIQUE_ROOT',
    confidence: 'HIGH',
    evidenceSource:
      'OpenDART document.xml text: 최초제출일 2026-05-18 + 휴온스랩 semantic identity',
  },
  {
    receiptNo: '20260826900706',
    rootReceiptNo: '20260518900970',
    reason: 'OPENDART_WITHDRAWAL_DOCUMENT_INITIAL_SUBMISSION_DATE_UNIQUE_ROOT',
    confidence: 'HIGH',
    evidenceSource:
      'OpenDART document.xml text: 최초제출일 2026-05-18 + 휴온스랩 merger withdrawal',
  },
  {
    receiptNo: '20260826900708',
    rootReceiptNo: '20260518900970',
    reason: 'OPENDART_WITHDRAWAL_EXPLICIT_EVENT_DATE_AND_COUNTERPARTY_UNIQUE_ROOT',
    confidence: 'HIGH',
    evidenceSource:
      'OpenDART document.xml text: 2026-05-18 merger decision + 휴온스랩 + explicit withdrawal',
  },
];

const EXTERNAL_MEDIUM = [
  {
    receiptNo: '20260818000018',
    rootReceiptNo: '20260814002685',
    counterparty: '립스',
  },
  {
    receiptNo: '20260818000019',
    rootReceiptNo: '20260814002642',
    counterparty: '한국항공기술케이에이티',
  },
  {
    receiptNo: '20260818000020',
    rootReceiptNo: '20260814002868',
    counterparty: '한국글로벌솔루션',
  },
  {
    receiptNo: '20260818000021',
    rootReceiptNo: '20260814002795',
    counterparty: '에이치씨네트웍스',
  },
].map((row) => ({
  ...row,
  reason:
    'PROVIDER_014_EXTERNAL_ORIGINAL_LINK_AND_COUNTERPARTY_CORROBORATION',
  confidence: 'MEDIUM',
  productionEligible: false,
  evidenceSource:
    'Public disclosure mirror original-link mapping; candidate original identities are backed by local OpenDART document.xml',
}));

const SCOPE_EXCLUDED = [
  {
    receiptNo: '20260812800391',
    reason: 'OTHER_ENTITY_SCOPE_REVIEW',
  },
  {
    receiptNo: '20260828800693',
    reason: 'OTHER_ENTITY_SCOPE_REVIEW',
  },
  {
    receiptNo: '20260928800644',
    reason: 'OTHER_ENTITY_SCOPE_REVIEW',
  },
].map((row) => ({
  ...row,
  disposition:
    'PARENT_SECURITY_SCOPE_EXCLUDED',
  productionEligible: false,
}));

function validateMapping(mapping) {
  const row = byReceipt.get(
    mapping.receiptNo,
  );

  if (!row) {
    return {
      ...mapping,
      validation:
        'CURRENT_AMBIGUOUS_ROW_NOT_FOUND',
      valid: false,
    };
  }

  const plausibleRoots =
    (row.plausibleRoots ?? []).map(String);

  const rootAllowed =
    mapping.rootReceiptNo
      ? plausibleRoots.includes(
          String(mapping.rootReceiptNo),
        )
      : true;

  return {
    ...mapping,
    validation:
      rootAllowed
        ? 'CURRENT_PLAUSIBLE_ROOT_CONFIRMED'
        : 'MAPPED_ROOT_NOT_IN_CURRENT_PLAUSIBLE_ROOTS',
    valid: rootAllowed,
    stockCode:
      row.stockCode ?? null,
    corpCode:
      row.corpCode ?? null,
    actionType:
      row.actionType ?? null,
    gate:
      row.gate ?? null,
    currentPlausibleRoots:
      plausibleRoots,
  };
}

function validateScope(rowDef) {
  const row = byReceipt.get(
    rowDef.receiptNo,
  );

  if (!row) {
    return {
      ...rowDef,
      validation:
        'CURRENT_AMBIGUOUS_ROW_NOT_FOUND',
      valid: false,
    };
  }

  return {
    ...rowDef,
    validation:
      row.otherEntity === true
        ? 'CURRENT_OTHER_ENTITY_CONFIRMED'
        : 'CURRENT_OTHER_ENTITY_NOT_CONFIRMED',
    valid:
      row.otherEntity === true,
    stockCode:
      row.stockCode ?? null,
    corpCode:
      row.corpCode ?? null,
    actionType:
      row.actionType ?? null,
    gate:
      row.gate ?? null,
  };
}

const firstPartyHigh =
  FIRST_PARTY_HIGH.map(
    validateMapping,
  );

const externalMedium =
  EXTERNAL_MEDIUM.map(
    validateMapping,
  );

const parentScopeExcluded =
  SCOPE_EXCLUDED.map(
    validateScope,
  );

const accounted = new Set([
  ...firstPartyHigh.map(
    (row) => row.receiptNo,
  ),
  ...externalMedium.map(
    (row) => row.receiptNo,
  ),
  ...parentScopeExcluded.map(
    (row) => row.receiptNo,
  ),
]);

const unaccounted =
  ambiguousRows
    .filter(
      (row) =>
        !accounted.has(
          String(row.receiptNo),
        ),
    )
    .map(
      (row) => ({
        receiptNo:
          row.receiptNo,
        stockCode:
          row.stockCode,
        corpCode:
          row.corpCode,
        actionType:
          row.actionType,
        gate:
          row.gate,
        plausibleRoots:
          row.plausibleRoots ?? [],
      }),
    );

const invalid = [
  ...firstPartyHigh,
  ...externalMedium,
  ...parentScopeExcluded,
].filter(
  (row) => !row.valid,
);

const report = {
  version:
    'V9_8_4_2_EVIDENCE_RECONCILIATION',
  status:
    invalid.length === 0 &&
    unaccounted.length === 0
      ? 'ALL_CURRENT_AMBIGUITIES_ACCOUNTED'
      : 'RECONCILIATION_REVIEW_REQUIRED',
  sourceVersion:
    current.version ?? null,

  counts: {
    currentAmbiguousRows:
      ambiguousRows.length,
    firstPartyHighResolved:
      firstPartyHigh.length,
    externalCorroboratedMedium:
      externalMedium.length,
    parentSecurityScopeExcluded:
      parentScopeExcluded.length,
    unaccounted:
      unaccounted.length,
    validationFailures:
      invalid.length,
  },

  firstPartyHigh,
  externalMedium,
  parentScopeExcluded,
  unaccounted,
  validationFailures:
    invalid,

  policy: {
    firstPartyHigh:
      'Eligible for next resolver integration after structural validation.',
    externalMedium:
      'Keep provenance and do not promote to HIGH or production solely from mirror evidence.',
    parentSecurityScopeExcluded:
      'Exclude from parent-security canonical event creation; chain identity may remain separately auditable.',
  },

  safety: {
    networkRequests: 0,
    databaseWrites: 0,
    productionApplied: false,
    currentResolutionFileModified: false,
  },
};

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2,
  ),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,
      counts:
        report.counts,
      safety:
        report.safety,
      outputFile:
        path
          .relative(
            root,
            outputFile,
          )
          .replaceAll(
            '\\',
            '/',
          ),
    },
    null,
    2,
  ),
);
