'use strict';

// V9.7.25 - market_daily_bars adjusted-price storage contract lock.
//
// Default: DRY RUN only.
// Apply:   node .\scripts\v9725.cjs --apply
//
// This patch intentionally keeps lib/kis/client.ts flexible.
// It locks only writers that persist into market_daily_bars:
//
// 1) lib/market/sync-daily-bars.ts
//    - reject adjustedPrice:false
//    - force stored/requested adjustedPrice=true
//
// 2) app/api/market/daily-bars/sync/route.ts
//    - reject adjustedPrice:false at HTTP boundary
//
// 3) lib/market/process-market-data-backfill-v8-3.ts
//    - refuse any backfill run whose adjusted_price is not true
//
// No DB writes. No network access.
// On --apply, .bak-v9725 backups are created before modification.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_25_ADJUSTED_PRICE_STORAGE_CONTRACT_LOCK';

const root = path.resolve(__dirname, '..');

const targets = {
  sync: path.join(root, 'lib', 'market', 'sync-daily-bars.ts'),
  route: path.join(root, 'app', 'api', 'market', 'daily-bars', 'sync', 'route.ts'),
  backfill: path.join(root, 'lib', 'market', 'process-market-data-backfill-v8-3.ts'),
};

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function mustRead(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`TARGET_NOT_FOUND_${path.basename(file)}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) {
    throw new Error(`PATCH_ANCHOR_NOT_FOUND_${label}`);
  }
  const second = text.indexOf(from, first + from.length);
  if (second >= 0) {
    throw new Error(`PATCH_ANCHOR_NOT_UNIQUE_${label}`);
  }
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function patchSync(text) {
  const from = `  const adjustedPrice =
    input.adjustedPrice !==
    false;`;

  const to = `  /*
   * V9.7.25 storage contract:
   * market_daily_bars stores KIS mode 0 adjusted prices only.
   * Keep lib/kis/client.ts flexible for diagnostics, but never persist
   * original-price mode through this writer.
   */
  if (input.adjustedPrice === false) {
    throw new Error(
      "MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE",
    );
  }

  const adjustedPrice =
    true;`;

  return replaceOnce(text, from, to, 'SYNC_ADJUSTED_PRICE_LOCK');
}

function patchRoute(text) {
  const anchor = `    const result =
      await syncDailyBars({`;

  const insertion = `    /*
     * V9.7.25 storage contract:
     * this endpoint may only persist adjusted-price daily bars.
     */
    if (
      body.adjustedPrice ===
      false
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE",
        },
        {
          status: 400,
        },
      );
    }

`;

  if (text.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE')) {
    return text;
  }

  return replaceOnce(text, anchor, insertion + anchor, 'ROUTE_ADJUSTED_PRICE_GUARD');
}

function patchBackfill(text) {
  // Insert immediately after the run existence/error validation area by
  // anchoring before access-token/task processing. We prefer the exact
  // adjusted_price select and then locate the first subsequent use of
  // run.adjusted_price in the KIS request; insert a guard before work starts.

  if (text.includes('BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE')) {
    return text;
  }

  const marker = `  const accessToken =
    await getKisAccessToken();`;

  const guard = `  /*
   * V9.7.25 storage contract:
   * market_daily_bars is a KIS mode 0 adjusted-price table.
   * A backfill run configured for original prices must not write here.
   */
  if (
    run.adjusted_price !==
    true
  ) {
    throw new Error(
      "BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE",
    );
  }

`;

  if (!text.includes(marker)) {
    // Fallback: locate first call site that passes run.adjusted_price.
    const fallback = `            adjustedPrice:
              run.adjusted_price,`;

    if (!text.includes(fallback)) {
      throw new Error('PATCH_ANCHOR_NOT_FOUND_BACKFILL_ADJUSTED_PRICE_GUARD');
    }

    const idx = text.indexOf(fallback);
    // Find nearest preceding blank-line boundary with comfortable placement.
    const insertionPoint = text.lastIndexOf('\n\n', idx);
    if (insertionPoint < 0) {
      throw new Error('PATCH_INSERTION_POINT_NOT_FOUND_BACKFILL');
    }
    return text.slice(0, insertionPoint + 2) + guard + text.slice(insertionPoint + 2);
  }

  return replaceOnce(text, marker, guard + marker, 'BACKFILL_ADJUSTED_PRICE_GUARD');
}

function summarizeChange(name, before, after) {
  return {
    file: path.relative(root, targets[name]).replaceAll('\\', '/'),
    changed: before !== after,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    beforeBytes: Buffer.byteLength(before, 'utf8'),
    afterBytes: Buffer.byteLength(after, 'utf8'),
    contractMarkers: {
      requiresAdjustedPrice:
        after.includes('MARKET_DAILY_BARS_REQUIRES_ADJUSTED_PRICE'),
      backfillRequiresAdjustedPrice:
        after.includes('BACKFILL_RUN_REQUIRES_ADJUSTED_PRICE'),
    },
  };
}

function backupAndWrite(file, text) {
  const backup = `${file}.bak-v9725`;

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  const tmp = `${file}.tmp-v9725`;
  fs.writeFileSync(tmp, text, 'utf8');
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

  const before = {
    sync: mustRead(targets.sync),
    route: mustRead(targets.route),
    backfill: mustRead(targets.backfill),
  };

  const after = {
    sync: patchSync(before.sync),
    route: patchRoute(before.route),
    backfill: patchBackfill(before.backfill),
  };

  const changes = Object.keys(before).map(name =>
    summarizeChange(name, before[name], after[name])
  );

  if (changes.some(x => !x.changed)) {
    // An already-patched file can be unchanged on a rerun, which is okay only
    // when the expected contract marker exists.
    for (const c of changes) {
      if (!c.changed) {
        if (
          c.file.endsWith('sync-daily-bars.ts') &&
          !c.contractMarkers.requiresAdjustedPrice
        ) {
          throw new Error('SYNC_FILE_UNCHANGED_WITHOUT_CONTRACT_MARKER');
        }
        if (
          c.file.endsWith('route.ts') &&
          !c.contractMarkers.requiresAdjustedPrice
        ) {
          throw new Error('ROUTE_FILE_UNCHANGED_WITHOUT_CONTRACT_MARKER');
        }
        if (
          c.file.endsWith('process-market-data-backfill-v8-3.ts') &&
          !c.contractMarkers.backfillRequiresAdjustedPrice
        ) {
          throw new Error('BACKFILL_FILE_UNCHANGED_WITHOUT_CONTRACT_MARKER');
        }
      }
    }
  }

  let backups = [];

  if (apply) {
    backups = [
      backupAndWrite(targets.sync, after.sync),
      backupAndWrite(targets.route, after.route),
      backupAndWrite(targets.backfill, after.backfill),
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
      syncDailyBarsRejectsOriginalMode: true,
      httpSyncRouteRejectsOriginalMode: true,
      backfillRejectsAdjustedPriceFalseRuns: true,
      corporateActionAutomaticRefreshImplemented: false,
    },
    changes,
    backups,
    safety: {
      databaseConnected: false,
      kisConnected: false,
      sourceFilesModified: apply ? 3 : 0,
      databaseWrites: 0,
    },
    nextGate: apply
      ? 'RUN_TYPECHECK_THEN_BUILD_V9_7_26_POST_ACTION_STALE_REFRESH'
      : 'APPLY_V9_7_25_AFTER_REVIEW',
  };

  const outDir = path.join(root, 'logs');
  fs.mkdirSync(outDir, { recursive: true });
  const reportFile = path.join(
    outDir,
    'adjusted-price-storage-contract-v9-7-25.json'
  );
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    applyRequested: report.applyRequested,
    marketDailyBarsPriceBasis: report.policy.marketDailyBarsPriceBasis,
    kisClientRemainsFlexible: report.policy.kisClientRemainsFlexible,
    changes: report.changes,
    sourceFilesModified: report.safety.sourceFilesModified,
    databaseWrites: 0,
    nextGate: report.nextGate,
  }, null, 2));

  console.log('Report: ' + reportFile);
}

try {
  main();
} catch (err) {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
