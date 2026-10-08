'use strict';

/**
 * AI Stock Lab
 * V9.8.3.1 - OpenDART provider-status 014 evidence disposition
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3.json
 *
 * Output:
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Purpose:
 *   V9.8.3 treated any missing document.xml ZIP as EVIDENCE_FAILED.
 *   We proved that all current 32 failures are:
 *
 *     HTTP 200
 *     providerStatus = 014
 *     DOCUMENT_SOURCE_UNAVAILABLE
 *
 *   OpenDART is therefore explicitly reporting that the source file is not
 *   available for those receipts. Re-fetching the same receipt is not the
 *   right recovery strategy.
 *
 * This stage:
 *   - preserves all 244 ZIP-backed evidence rows
 *   - reclassifies provider-014 rows as deferred evidence, not transport failure
 *   - identifies which rows have structured fallback data
 *   - identifies which rows must be resolved through correction/withdrawal chain
 *   - never declares a 014 row canonical-ready by itself
 *
 * Run:
 *   node .\scripts\v9803-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const INPUT_VERSION =
  'V9_8_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR';

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    input: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      out.input =
        arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output =
        arg.slice('--output='.length);
      continue;
    }

    throw new Error('UNKNOWN_OPTION');
  }

  return out;
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function countBy(rows, selector) {
  const counts = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    counts[key] =
      (counts[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function classify(row) {
  const docStatus =
    row?.document?.status ?? null;

  const providerStatus =
    row?.document?.providerStatus ?? null;

  const httpStatus =
    row?.document?.httpStatus ?? null;

  const hasZip =
    docStatus ===
    'DOCUMENT_ZIP_RECEIVED';

  const provider014 =
    docStatus ===
      'DOCUMENT_SOURCE_UNAVAILABLE' &&
    providerStatus ===
      '014' &&
    Number(httpStatus) ===
      200;

  const structuredStatus =
    row?.structured?.status ??
    null;

  const hasStructuredData =
    structuredStatus ===
    'STRUCTURED_DATA_RECEIVED';

  const hasStructuredNoData =
    structuredStatus ===
    'STRUCTURED_NO_DATA';

  const structuredExactReceiptMatches =
    Number(
      row?.structuredExactReceiptMatches ??
      0,
    );

  const needsChainLookup =
    Boolean(
      row?.needsChainLookup,
    );

  if (hasZip) {
    return {
      ...row,

      evidenceDisposition:
        'PRIMARY_DOCUMENT_EVIDENCE_READY',

      evidenceUsableForNextStage:
        true,

      retryDocumentXml:
        false,

      chainResolutionRequired:
        needsChainLookup,

      structuredFallbackAvailable:
        hasStructuredData,

      canonicalReadyFromThisStage:
        false,
    };
  }

  if (provider014) {
    if (needsChainLookup) {
      return {
        ...row,

        status:
          'EVIDENCE_DEFERRED_PROVIDER_014',

        error:
          null,

        evidenceDisposition:
          hasStructuredData
            ? 'PROVIDER_014_CHAIN_RESOLUTION_WITH_STRUCTURED_FALLBACK'
            : hasStructuredNoData
              ? 'PROVIDER_014_CHAIN_RESOLUTION_WITH_STRUCTURED_NO_DATA'
              : 'PROVIDER_014_CHAIN_RESOLUTION_REQUIRED',

        evidenceUsableForNextStage:
          true,

        retryDocumentXml:
          false,

        chainResolutionRequired:
          true,

        structuredFallbackAvailable:
          hasStructuredData,

        canonicalReadyFromThisStage:
          false,

        provider014Evidence: {
          httpStatus,
          providerStatus,
          documentStatus:
            docStatus,

          structuredStatus,

          structuredExactReceiptMatches,

          policy:
            'DO_NOT_RETRY_SAME_DOCUMENT_XML_RECEIPT; RESOLVE_CHAIN_OR_USE_STRUCTURED_FALLBACK',
        },
      };
    }

    return {
      ...row,

      status:
        'EVIDENCE_DEFERRED_PROVIDER_014',

      error:
        null,

      evidenceDisposition:
        hasStructuredData
          ? 'PROVIDER_014_STRUCTURED_FALLBACK_REQUIRES_IDENTITY_RESOLUTION'
          : hasStructuredNoData
            ? 'PROVIDER_014_STRUCTURED_NO_DATA_UNRESOLVED'
            : 'PROVIDER_014_NO_ALTERNATE_EVIDENCE_UNRESOLVED',

      evidenceUsableForNextStage:
        hasStructuredData,

      retryDocumentXml:
        false,

      chainResolutionRequired:
        true,

      structuredFallbackAvailable:
        hasStructuredData,

      canonicalReadyFromThisStage:
        false,

      provider014Evidence: {
        httpStatus,
        providerStatus,
        documentStatus:
          docStatus,

        structuredStatus,

        structuredExactReceiptMatches,

        policy:
          'DO_NOT_RETRY_SAME_DOCUMENT_XML_RECEIPT; RESOLVE_IDENTITY_BEFORE_CANONICALIZATION',
      },
    };
  }

  return {
    ...row,

    evidenceDisposition:
      'UNEXPECTED_EVIDENCE_FAILURE',

    evidenceUsableForNextStage:
      false,

    retryDocumentXml:
      true,

    chainResolutionRequired:
      Boolean(
        row?.needsChainLookup,
      ),

    structuredFallbackAvailable:
      hasStructuredData,

    canonicalReadyFromThisStage:
      false,
  };
}

function main() {
  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.resolve(
      args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      ),
    );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      'V9_8_3_INPUT_NOT_FOUND',
    );
  }

  const source =
    JSON.parse(
      fs
        .readFileSync(
          inputFile,
          'utf8',
        )
        .replace(/^\uFEFF/, ''),
    );

  if (
    source.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'V9_8_3_INPUT_VERSION_MISMATCH',
    );
  }

  if (!Array.isArray(source.results)) {
    throw new Error(
      'V9_8_3_RESULTS_MISSING',
    );
  }

  const inputFailures =
    source.results.filter(
      (row) =>
        row.status ===
        'EVIDENCE_FAILED',
    );

  const unexpectedFailures =
    inputFailures.filter(
      (row) =>
        !(
          row?.document?.status ===
            'DOCUMENT_SOURCE_UNAVAILABLE' &&
          row?.document?.providerStatus ===
            '014' &&
          Number(
            row?.document?.httpStatus,
          ) === 200
        ),
    );

  if (
    unexpectedFailures.length >
    0
  ) {
    throw new Error(
      'UNEXPECTED_NON_014_FAILURES_PRESENT',
    );
  }

  const results =
    source.results.map(
      classify,
    );

  const provider014Rows =
    results.filter(
      (row) =>
        row?.document?.providerStatus ===
          '014' &&
        row?.document?.status ===
          'DOCUMENT_SOURCE_UNAVAILABLE',
    );

  const unexpectedEvidenceFailures =
    results.filter(
      (row) =>
        row.evidenceDisposition ===
        'UNEXPECTED_EVIDENCE_FAILURE',
    );

  const nextStageUsable =
    results.filter(
      (row) =>
        row.evidenceUsableForNextStage,
    );

  const chainResolutionQueue =
    results.filter(
      (row) =>
        row.chainResolutionRequired,
    );

  const unresolvedWithoutAlternateEvidence =
    results.filter(
      (row) =>
        row.evidenceDisposition ===
          'PROVIDER_014_NO_ALTERNATE_EVIDENCE_UNRESOLVED' ||
        row.evidenceDisposition ===
          'PROVIDER_014_STRUCTURED_NO_DATA_UNRESOLVED',
    );

  const standaloneProvider014 =
    provider014Rows.filter(
      (row) =>
        !row.needsChainLookup,
    );

  const summary = {
    totalRows:
      results.length,

    primaryDocumentReady:
      results.filter(
        (row) =>
          row.evidenceDisposition ===
          'PRIMARY_DOCUMENT_EVIDENCE_READY',
      ).length,

    provider014Deferred:
      provider014Rows.length,

    provider014WithStructuredFallback:
      provider014Rows.filter(
        (row) =>
          row.structuredFallbackAvailable,
      ).length,

    provider014NeedsChainResolution:
      provider014Rows.filter(
        (row) =>
          row.chainResolutionRequired,
      ).length,

    standaloneProvider014:
      standaloneProvider014.length,

    nextStageUsable:
      nextStageUsable.length,

    chainResolutionQueue:
      chainResolutionQueue.length,

    unresolvedWithoutAlternateEvidence:
      unresolvedWithoutAlternateEvidence.length,

    unexpectedEvidenceFailures:
      unexpectedEvidenceFailures.length,
  };

  const report = {
    version:
      VERSION,

    status:
      unexpectedEvidenceFailures.length ===
        0
        ? 'PROVIDER_014_DISPOSITION_COMPLETE'
        : 'PROVIDER_014_DISPOSITION_BLOCKED',

    source: {
      inputVersion:
        source.version,

      inputStatus:
        source.status,

      inputFile:
        path.relative(
          root,
          inputFile,
        ).replaceAll('\\', '/'),

      inputFingerprint:
        sha256(
          JSON.stringify(
            source.results,
          ),
        ),
    },

    verifiedInputFailureContract: {
      inputFailedRows:
        inputFailures.length,

      providerStatus014Rows:
        provider014Rows.length,

      non014FailureRows:
        unexpectedFailures.length,

      allInputFailuresAreHttp200Provider014:
        unexpectedFailures.length ===
        0,
    },

    summary,

    provider014ActionTypeCounts:
      countBy(
        provider014Rows,
        (row) =>
          row.actionType,
      ),

    provider014GateCounts:
      countBy(
        provider014Rows,
        (row) =>
          row.gate,
      ),

    provider014StructuredStatusCounts:
      countBy(
        provider014Rows,
        (row) =>
          row?.structured?.status ??
          null,
      ),

    dispositionCounts:
      countBy(
        results,
        (row) =>
          row.evidenceDisposition,
      ),

    safety: {
      networkRequests:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      coverageWindowAdvanced:
        false,

      retrySameProvider014Receipt:
        false,
    },

    policy: {
      provider014:
        'OFFICIAL_SOURCE_FILE_UNAVAILABLE_NOT_TRANSPORT_FAILURE',

      provider014Retry:
        'DO_NOT_RETRY_IDENTICAL_DOCUMENT_XML_REQUEST',

      correctionAndWithdrawal:
        'RESOLVE_ORIGINAL_RECEIPT_CHAIN_BEFORE_CANONICAL_IDENTITY',

      structuredFallback:
        'SUPPLEMENTAL_EVIDENCE_ONLY; DOES_NOT BY ITSELF ASSIGN PROVIDER_EVENT_ID',

      canonicalization:
        'NOT_PERFORMED_IN_V9_8_3_1',
    },

    chainResolutionQueue:
      chainResolutionQueue.map(
        (row) => ({
          workId:
            row.workId,

          receiptNo:
            row.receiptNo,

          receiptDate:
            row.receiptDate,

          corpCode:
            row.corpCode,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          gate:
            row.gate,

          correction:
            row.correction,

          withdrawal:
            row.withdrawal,

          otherEntity:
            row.otherEntity,

          evidenceDisposition:
            row.evidenceDisposition,

          documentStatus:
            row?.document?.status ??
            null,

          providerStatus:
            row?.document?.providerStatus ??
            null,

          structuredStatus:
            row?.structured?.status ??
            null,

          structuredExactReceiptMatches:
            Number(
              row?.structuredExactReceiptMatches ??
              0,
            ),

          structuredFallbackAvailable:
            row.structuredFallbackAvailable,
        }),
      ),

    unresolvedWithoutAlternateEvidence:
      unresolvedWithoutAlternateEvidence.map(
        (row) => ({
          workId:
            row.workId,

          receiptNo:
            row.receiptNo,

          corpCode:
            row.corpCode,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          gate:
            row.gate,

          evidenceDisposition:
            row.evidenceDisposition,
        }),
      ),

    results,

    outputFile:
      path.relative(
        root,
        outputFile,
      ).replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source.inputFingerprint,

        summary:
          report.summary,

        dispositionCounts:
          report.dispositionCounts,

        chainQueue:
          report.chainResolutionQueue.map(
            (row) =>
              row.workId,
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

        ...report
          .verifiedInputFailureContract,

        ...summary,

        provider014ActionTypeCounts:
          report.provider014ActionTypeCounts,

        provider014GateCounts:
          report.provider014GateCounts,

        provider014StructuredStatusCounts:
          report.provider014StructuredStatusCounts,

        dispositionCounts:
          report.dispositionCounts,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
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
    report.status !==
    'PROVIDER_014_DISPOSITION_COMPLETE'
  ) {
    process.exitCode = 2;
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

  process.exitCode = 1;
}
