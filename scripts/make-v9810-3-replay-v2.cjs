#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.10.3 replay v2 from scripts/v9810-3-replay.cjs.
 *
 * Purpose:
 * - Preserve existing V9.8.10.3 finalization logic.
 * - Replace the invalid assumption "15/15 review rows resolved by probe"
 *   with repaired lineage:
 *     22 audit-safe
 *     11 exact-probe resolved
 *      4 reconciliation resolved
 *     37 structural total
 *
 * Safety:
 * - no network
 * - no DB writes
 * - no production mutation
 * - generic MERGER/SPIN_OFF factor remains STRUCTURAL_BLOCKED
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9810-3-replay.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9810-3-replay-v2.cjs',
);

function replaceOnce(src, regex, replacement, label) {
  const flags = regex.flags.includes('g')
    ? regex.flags
    : regex.flags + 'g';

  const matches =
    src.match(new RegExp(regex.source, flags)) ?? [];

  if (matches.length !== 1) {
    throw new Error(`${label}_MATCH_COUNT:${matches.length}`);
  }

  return src.replace(regex, replacement);
}

function insertBeforeOnce(src, marker, insertion, label) {
  const first = src.indexOf(marker);
  const last = src.lastIndexOf(marker);

  if (first < 0 || first !== last) {
    throw new Error(
      `${label}_MARKER_COUNT:${first < 0 ? 0 : 2}`,
    );
  }

  return (
    src.slice(0, first) +
    insertion +
    src.slice(first)
  );
}

let src = fs.readFileSync(sourceFile, 'utf8');

// ---------------------------------------------------------------------------
// 1) Explicit replay-v2 version.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /const VERSION\s*=\s*[\r\n\s]*'V9_8_10_3_REPLAY_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';/,
  `const VERSION =\n  'V9_8_10_3_REPLAY_V2_STRUCTURAL_CANONICAL_DATE_FINALIZATION_WITH_RECONCILIATION';`,
  'VERSION',
);

// ---------------------------------------------------------------------------
// 2) Add reconciliation version + corrected expected accounting.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /const PROBE_VERSION\s*=\s*[\r\n\s]*'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';/,
  `const PROBE_VERSION =\n  'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';\n\nconst RECONCILIATION_VERSION =\n  'V9_8_10_2_2_REPLAY_STRUCTURAL_DATE_EVIDENCE_RECONCILIATION';`,
  'PROBE_VERSION',
);

src = replaceOnce(
  src,
  /const EXPECTED_AUDIT_SAFE\s*=\s*22;\s*[\r\n]+const EXPECTED_PROBE_RESOLVED\s*=\s*15;/,
  `const EXPECTED_AUDIT_SAFE = 22;\nconst EXPECTED_REVIEW_TOTAL = 15;\nconst EXPECTED_PROBE_RESOLVED = 11;\nconst EXPECTED_RECONCILED = 4;`,
  'EXPECTED_COUNTS',
);

// ---------------------------------------------------------------------------
// 3) Add reconciliation input and use a new output artifact.
// ---------------------------------------------------------------------------

const outputMarker = `  const outputFile = path.join(`;

src = insertBeforeOnce(
  src,
  outputMarker,
  `  const reconciliationFile = path.join(\n` +
  `    root,\n` +
  `    'logs',\n` +
  `    'opendart-corporate-action-structural-date-reconciliation-v9-8-10-2-2-replay.json',\n` +
  `  );\n\n`,
  'RECONCILIATION_FILE_INSERT',
);

src = src.replaceAll(
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay.json',
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json',
);

// ---------------------------------------------------------------------------
// 4) Include reconciliation in input existence/read/version/status checks.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /for \(const file of \[factorFile,\s*auditFile,\s*probeFile\]\) \{/,
  `for (const file of [\n    factorFile,\n    auditFile,\n    probeFile,\n    reconciliationFile,\n  ]) {`,
  'INPUT_FILES',
);

src = replaceOnce(
  src,
  /const factor = readJson\(factorFile\);\s*[\r\n]+  const audit = readJson\(auditFile\);\s*[\r\n]+  const probe = readJson\(probeFile\);/,
  `const factor = readJson(factorFile);\n` +
  `  const audit = readJson(auditFile);\n` +
  `  const probe = readJson(probeFile);\n` +
  `  const reconciliation = readJson(reconciliationFile);`,
  'READ_INPUTS',
);

const factorStatusMarker =
  `  if (factor.status !== 'PER_EVENT_FACTOR_VALIDATION_COMPLETE') {`;

src = insertBeforeOnce(
  src,
  factorStatusMarker,
  `  if (reconciliation.version !== RECONCILIATION_VERSION) {\n` +
  `    throw new Error('RECONCILIATION_VERSION_MISMATCH');\n` +
  `  }\n\n` +
  `  if (\n` +
  `    reconciliation.status !==\n` +
  `    'STRUCTURAL_DATE_EVIDENCE_RECONCILIATION_COMPLETE'\n` +
  `  ) {\n` +
  `    throw new Error('RECONCILIATION_STAGE_STATUS_UNEXPECTED');\n` +
  `  }\n\n` +
  `  if (!Array.isArray(reconciliation.rows)) {\n` +
  `    throw new Error('RECONCILIATION_ROWS_MISSING');\n` +
  `  }\n\n` +
  `  if (reconciliation.rows.length !== EXPECTED_RECONCILED) {\n` +
  `    throw new Error('RECONCILIATION_ROW_COUNT_MISMATCH');\n` +
  `  }\n\n` +
  `  if (Number(reconciliation.counts?.unresolved ?? 0) !== 0) {\n` +
  `    throw new Error('RECONCILIATION_STILL_UNRESOLVED');\n` +
  `  }\n\n`,
  'RECONCILIATION_VALIDATION_INSERT',
);

// ---------------------------------------------------------------------------
// 5) Build reconciliation map and validate exact 15 = 11 + 4 accounting.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /const probeById = new Map\(\s*[\r\n]+    probe\.rows\.map\(\(row\) => \[row\.providerEventId, row\]\),\s*[\r\n]+  \);/,
  `const probeById = new Map(\n` +
  `    probe.rows.map((row) => [row.providerEventId, row]),\n` +
  `  );\n\n` +
  `  const reconciliationById = new Map(\n` +
  `    reconciliation.rows.map((row) => [\n` +
  `      row.providerEventId,\n` +
  `      row,\n` +
  `    ]),\n` +
  `  );\n\n` +
  `  if (reconciliationById.size !== EXPECTED_RECONCILED) {\n` +
  `    throw new Error('RECONCILIATION_DUPLICATE_PROVIDER_EVENT_IDS');\n` +
  `  }`,
  'RECONCILIATION_MAP',
);

src = replaceOnce(
  src,
  /if \(reviewIds\.size !== EXPECTED_PROBE_RESOLVED\) \{\s*[\r\n]+    throw new Error\('AUDIT_REVIEW_SET_COUNT_MISMATCH'\);\s*[\r\n]+  \}/,
  `if (reviewIds.size !== EXPECTED_REVIEW_TOTAL) {\n` +
  `    throw new Error('AUDIT_REVIEW_SET_COUNT_MISMATCH');\n` +
  `  }\n\n` +
  `  for (const reconciliationRow of reconciliation.rows) {\n` +
  `    if (!reviewIds.has(reconciliationRow.providerEventId)) {\n` +
  `      throw new Error(\n` +
  `        \`RECONCILIATION_TARGET_NOT_IN_REVIEW_SET:\${reconciliationRow.providerEventId}\`,\n` +
  `      );\n` +
  `    }\n\n` +
  `    const probeRow =\n` +
  `      probeById.get(reconciliationRow.providerEventId);\n\n` +
  `    if (!probeRow) {\n` +
  `      throw new Error(\n` +
  `        \`RECONCILIATION_PROBE_ROW_MISSING:\${reconciliationRow.providerEventId}\`,\n` +
  `      );\n` +
  `    }\n\n` +
  `    if (\n` +
  `      probeRow.strongestCandidate != null ||\n` +
  `      probeRow.candidateBasis != null\n` +
  `    ) {\n` +
  `      throw new Error(\n` +
  `        \`RECONCILIATION_TARGET_ALREADY_PROBE_RESOLVED:\${reconciliationRow.providerEventId}\`,\n` +
  `      );\n` +
  `    }\n` +
  `  }`,
  'REVIEW_ACCOUNTING',
);

// ---------------------------------------------------------------------------
// 6) Replace only the review-resolution branch.
//    - allowed exact probe basis -> existing probe provenance
//    - otherwise -> require explicit V9.8.10.2.2 reconciliation row
// ---------------------------------------------------------------------------

const reviewBranchRegex =
  /if \(reviewIds\.has\(row\.providerEventId\)\) \{[\s\S]*?    \} else \{\s*[\r\n]+      if \(auditRow\.safeToPromoteInNextStage !== true\) \{/;

const reviewBranchReplacement =
`if (reviewIds.has(row.providerEventId)) {
      const probeRow = probeById.get(row.providerEventId);

      if (!probeRow) {
        throw new Error(
          \`PROBE_ROW_MISSING:\${row.providerEventId}\`,
        );
      }

      if (
        ALLOWED_PROBE_BASES.has(
          probeRow.candidateBasis,
        )
      ) {
        if (!isIsoDate(probeRow.strongestCandidate)) {
          throw new Error(
            \`PROBE_DATE_INVALID:\${row.providerEventId}\`,
          );
        }

        effectiveDate = probeRow.strongestCandidate;
        resolutionBasis = probeRow.candidateBasis;

        evidence = {
          resolutionSource:
            'V9_8_10_2_1_EXACT_PROBE',

          previousPrimaryDateCandidate:
            probeRow.previousPrimaryDateCandidate ?? null,

          previousChronologyWarnings:
            probeRow.previousChronologyWarnings ?? [],

          structuredSourceConsensus:
            probeRow.structuredProbe
              ?.sourcePrimaryDateConsensus ?? null,

          structuredRootConsensus:
            probeRow.structuredProbe
              ?.rootPrimaryDateConsensus ?? null,

          xmlPrimaryDateDistinctDates:
            probeRow.documentProbe
              ?.primaryDateDistinctDates ?? [],

          sourceReceiptNo:
            row.sourceReceiptNo,
        };
      } else {
        const reconciliationRow =
          reconciliationById.get(row.providerEventId);

        if (!reconciliationRow) {
          throw new Error(
            \`RECONCILIATION_ROW_MISSING_FOR_UNRESOLVED_PROBE:\${row.providerEventId}\`,
          );
        }

        if (!isIsoDate(reconciliationRow.effectiveDate)) {
          throw new Error(
            \`RECONCILIATION_DATE_INVALID:\${row.providerEventId}\`,
          );
        }

        if (
          !['HIGH', 'MEDIUM'].includes(
            reconciliationRow.confidence,
          )
        ) {
          throw new Error(
            \`RECONCILIATION_CONFIDENCE_NOT_ALLOWED:\${row.providerEventId}\`,
          );
        }

        effectiveDate = reconciliationRow.effectiveDate;
        resolutionBasis =
          \`RECONCILIATION_\${reconciliationRow.reconciliationBasis}\`;

        evidence = {
          resolutionSource:
            'V9_8_10_2_2_RECONCILIATION',

          reconciliationConfidence:
            reconciliationRow.confidence,

          reconciliationBasis:
            reconciliationRow.reconciliationBasis,

          reconciliationProvenance:
            reconciliationRow.provenance ?? null,

          priorProbe:
            reconciliationRow.priorProbe ?? null,

          sourceReceiptNo:
            row.sourceReceiptNo,
        };
      }
    } else {
      if (auditRow.safeToPromoteInNextStage !== true) {`;

src = replaceOnce(
  src,
  reviewBranchRegex,
  reviewBranchReplacement,
  'REVIEW_BRANCH',
);

// ---------------------------------------------------------------------------
// 7) Correct accounting of 11 exact-probe + 4 reconciliation.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /const probeResolvedRows = finalized\.filter\(\s*[\r\n]+    \(row\) =>\s*[\r\n]+      row\.resolutionBasis !==\s*[\r\n]+      'AUDIT_SAFE_PRIMARY_STRUCTURAL_DATE',\s*[\r\n]+  \);/,
  `const probeResolvedRows = finalized.filter(\n` +
  `    (row) => ALLOWED_PROBE_BASES.has(row.resolutionBasis),\n` +
  `  );\n\n` +
  `  const reconciliationResolvedRows = finalized.filter(\n` +
  `    (row) =>\n` +
  `      String(row.resolutionBasis ?? '').startsWith(\n` +
  `        'RECONCILIATION_',\n` +
  `      ),\n` +
  `  );`,
  'RESOLUTION_ACCOUNTING',
);

src = replaceOnce(
  src,
  /auditSafeRows\.length === EXPECTED_AUDIT_SAFE &&\s*[\r\n]+    probeResolvedRows\.length === EXPECTED_PROBE_RESOLVED &&/,
  `auditSafeRows.length === EXPECTED_AUDIT_SAFE &&\n` +
  `    probeResolvedRows.length === EXPECTED_PROBE_RESOLVED &&\n` +
  `    reconciliationResolvedRows.length === EXPECTED_RECONCILED &&`,
  'STATUS_ACCOUNTING',
);

// ---------------------------------------------------------------------------
// 8) Add reconciliation provenance to report.source.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /probeFingerprint:\s*[\r\n]+        probe\.outputFingerprint,\s*[\r\n]+    \},/,
  `probeFingerprint:\n` +
  `        probe.outputFingerprint,\n\n` +
  `      reconciliationVersion:\n` +
  `        reconciliation.version,\n` +
  `      reconciliationFingerprint:\n` +
  `        reconciliation.outputFingerprint,\n` +
  `    },`,
  'REPORT_SOURCE',
);

// ---------------------------------------------------------------------------
// 9) Split counts in report.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /precisionProbePromotedPreview:\s*[\r\n]+        probeResolvedRows\.length,/,
  `precisionProbePromotedPreview:\n` +
  `        probeResolvedRows.length,\n\n` +
  `      reconciliationPromotedPreview:\n` +
  `        reconciliationResolvedRows.length,`,
  'REPORT_COUNTS',
);

// ---------------------------------------------------------------------------
// 10) Add reconciliation policy statement.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /reviewRows:\s*[\r\n]+        'USE_EXACT_STRUCTURED_SOURCE_OR_CANONICAL_ROOT_RECEIPT_DATE',/,
  `reviewRows:\n` +
  `        'USE_EXACT_PROBE_OR_EXPLICIT_RECONCILIATION_WITH_PROVENANCE',\n\n` +
  `      reconciliationRows:\n` +
  `        '4_ROWS_ONLY_FROM_V9_8_10_2_2_RECONCILIATION_HIGH_OR_MEDIUM_PROVENANCE',`,
  'REPORT_POLICY',
);

// ---------------------------------------------------------------------------
// 11) Include reconciliation fingerprint in deterministic output fingerprint.
// ---------------------------------------------------------------------------

src = replaceOnce(
  src,
  /probeFingerprint:\s*[\r\n]+        report\.source\.probeFingerprint,\s*[\r\n]+      rows:/,
  `probeFingerprint:\n` +
  `        report.source.probeFingerprint,\n` +
  `      reconciliationFingerprint:\n` +
  `        report.source.reconciliationFingerprint,\n` +
  `      rows:`,
  'OUTPUT_FINGERPRINT',
);

fs.writeFileSync(outputFile, src, 'utf8');

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_10_3_REPLAY_V2_BUILT',

      version:
        'V9_8_10_3_REPLAY_V2_STRUCTURAL_CANONICAL_DATE_FINALIZATION_WITH_RECONCILIATION',

      lineage: {
        auditSafe: 22,
        exactProbe: 11,
        reconciliation: 4,
        structuralTotal: 37,
      },

      reconciliationInput:
        'logs/opendart-corporate-action-structural-date-reconciliation-v9-8-10-2-2-replay.json',

      output:
        'logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json',

      script:
        'scripts/v9810-3-replay-v2.cjs',

      safety: {
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
        genericStructuralFactorStillBlocked: true,
      },
    },
    null,
    2,
  ),
);
