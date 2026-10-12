/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.10.1 - Structural canonical-date audit
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json
 *
 * Why this gate exists:
 *   corporate_action_events.effective_date is NOT NULL.
 *
 *   MERGER / SPIN_OFF are blocked from generic factor computation, but they
 *   still need a canonical event date before production persistence.
 *
 * Canonical structural-date candidates:
 *   MERGER   -> mergerDate (합병기일)
 *   SPIN_OFF -> splitDate  (분할기일 / 분할합병기일)
 *
 * This script only audits. It does NOT promote dates into canonicalPreview.
 *
 * Run:
 *   node .\scripts\v9810-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_1_REPLAY_STRUCTURAL_CANONICAL_DATE_AUDIT';

const INPUT_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const EXPECTED_STRUCTURAL =
  37;

const EXPECTED_MERGER =
  33;

const EXPECTED_SPIN_OFF =
  4;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(temp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(selector(row) ?? 'NULL');

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
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

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',
    );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(inputFile);

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
    'PER_EVENT_FACTOR_VALIDATION_COMPLETE'
  ) {
    throw new Error(
      'FACTOR_VALIDATION_NOT_COMPLETE',
    );
  }

  if (
    !Array.isArray(
      input.results,
    )
  ) {
    throw new Error(
      'INPUT_RESULTS_MISSING',
    );
  }

  const structural =
    input.results.filter(
      (row) =>
        row.factorValidation
          ?.status ===
        'STRUCTURAL_BLOCKED',
    );

  if (
    structural.length !==
    EXPECTED_STRUCTURAL
  ) {
    throw new Error(
      'STRUCTURAL_COUNT_MISMATCH',
    );
  }

  const mergerCount =
    structural.filter(
      (row) =>
        row.actionType ===
        'MERGER',
    ).length;

  const spinOffCount =
    structural.filter(
      (row) =>
        row.actionType ===
        'SPIN_OFF',
    ).length;

  if (
    mergerCount !==
      EXPECTED_MERGER ||
    spinOffCount !==
      EXPECTED_SPIN_OFF
  ) {
    throw new Error(
      'STRUCTURAL_ACTION_TYPE_COUNT_MISMATCH',
    );
  }

  const rows =
    structural
      .map(
        (row) => {
          const facts =
            row.parsed
              ?.facts ??
            {};

          const candidate =
            row.actionType ===
            'MERGER'
              ? (
                  facts.mergerDate ??
                  null
                )
              : (
                  facts.splitDate ??
                  null
                );

          const primaryField =
            row.actionType ===
            'MERGER'
              ? 'mergerDate'
              : 'splitDate';

          const candidateReady =
            isIsoDate(
              candidate,
            );

          const boardDecisionDate =
            isIsoDate(
              facts.boardDecisionDate,
            )
              ? facts.boardDecisionDate
              : null;

          const registrationDate =
            isIsoDate(
              facts.registrationDate,
            )
              ? facts.registrationDate
              : null;

          const newListingDate =
            isIsoDate(
              facts.newListingDate,
            )
              ? facts.newListingDate
              : null;

          const chronologyWarnings =
            [];

          if (
            candidateReady &&
            boardDecisionDate &&
            boardDecisionDate >
              candidate
          ) {
            chronologyWarnings.push(
              'BOARD_DECISION_AFTER_PRIMARY_DATE',
            );
          }

          if (
            candidateReady &&
            registrationDate &&
            registrationDate <
              candidate
          ) {
            chronologyWarnings.push(
              'REGISTRATION_BEFORE_PRIMARY_DATE',
            );
          }

          if (
            candidateReady &&
            newListingDate &&
            newListingDate <
              candidate
          ) {
            chronologyWarnings.push(
              'LISTING_BEFORE_PRIMARY_DATE',
            );
          }

          const sourceReceiptDate =
            row.sourceReceiptDate ??
            null;

          const sourceAfterPrimary =
            candidateReady &&
            /^\d{8}$/.test(
              String(
                sourceReceiptDate ??
                '',
              ),
            )
              ? (
                  `${String(sourceReceiptDate).slice(0, 4)}-` +
                  `${String(sourceReceiptDate).slice(4, 6)}-` +
                  `${String(sourceReceiptDate).slice(6, 8)}` >
                  candidate
                )
              : null;

          return {
            providerEventId:
              row.providerEventId,

            sourceReceiptNo:
              row.sourceReceiptNo,

            sourceReceiptDate,

            stockCode:
              row.stockCode,

            corpCode:
              row.corpCode,

            actionType:
              row.actionType,

            sourceKind:
              row.sourceKind,

            parserStatus:
              row.parsed
                ?.status ??
              null,

            factorBlockReason:
              row.factorValidation
                ?.reason ??
              null,

            primaryDateField:
              primaryField,

            primaryDateCandidate:
              candidateReady
                ? candidate
                : null,

            candidateStatus:
              candidateReady
                ? 'STRUCTURAL_DATE_CANDIDATE_READY'
                : 'STRUCTURAL_DATE_CANDIDATE_MISSING',

            facts: {
              boardDecisionDate,
              mergerDate:
                isIsoDate(
                  facts.mergerDate,
                )
                  ? facts.mergerDate
                  : null,

              splitDate:
                isIsoDate(
                  facts.splitDate,
                )
                  ? facts.splitDate
                  : null,

              registrationDate,
              newListingDate,
            },

            chronologyWarnings,

            sourceReceiptAfterPrimaryDate:
              sourceAfterPrimary,

            canonicalPreviewEffectiveDateBeforeAudit:
              row.canonicalPreview
                ?.effective_date ??
              null,

            safeToPromoteInNextStage:
              candidateReady &&
              chronologyWarnings.length ===
                0,
          };
        },
      )
      .sort(
        (a, b) =>
          [
            a.actionType,
            a.stockCode,
            a.providerEventId,
          ]
            .join('|')
            .localeCompare(
              [
                b.actionType,
                b.stockCode,
                b.providerEventId,
              ].join('|'),
            ),
      );

  const readyRows =
    rows.filter(
      (row) =>
        row.candidateStatus ===
        'STRUCTURAL_DATE_CANDIDATE_READY',
    );

  const missingRows =
    rows.filter(
      (row) =>
        row.candidateStatus ===
        'STRUCTURAL_DATE_CANDIDATE_MISSING',
    );

  const warningRows =
    rows.filter(
      (row) =>
        row.chronologyWarnings.length >
        0,
    );

  const prepopulatedCanonicalDates =
    rows.filter(
      (row) =>
        row.canonicalPreviewEffectiveDateBeforeAudit !==
        null,
    );

  const safeRows =
    rows.filter(
      (row) =>
        row.safeToPromoteInNextStage,
    );

  const status =
    prepopulatedCanonicalDates.length >
      0
      ? 'STRUCTURAL_DATE_AUDIT_INVALID'
      : missingRows.length ===
          0 &&
        warningRows.length ===
          0
        ? 'STRUCTURAL_DATE_AUDIT_COMPLETE'
        : 'STRUCTURAL_DATE_AUDIT_COMPLETE_WITH_REVIEW';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    counts: {
      structuralRows:
        rows.length,

      mergerRows:
        rows.filter(
          (row) =>
            row.actionType ===
            'MERGER',
        ).length,

      spinOffRows:
        rows.filter(
          (row) =>
            row.actionType ===
            'SPIN_OFF',
        ).length,

      primaryDateCandidatesReady:
        readyRows.length,

      primaryDateCandidatesMissing:
        missingRows.length,

      chronologyWarningRows:
        warningRows.length,

      safeToPromote:
        safeRows.length,

      prepopulatedCanonicalDates:
        prepopulatedCanonicalDates.length,
    },

    candidateStatusCounts:
      countBy(
        rows,
        (row) =>
          row.candidateStatus,
      ),

    readyByActionType:
      countBy(
        readyRows,
        (row) =>
          row.actionType,
      ),

    missingByActionType:
      countBy(
        missingRows,
        (row) =>
          row.actionType,
      ),

    chronologyWarningCounts:
      countBy(
        warningRows.flatMap(
          (row) =>
            row.chronologyWarnings.map(
              (warning) => ({
                warning,
              }),
            ),
        ),
        (row) =>
          row.warning,
      ),

    reviewQueue:
      rows
        .filter(
          (row) =>
            !row.safeToPromoteInNextStage,
        )
        .map(
          (row) => ({
            providerEventId:
              row.providerEventId,

            sourceReceiptNo:
              row.sourceReceiptNo,

            stockCode:
              row.stockCode,

            actionType:
              row.actionType,

            sourceKind:
              row.sourceKind,

            parserStatus:
              row.parserStatus,

            primaryDateField:
              row.primaryDateField,

            primaryDateCandidate:
              row.primaryDateCandidate,

            facts:
              row.facts,

            chronologyWarnings:
              row.chronologyWarnings,
          }),
        ),

    rows,

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      structuralEffectiveDatesPromoted:
        0,

      factorsComputed:
        0,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      mergerCanonicalDate:
        'MERGER_DATE_합병기일',

      spinOffCanonicalDate:
        'SPLIT_DATE_분할기일_OR_분할합병기일',

      genericFactor:
        'STRUCTURAL_ACTIONS_REMAIN_BLOCKED',

      persistence:
        'NO_WRITES_AND_NO_DATE_PROMOTION_IN_V9_8_10_1',
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

        inputFingerprint:
          report.source.inputFingerprint,

        rows:
          rows.map(
            (row) => [
              row.providerEventId,
              row.actionType,
              row.primaryDateField,
              row.primaryDateCandidate,
              row.chronologyWarnings,
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

        candidateStatusCounts:
          report.candidateStatusCounts,

        readyByActionType:
          report.readyByActionType,

        missingByActionType:
          report.missingByActionType,

        chronologyWarningCounts:
          report.chronologyWarningCounts,

        reviewQueue:
          report.reviewQueue,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        structuralEffectiveDatesPromoted:
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
    'STRUCTURAL_DATE_AUDIT_INVALID'
  ) {
    process.exitCode =
      2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(
      error?.message ??
      error,
    ),
  );

  process.exitCode =
    1;
}
