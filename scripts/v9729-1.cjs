'use strict';

// V9.7.29.1 - fix false REFRESHED when explicit corporate-action stocks are inactive.
// Default: dry-run
// Apply:   node .\scripts\v9729-1.cjs --apply
//
// Patches:
// 1) syncDailyBars input gets includeInactiveExplicitStocks?: boolean
// 2) Explicit stock-code refresh may include inactive stocks.
// 3) Corporate-action refresh enables that option.
// 4) Corporate-action refresh refuses to report REFRESHED when sync did no work.
//
// Installer performs no DB/KIS/network access.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_7_29_1_INACTIVE_EXPLICIT_STOCK_REFRESH_AND_FALSE_SUCCESS_GUARD';

const root = path.resolve(__dirname, '..');

const syncRel = 'lib/market/sync-daily-bars.ts';
const refreshRel = 'lib/market/refresh-corporate-action-history-v9-7-26.ts';

const syncFile = path.join(root, ...syncRel.split('/'));
const refreshFile = path.join(root, ...refreshRel.split('/'));

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readRequired(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`TARGET_NOT_FOUND:${path.relative(root, file)}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function countMatches(text, rx) {
  const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
  return [...text.matchAll(new RegExp(rx.source, flags))].length;
}

function replaceExactlyOne(text, rx, replacement, label) {
  const count = countMatches(text, rx);
  if (count !== 1) {
    throw new Error(`${label}_MATCH_COUNT_${count}`);
  }
  return text.replace(rx, replacement);
}

function patchSync(text) {
  const eol = eolOf(text);

  if (!text.includes('includeInactiveExplicitStocks?: boolean')) {
    const inputRx = /(  adjustedPrice\?: boolean;\r?\n)/m;

    text = replaceExactlyOne(
      text,
      inputRx,
      [
        '$1',
        '',
        '  /*',
        '   * V9.7.29.1:',
        '   * only for explicitly requested stockCodes.',
        '   * Corporate-action history may need suspended/inactive',
        '   * securities that still have stored historical bars.',
        '   */',
        '  includeInactiveExplicitStocks?: boolean;',
        '',
      ].join(eol),
      'SYNC_INPUT_FLAG',
    );
  }

  if (!text.includes('const includeInactiveExplicitStocks =')) {
    const requestedCodesRx =
      /(  const requestedCodes\s*=\s*\r?\n\s*normalizeStockCodes\(\s*\r?\n\s*input\.stockCodes,\s*\r?\n\s*\);\r?\n)/m;

    text = replaceExactlyOne(
      text,
      requestedCodesRx,
      [
        '$1',
        '',
        '  const includeInactiveExplicitStocks =',
        '    requestedCodes.length >',
        '      0 &&',
        '    input.includeInactiveExplicitStocks ===',
        '      true;',
        '',
      ].join(eol),
      'SYNC_EXPLICIT_INACTIVE_FLAG',
    );
  }

  if (!/\.in\(\s*\r?\n\s*"is_active"/m.test(text)) {
    const activeFilterRx =
      /\.eq\(\s*\r?\n\s*"is_active",\s*\r?\n\s*true,\s*\r?\n\s*\)/m;

    const replacement = [
      '.in(',
      '        "is_active",',
      '        includeInactiveExplicitStocks',
      '          ? [',
      '              true,',
      '              false,',
      '            ]',
      '          : [',
      '              true,',
      '            ],',
      '      )',
    ].join(eol);

    text = replaceExactlyOne(
      text,
      activeFilterRx,
      replacement,
      'SYNC_ACTIVE_FILTER',
    );
  }

  return text;
}

function patchRefresh(text) {
  const eol = eolOf(text);

  if (!text.includes('includeInactiveExplicitStocks:')) {
    const adjustedArgRx =
      /(          adjustedPrice:\s*\r?\n\s*true,\r?\n)(\s*chunkDays:)/m;

    text = replaceExactlyOne(
      text,
      adjustedArgRx,
      [
        '$1',
        '          includeInactiveExplicitStocks:',
        '            true,',
        '$2',
      ].join(eol),
      'REFRESH_ENABLE_INACTIVE_EXPLICIT',
    );
  }

  if (!text.includes('CORPORATE_ACTION_REFRESH_SYNC_DID_NO_WORK')) {
    const afterSyncRx =
      /(      const syncResult\s*=\s*\r?\n\s*await syncDailyBars\(\{[\s\S]*?\r?\n\s*\}\);\r?\n)(\r?\n\s*targets\.push\(\{\r?\n\s*eventId:)/m;

    const guard = [
      '$1',
      '',
      '      const syncDidRealWork =',
      '        syncResult.requestedStocks >',
      '          0 &&',
      '        syncResult.requestedRanges >',
      '          0 &&',
      '        syncResult.receivedRows >',
      '          0 &&',
      '        syncResult.savedRows >',
      '          0 &&',
      '        syncResult.failures.length ===',
      '          0;',
      '',
      '      if (',
      '        !syncDidRealWork',
      '      ) {',
      '        targets.push({',
      '          eventId:',
      '            event.id,',
      '          stockCode:',
      '            event.stock_code,',
      '          actionType:',
      '            event.action_type as RefreshActionType,',
      '          effectiveDate,',
      '          staleEvidence:',
      '            true,',
      '          earliestStoredDate,',
      '          refreshStartDate:',
      '            earliestStoredDate,',
      '          refreshEndDate,',
      '          status:',
      '            "REFRESH_FAILED",',
      '          syncResult,',
      '          error:',
      '            "CORPORATE_ACTION_REFRESH_SYNC_DID_NO_WORK",',
      '        });',
      '',
      '        continue;',
      '      }',
      '$2',
    ].join(eol);

    text = replaceExactlyOne(
      text,
      afterSyncRx,
      guard,
      'REFRESH_FALSE_SUCCESS_GUARD',
    );
  }

  return text;
}

function backupAndWrite(file, content) {
  const backup = file + '.bak-v9729-1';

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  const tmp = file + '.tmp-v9729-1';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);

  return path.relative(root, backup).replaceAll('\\', '/');
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  for (const arg of args) {
    if (arg !== '--apply') {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  const syncBefore = readRequired(syncFile);
  const refreshBefore = readRequired(refreshFile);

  const syncAfter = patchSync(syncBefore);
  const refreshAfter = patchRefresh(refreshBefore);

  const verification = {
    sync: {
      inputFlagPresent:
        syncAfter.includes('includeInactiveExplicitStocks?: boolean'),
      explicitInactiveGatePresent:
        syncAfter.includes('const includeInactiveExplicitStocks ='),
      activeFilterCanIncludeInactive:
        /\.in\([\s\S]{0,250}?"is_active"[\s\S]{0,250}?includeInactiveExplicitStocks/m
          .test(syncAfter),
      adjustedPriceContractStillPresent:
        syncAfter.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE'),
    },
    refresh: {
      inactiveExplicitEnabled:
        /includeInactiveExplicitStocks:\s*\r?\n\s*true,/m
          .test(refreshAfter),
      falseSuccessGuardPresent:
        refreshAfter.includes('CORPORATE_ACTION_REFRESH_SYNC_DID_NO_WORK'),
      requiresRequestedStocks:
        /syncResult\.requestedStocks\s*>\s*\r?\n\s*0/m
          .test(refreshAfter),
      requiresRequestedRanges:
        /syncResult\.requestedRanges\s*>\s*\r?\n\s*0/m
          .test(refreshAfter),
      requiresSavedRows:
        /syncResult\.savedRows\s*>\s*\r?\n\s*0/m
          .test(refreshAfter),
      adjustedPriceStillForced:
        /adjustedPrice:\s*\r?\n\s*true,/m
          .test(refreshAfter),
    },
  };

  const ready =
    Object.values(verification.sync).every(Boolean) &&
    Object.values(verification.refresh).every(Boolean);

  if (!ready) {
    throw new Error('POST_PATCH_VERIFICATION_FAILED');
  }

  const changes = [
    {
      file: syncRel,
      changed: syncBefore !== syncAfter,
      beforeSha256: sha256(syncBefore),
      afterSha256: sha256(syncAfter),
      lineEnding: eolOf(syncBefore) === '\r\n' ? 'CRLF' : 'LF',
    },
    {
      file: refreshRel,
      changed: refreshBefore !== refreshAfter,
      beforeSha256: sha256(refreshBefore),
      afterSha256: sha256(refreshAfter),
      lineEnding: eolOf(refreshBefore) === '\r\n' ? 'CRLF' : 'LF',
    },
  ];

  const applied = [];

  if (apply) {
    applied.push({
      file: syncRel,
      result: 'UPDATED',
      backup: backupAndWrite(syncFile, syncAfter),
    });

    applied.push({
      file: refreshRel,
      result: 'UPDATED',
      backup: backupAndWrite(refreshFile, refreshAfter),
    });
  }

  const report = {
    version: VERSION,
    status: apply
      ? 'INACTIVE_EXPLICIT_STOCK_REFRESH_FIX_APPLIED'
      : 'INACTIVE_EXPLICIT_STOCK_REFRESH_FIX_DRY_RUN_READY',
    applyRequested: apply,
    verification,
    changes,
    applied,
    diagnosis: {
      observedFalseRefresh: true,
      observedSyncResult: {
        requestedStocks: 0,
        requestedRanges: 0,
        receivedRows: 0,
        savedRows: 0,
      },
      rootCause:
        'EXPLICIT_CORPORATE_ACTION_STOCK_FILTERED_BY_ACTIVE_STOCK_UNIVERSE',
      falseSuccessNowBlocked: true,
    },
    safety: {
      installerNetworkAccess: false,
      installerDatabaseAccess: false,
      databaseWrites: 0,
      sourceFilesModified: apply ? 2 : 0,
    },
    nextCommands: apply
      ? [
          'npx tsc --noEmit',
          'restart dev server',
          'rerun production history-refresh API',
        ]
      : [
          'node .\\scripts\\v9729-1.cjs --apply',
        ],
  };

  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const reportFile = path.join(
    logDir,
    'inactive-explicit-stock-refresh-fix-v9-7-29-1.json',
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2),
    'utf8',
  );

  console.log(JSON.stringify({
    status: report.status,
    applyRequested: apply,
    verification,
    changes,
    diagnosis: report.diagnosis,
    sourceFilesModified: report.safety.sourceFilesModified,
    databaseWrites: 0,
    nextCommands: report.nextCommands,
  }, null, 2));

  console.log('Report: ' + reportFile);
}

try {
  main();
} catch (error) {
  console.error(
    String(error?.message || error)
      .replace(/[^A-Za-z0-9_:\-.,/\\]/g, '_')
      .toUpperCase(),
  );

  process.exitCode = 1;
}
