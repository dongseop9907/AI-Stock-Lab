'use strict';

// V9.7.29.2 - explicit corporate-action stock codes must not depend on stocks-table membership.
// Default: dry-run
// Apply:   node .\scripts\v9729-2.cjs --apply
//
// This patch only changes syncDailyBars behavior when BOTH are true:
//   - explicit stockCodes were supplied
//   - includeInactiveExplicitStocks === true
//
// Missing explicit codes are synthesized as minimal stock rows so KIS is still queried.
// Normal EOD behavior is unchanged.
//
// Installer performs no DB/KIS/network access.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_7_29_2_EXPLICIT_STOCK_CODES_BYPASS_STOCK_UNIVERSE_MEMBERSHIP';

const root = path.resolve(__dirname, '..');
const syncRel = 'lib/market/sync-daily-bars.ts';
const syncFile = path.join(root, ...syncRel.split('/'));

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
  if (
    text.includes('explicitFallbackStocks') &&
    text.includes('missingExplicitCodes')
  ) {
    return text;
  }

  const eol = eolOf(text);

  const stocksRx =
    /  const stocks\s*=\s*\r?\n\s*\(stockData\s*\?\?\s*\r?\n\s*\[\]\)\s*as ActiveStock\[\];/m;

  const replacement = [
    '  const queriedStocks =',
    '    (stockData ??',
    '      []) as ActiveStock[];',
    '',
    '  /*',
    '   * V9.7.29.2:',
    '   * An explicit corporate-action refresh must not depend on',
    '   * the security still being present in the active stock universe.',
    '   *',
    '   * When the internal opt-in flag is enabled, preserve any rows',
    '   * found in stocks and synthesize minimal rows for missing explicit',
    '   * codes. KIS then becomes the authoritative existence/data check.',
    '   */',
    '  const queriedCodeSet =',
    '    new Set(',
    '      queriedStocks.map(',
    '        (stock) =>',
    '          stock.stock_code,',
    '      ),',
    '    );',
    '',
    '  const missingExplicitCodes =',
    '    includeInactiveExplicitStocks',
    '      ? requestedCodes.filter(',
    '          (stockCode) =>',
    '            !queriedCodeSet.has(',
    '              stockCode,',
    '            ),',
    '        )',
    '      : [];',
    '',
    '  const explicitFallbackStocks:',
    '    ActiveStock[] =',
    '    missingExplicitCodes.map(',
    '      (stockCode) => ({',
    '        stock_code:',
    '          stockCode,',
    '        stock_name:',
    '          stockCode,',
    '      }),',
    '    );',
    '',
    '  const stocks =',
    '    includeInactiveExplicitStocks',
    '      ? [',
    '          ...queriedStocks,',
    '          ...explicitFallbackStocks,',
    '        ]',
    '      : queriedStocks;',
  ].join(eol);

  return replaceExactlyOne(
    text,
    stocksRx,
    replacement,
    'SYNC_STOCKS_MATERIALIZATION',
  );
}

function backupAndWrite(file, content) {
  const backup = file + '.bak-v9729-2';

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  const tmp = file + '.tmp-v9729-2';
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

  const before = readRequired(syncFile);
  const after = patchSync(before);

  const verification = {
    inputFlagStillPresent:
      after.includes('includeInactiveExplicitStocks?: boolean'),
    inactiveGateStillPresent:
      after.includes('const includeInactiveExplicitStocks ='),
    queriedStocksPresent:
      after.includes('const queriedStocks ='),
    missingExplicitCodesPresent:
      after.includes('const missingExplicitCodes ='),
    explicitFallbackStocksPresent:
      after.includes('const explicitFallbackStocks:'),
    missingCodesSynthesized:
      /missingExplicitCodes\.map\([\s\S]{0,250}?stock_code:/m.test(after),
    fallbackMergedIntoStocks:
      /\.\.\.queriedStocks,[\s\S]{0,120}?\.\.\.explicitFallbackStocks/m.test(after),
    normalPathUsesQueriedStocks:
      /:\s*queriedStocks;/m.test(after),
    adjustedPriceContractStillPresent:
      after.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE'),
  };

  const ready =
    Object.values(verification).every(Boolean);

  if (!ready) {
    throw new Error('POST_PATCH_VERIFICATION_FAILED');
  }

  const changes = [
    {
      file: syncRel,
      changed: before !== after,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      lineEnding:
        eolOf(before) === '\r\n'
          ? 'CRLF'
          : 'LF',
    },
  ];

  const applied = [];

  if (apply) {
    applied.push({
      file: syncRel,
      result: 'UPDATED',
      backup: backupAndWrite(syncFile, after),
    });
  }

  const report = {
    version: VERSION,
    status: apply
      ? 'EXPLICIT_STOCK_UNIVERSE_BYPASS_FIX_APPLIED'
      : 'EXPLICIT_STOCK_UNIVERSE_BYPASS_FIX_DRY_RUN_READY',
    applyRequested: apply,
    verification,
    changes,
    applied,
    diagnosis: {
      previousInactiveFilterFixInsufficient: true,
      remainingCause:
        'EXPLICIT_CODES_ABSENT_FROM_OR_NOT_RETURNED_BY_STOCKS_TABLE',
      correctedBehavior:
        'EXPLICIT_INTERNAL_REFRESH_CODES_SYNTHESIZED_WHEN_STOCKS_TABLE_DOES_NOT_RETURN_THEM',
      normalEodUniverseBehaviorChanged: false,
      kisRemainsFinalDataAuthority: true,
    },
    safety: {
      installerNetworkAccess: false,
      installerDatabaseAccess: false,
      databaseWrites: 0,
      sourceFilesModified: apply ? 1 : 0,
    },
    nextCommands: apply
      ? [
          'npx tsc --noEmit',
          'restart dev server',
          'rerun production history-refresh API',
        ]
      : [
          'node .\\scripts\\v9729-2.cjs --apply',
        ],
  };

  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const reportFile = path.join(
    logDir,
    'explicit-stock-universe-bypass-fix-v9-7-29-2.json',
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
