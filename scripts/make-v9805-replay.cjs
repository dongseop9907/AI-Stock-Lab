#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Build a transparent V9.8.5 replay adapter for V9.8.4.3.
 *
 * Why:
 * - Original v9805.cjs consumes three historical chain stages:
 *   chain.resolutions + precision.rows + finalPrecision.rows/quarantineQueue.
 * - V9.8.4.3 is now the consolidated upstream truth.
 * - We preserve the original V9.8.5 selection algorithm by creating explicit
 *   compatibility views with NEW version names (no version spoofing).
 *
 * Outputs:
 *   logs/v9805-replay-chain-view.json
 *   logs/v9805-replay-precision-view.json
 *   logs/v9805-replay-final-precision-view.json
 *   scripts/v9805-replay.cjs
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

const sourceScript = path.join(
  __dirname,
  'v9805.cjs',
);

const consolidatedFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-3.json',
);

const chainViewFile = path.join(
  root,
  'logs',
  'v9805-replay-chain-view.json',
);

const precisionViewFile = path.join(
  root,
  'logs',
  'v9805-replay-precision-view.json',
);

const finalPrecisionViewFile = path.join(
  root,
  'logs',
  'v9805-replay-final-precision-view.json',
);

const replayScript = path.join(
  __dirname,
  'v9805-replay.cjs',
);

const CONSOLIDATED_VERSION =
  'V9_8_4_3_FIRST_PARTY_CHAIN_EVIDENCE_INTEGRATION';

const CHAIN_VIEW_VERSION =
  'V9_8_4_3_REPLAY_CHAIN_VIEW';

const PRECISION_VIEW_VERSION =
  'V9_8_4_3_REPLAY_PRECISION_VIEW';

const FINAL_PRECISION_VIEW_VERSION =
  'V9_8_4_3_REPLAY_FINAL_PRECISION_VIEW';

const REPLAY_VERSION =
  'V9_8_5_REPLAY_FROM_V9_8_4_3_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';

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

function atomicJson(file, value) {
  const temp =
    `${file}.tmp-${process.pid}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(temp, file);
}

function replaceExactlyOnce(source, regex, replacement, label) {
  const matches = source.match(
    new RegExp(regex.source, regex.flags.includes('g')
      ? regex.flags
      : regex.flags + 'g'),
  );

  if (!matches || matches.length !== 1) {
    throw new Error(
      `${label}_REPLACEMENT_MATCH_COUNT:${matches?.length ?? 0}`,
    );
  }

  return source.replace(
    regex,
    replacement,
  );
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

if (
  !Array.isArray(
    consolidated.resolutions,
  )
) {
  throw new Error(
    'CONSOLIDATED_RESOLUTIONS_MISSING',
  );
}

const resolved =
  consolidated.resolutions.filter(
    (row) =>
      row.resolutionStatus ===
        'RESOLVED' &&
      row.rootReceiptNo,
  );

const ambiguous =
  consolidated.resolutions.filter(
    (row) =>
      row.resolutionStatus ===
      'AMBIGUOUS',
  );

const unresolved =
  consolidated.resolutions.filter(
    (row) =>
      row.resolutionStatus ===
      'UNRESOLVED',
  );

if (unresolved.length !== 0) {
  throw new Error(
    `UNRESOLVED_ROWS_NOT_SUPPORTED:${unresolved.length}`,
  );
}

/*
 * Compatibility view 1:
 * Present the consolidated resolution set through the same
 * chain.resolutions interface consumed by original v9805.cjs.
 */
const chainView = {
  version:
    CHAIN_VIEW_VERSION,
  status:
    consolidated.status,
  source: {
    consolidatedVersion:
      consolidated.version,
    consolidatedFile:
      'logs/opendart-corporate-action-chain-resolution-v9-8-4-3.json',
    representation:
      'TRANSPARENT_COMPATIBILITY_VIEW',
  },
  counts: {
    total:
      consolidated.resolutions.length,
    resolved:
      resolved.length,
    ambiguous:
      ambiguous.length,
    unresolved:
      unresolved.length,
  },
  resolutions:
    consolidated.resolutions,
};

chainView.outputFingerprint =
  sha256(chainView);

/*
 * Compatibility view 2:
 * No separate precision overrides are required because V9.8.4.3
 * already contains all approved first-party HIGH mappings.
 */
const precisionView = {
  version:
    PRECISION_VIEW_VERSION,
  status:
    'NO_SEPARATE_PRECISION_OVERRIDES_REQUIRED',
  source: {
    consolidatedVersion:
      consolidated.version,
    representation:
      'EMPTY_COMPATIBILITY_VIEW',
  },
  rows: [],
};

precisionView.outputFingerprint =
  sha256(precisionView);

/*
 * Compatibility view 3:
 * Keep ALL remaining ambiguous candidate roots quarantined so
 * original V9.8.5 cannot silently reactivate a stale original.
 *
 * External MEDIUM Korea Carbon mappings remain proposed metadata only.
 * OTHER_ENTITY scope-excluded rows also remain auditable and are not
 * falsely promoted to a unique root.
 */
const quarantineQueue =
  ambiguous.map(
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
        row.downstreamDisposition
          ?.disposition ??
        'V9_8_4_3_REMAINING_AMBIGUOUS',
      externalCorroboration:
        row.externalCorroboration ??
        null,
      downstreamDisposition:
        row.downstreamDisposition ??
        null,
    }),
  );

const finalPrecisionView = {
  version:
    FINAL_PRECISION_VIEW_VERSION,
  status:
    'CONSOLIDATED_FINAL_VIEW',
  source: {
    consolidatedVersion:
      consolidated.version,
    representation:
      'TRANSPARENT_COMPATIBILITY_VIEW',
  },
  rows: [],
  quarantineQueue,
};

finalPrecisionView.outputFingerprint =
  sha256(finalPrecisionView);

atomicJson(
  chainViewFile,
  chainView,
);

atomicJson(
  precisionViewFile,
  precisionView,
);

atomicJson(
  finalPrecisionViewFile,
  finalPrecisionView,
);

/*
 * Patch ONLY the four version constants in a copy of original v9805.cjs.
 * All canonical chain collapse/source-selection logic stays unchanged.
 */
let source =
  fs.readFileSync(
    sourceScript,
    'utf8',
  );

source = replaceExactlyOnce(
  source,
  /const VERSION\s*=\s*'V9_8_5_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';/,
  `const VERSION =\n  '${REPLAY_VERSION}';`,
  'VERSION',
);

source = replaceExactlyOnce(
  source,
  /const CHAIN_VERSION\s*=\s*'V9_8_4_OPENDART_CORRECTION_WITHDRAWAL_CHAIN_RESOLVER';/,
  `const CHAIN_VERSION =\n  '${CHAIN_VIEW_VERSION}';`,
  'CHAIN_VERSION',
);

source = replaceExactlyOnce(
  source,
  /const PRECISION_VERSION\s*=\s*'V9_8_4_1_PRECISION_CORRECTION_CHAIN_RESOLVER';/,
  `const PRECISION_VERSION =\n  '${PRECISION_VIEW_VERSION}';`,
  'PRECISION_VERSION',
);

source = replaceExactlyOnce(
  source,
  /const FINAL_PRECISION_VERSION\s*=\s*'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER';/,
  `const FINAL_PRECISION_VERSION =\n  '${FINAL_PRECISION_VIEW_VERSION}';`,
  'FINAL_PRECISION_VERSION',
);

fs.writeFileSync(
  replayScript,
  source,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_5_REPLAY_ADAPTER_BUILT',
      consolidatedVersion:
        consolidated.version,
      counts: {
        total:
          consolidated.resolutions.length,
        resolved:
          resolved.length,
        ambiguous:
          ambiguous.length,
        quarantineQueue:
          quarantineQueue.length,
      },
      versions: {
        replay:
          REPLAY_VERSION,
        chainView:
          CHAIN_VIEW_VERSION,
        precisionView:
          PRECISION_VIEW_VERSION,
        finalPrecisionView:
          FINAL_PRECISION_VIEW_VERSION,
      },
      files: {
        replayScript:
          path.relative(
            root,
            replayScript,
          ).replaceAll('\\', '/'),
        chainView:
          path.relative(
            root,
            chainViewFile,
          ).replaceAll('\\', '/'),
        precisionView:
          path.relative(
            root,
            precisionViewFile,
          ).replaceAll('\\', '/'),
        finalPrecisionView:
          path.relative(
            root,
            finalPrecisionViewFile,
          ).replaceAll('\\', '/'),
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
