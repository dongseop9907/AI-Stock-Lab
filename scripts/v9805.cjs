/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.5 - Canonical chain collapse / source selection
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-detail-workset-v9-8-2.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-1.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5.json
 *
 * Contract:
 *   - provider_event_id identity will ultimately be the ORIGINAL/root receipt.
 *   - event values will be parsed later from the latest valid chain document.
 *   - a resolved withdrawal suppresses the entire root event.
 *   - unresolved correction chains are quarantined, never guessed.
 *   - OTHER_ENTITY_SCOPE_REVIEW rows are excluded from parent-security events.
 *   - MERGER / SPIN_OFF remain canonical structural events, but are not generic
 *     price-factor events.
 *
 * This stage DOES NOT parse effective dates, ratios, or cash amounts.
 *
 * Run:
 *   node .\scripts\v9805.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_5_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';

const WORKSET_VERSION =
  'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const CHAIN_VERSION =
  'V9_8_4_OPENDART_CORRECTION_WITHDRAWAL_CHAIN_RESOLVER';

const PRECISION_VERSION =
  'V9_8_4_1_PRECISION_CORRECTION_CHAIN_RESOLVER';

const FINAL_PRECISION_VERSION =
  'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER';

const STRUCTURAL_TYPES =
  new Set([
    'MERGER',
    'SPIN_OFF',
  ]);

const FACTOR_TYPES =
  new Set([
    'CASH_DIVIDEND',
    'STOCK_DIVIDEND',
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
  ]);

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function readJson(file) {
  return JSON.parse(
    fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2,
    ),
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function parseArgs(argv) {
  const out = {
    workset: null,
    evidence: null,
    chain: null,
    precision: null,
    finalPrecision: null,
    output: null,
  };

  const pairs = [
    ['--workset=', 'workset'],
    ['--evidence=', 'evidence'],
    ['--chain=', 'chain'],
    ['--precision=', 'precision'],
    ['--final-precision=', 'finalPrecision'],
    ['--output=', 'output'],
  ];

  for (const arg of argv) {
    let matched = false;

    for (const [prefix, key] of pairs) {
      if (arg.startsWith(prefix)) {
        out[key] =
          arg.slice(prefix.length);

        matched = true;
        break;
      }
    }

    if (!matched) {
      throw new Error(
        `UNKNOWN_OPTION:${arg}`,
      );
    }
  }

  return out;
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function receiptSort(a, b) {
  return (
    String(a.receiptDate)
      .localeCompare(
        String(b.receiptDate),
      ) ||
    String(a.receiptNo)
      .localeCompare(
        String(b.receiptNo),
      )
  );
}

function validReceipt(value) {
  return /^\d{14}$/.test(
    String(value ?? ''),
  );
}

function addResolution({
  map,
  sourceStage,
  receiptNo,
  rootReceiptNo,
  evidence,
}) {
  if (
    !validReceipt(receiptNo) ||
    !validReceipt(rootReceiptNo)
  ) {
    throw new Error(
      'INVALID_RESOLUTION_RECEIPT',
    );
  }

  const existing =
    map.get(
      receiptNo,
    );

  if (
    existing &&
    existing.rootReceiptNo !==
      rootReceiptNo
  ) {
    throw new Error(
      `CHAIN_RESOLUTION_CONFLICT:${receiptNo}`,
    );
  }

  map.set(
    receiptNo,
    {
      receiptNo,
      rootReceiptNo,
      sourceStage,
      evidence,
    },
  );
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

  const worksetFile =
    path.resolve(
      args.workset ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-workset-v9-8-2.json',
      ),
    );

  const evidenceFile =
    path.resolve(
      args.evidence ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      ),
    );

  const chainFile =
    path.resolve(
      args.chain ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4.json',
      ),
    );

  const precisionFile =
    path.resolve(
      args.precision ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4-1.json',
      ),
    );

  const finalPrecisionFile =
    path.resolve(
      args.finalPrecision ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-8-5.json',
      ),
    );

  for (const file of [
    worksetFile,
    evidenceFile,
    chainFile,
    precisionFile,
    finalPrecisionFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const workset =
    readJson(worksetFile);

  const evidence =
    readJson(evidenceFile);

  const chain =
    readJson(chainFile);

  const precision =
    readJson(precisionFile);

  const finalPrecision =
    readJson(finalPrecisionFile);

  if (
    workset.version !==
    WORKSET_VERSION
  ) {
    throw new Error(
      'WORKSET_VERSION_MISMATCH',
    );
  }

  if (
    evidence.version !==
    EVIDENCE_VERSION
  ) {
    throw new Error(
      'EVIDENCE_VERSION_MISMATCH',
    );
  }

  if (
    chain.version !==
    CHAIN_VERSION
  ) {
    throw new Error(
      'CHAIN_VERSION_MISMATCH',
    );
  }

  if (
    precision.version !==
    PRECISION_VERSION
  ) {
    throw new Error(
      'PRECISION_VERSION_MISMATCH',
    );
  }

  if (
    finalPrecision.version !==
    FINAL_PRECISION_VERSION
  ) {
    throw new Error(
      'FINAL_PRECISION_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(
      workset.detailFetchQueue,
    ) ||
    !Array.isArray(
      evidence.results,
    ) ||
    !Array.isArray(
      chain.resolutions,
    ) ||
    !Array.isArray(
      precision.rows,
    ) ||
    !Array.isArray(
      finalPrecision.rows,
    )
  ) {
    throw new Error(
      'INPUT_ROWS_MISSING',
    );
  }

  const evidenceByReceipt =
    new Map(
      evidence.results.map(
        (row) => [
          row.receiptNo,
          row,
        ],
      ),
    );

  /*
   * Merge the three chain-resolution stages.
   *
   * V9.8.4 solved 107.
   * V9.8.4.1 solved part of the original 14 ambiguous.
   * V9.8.4.2 solved part of the remaining 7.
   *
   * Any conflicting root assignment is fatal.
   */
  const rootMap =
    new Map();

  for (const row of chain.resolutions) {
    if (
      row.resolutionStatus ===
      'RESOLVED' &&
      row.rootReceiptNo
    ) {
      addResolution({
        map:
          rootMap,

        sourceStage:
          'V9_8_4',

        receiptNo:
          row.receiptNo,

        rootReceiptNo:
          row.rootReceiptNo,

        evidence: {
          reason:
            row.resolutionReason,

          confidence:
            row.confidence,
        },
      });
    }
  }

  for (const row of precision.rows) {
    if (
      row.refinedResolutionStatus ===
      'RESOLVED' &&
      row.refinedRootReceiptNo
    ) {
      addResolution({
        map:
          rootMap,

        sourceStage:
          'V9_8_4_1',

        receiptNo:
          row.receiptNo,

        rootReceiptNo:
          row.refinedRootReceiptNo,

        evidence: {
          reason:
            row.refinedResolutionReason,

          confidence:
            row.refinedConfidence,
        },
      });
    }
  }

  for (
    const row of
    finalPrecision.rows
  ) {
    if (
      row.resolutionStatus ===
      'RESOLVED' &&
      row.rootReceiptNo
    ) {
      addResolution({
        map:
          rootMap,

        sourceStage:
          'V9_8_4_2',

        receiptNo:
          row.receiptNo,

        rootReceiptNo:
          row.rootReceiptNo,

        evidence: {
          reason:
            row.resolutionReason,

          confidence:
            row.confidence,
        },
      });
    }
  }

  const unresolvedChainReceipts =
    new Set(
      finalPrecision
        .quarantineQueue
        .map(
          (row) =>
            row.receiptNo,
        ),
    );

  /*
   * When a correction cannot be assigned to a root, all root candidates
   * implicated by that ambiguous correction are quarantined as well.
   * This prevents us from silently using stale original data.
   */
  const ambiguousRootCandidates =
    new Set();

  for (
    const row of
    finalPrecision.quarantineQueue
  ) {
    for (
      const receiptNo of
      row.candidateReceiptNos ??
      []
    ) {
      if (
        validReceipt(
          receiptNo,
        )
      ) {
        ambiguousRootCandidates.add(
          receiptNo,
        );
      }
    }
  }

  const detailRows =
    workset.detailFetchQueue;

  const otherEntityExcluded =
    detailRows.filter(
      (row) =>
        row.gate ===
        'OTHER_ENTITY_SCOPE_REVIEW',
    );

  const eligibleRows =
    detailRows.filter(
      (row) =>
        row.gate !==
        'OTHER_ENTITY_SCOPE_REVIEW',
    );

  const withdrawnRoots =
    new Map();

  const rowDecisions = [];

  /*
   * First pass:
   * - classify each document
   * - discover resolved withdrawals
   */
  for (const row of eligibleRows) {
    const resolution =
      rootMap.get(
        row.receiptNo,
      );

    if (
      row.withdrawal
    ) {
      if (!resolution) {
        rowDecisions.push({
          receiptNo:
            row.receiptNo,

          decision:
            'QUARANTINE_UNRESOLVED_WITHDRAWAL',

          rootReceiptNo:
            null,

          reason:
            'WITHDRAWAL_ROOT_NOT_RESOLVED',
        });

        continue;
      }

      const existing =
        withdrawnRoots.get(
          resolution.rootReceiptNo,
        );

      if (
        !existing ||
        receiptSort(
          existing,
          row,
        ) < 0
      ) {
        withdrawnRoots.set(
          resolution.rootReceiptNo,
          row,
        );
      }

      rowDecisions.push({
        receiptNo:
          row.receiptNo,

        decision:
          'WITHDRAWAL_SUPPRESSES_ROOT',

        rootReceiptNo:
          resolution.rootReceiptNo,

        reason:
          'RESOLVED_WITHDRAWAL_CHAIN',
      });

      continue;
    }

    rowDecisions.push({
      receiptNo:
        row.receiptNo,

      decision:
        'PENDING_GROUPING',

      rootReceiptNo:
        resolution?.rootReceiptNo ??
        null,

      reason:
        null,
    });
  }

  const groups =
    new Map();

  const quarantineDocuments = [];

  /*
   * Second pass:
   * collapse non-withdrawal documents by root identity.
   */
  for (const row of eligibleRows) {
    if (row.withdrawal) {
      continue;
    }

    if (
      unresolvedChainReceipts.has(
        row.receiptNo,
      )
    ) {
      quarantineDocuments.push({
        receiptNo:
          row.receiptNo,

        corpCode:
          row.corpCode,

        stockCode:
          row.stockCode,

        actionType:
          row.actionType,

        reason:
          'UNRESOLVED_CORRECTION_CHAIN',

        gate:
          row.gate,
      });

      continue;
    }

    const resolution =
      rootMap.get(
        row.receiptNo,
      );

    let rootReceiptNo;

    if (
      row.needsChainLookup ||
      row.correction
    ) {
      if (!resolution) {
        quarantineDocuments.push({
          receiptNo:
            row.receiptNo,

          corpCode:
            row.corpCode,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          reason:
            'CHAIN_REQUIRED_BUT_ROOT_NOT_RESOLVED',

          gate:
            row.gate,
        });

        continue;
      }

      rootReceiptNo =
        resolution.rootReceiptNo;
    } else {
      /*
       * Direct original event.
       * A self-root resolution from V9.8.4 is equivalent.
       */
      rootReceiptNo =
        resolution?.rootReceiptNo ??
        row.receiptNo;
    }

    if (
      !validReceipt(
        rootReceiptNo,
      )
    ) {
      throw new Error(
        `INVALID_GROUP_ROOT:${row.receiptNo}`,
      );
    }

    if (
      ambiguousRootCandidates.has(
        rootReceiptNo,
      ) ||
      ambiguousRootCandidates.has(
        row.receiptNo,
      )
    ) {
      quarantineDocuments.push({
        receiptNo:
          row.receiptNo,

        corpCode:
          row.corpCode,

        stockCode:
          row.stockCode,

        actionType:
          row.actionType,

        rootReceiptNo,

        reason:
          'ROOT_IMPLICATED_BY_UNRESOLVED_CORRECTION',

        gate:
          row.gate,
      });

      continue;
    }

    if (!groups.has(rootReceiptNo)) {
      groups.set(
        rootReceiptNo,
        [],
      );
    }

    groups
      .get(rootReceiptNo)
      .push({
        ...row,

        rootReceiptNo,

        rootResolution:
          resolution
            ? {
                sourceStage:
                  resolution.sourceStage,

                reason:
                  resolution
                    .evidence
                    .reason,

                confidence:
                  resolution
                    .evidence
                    .confidence,
              }
            : {
                sourceStage:
                  'DIRECT_ORIGINAL',

                reason:
                  'DIRECT_DECISION_DISCLOSURE',

                confidence:
                  'HIGH',
              },
      });
  }

  const activeChains = [];
  const suppressedChains = [];
  const conflictedChains = [];

  for (
    const [
      rootReceiptNo,
      members,
    ] of groups
  ) {
    const actionTypes =
      [
        ...new Set(
          members.map(
            (row) =>
              row.actionType,
          ),
        ),
      ];

    const stockCodes =
      [
        ...new Set(
          members
            .map(
              (row) =>
                row.stockCode,
            )
            .filter(Boolean),
        ),
      ];

    const corpCodes =
      [
        ...new Set(
          members.map(
            (row) =>
              row.corpCode,
          ),
        ),
      ];

    if (
      actionTypes.length !==
        1 ||
      stockCodes.length >
        1 ||
      corpCodes.length !==
        1
    ) {
      conflictedChains.push({
        rootReceiptNo,

        actionTypes,

        stockCodes,

        corpCodes,

        memberReceiptNos:
          members.map(
            (row) =>
              row.receiptNo,
          ),

        reason:
          'CHAIN_IDENTITY_CONFLICT',
      });

      continue;
    }

    if (
      withdrawnRoots.has(
        rootReceiptNo,
      )
    ) {
      const withdrawal =
        withdrawnRoots.get(
          rootReceiptNo,
        );

      suppressedChains.push({
        rootReceiptNo,

        actionType:
          actionTypes[0],

        stockCode:
          stockCodes[0] ??
          null,

        corpCode:
          corpCodes[0],

        withdrawalReceiptNo:
          withdrawal.receiptNo,

        withdrawalReceiptDate:
          withdrawal.receiptDate,

        memberReceiptNos:
          members
            .slice()
            .sort(
              receiptSort,
            )
            .map(
              (row) =>
                row.receiptNo,
            ),

        status:
          'WITHDRAWN_SUPPRESSED',
      });

      continue;
    }

    const ordered =
      members
        .slice()
        .sort(
          receiptSort,
        );

    const latest =
      ordered.at(-1);

    const evidenceRow =
      evidenceByReceipt.get(
        latest.receiptNo,
      ) ??
      null;

    activeChains.push({
      provider:
        'DART_KRX_CANONICAL',

      providerEventId:
        rootReceiptNo,

      rootReceiptNo,

      sourceReceiptNo:
        latest.receiptNo,

      sourceReceiptDate:
        latest.receiptDate,

      sourceIsCorrection:
        Boolean(
          latest.correction,
        ),

      actionType:
        actionTypes[0],

      stockCode:
        stockCodes[0] ??
        null,

      corpCode:
        corpCodes[0],

      market:
        latest.market ??
        null,

      structuralAction:
        STRUCTURAL_TYPES.has(
          actionTypes[0],
        ),

      genericFactorAction:
        FACTOR_TYPES.has(
          actionTypes[0],
        ),

      sourceEvidence: {
        disposition:
          evidenceRow
            ?.evidenceDisposition ??
          null,

        documentStatus:
          evidenceRow
            ?.document
            ?.status ??
          null,

        providerStatus:
          evidenceRow
            ?.document
            ?.providerStatus ??
          null,

        structuredStatus:
          evidenceRow
            ?.structured
            ?.status ??
          null,

        structuredFile:
          evidenceRow
            ?.structured
            ?.file ??
          null,

        documentFile:
          evidenceRow
            ?.document
            ?.file ??
          null,
      },

      memberCount:
        ordered.length,

      memberReceiptNos:
        ordered.map(
          (row) =>
            row.receiptNo,
        ),

      members:
        ordered.map(
          (row) => ({
            receiptNo:
              row.receiptNo,

            receiptDate:
              row.receiptDate,

            reportName:
              row.reportName,

            gate:
              row.gate,

            correction:
              Boolean(
                row.correction,
              ),

            rootResolution:
              row.rootResolution,
          }),
        ),

      parseStatus:
        'NOT_YET_PARSED',

      eventInsertAllowed:
        false,
    });
  }

  activeChains.sort(
    (a, b) =>
      String(a.stockCode ?? '')
        .localeCompare(
          String(b.stockCode ?? ''),
        ) ||
      a.providerEventId
        .localeCompare(
          b.providerEventId,
        ),
  );

  const activeIdentitySet =
    new Set();

  for (
    const row of
    activeChains
  ) {
    const id =
      `${row.provider}|${row.providerEventId}`;

    if (
      activeIdentitySet.has(
        id,
      )
    ) {
      throw new Error(
        `DUPLICATE_ACTIVE_CANONICAL_IDENTITY:${id}`,
      );
    }

    activeIdentitySet.add(id);
  }

  const allReferencedWorkReceipts =
    new Set(
      [
        ...activeChains.flatMap(
          (row) =>
            row.memberReceiptNos,
        ),

        ...suppressedChains.flatMap(
          (row) => [
            ...row.memberReceiptNos,
            row.withdrawalReceiptNo,
          ],
        ),

        ...quarantineDocuments.map(
          (row) =>
            row.receiptNo,
        ),

        ...otherEntityExcluded.map(
          (row) =>
            row.receiptNo,
        ),

        ...conflictedChains.flatMap(
          (row) =>
            row.memberReceiptNos,
        ),
      ],
    );

  const unaccountedReceipts =
    detailRows
      .map(
        (row) =>
          row.receiptNo,
      )
      .filter(
        (receiptNo) =>
          !allReferencedWorkReceipts.has(
            receiptNo,
          ),
      );

  const report = {
    version:
      VERSION,

    status:
      conflictedChains.length >
        0 ||
      unaccountedReceipts.length >
        0
        ? 'CANONICAL_SOURCE_SELECTION_BLOCKED'
        : quarantineDocuments.length >
            0
          ? 'CANONICAL_SOURCE_SELECTION_READY_WITH_QUARANTINE'
          : 'CANONICAL_SOURCE_SELECTION_READY',

    source: {
      worksetVersion:
        workset.version,

      evidenceVersion:
        evidence.version,

      chainVersion:
        chain.version,

      precisionVersion:
        precision.version,

      finalPrecisionVersion:
        finalPrecision.version,

      inputFingerprint:
        sha256(
          JSON.stringify({
            workset:
              workset.outputFingerprint ??
              workset.source
                ?.inputFingerprint ??
              null,

            evidence:
              evidence.outputFingerprint ??
              null,

            chain:
              chain.outputFingerprint ??
              null,

            precision:
              precision.outputFingerprint ??
              null,

            finalPrecision:
              finalPrecision.outputFingerprint ??
              null,
          }),
        ),
    },

    counts: {
      detailWorkItems:
        detailRows.length,

      resolvedChainMappings:
        rootMap.size,

      unresolvedChainDocuments:
        unresolvedChainReceipts.size,

      ambiguousRootCandidates:
        ambiguousRootCandidates.size,

      otherEntityExcluded:
        otherEntityExcluded.length,

      resolvedWithdrawals:
        withdrawnRoots.size,

      activeCanonicalChains:
        activeChains.length,

      withdrawnChainsSuppressed:
        suppressedChains.length,

      quarantinedDocuments:
        quarantineDocuments.length,

      conflictedChains:
        conflictedChains.length,

      unaccountedReceipts:
        unaccountedReceipts.length,
    },

    activeActionTypeCounts:
      countBy(
        activeChains,
        (row) =>
          row.actionType,
      ),

    sourceDocumentStatusCounts:
      countBy(
        activeChains,
        (row) =>
          row
            .sourceEvidence
            .documentStatus,
      ),

    sourceEvidenceDispositionCounts:
      countBy(
        activeChains,
        (row) =>
          row
            .sourceEvidence
            .disposition,
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

      providerEventIdsPersisted:
        0,

      effectiveDatesParsed:
        false,

      factorsComputed:
        false,

      coverageWindowAdvanced:
        false,

      unresolvedChainsForced:
        0,

      withdrawnRootsActive:
        activeChains.filter(
          (row) =>
            withdrawnRoots.has(
              row.rootReceiptNo,
            ),
        ).length,
    },

    policy: {
      provider:
        'DART_KRX_CANONICAL',

      providerEventId:
        'ORIGINAL_ROOT_DART_RECEIPT',

      eventValueSource:
        'LATEST_VALID_NON_WITHDRAWAL_CHAIN_DOCUMENT',

      withdrawal:
        'SUPPRESS_ENTIRE_ROOT_EVENT',

      unresolvedCorrection:
        'QUARANTINE_ROOT_CANDIDATES_AND_DO_NOT_USE_STALE_ORIGINAL',

      otherEntityScope:
        'EXCLUDE_FROM_PARENT_SECURITY_CANONICAL_EVENT',

      structuralActions:
        'KEEP_CANONICAL_BUT_NEVER_GENERIC_FACTOR',

      parsing:
        'DEFERRED_TO_NEXT_STAGE',
    },

    activeChains,

    suppressedChains,

    quarantineDocuments,

    otherEntityExcluded:
      otherEntityExcluded.map(
        (row) => ({
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

          reportName:
            row.reportName,

          reason:
            'OTHER_ENTITY_SCOPE_REVIEW',
        }),
      ),

    conflictedChains,

    unaccountedReceipts,

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
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report
            .source
            .inputFingerprint,

        active:
          activeChains.map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
              row.actionType,
              row.stockCode,
            ],
          ),

        suppressed:
          suppressedChains.map(
            (row) => [
              row.rootReceiptNo,
              row.withdrawalReceiptNo,
            ],
          ),

        quarantined:
          quarantineDocuments.map(
            (row) => [
              row.receiptNo,
              row.rootReceiptNo ??
                null,
              row.reason,
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

        activeActionTypeCounts:
          report.activeActionTypeCounts,

        sourceDocumentStatusCounts:
          report.sourceDocumentStatusCounts,

        sourceEvidenceDispositionCounts:
          report.sourceEvidenceDispositionCounts,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        providerEventIdsPersisted:
          0,

        effectiveDatesParsed:
          false,

        factorsComputed:
          false,

        coverageWindowAdvanced:
          false,

        unresolvedChainsForced:
          0,

        withdrawnRootsActive:
          report
            .safety
            .withdrawnRootsActive,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    report.status ===
    'CANONICAL_SOURCE_SELECTION_BLOCKED'
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
