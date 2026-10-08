'use strict';

/**
 * AI Stock Lab
 * V9.8.2 - Incremental corporate-action candidate gate / detail workset builder
 *
 * Read-only, no network, no DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-incremental-v9-10-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-detail-workset-v9-10-2.json
 *
 * Goal:
 *   - keep only action types covered by the current V9.7 canonical contract
 *   - separate true decision disclosures from follow-up notices
 *   - separate correction / withdrawal control documents
 *   - quarantine subsidiary / other-entity disclosures
 *   - build the exact workset for the next detail-fetch/parser stage
 *
 * Run:
 *   node .\scripts\v9802.cjs
 *
 * Optional:
 *   node .\scripts\v9802.cjs --input=.\logs\opendart-corporate-action-incremental-v9-10-1.json
 *   node .\scripts\v9802.cjs --output=.\logs\opendart-corporate-action-detail-workset-v9-10-2.json
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_10_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const INPUT_VERSION =
  'V9_10_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY';

const CURRENT_CANONICAL_ACTION_TYPES =
  new Set([
    'CASH_DIVIDEND',
    'STOCK_DIVIDEND',
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
    'MERGER',
    'SPIN_OFF',
  ]);

const STRUCTURAL_ACTION_TYPES =
  new Set([
    'MERGER',
    'SPIN_OFF',
  ]);

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
      out.input = arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output = arg.slice('--output='.length);
      continue;
    }

    throw new Error('UNKNOWN_OPTION');
  }

  return out;
}

function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(value) {
  return normalizeTitle(value)
    .replace(/\s+/g, '');
}

function stripCorrectionPrefix(title) {
  return compactTitle(title)
    .replace(
      /^\[(?:기재|첨부)?정정\]/,
      '',
    )
    .replace(
      /^(?:기재|첨부)?정정/,
      '',
    );
}

function isCorrection(title) {
  const compact =
    compactTitle(title);

  return (
    /^\[(?:기재|첨부)?정정\]/.test(compact) ||
    /^(?:기재|첨부)?정정/.test(compact)
  );
}

function isWithdrawal(title) {
  return /철회/.test(
    compactTitle(title),
  );
}

function isOtherEntityScope(title) {
  return /종속회사|자회사/.test(
    compactTitle(title),
  );
}

function isFollowupNotice(title) {
  const compact =
    compactTitle(title);

  return (
    /주권매매거래정지/.test(compact) ||
    /신주상장/.test(compact) ||
    /변경상장/.test(compact) ||
    /최종발행가액/.test(compact) ||
    /발행가액확정/.test(compact) ||
    /권리락/.test(compact)
  );
}

function strictDecisionMatch(
  actionType,
  title,
) {
  const compact =
    stripCorrectionPrefix(
      title,
    );

  switch (actionType) {
    case 'CASH_DIVIDEND':
      return (
        /현금[ㆍ·및,]?(?:현물)?배당결정/.test(compact) ||
        /현금배당결정/.test(compact)
      );

    case 'STOCK_DIVIDEND':
      return /주식배당결정/.test(compact);

    case 'STOCK_SPLIT':
      return /주식분할결정/.test(compact);

    case 'REVERSE_SPLIT':
      return /주식병합결정/.test(compact);

    case 'MERGER':
      return /회사합병결정/.test(compact);

    case 'SPIN_OFF':
      return (
        /회사분할결정/.test(compact) ||
        /회사분할합병결정/.test(compact) ||
        /분할합병결정/.test(compact)
      );

    default:
      return false;
  }
}

function deterministicWorkId(candidate) {
  return sha256(
    [
      candidate.receiptNo,
      candidate.corpCode,
      candidate.stockCode ?? '',
      candidate.candidateActionType,
    ].join('|'),
  );
}

function classifyCandidate(candidate) {
  const actionType =
    String(
      candidate.candidateActionType ??
      '',
    );

  const title =
    normalizeTitle(
      candidate.reportName,
    );

  const correction =
    isCorrection(title);

  const withdrawal =
    isWithdrawal(title);

  const otherEntity =
    isOtherEntityScope(title);

  const followup =
    isFollowupNotice(title);

  const inCanonicalContract =
    CURRENT_CANONICAL_ACTION_TYPES.has(
      actionType,
    );

  const strictDecision =
    inCanonicalContract &&
    strictDecisionMatch(
      actionType,
      title,
    );

  const base = {
    workId:
      deterministicWorkId(
        candidate,
      ),

    corpCode:
      candidate.corpCode,

    corpName:
      candidate.corpName ??
      null,

    stockCode:
      candidate.stockCode ??
      null,

    market:
      candidate.market ??
      null,

    receiptNo:
      candidate.receiptNo,

    receiptDate:
      candidate.receiptDate,

    reportName:
      title,

    actionType,

    correction,
    withdrawal,
    otherEntity,
    followup,
    strictDecision,

    originalV981ReviewFlags:
      Array.isArray(
        candidate.reviewFlags,
      )
        ? candidate.reviewFlags
        : [],
  };

  if (
    !inCanonicalContract
  ) {
    return {
      ...base,
      gate:
        'OUT_OF_CURRENT_CANONICAL_SCOPE',
      reason:
        'ACTION_TYPE_NOT_IN_V9_7_CANONICAL_CONTRACT',
      autoDetailFetch:
        false,
      needsChainLookup:
        false,
      canBecomeProductionEvent:
        false,
    };
  }

  if (
    withdrawal
  ) {
    return {
      ...base,
      gate:
        'CHAIN_CONTROL_WITHDRAWAL',
      reason:
        'WITHDRAWAL_MUST_LINK_TO_PRIOR_ORIGINAL_EVENT',
      autoDetailFetch:
        true,
      needsChainLookup:
        true,
      canBecomeProductionEvent:
        false,
    };
  }

  if (
    followup &&
    !strictDecision
  ) {
    return {
      ...base,
      gate:
        'FOLLOWUP_NOTICE_NOT_EVENT',
      reason:
        'FOLLOWUP_NOTICE_MUST_NOT_CREATE_NEW_EVENT',
      autoDetailFetch:
        false,
      needsChainLookup:
        false,
      canBecomeProductionEvent:
        false,
    };
  }

  if (
    !strictDecision
  ) {
    return {
      ...base,
      gate:
        'TITLE_NOT_STRICT_DECISION',
      reason:
        'BROAD_V9_8_1_CANDIDATE_FAILED_STRICT_DECISION_GATE',
      autoDetailFetch:
        false,
      needsChainLookup:
        false,
      canBecomeProductionEvent:
        false,
    };
  }

  if (
    otherEntity
  ) {
    return {
      ...base,
      gate:
        'OTHER_ENTITY_SCOPE_REVIEW',
      reason:
        'DISCLOSURE_APPEARS_TO_DESCRIBE_SUBSIDIARY_OR_OTHER_ENTITY',
      autoDetailFetch:
        true,
      needsChainLookup:
        correction,
      canBecomeProductionEvent:
        false,
    };
  }

  if (
    correction
  ) {
    return {
      ...base,
      gate:
        'CORRECTION_REQUIRES_CHAIN_LOOKUP',
      reason:
        'CORRECTION_MUST_RESOLVE_TO_ORIGINAL_RECEIPT_BEFORE_CANONICAL_IDENTITY',
      autoDetailFetch:
        true,
      needsChainLookup:
        true,
      canBecomeProductionEvent:
        false,
    };
  }

  return {
    ...base,
    gate:
      STRUCTURAL_ACTION_TYPES.has(
        actionType,
      )
        ? 'STRUCTURAL_DECISION_DETAIL_READY'
        : 'SUPPORTED_DECISION_DETAIL_READY',

    reason:
      STRUCTURAL_ACTION_TYPES.has(
        actionType,
      )
        ? 'VALID_DECISION_TITLE_STRUCTURAL_ACTION_REQUIRES_DETAIL_AND_REVIEW'
        : 'VALID_DECISION_TITLE_READY_FOR_DETAIL_EXTRACTION',

    autoDetailFetch:
      true,

    needsChainLookup:
      false,

    canBecomeProductionEvent:
      true,
  };
}

function atomicSave(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
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

function countBy(rows, keyFn) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        keyFn(row),
      );

    out[key] =
      (out[key] ?? 0) +
      1;
  }

  return Object.fromEntries(
    Object
      .entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function uniqueCount(
  rows,
  selector,
) {
  return new Set(
    rows.map(
      selector,
    ),
  ).size;
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
        'opendart-corporate-action-incremental-v9-10-1.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-workset-v9-10-2.json',
      ),
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      'V9_8_1_INPUT_NOT_FOUND',
    );
  }

  const source =
    JSON.parse(
      fs
        .readFileSync(
          inputFile,
          'utf8',
        )
        .replace(
          /^\uFEFF/,
          '',
        ),
    );

  if (
    source.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'V9_8_1_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    source.status !==
    'INCREMENTAL_INVENTORY_COMPLETE'
  ) {
    throw new Error(
      'V9_8_1_INPUT_NOT_COMPLETE',
    );
  }

  if (
    !Array.isArray(
      source.candidates,
    )
  ) {
    throw new Error(
      'V9_8_1_CANDIDATES_MISSING',
    );
  }

  const identities =
    new Set();

  for (
    const candidate of
    source.candidates
  ) {
    const identity =
      `${candidate.receiptNo}|${candidate.candidateActionType}`;

    if (
      identities.has(
        identity,
      )
    ) {
      throw new Error(
        'DUPLICATE_V9_8_1_CANDIDATE_IDENTITY',
      );
    }

    identities.add(
      identity,
    );
  }

  const workset =
    source.candidates.map(
      classifyCandidate,
    );

  const detailFetchQueue =
    workset
      .filter(
        (row) =>
          row.autoDetailFetch,
      )
      .sort(
        (a, b) =>
          String(a.receiptDate)
            .localeCompare(
              String(b.receiptDate),
            ) ||
          String(a.receiptNo)
            .localeCompare(
              String(b.receiptNo),
            ),
      );

  const chainLookupQueue =
    workset
      .filter(
        (row) =>
          row.needsChainLookup,
      );

  const currentContractRows =
    workset
      .filter(
        (row) =>
          CURRENT_CANONICAL_ACTION_TYPES.has(
            row.actionType,
          ),
      );

  const outOfScopeRows =
    workset
      .filter(
        (row) =>
          !CURRENT_CANONICAL_ACTION_TYPES.has(
            row.actionType,
          ),
      );

  const productionCandidateRows =
    workset
      .filter(
        (row) =>
          row.canBecomeProductionEvent,
      );

  const autoExcludedRows =
    workset
      .filter(
        (row) =>
          !row.autoDetailFetch,
      );

  const report = {
    version:
      VERSION,

    status:
      'DETAIL_WORKSET_READY',

    source: {
      version:
        source.version,

      status:
        source.status,

      startDate:
        source.startDate,

      throughDate:
        source.throughDate,

      sourceCandidateCount:
        source.candidates.length,

      inputFile,

      inputFingerprint:
        sha256(
          JSON.stringify(
            source.candidates,
          ),
        ),
    },

    currentCanonicalContract: [
      ...CURRENT_CANONICAL_ACTION_TYPES,
    ],

    counts: {
      sourceCandidates:
        source.candidates.length,

      inCurrentCanonicalContract:
        currentContractRows.length,

      outOfCurrentCanonicalScope:
        outOfScopeRows.length,

      detailFetchQueue:
        detailFetchQueue.length,

      chainLookupQueue:
        chainLookupQueue.length,

      currentlyEligibleStandaloneProductionCandidates:
        productionCandidateRows.length,

      autoExcludedWithoutDetailFetch:
        autoExcludedRows.length,

      uniqueReceiptNos:
        uniqueCount(
          workset,
          (row) =>
            row.receiptNo,
        ),

      uniqueCorpCodesInDetailQueue:
        uniqueCount(
          detailFetchQueue,
          (row) =>
            row.corpCode,
        ),

      uniqueStockCodesInDetailQueue:
        uniqueCount(
          detailFetchQueue.filter(
            (row) =>
              row.stockCode,
          ),
          (row) =>
            row.stockCode,
        ),
    },

    gateCounts:
      countBy(
        workset,
        (row) =>
          row.gate,
      ),

    actionTypeCountsByGate:
      Object.fromEntries(
        [
          ...new Set(
            workset.map(
              (row) =>
                row.gate,
            ),
          ),
        ]
          .sort()
          .map(
            (gate) => [
              gate,
              countBy(
                workset.filter(
                  (row) =>
                    row.gate ===
                    gate,
                ),
                (row) =>
                  row.actionType,
              ),
            ],
          ),
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

      correctionProviderIdentityAssigned:
        false,

      effectiveDatesParsed:
        false,

      factorMutation:
        false,
    },

    policy: {
      rightsIssue:
        'OUT_OF_CURRENT_V9_7_CANONICAL_CONTRACT',

      correction:
        'MUST_RESOLVE_ORIGINAL_RECEIPT_BEFORE_CANONICAL_IDENTITY',

      withdrawal:
        'CHAIN_CONTROL_ONLY_NOT_NEW_EVENT',

      followupNotice:
        'NOT_A_NEW_CORPORATE_ACTION_EVENT',

      subsidiaryOrOtherEntity:
        'QUARANTINE_FROM_AUTOMATIC_PARENT_SECURITY_EVENT',

      strictSplitTitle:
        'REQUIRE_STOCK_SPLIT_DECISION_TITLE',

      strictReverseSplitTitle:
        'REQUIRE_REVERSE_SPLIT_DECISION_TITLE',
    },

    detailFetchQueue,

    chainLookupQueue,

    productionCandidateRows,

    autoExcludedRows,

    allRows:
      workset,

    outputFile,
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        sourceFingerprint:
          report
            .source
            .inputFingerprint,

        gateCounts:
          report.gateCounts,

        queueWorkIds:
          detailFetchQueue.map(
            (row) =>
              row.workId,
          ),
      }),
    );

  atomicSave(
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

        sourceCandidates:
          report
            .counts
            .sourceCandidates,

        inCurrentCanonicalContract:
          report
            .counts
            .inCurrentCanonicalContract,

        outOfCurrentCanonicalScope:
          report
            .counts
            .outOfCurrentCanonicalScope,

        detailFetchQueue:
          report
            .counts
            .detailFetchQueue,

        chainLookupQueue:
          report
            .counts
            .chainLookupQueue,

        currentlyEligibleStandaloneProductionCandidates:
          report
            .counts
            .currentlyEligibleStandaloneProductionCandidates,

        autoExcludedWithoutDetailFetch:
          report
            .counts
            .autoExcludedWithoutDetailFetch,

        gateCounts:
          report.gateCounts,

        actionTypeCountsByGate:
          report.actionTypeCountsByGate,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        outputFile,
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
    String(
      error?.message ||
      error,
    )
      .replace(
        /[^A-Za-z0-9_:\-.,/\\]/g,
        '_',
      )
      .toUpperCase(),
  );

  process.exitCode =
    1;
}
