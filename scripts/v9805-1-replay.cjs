/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.5.1 - Withdrawal control accounting fix
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5-replay-v2.json
 *   logs/opendart-corporate-action-detail-workset-v9-8-2.json
 *   logs/v9805-replay-chain-view.json
 *   logs/v9805-replay-precision-view.json
 *   logs/v9805-replay-final-precision-view-v2.json
 *
 * Output:
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json
 *
 * Purpose:
 *   V9.8.5 intentionally did not create events from withdrawal-control
 *   disclosures. However, resolved withdrawal controls whose root chain was
 *   either:
 *
 *     A) OTHER_ENTITY scope, or
 *     B) outside the current incremental detail workset
 *
 *   were not counted in the final receipt-accounting set.
 *
 * This patch explicitly accounts for those controls without creating any
 * canonical event.
 *
 * Categories:
 *   OTHER_ENTITY_WITHDRAWAL_CONTROL_EXCLUDED
 *     - withdrawal belongs to subsidiary/other-entity scope
 *     - never suppress parent-security canonical event
 *
 *   CARRY_IN_WITHDRAWAL_CONTROL
 *     - withdrawal root is resolved
 *     - root event is not represented by current incremental detail workset
 *     - must be reconciled against previously persisted production events in
 *       a later read-only production reconciliation stage
 *
 *   ADDITIONAL_WITHDRAWAL_CONTROL_FOR_SUPPRESSED_ROOT
 *     - root already suppressed in V9.8.5; this is an additional control doc
 *
 * Fail closed:
 *   - any unaccounted non-withdrawal => BLOCKED
 *   - any unresolved withdrawal root => BLOCKED
 *   - any withdrawal targeting an ACTIVE root => BLOCKED
 *
 * Run:
 *   node .\scripts\v9805-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_5_1_REPLAY_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';

const SOURCE_VERSION =
  'V9_8_5_REPLAY_V2_FROM_V9_8_4_3_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';

const WORKSET_VERSION =
  'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const CHAIN_VERSION =
  'V9_8_4_3_REPLAY_CHAIN_VIEW';

const PRECISION_VERSION =
  'V9_8_4_3_REPLAY_PRECISION_VIEW';

const FINAL_PRECISION_VERSION =
  'V9_8_4_3_REPLAY_FINAL_PRECISION_VIEW_V2';

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

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    source: null,
    workset: null,
    chain: null,
    precision: null,
    finalPrecision: null,
    output: null,
  };

  const pairs = [
    ['--source=', 'source'],
    ['--workset=', 'workset'],
    ['--chain=', 'chain'],
    ['--precision=', 'precision'],
    ['--final-precision=', 'finalPrecision'],
    ['--output=', 'output'],
  ];

  for (const arg of argv) {
    let matched = false;

    for (const [prefix, key] of pairs) {
      if (
        arg.startsWith(
          prefix,
        )
      ) {
        out[key] =
          arg.slice(
            prefix.length,
          );

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
  reason,
  confidence,
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
      reason:
        reason ??
        null,
      confidence:
        confidence ??
        null,
    },
  );
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

  const sourceFile =
    path.resolve(
      args.source ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-8-5-replay-v2.json',
      ),
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

  const chainFile =
    path.resolve(
      args.chain ??
      path.join(
        root,
        'logs',
        'v9805-replay-chain-view.json',
      ),
    );

  const precisionFile =
    path.resolve(
      args.precision ??
      path.join(
        root,
        'logs',
        'v9805-replay-precision-view.json',
      ),
    );

  const finalPrecisionFile =
    path.resolve(
      args.finalPrecision ??
      path.join(
        root,
        'logs',
        'v9805-replay-final-precision-view-v2.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json',
      ),
    );

  for (const file of [
    sourceFile,
    worksetFile,
    chainFile,
    precisionFile,
    finalPrecisionFile,
  ]) {
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

  const source =
    readJson(
      sourceFile,
    );

  const workset =
    readJson(
      worksetFile,
    );

  const chain =
    readJson(
      chainFile,
    );

  const precision =
    readJson(
      precisionFile,
    );

  const finalPrecision =
    readJson(
      finalPrecisionFile,
    );

  if (
    source.version !==
    SOURCE_VERSION
  ) {
    throw new Error(
      'SOURCE_VERSION_MISMATCH',
    );
  }

  if (
    workset.version !==
    WORKSET_VERSION
  ) {
    throw new Error(
      'WORKSET_VERSION_MISMATCH',
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
      source.unaccountedReceipts,
    ) ||
    !Array.isArray(
      workset.detailFetchQueue,
    )
  ) {
    throw new Error(
      'REQUIRED_ROWS_MISSING',
    );
  }

  const workByReceipt =
    new Map(
      workset
        .detailFetchQueue
        .map(
          (row) => [
            row.receiptNo,
            row,
          ],
        ),
    );

  /*
   * Rebuild final resolved root map.
   */
  const rootMap =
    new Map();

  for (
    const row of
    chain.resolutions
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
          'V9_8_4',

        receiptNo:
          row.receiptNo,

        rootReceiptNo:
          row.rootReceiptNo,

        reason:
          row.resolutionReason,

        confidence:
          row.confidence,
      });
    }
  }

  for (
    const row of
    precision.rows
  ) {
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

        reason:
          row.refinedResolutionReason,

        confidence:
          row.refinedConfidence,
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

        reason:
          row.resolutionReason,

        confidence:
          row.confidence,
      });
    }
  }

  const activeRootSet =
    new Set(
      source.activeChains.map(
        (row) =>
          row.rootReceiptNo,
      ),
    );

  const suppressedRootSet =
    new Set(
      source.suppressedChains.map(
        (row) =>
          row.rootReceiptNo,
      ),
    );

  const detailReceiptSet =
    new Set(
      workset
        .detailFetchQueue
        .map(
          (row) =>
            row.receiptNo,
        ),
    );

  /*
   * Root receipt can be outside the incremental workset.
   * That is exactly the carry-in withdrawal case.
   */
  const fixedControls = [];
  const blockingRows = [];

  for (
    const receiptNo of
    source.unaccountedReceipts
  ) {
    const row =
      workByReceipt.get(
        receiptNo,
      );

    if (!row) {
      blockingRows.push({
        receiptNo,

        reason:
          'UNACCOUNTED_RECEIPT_NOT_FOUND_IN_WORKSET',
      });

      continue;
    }

    if (
      !row.withdrawal ||
      row.gate !==
        'CHAIN_CONTROL_WITHDRAWAL'
    ) {
      blockingRows.push({
        receiptNo,

        reason:
          'UNACCOUNTED_NON_WITHDRAWAL_RECEIPT',

        actionType:
          row.actionType,

        gate:
          row.gate,

        withdrawal:
          Boolean(
            row.withdrawal,
          ),
      });

      continue;
    }

    const resolution =
      rootMap.get(
        receiptNo,
      );

    if (!resolution) {
      blockingRows.push({
        receiptNo,

        reason:
          'WITHDRAWAL_ROOT_UNRESOLVED',

        actionType:
          row.actionType,

        gate:
          row.gate,
      });

      continue;
    }

    const rootReceiptNo =
      resolution.rootReceiptNo;

    if (
      activeRootSet.has(
        rootReceiptNo,
      )
    ) {
      blockingRows.push({
        receiptNo,

        rootReceiptNo,

        reason:
          'WITHDRAWAL_TARGET_ROOT_STILL_ACTIVE',

        actionType:
          row.actionType,
      });

      continue;
    }

    let classification;

    if (
      row.otherEntity
    ) {
      classification =
        'OTHER_ENTITY_WITHDRAWAL_CONTROL_EXCLUDED';
    } else if (
      suppressedRootSet.has(
        rootReceiptNo,
      )
    ) {
      classification =
        'ADDITIONAL_WITHDRAWAL_CONTROL_FOR_SUPPRESSED_ROOT';
    } else if (
      !detailReceiptSet.has(
        rootReceiptNo,
      )
    ) {
      classification =
        'CARRY_IN_WITHDRAWAL_CONTROL';
    } else {
      /*
       * Root is in the current workset but neither active nor suppressed.
       * It may be quarantined, and a withdrawal against a quarantined root
       * must remain explicit rather than silently disappearing.
       */
      classification =
        'WITHDRAWAL_CONTROL_FOR_NONACTIVE_CURRENT_WINDOW_ROOT';
    }

    fixedControls.push({
      receiptNo:
        row.receiptNo,

      receiptDate:
        row.receiptDate,

      corpCode:
        row.corpCode,

      corpName:
        row.corpName,

      stockCode:
        row.stockCode,

      market:
        row.market,

      actionType:
        row.actionType,

      reportName:
        row.reportName,

      correction:
        Boolean(
          row.correction,
        ),

      withdrawal:
        true,

      otherEntity:
        Boolean(
          row.otherEntity,
        ),

      gate:
        row.gate,

      rootReceiptNo,

      rootResolutionStage:
        resolution.sourceStage,

      rootResolutionReason:
        resolution.reason,

      rootResolutionConfidence:
        resolution.confidence,

      rootInCurrentDetailWorkset:
        detailReceiptSet.has(
          rootReceiptNo,
        ),

      rootAlreadySuppressed:
        suppressedRootSet.has(
          rootReceiptNo,
        ),

      classification,

      canonicalEventCreated:
        false,

      parentSecurityEventMutationAllowed:
        classification ===
          'CARRY_IN_WITHDRAWAL_CONTROL',

      productionReconciliationRequired:
        classification ===
          'CARRY_IN_WITHDRAWAL_CONTROL',
    });
  }

  /*
   * Recompute full accounting using V9.8.5 buckets plus fixed controls.
   */
  const accounted =
    new Set();

  for (
    const row of
    source.activeChains
  ) {
    for (
      const receiptNo of
      row.memberReceiptNos ??
      []
    ) {
      accounted.add(
        receiptNo,
      );
    }
  }

  for (
    const row of
    source.suppressedChains
  ) {
    for (
      const receiptNo of
      row.memberReceiptNos ??
      []
    ) {
      accounted.add(
        receiptNo,
      );
    }

    if (
      row.withdrawalReceiptNo
    ) {
      accounted.add(
        row.withdrawalReceiptNo,
      );
    }
  }

  for (
    const row of
    source.quarantineDocuments
  ) {
    accounted.add(
      row.receiptNo,
    );
  }

  for (
    const row of
    source.otherEntityExcluded
  ) {
    accounted.add(
      row.receiptNo,
    );
  }

  for (
    const row of
    source.conflictedChains
  ) {
    for (
      const receiptNo of
      row.memberReceiptNos ??
      []
    ) {
      accounted.add(
        receiptNo,
      );
    }
  }

  for (
    const row of
    fixedControls
  ) {
    accounted.add(
      row.receiptNo,
    );
  }

  const remainingUnaccounted =
    workset
      .detailFetchQueue
      .map(
        (row) =>
          row.receiptNo,
      )
      .filter(
        (receiptNo) =>
          !accounted.has(
            receiptNo,
          ),
      );

  const carryInWithdrawalControls =
    fixedControls.filter(
      (row) =>
        row.classification ===
        'CARRY_IN_WITHDRAWAL_CONTROL',
    );

  const otherEntityWithdrawalControls =
    fixedControls.filter(
      (row) =>
        row.classification ===
        'OTHER_ENTITY_WITHDRAWAL_CONTROL_EXCLUDED',
    );

  const additionalSuppressedControls =
    fixedControls.filter(
      (row) =>
        row.classification ===
        'ADDITIONAL_WITHDRAWAL_CONTROL_FOR_SUPPRESSED_ROOT',
    );

  const currentWindowNonactiveControls =
    fixedControls.filter(
      (row) =>
        row.classification ===
        'WITHDRAWAL_CONTROL_FOR_NONACTIVE_CURRENT_WINDOW_ROOT',
    );

  const blocked =
    blockingRows.length >
      0 ||
    remainingUnaccounted.length >
      0 ||
    source.conflictedChains.length >
      0;

  const report = {
    version:
      VERSION,

    status:
      blocked
        ? 'CANONICAL_SOURCE_SELECTION_BLOCKED'
        : 'CANONICAL_SOURCE_SELECTION_READY_WITH_QUARANTINE',

    source: {
      sourceVersion:
        source.version,

      worksetVersion:
        workset.version,

      chainVersion:
        chain.version,

      precisionVersion:
        precision.version,

      finalPrecisionVersion:
        finalPrecision.version,

      sourceFingerprint:
        source.outputFingerprint,

      inputFingerprint:
        sha256(
          JSON.stringify({
            source:
              source.outputFingerprint,

            unaccounted:
              source.unaccountedReceipts,

            resolvedMappings:
              [...rootMap.values()]
                .map(
                  (row) => [
                    row.receiptNo,
                    row.rootReceiptNo,
                    row.sourceStage,
                  ],
                )
                .sort(),
          }),
        ),
    },

    counts: {
      detailWorkItems:
        workset
          .detailFetchQueue
          .length,

      sourceActiveCanonicalChains:
        source
          .activeChains
          .length,

      sourceWithdrawnChainsSuppressed:
        source
          .suppressedChains
          .length,

      sourceQuarantinedDocuments:
        source
          .quarantineDocuments
          .length,

      sourceOtherEntityExcluded:
        source
          .otherEntityExcluded
          .length,

      sourceUnaccountedReceipts:
        source
          .unaccountedReceipts
          .length,

      fixedWithdrawalControls:
        fixedControls.length,

      carryInWithdrawalControls:
        carryInWithdrawalControls.length,

      otherEntityWithdrawalControls:
        otherEntityWithdrawalControls.length,

      additionalSuppressedControls:
        additionalSuppressedControls.length,

      currentWindowNonactiveControls:
        currentWindowNonactiveControls.length,

      blockingRows:
        blockingRows.length,

      remainingUnaccountedReceipts:
        remainingUnaccounted.length,

      conflictedChains:
        source
          .conflictedChains
          .length,
    },

    withdrawalControlClassCounts:
      countBy(
        fixedControls,
        (row) =>
          row.classification,
      ),

    activeActionTypeCounts:
      source
        .activeActionTypeCounts,

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

      unaccountedNonWithdrawalReceipts:
        blockingRows.filter(
          (row) =>
            row.reason ===
            'UNACCOUNTED_NON_WITHDRAWAL_RECEIPT',
        ).length,

      unresolvedWithdrawalRoots:
        blockingRows.filter(
          (row) =>
            row.reason ===
            'WITHDRAWAL_ROOT_UNRESOLVED',
        ).length,

      withdrawalTargetsStillActive:
        blockingRows.filter(
          (row) =>
            row.reason ===
            'WITHDRAWAL_TARGET_ROOT_STILL_ACTIVE',
        ).length,

      carryInProductionMutationsPerformed:
        0,
    },

    policy: {
      withdrawalControl:
        'CONTROL_RECORD_ONLY_NOT_CANONICAL_EVENT',

      otherEntityWithdrawal:
        'EXCLUDE_FROM_PARENT_SECURITY_EVENT',

      carryInWithdrawal:
        'QUEUE_FOR_LATER_READ_ONLY_PRODUCTION_RECONCILIATION',

      carryInMutation:
        'NOT_PERFORMED_IN_V9_8_5_1',

      unresolvedOrActiveRoot:
        'FAIL_CLOSED',

      canonicalParsing:
        'MAY_PROCEED_ONLY_FOR_ACTIVE_CHAINS_AFTER_ACCOUNTING_PASSES',
    },

    activeChains:
      source.activeChains,

    suppressedChains:
      source.suppressedChains,

    quarantineDocuments:
      source.quarantineDocuments,

    otherEntityExcluded:
      source.otherEntityExcluded,

    withdrawalControls:
      fixedControls,

    carryInWithdrawalControls,

    otherEntityWithdrawalControls,

    additionalSuppressedControls,

    currentWindowNonactiveControls,

    blockingRows,

    remainingUnaccountedReceipts:
      remainingUnaccounted,

    conflictedChains:
      source.conflictedChains,

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

        activeChains:
          report.activeChains.map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
            ],
          ),

        controls:
          fixedControls.map(
            (row) => [
              row.receiptNo,
              row.rootReceiptNo,
              row.classification,
            ],
          ),

        remainingUnaccounted,
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

        withdrawalControlClassCounts:
          report.withdrawalControlClassCounts,

        carryInWithdrawalControls:
          carryInWithdrawalControls.map(
            (row) => ({
              receiptNo:
                row.receiptNo,

              stockCode:
                row.stockCode,

              actionType:
                row.actionType,

              rootReceiptNo:
                row.rootReceiptNo,

              productionReconciliationRequired:
                row.productionReconciliationRequired,
            }),
          ),

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

        carryInProductionMutationsPerformed:
          0,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (blocked) {
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
