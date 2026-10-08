#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.2.1.1 replay launcher
 *
 * Purpose:
 * - preserve the existing local scripts/v9902-1-1.cjs business logic
 * - reconstruct the historical V9.8 carry-forward contract from repaired
 *   read-only replay artifacts
 * - NEVER spoof the historical V9.8.11.13 version
 * - create an explicit replay bridge closure
 * - create a patched replay COPY of v9902-1-1.cjs
 * - execute that replay copy immediately
 *
 * Carry-forward contract remains exactly:
 *   future ratio       24
 *   future structural  30
 *   future cash         1
 *   total              55
 *
 * 028080 physical provenance repair is NOT added to those 55 rows.
 * It remains a separate virtual repair overlay carried in bridge metadata.
 *
 * No network.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const LAUNCHER_VERSION =
  'V9_9_2_1_1_REPLAY_LAUNCHER_WITH_V9_8_REPAIRED_CARRY_FORWARD_BRIDGE';

const BRIDGE_VERSION =
  'V9_8_11_13_REPLAY_V2_V9_9_CARRY_FORWARD_BRIDGE';

const ORIGINAL_SCRIPT_VERSION =
  'V9_9_2_1_1_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const REPLAY_SCRIPT_VERSION =
  'V9_9_2_1_1_REPLAY_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION_FIELD_PATH_REPAIR';

const ORIGINAL_CLOSURE_VERSION =
  'V9_8_11_13_CORPORATE_ACTION_CYCLE_CLOSURE_AUDIT';

const EXPECTED_REPLAY_CLOSURE_VERSION =
  'V9_8_11_13_REPLAY_V2_CORPORATE_ACTION_CYCLE_CLOSURE_AUDIT';

const EXPECTED_WORKSET_VERSION =
  'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const EXPECTED = {
  worksetSourceCandidates: 15,
  worksetInContract: 7,
  futureRatio: 24,
  futureStructural: 30,
  futureCash: 1,
  carryForwardTotal: 55,
};

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function atomicSaveText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(tmp, value, 'utf8');
  fs.renameSync(tmp, file);
}

function replaceRequired(source, oldValue, newValue, label) {
  assert(
    source.includes(oldValue),
    `PATCH_TARGET_NOT_FOUND:${label}`,
  );

  return source.split(oldValue).join(newValue);
}

function normalizeRatioCarry(row) {
  return {
    providerEventId:
      String(row.providerEventId ?? ''),

    stockCode:
      String(row.stockCode ?? ''),

    actionType:
      String(row.actionType ?? ''),

    effectiveDate:
      row.effectiveDate ?? null,

    disposition:
      row.disposition ??
      row.eligibility ??
      'RECONFIRM_AFTER_EFFECTIVE_DATE_BEFORE_KIS_REFRESH',
  };
}

function normalizeStructuralCarry(row) {
  return {
    providerEventId:
      String(
        row.providerEventId ??
        row.provider_event_id ??
        '',
      ),

    stockCode:
      String(
        row.stockCode ??
        row.stock_code ??
        '',
      ),

    actionType:
      String(
        row.actionType ??
        row.action_type ??
        '',
      ),

    effectiveDate:
      row.effectiveDate ??
      row.effective_date ??
      null,

    sourceFingerprint:
      row.sourceFingerprint ??
      row.source_fingerprint ??
      null,

    disposition:
      row.disposition ??
      'DEFER_UNTIL_INCREMENTAL_REFRESH_RECONFIRMS',
  };
}

function normalizeCashCarry(row) {
  return {
    providerEventId:
      String(
        row.providerEventId ??
        row.provider_event_id ??
        '',
      ),

    sourceReceiptNo:
      String(
        row.sourceReceiptNo ??
        row.source_receipt_no ??
        row.providerEventId ??
        row.provider_event_id ??
        '',
      ),

    stockCode:
      String(
        row.stockCode ??
        row.stock_code ??
        '',
      ),

    actionType:
      String(
        row.actionType ??
        row.action_type ??
        '',
      ),

    recordDate:
      row.recordDate ??
      row.record_date ??
      null,

    effectiveDate:
      row.effectiveDate ??
      row.effective_date ??
      null,

    factorStatus:
      row.factorStatus ??
      row.factor_status ??
      null,

    reason:
      row.reason ??
      'FUTURE_MARKET_DATE_PENDING',

    disposition:
      'RECONFIRM_AFTER_RECORD_DATE_MARKET_CALENDAR_IS_AVAILABLE',
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const originalScriptFile =
    path.join(
      root,
      'scripts',
      'v9902-1-1.cjs',
    );

  const replayScriptFile =
    path.join(
      root,
      'scripts',
      'v9902-1-1-replay.cjs',
    );

  const replayClosureFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-8-11-13-replay-v2.json',
    );

  const ratioEligibilityFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json',
    );

  const snapshotEligibilityFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
    );

  const productionPreflightFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json',
    );

  const worksetFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-workset-v9-9-2.json',
    );

  const bridgeFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-8-11-13-replay-v2-v9-9-bridge.json',
    );

  const replayOutputFileName =
    'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1-replay.json';

  for (
    const file of [
      originalScriptFile,
      replayClosureFile,
      ratioEligibilityFile,
      snapshotEligibilityFile,
      productionPreflightFile,
      worksetFile,
    ]
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.relative(root, file)}`,
    );
  }

  const closure =
    readJson(replayClosureFile);

  const ratio =
    readJson(ratioEligibilityFile);

  const snapshot =
    readJson(snapshotEligibilityFile);

  const preflight =
    readJson(productionPreflightFile);

  const workset =
    readJson(worksetFile);

  assert(
    closure.version ===
      EXPECTED_REPLAY_CLOSURE_VERSION,
    `REPLAY_CLOSURE_VERSION_MISMATCH:${closure.version}`,
  );

  assert(
    closure.status ===
      'V9_8_REPLAY_CYCLE_CLOSED_AT_2026_10_01_PHYSICAL_REPAIR_PENDING',
    `REPLAY_CLOSURE_STATUS_MISMATCH:${closure.status}`,
  );

  assert(
    closure.closure
      ?.replayDependencyChainClosed === true,
    'REPLAY_DEPENDENCY_CHAIN_NOT_CLOSED',
  );

  assert(
    closure.closure
      ?.physicalProductionRepairOutstanding === true,
    'EXPECTED_PHYSICAL_REPAIR_OUTSTANDING',
  );

  assert(
    closure.outstandingPhysicalRepair
      ?.stockCode === '028080',
    `EXPECTED_028080_REPAIR:${closure.outstandingPhysicalRepair?.stockCode}`,
  );

  assert(
    workset.version ===
      EXPECTED_WORKSET_VERSION,
    `WORKSET_VERSION_MISMATCH:${workset.version}`,
  );

  assert(
    workset.status ===
      'DETAIL_WORKSET_READY',
    `WORKSET_STATUS_MISMATCH:${workset.status}`,
  );

  assert(
    Number(
      workset.counts
        ?.sourceCandidates,
    ) ===
      EXPECTED.worksetSourceCandidates,
    `WORKSET_SOURCE_CANDIDATES:${workset.counts?.sourceCandidates}`,
  );

  assert(
    Number(
      workset.counts
        ?.inCurrentCanonicalContract,
    ) ===
      EXPECTED.worksetInContract,
    `WORKSET_IN_CONTRACT:${workset.counts?.inCurrentCanonicalContract}`,
  );

  assert(
    workset.source
      ?.startDate ===
      '2026-10-02',
    `WORKSET_START_DATE:${workset.source?.startDate}`,
  );

  assert(
    workset.source
      ?.throughDate ===
      '2026-10-04',
    `WORKSET_THROUGH_DATE:${workset.source?.throughDate}`,
  );

  const futureRatioRaw =
    Array.isArray(
      ratio.futureDeferredPlan,
    )
      ? ratio.futureDeferredPlan
      : [];

  const futureStructuralRaw =
    Array.isArray(
      snapshot.deferredFutureStructuralRows,
    )
      ? snapshot.deferredFutureStructuralRows
      : [];

  const futureCashCandidates =
    Array.isArray(
      preflight.futurePendingRows,
    )
      ? preflight.futurePendingRows
      : [];

  const futureRatio =
    futureRatioRaw.map(
      normalizeRatioCarry,
    );

  const futureStructural =
    futureStructuralRaw.map(
      normalizeStructuralCarry,
    );

  const futureCashRows =
    futureCashCandidates
      .filter(
        (row) =>
          String(
            row.actionType ??
            row.action_type ??
            '',
          ) ===
          'CASH_DIVIDEND',
      )
      .map(
        normalizeCashCarry,
      );

  assert(
    futureRatio.length ===
      EXPECTED.futureRatio,
    `FUTURE_RATIO_COUNT:${futureRatio.length}`,
  );

  assert(
    futureStructural.length ===
      EXPECTED.futureStructural,
    `FUTURE_STRUCTURAL_COUNT:${futureStructural.length}`,
  );

  assert(
    futureCashRows.length ===
      EXPECTED.futureCash,
    `FUTURE_CASH_COUNT:${futureCashRows.length}`,
  );

  const futureCashDividend =
    futureCashRows[0];

  assert(
    futureCashDividend.providerEventId ===
      '20260928900449',
    `FUTURE_CASH_PROVIDER_ID:${futureCashDividend.providerEventId}`,
  );

  assert(
    futureCashDividend.stockCode ===
      '478560',
    `FUTURE_CASH_STOCK:${futureCashDividend.stockCode}`,
  );

  assert(
    futureCashDividend.recordDate ===
      '2026-10-13',
    `FUTURE_CASH_RECORD_DATE:${futureCashDividend.recordDate}`,
  );

  const carryForwardTotal =
    futureRatio.length +
    futureStructural.length +
    1;

  assert(
    carryForwardTotal ===
      EXPECTED.carryForwardTotal,
    `EXPECTED_55_CARRY_FORWARD_GOT_${carryForwardTotal}`,
  );

  const corrected003580Deferred =
    futureStructural.some(
      (row) =>
        row.providerEventId ===
          '20260807000649' &&
        row.stockCode ===
          '003580' &&
        row.actionType ===
          'MERGER' &&
        row.effectiveDate ===
          '2026-10-12',
    );

  assert(
    corrected003580Deferred,
    'CORRECTED_003580_NOT_IN_FUTURE_STRUCTURAL_CARRY_FORWARD',
  );

  // 028080 is an already-effective structural row. It must NOT be injected
  // into the historical 55 carry-forward workset.
  const carryForwardHas028080 =
    [
      ...futureRatio,
      ...futureStructural,
      futureCashDividend,
    ].some(
      (row) =>
        row.stockCode ===
        '028080',
    );

  assert(
    !carryForwardHas028080,
    '028080_MUST_NOT_BE_ADDED_TO_HISTORICAL_55_CARRY_FORWARD',
  );

  const bridge = {
    ...closure,

    version:
      BRIDGE_VERSION,

    status:
      'V9_8_REPLAY_CLOSURE_BRIDGED_FOR_V9_9_READ_ONLY_RECONCILIATION',

    bridge: {
      launcherVersion:
        LAUNCHER_VERSION,

      sourceReplayClosureVersion:
        closure.version,

      sourceReplayClosureFingerprint:
        closure.outputFingerprint ??
        null,

      historicalVersionSpoofed:
        false,

      purpose:
        'RECONSTRUCT_V9_9_PRIOR_CARRY_FORWARD_CONTRACT_FROM_REPAIRED_V9_8_REPLAY_ARTIFACTS',

      physical028080RepairOutstanding:
        true,

      physical028080RepairAddedToCarryForward:
        false,

      physical028080RepairMode:
        'SEPARATE_VIRTUAL_PROVENANCE_OVERLAY',

      carryForwardContract: {
        futureRatio:
          futureRatio.length,

        futureStructural:
          futureStructural.length,

        futureCash:
          1,

        total:
          carryForwardTotal,
      },
    },

    carryForward: {
      futureRatioActions:
        futureRatio,

      futureStructuralActions:
        futureStructural,

      futureCashDividend,
    },

    safety: {
      ...(closure.safety ?? {}),

      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    outputFile:
      path
        .relative(
          root,
          bridgeFile,
        )
        .replaceAll('\\', '/'),
  };

  bridge.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          bridge.version,

        sourceReplayClosureFingerprint:
          bridge.bridge
            .sourceReplayClosureFingerprint,

        carryForward:
          bridge.carryForward,

        outstandingPhysicalRepair:
          bridge.outstandingPhysicalRepair,
      }),
    );

  atomicSaveJson(
    bridgeFile,
    bridge,
  );

  // -------------------------------------------------------------------
  // Patch a COPY of the local authoritative field-path-repair script.
  // Business logic after input/version/path wiring remains unchanged.
  // -------------------------------------------------------------------

  let source =
    fs.readFileSync(
      originalScriptFile,
      'utf8',
    );

  source =
    replaceRequired(
      source,
      ORIGINAL_SCRIPT_VERSION,
      REPLAY_SCRIPT_VERSION,
      'SCRIPT_VERSION',
    );

  source =
    replaceRequired(
      source,
      ORIGINAL_CLOSURE_VERSION,
      BRIDGE_VERSION,
      'EXPECTED_CLOSURE_VERSION',
    );

  source =
    replaceRequired(
      source,
      'opendart-corporate-action-cycle-closure-v9-8-11-13.json',
      path.basename(bridgeFile),
      'CLOSURE_INPUT_FILE',
    );

  source =
    replaceRequired(
      source,
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1.json',
      replayOutputFileName,
      'REPLAY_OUTPUT_FILE',
    );

  const replayHeader =
    `/**\n` +
    ` * REPLAY COPY GENERATED BY ${LAUNCHER_VERSION}\n` +
    ` * Source business logic: scripts/v9902-1-1.cjs\n` +
    ` * Historical versions are NOT spoofed.\n` +
    ` * V9.8 physical 028080 repair remains a separate virtual overlay.\n` +
    ` */\n\n`;

  source =
    replayHeader + source;

  atomicSaveText(
    replayScriptFile,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_2_1_1_REPLAY_BRIDGE_AND_SCRIPT_BUILT',

        version:
          LAUNCHER_VERSION,

        bridgeVersion:
          BRIDGE_VERSION,

        replayScriptVersion:
          REPLAY_SCRIPT_VERSION,

        workset: {
          startDate:
            workset.source.startDate,

          throughDate:
            workset.source.throughDate,

          sourceCandidates:
            workset.counts.sourceCandidates,

          inCurrentCanonicalContract:
            workset.counts
              .inCurrentCanonicalContract,
        },

        priorCarryForward: {
          futureRatio:
            futureRatio.length,

          futureStructural:
            futureStructural.length,

          futureCash:
            1,

          total:
            carryForwardTotal,

          corrected003580Deferred,
        },

        physical028080Repair: {
          outstanding:
            true,

          addedToCarryForward55:
            false,

          mode:
            'SEPARATE_VIRTUAL_PROVENANCE_OVERLAY',
        },

        bridgeFile:
          path
            .relative(
              root,
              bridgeFile,
            )
            .replaceAll('\\', '/'),

        replayScript:
          path
            .relative(
              root,
              replayScriptFile,
            )
            .replaceAll('\\', '/'),

        databaseWrites:
          0,

        networkRequests:
          0,

        nextAction:
          'EXECUTE_REPLAY_RECONCILIATION_COPY',
      },
      null,
      2,
    ),
  );

  const child =
    spawnSync(
      process.execPath,
      [replayScriptFile],
      {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
      },
    );

  if (child.error) {
    throw child.error;
  }

  if (child.status !== 0) {
    process.exitCode =
      child.status ?? 2;
    return;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_9_2_1_1_REPLAY_LAUNCH_FAILED',

        version:
          LAUNCHER_VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        networkRequests:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
