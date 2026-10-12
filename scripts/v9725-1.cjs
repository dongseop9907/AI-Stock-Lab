'use strict';

// V9.7.25.1 - robust adjusted-price storage contract lock.
// Fixes V9.7.25 exact-string anchor failure on CRLF/formatting differences.
//
// Default: dry-run.
// Apply: node .\scripts\v9725-1.cjs --apply
//
// No DB/KIS/network access.
// Creates .bak-v9725-1 before modifying each source file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_25_1_ADJUSTED_PRICE_STORAGE_CONTRACT_LOCK_ROBUST';
const root = path.resolve(__dirname, '..');

const files = {
  sync: path.join(root, 'lib', 'market', 'sync-daily-bars.ts'),
  route: path.join(root, 'app', 'api', 'market', 'daily-bars', 'sync', 'route.ts'),
  backfill: path.join(root, 'lib', 'market', 'process-market-data-backfill-v8-3.ts'),
};

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function read(file) {
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
  const copy = new RegExp(rx.source, flags);
  return [...text.matchAll(copy)].length;
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
    text.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE') &&
    /const\s+adjustedPrice\s*=\s*true\s*;/m.test(text)
  ) {
    return text;
  }

  const eol = eolOf(text);

  const rx =
    /(?:\s{2})const\s+adjustedPrice\s*=\s*input\.adjustedPrice\s*!==\s*false\s*;/m;

  const replacement = [
    '  /*',
    '   * V9.7.25.1 storage contract:',
    '   * market_daily_bars stores KIS mode 0 adjusted prices only.',
    '   * lib/kis/client.ts remains flexible for diagnostics.',
    '   */',
    '  if (',
    '    input.adjustedPrice ===',
    '    false',
    '  ) {',
    '    throw new Error(',
    '      "MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE",',
    '    );',
    '  }',
    '',
    '  const adjustedPrice =',
    '    true;',
  ].join(eol);

  return replaceExactlyOne(
    text,
    rx,
    replacement,
    'SYNC_ADJUSTED_PRICE_LOCK'
  );
}

function patchRoute(text) {
  if (text.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE')) {
    return text;
  }

  const eol = eolOf(text);

  const rx =
    /(\s{4}const\s+result\s*=\s*(?:\r?\n)\s*await\s+syncDailyBars\s*\(\s*\{)/m;

  const guard = [
    '    /*',
    '     * V9.7.25.1 storage contract:',
    '     * this endpoint only persists adjusted-price daily bars.',
    '     */',
    '    if (',
    '      body.adjustedPrice ===',
    '      false',
    '    ) {',
    '      return NextResponse.json(',
    '        {',
    '          ok: false,',
    '          error:',
    '            "MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE",',
    '        },',
    '        {',
    '          status: 400,',
    '        },',
    '      );',
    '    }',
    '',
  ].join(eol);

  const count = countMatches(text, rx);
  if (count !== 1) {
    throw new Error(`ROUTE_SYNC_CALL_MATCH_COUNT_${count}`);
  }

  return text.replace(rx, guard + '$1');
}

function patchBackfill(text) {
  if (text.includes('BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE')) {
    return text;
  }

  const eol = eolOf(text);

  // We know from v9.7.24.2 that run.adjusted_price is selected and later passed
  // to getDomesticDailyStockPrices. Insert the contract guard immediately before
  // the first use as adjustedPrice: run.adjusted_price.
  const rx =
    /(\s+adjustedPrice\s*:\s*(?:\r?\n)?\s*run\.adjusted_price\s*,)/m;

  const match = text.match(rx);
  if (!match) {
    throw new Error('BACKFILL_RUN_ADJUSTED_PRICE_USE_NOT_FOUND');
  }

  // Place guard at the beginning of the try/work block before the KIS call.
  // Find the nearest "const response =" preceding the matched use.
  const useIndex = match.index;
  const prefix = text.slice(0, useIndex);
  const responseRx = /(?:^|\r?\n)(\s*)const\s+response\s*=\s*$/gm;

  let last = null;
  for (const m of prefix.matchAll(responseRx)) {
    last = m;
  }

  if (!last || last.index == null) {
    throw new Error('BACKFILL_RESPONSE_ANCHOR_NOT_FOUND');
  }

  const insertionStart =
    last.index + (last[0].startsWith('\r\n') ? 2 :
                  last[0].startsWith('\n') ? 1 : 0);

  const indent = last[1] || '      ';

  const guard = [
    `${indent}/*`,
    `${indent} * V9.7.25.1 storage contract:`,
    `${indent} * market_daily_bars accepts adjusted-price backfills only.`,
    `${indent} */`,
    `${indent}if (`,
    `${indent}  run.adjusted_price !==`,
    `${indent}  true`,
    `${indent}) {`,
    `${indent}  throw new Error(`,
    `${indent}    "BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE",`,
    `${indent}  );`,
    `${indent}}`,
    '',
  ].join(eol);

  return text.slice(0, insertionStart) + guard + text.slice(insertionStart);
}

function verifySync(text) {
  return {
    guardPresent:
      text.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE'),
    forcedTrue:
      /const\s+adjustedPrice\s*=\s*true\s*;/m.test(text),
    oldPermissiveAssignmentPresent:
      /const\s+adjustedPrice\s*=\s*input\.adjustedPrice\s*!==\s*false\s*;/m.test(text),
  };
}

function verifyRoute(text) {
  return {
    guardPresent:
      text.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE'),
    syncCallPresent:
      /await\s+syncDailyBars\s*\(/m.test(text),
  };
}

function verifyBackfill(text) {
  return {
    guardPresent:
      text.includes('BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE'),
    runAdjustedPriceStillPassedToKis:
      /adjustedPrice\s*:\s*run\.adjusted_price/m.test(text),
    marketDailyBarsUpsertPresent:
      /["']market_daily_bars["'][\s\S]{0,300}?\.upsert\s*\(/m.test(text),
  };
}

function backupAndWrite(file, content) {
  const backup = file + '.bak-v9725-1';

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  const tmp = file + '.tmp-v9725-1';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);

  return path.relative(root, backup).replaceAll('\\', '/');
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  for (const a of args) {
    if (a !== '--apply') throw new Error('UNKNOWN_OPTION');
  }

  const before = {
    sync: read(files.sync),
    route: read(files.route),
    backfill: read(files.backfill),
  };

  const after = {
    sync: patchSync(before.sync),
    route: patchRoute(before.route),
    backfill: patchBackfill(before.backfill),
  };

  const verification = {
    sync: verifySync(after.sync),
    route: verifyRoute(after.route),
    backfill: verifyBackfill(after.backfill),
  };

  const ready =
    verification.sync.guardPresent &&
    verification.sync.forcedTrue &&
    !verification.sync.oldPermissiveAssignmentPresent &&
    verification.route.guardPresent &&
    verification.route.syncCallPresent &&
    verification.backfill.guardPresent &&
    verification.backfill.runAdjustedPriceStillPassedToKis &&
    verification.backfill.marketDailyBarsUpsertPresent;

  if (!ready) {
    throw new Error('POST_PATCH_VERIFICATION_FAILED');
  }

  const changes = Object.keys(files).map(k => ({
    file: path.relative(root, files[k]).replaceAll('\\', '/'),
    changed: before[k] !== after[k],
    beforeSha256: hash(before[k]),
    afterSha256: hash(after[k]),
    lineEnding: eolOf(before[k]) === '\r\n' ? 'CRLF' : 'LF',
  }));

  let backups = [];

  if (apply) {
    backups = [
      backupAndWrite(files.sync, after.sync),
      backupAndWrite(files.route, after.route),
      backupAndWrite(files.backfill, after.backfill),
    ];
  }

  const report = {
    version: VERSION,
    status: apply
      ? 'ADJUSTED_PRICE_STORAGE_CONTRACT_APPLIED'
      : 'ADJUSTED_PRICE_STORAGE_CONTRACT_DRY_RUN_READY',
    applyRequested: apply,
    policy: {
      marketDailyBarsPriceBasis: 'KIS_MODE_0_ADJUSTED_ONLY',
      kisClientRemainsFlexible: true,
      syncDailyBarsRejectsAdjustedPriceFalse: true,
      routeRejectsAdjustedPriceFalse: true,
      backfillRejectsAdjustedPriceFalseRun: true,
    },
    verification,
    changes,
    backups,
    safety: {
      networkAccess: false,
      databaseConnected: false,
      sourceFilesModified: apply ? 3 : 0,
      databaseWrites: 0,
    },
    nextCommand: apply
      ? null
      : 'node .\\scripts\\v9725-1.cjs --apply',
    nextGate: apply
      ? 'TYPECHECK_AND_THEN_V9_7_26_AUTOMATIC_POST_ACTION_REFRESH'
      : 'APPLY_AFTER_DRY_RUN_PASSES',
  };

  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const reportFile = path.join(
    logDir,
    'adjusted-price-storage-contract-v9-7-25-1.json'
  );
  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log(JSON.stringify({
    status: report.status,
    applyRequested: apply,
    marketDailyBarsPriceBasis:
      report.policy.marketDailyBarsPriceBasis,
    verification,
    changes,
    sourceFilesModified:
      report.safety.sourceFilesModified,
    databaseWrites: 0,
    nextCommand: report.nextCommand,
  }, null, 2));

  console.log('Report: ' + reportFile);
}

try {
  main();
} catch (err) {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_:\-]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
