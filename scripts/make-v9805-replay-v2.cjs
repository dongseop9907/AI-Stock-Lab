#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.5 replay adapter V2
 *
 * Fix from V1:
 * - Do NOT put PARENT_SECURITY_SCOPE_EXCLUDED / OTHER_ENTITY ambiguous rows
 *   into finalPrecision.quarantineQueue.
 * - Quarantine only ambiguities that can block parent-security canonical
 *   selection (currently the 4 Korea Carbon provider-014 rows).
 *
 * Reuses:
 *   logs/v9805-replay-chain-view.json
 *   logs/v9805-replay-precision-view.json
 *
 * Creates:
 *   logs/v9805-replay-final-precision-view-v2.json
 *   scripts/v9805-replay-v2.cjs
 *
 * Safety:
 * - no network
 * - no DB
 * - no production writes
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

const consolidatedFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-3.json',
);

const sourceReplayScript = path.join(
  __dirname,
  'v9805-replay.cjs',
);

const outputFinalView = path.join(
  root,
  'logs',
  'v9805-replay-final-precision-view-v2.json',
);

const outputReplayScript = path.join(
  __dirname,
  'v9805-replay-v2.cjs',
);

const CONSOLIDATED_VERSION =
  'V9_8_4_3_FIRST_PARTY_CHAIN_EVIDENCE_INTEGRATION';

const FINAL_VIEW_VERSION =
  'V9_8_4_3_REPLAY_FINAL_PRECISION_VIEW_V2';

const REPLAY_VERSION =
  'V9_8_5_REPLAY_V2_FROM_V9_8_4_3_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8'),
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');
}

const consolidated =
  readJson(consolidatedFile);

if (
  consolidated.version !==
  CONSOLIDATED_VERSION
) {
  throw new Error(
    `CONSOLIDATED_VERSION_MISMATCH:${consolidated.version}`,
  );
}

const ambiguous =
  (consolidated.resolutions ?? [])
    .filter(
      (row) =>
        row.resolutionStatus ===
        'AMBIGUOUS',
    );

const parentScopeExcluded =
  ambiguous.filter(
    (row) =>
      row.downstreamDisposition
        ?.disposition ===
      'PARENT_SECURITY_SCOPE_EXCLUDED',
  );

const blockingAmbiguous =
  ambiguous.filter(
    (row) =>
      row.downstreamDisposition
        ?.disposition !==
      'PARENT_SECURITY_SCOPE_EXCLUDED',
  );

const quarantineQueue =
  blockingAmbiguous.map(
    (row) => ({
      receiptNo:
        row.receiptNo,
      targetReceiptNo:
        row.receiptNo,
      stockCode:
        row.stockCode ?? null,
      corpCode:
        row.corpCode ?? null,
      actionType:
        row.actionType ?? null,
      gate:
        row.gate ?? null,

      candidateReceiptNos:
        (row.plausibleRoots ?? [])
          .map(String),

      reason:
        row.externalCorroboration
          ?.disposition ??
        'V9_8_4_3_REMAINING_AMBIGUOUS',

      externalCorroboration:
        row.externalCorroboration ??
        null,
    }),
  );

const finalView = {
  version:
    FINAL_VIEW_VERSION,

  status:
    'CONSOLIDATED_FINAL_VIEW_WITH_PARENT_SCOPE_EXCLUSIONS_REMOVED_FROM_QUARANTINE',

  source: {
    consolidatedVersion:
      consolidated.version,

    representation:
      'TRANSPARENT_COMPATIBILITY_VIEW',

    policy:
      'QUARANTINE_ONLY_PARENT_SECURITY_BLOCKING_AMBIGUITIES',
  },

  rows: [],
  quarantineQueue,

  accounting: {
    totalAmbiguous:
      ambiguous.length,

    quarantinedBlockingAmbiguous:
      blockingAmbiguous.length,

    parentSecurityScopeExcludedNotQuarantined:
      parentScopeExcluded.length,

    parentSecurityScopeExcludedReceipts:
      parentScopeExcluded.map(
        (row) => row.receiptNo,
      ),
  },
};

finalView.outputFingerprint =
  sha256(finalView);

fs.writeFileSync(
  outputFinalView,
  JSON.stringify(
    finalView,
    null,
    2,
  ),
  'utf8',
);

let replaySource =
  fs.readFileSync(
    sourceReplayScript,
    'utf8',
  );

const oldVersion =
  "'V9_8_5_REPLAY_FROM_V9_8_4_3_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION'";

const oldFinal =
  "'V9_8_4_3_REPLAY_FINAL_PRECISION_VIEW'";

if (
  !replaySource.includes(
    oldVersion,
  )
) {
  throw new Error(
    'REPLAY_V1_VERSION_MARKER_NOT_FOUND',
  );
}

if (
  !replaySource.includes(
    oldFinal,
  )
) {
  throw new Error(
    'REPLAY_V1_FINAL_VIEW_VERSION_MARKER_NOT_FOUND',
  );
}

replaySource =
  replaySource.replace(
    oldVersion,
    `'${REPLAY_VERSION}'`,
  );

replaySource =
  replaySource.replace(
    oldFinal,
    `'${FINAL_VIEW_VERSION}'`,
  );

fs.writeFileSync(
  outputReplayScript,
  replaySource,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_5_REPLAY_ADAPTER_V2_BUILT',

      counts: {
        totalAmbiguous:
          ambiguous.length,

        quarantinedBlockingAmbiguous:
          blockingAmbiguous.length,

        parentSecurityScopeExcludedNotQuarantined:
          parentScopeExcluded.length,

        ambiguousRootCandidates:
          [
            ...new Set(
              quarantineQueue.flatMap(
                (row) =>
                  row.candidateReceiptNos,
              ),
            ),
          ].length,
      },

      versions: {
        replay:
          REPLAY_VERSION,

        finalPrecisionView:
          FINAL_VIEW_VERSION,
      },

      files: {
        replayScript:
          path
            .relative(
              root,
              outputReplayScript,
            )
            .replaceAll('\\', '/'),

        finalPrecisionView:
          path
            .relative(
              root,
              outputFinalView,
            )
            .replaceAll('\\', '/'),
      },

      safety: {
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
      },
    },
    null,
    2,
  ),
);
