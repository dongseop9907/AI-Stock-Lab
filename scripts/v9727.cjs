'use strict';

// V9.7.27 - final corporate-action price-history integration installer.
//
// Default: dry-run.
// Apply:   node .\scripts\v9727.cjs --apply
//
// Changes:
// 1) Add a 2-calendar-day post-effective grace period to V9.7.26 refresh.
// 2) Hook production refresh into runMarketEodSyncV78 after normal stock sync.
// 3) Add a validation-only TypeScript runner.
//
// No DB/KIS access from this installer.
// On apply, backups are created for modified files.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_27_FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION';
const root = path.resolve(__dirname, '..');

const refreshRel =
  'lib/market/refresh-corporate-action-history-v9-7-26.ts';
const eodRel =
  'lib/market/run-market-eod-sync-v7-8.ts';
const validateRel =
  'scripts/v9727-validate.ts';

const refreshFile = path.join(root, ...refreshRel.split('/'));
const eodFile = path.join(root, ...eodRel.split('/'));
const validateFile = path.join(root, ...validateRel.split('/'));

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
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

function count(text, rx) {
  const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
  return [...text.matchAll(new RegExp(rx.source, flags))].length;
}

function replaceOne(text, rx, replacement, label) {
  const n = count(text, rx);
  if (n !== 1) {
    throw new Error(`${label}_MATCH_COUNT_${n}`);
  }
  return text.replace(rx, replacement);
}

function patchRefresh(text) {
  if (
    text.includes('minimumPostEffectiveGraceCalendarDays') &&
    text.includes('refreshEligibleThroughDate')
  ) {
    return text;
  }

  const eol = eolOf(text);

  // Insert eligible-through date after detectionStartDate calculation.
  const startRx =
    /(  const detectionStartDate\s*=\s*(?:\r?\n)[\s\S]*?    \);)(\r?\n\r?\n  const \{\r?\n    data: eventData,)/m;

  const startMatch = text.match(startRx);
  if (!startMatch) {
    throw new Error('REFRESH_DETECTION_START_ANCHOR_NOT_FOUND');
  }

  const inserted = [
    startMatch[1],
    '',
    '  /*',
    '   * Give KIS time to publish retroactively adjusted history.',
    '   * Corporate-action history refresh begins two calendar days',
    '   * after the effective date.',
    '   */',
    '  const refreshEligibleThroughDate =',
    '    addCalendarDays(',
    '      throughDate,',
    '      -2,',
    '    );',
    '',
    '  const {',
    '    data: eventData,',
  ].join(eol);

  text =
    text.slice(0, startMatch.index) +
    inserted +
    text.slice(
      startMatch.index + startMatch[0].length -
      '  const {\n    data: eventData,'.length
    );

  // The splice above can be sensitive to CRLF length. Normalize by repairing
  // duplicated/missing event-data prefix through regex if needed.
  text = text.replace(
    /  const \{\r?\n    data: eventData,\s*data: eventData,/m,
    `  const {${eol}    data: eventData,`
  );

  // Replace effective_date <= throughDate with <= refreshEligibleThroughDate.
  const endRx =
    /(\.lte\(\s*(?:\r?\n)?\s*"effective_date",\s*(?:\r?\n)?\s*)throughDate(\s*,?\s*(?:\r?\n)?\s*\))/m;

  text = replaceOne(
    text,
    endRx,
    '$1refreshEligibleThroughDate$2',
    'REFRESH_ELIGIBLE_END'
  );

  // Add returned field after detectionStartDate.
  const returnRx =
    /(    detectionStartDate,\r?\n)/m;

  text = replaceOne(
    text,
    returnRx,
    `$1    refreshEligibleThroughDate,${eol}`,
    'REFRESH_RETURN_FIELD'
  );

  // Add policy field.
  const policyRx =
    /(      cashDividendAutoRefresh:\s*(?:\r?\n)?\s*false,\r?\n)/m;

  text = replaceOne(
    text,
    policyRx,
    `$1      minimumPostEffectiveGraceCalendarDays:${eol}        2,${eol}`,
    'REFRESH_POLICY_GRACE'
  );

  return text;
}

function patchEod(text) {
  const eol = eolOf(text);

  if (!text.includes('refreshCorporateActionHistoryV9726')) {
    const importRx =
      /(import\s*\{\s*(?:\r?\n)?\s*syncDailyBars,\s*(?:\r?\n)?\s*\}\s*from\s*"@\/lib\/market\/sync-daily-bars";)/m;

    const importMatch = text.match(importRx);
    if (!importMatch) {
      throw new Error('EOD_SYNC_IMPORT_ANCHOR_NOT_FOUND');
    }

    const addition = [
      importMatch[1],
      '',
      'import {',
      '  refreshCorporateActionHistoryV9726,',
      '} from "@/lib/market/refresh-corporate-action-history-v9-7-26";',
    ].join(eol);

    text = text.replace(importRx, addition);
  }

  if (text.includes('V9.7.27 corporate-action history refresh')) {
    return text;
  }

  const callStart =
    text.search(
      /    const stockResult\s*=\s*(?:\r?\n)\s*await syncDailyBars\(\{/m
    );

  if (callStart < 0) {
    throw new Error('EOD_STOCK_SYNC_CALL_START_NOT_FOUND');
  }

  const syncCallIndex =
    text.indexOf('await syncDailyBars({', callStart);

  if (syncCallIndex < 0) {
    throw new Error('EOD_SYNC_CALL_TOKEN_NOT_FOUND');
  }

  // Find the first line-closing "});" after this call. The argument shown by
  // v9.7.24.2 is flat, so this is a stable boundary.
  const remainder = text.slice(syncCallIndex);
  const closeMatch =
    remainder.match(/\r?\n\s{6}\}\);/m);

  if (!closeMatch || closeMatch.index == null) {
    throw new Error('EOD_STOCK_SYNC_CALL_END_NOT_FOUND');
  }

  const insertionPoint =
    syncCallIndex +
    closeMatch.index +
    closeMatch[0].length;

  const hook = [
    '',
    '',
    '    /*',
    '     * V9.7.27 corporate-action history refresh.',
    '     *',
    '     * This runs only against production corporate-action rows.',
    '     * The refresh module itself enforces KIS mode 0 adjusted prices,',
    '     * stale evidence, idempotency, and the post-effective grace period.',
    '     * A refresh failure is intentionally allowed to fail the EOD run',
    '     * rather than silently leave stale backtest history behind.',
    '     */',
    '    await refreshCorporateActionHistoryV9726({',
    '      dryRun:',
    '        false,',
    '      includeValidationEvents:',
    '        false,',
    '      throughDate:',
    '        expectedMarketDate,',
    '      detectionLookbackCalendarDays:',
    '        Math.max(',
    '          45,',
    '          lookbackCalendarDays,',
    '        ),',
    '    });',
  ].join(eol);

  return (
    text.slice(0, insertionPoint) +
    hook +
    text.slice(insertionPoint)
  );
}

const validateSource = `import {
  refreshCorporateActionHistoryV9726,
} from "../lib/market/refresh-corporate-action-history-v9-7-26";

async function main() {
  const result =
    await refreshCorporateActionHistoryV9726({
      dryRun:
        true,
      includeValidationEvents:
        true,
      detectionLookbackCalendarDays:
        366,
      throughDate:
        "2026-10-01",
    });

  const unsafe =
    result.targets.filter(
      (target) =>
        target.status ===
          "REFRESH_FAILED",
    );

  console.log(
    JSON.stringify(
      {
        status:
          unsafe.length === 0
            ? "V9_7_27_VALIDATION_DRY_RUN_PASSED"
            : "V9_7_27_VALIDATION_REVIEW_REQUIRED",
        version:
          result.version,
        dryRun:
          result.dryRun,
        includeValidationEvents:
          result.includeValidationEvents,
        throughDate:
          result.throughDate,
        detectionStartDate:
          result.detectionStartDate,
        refreshEligibleThroughDate:
          result.refreshEligibleThroughDate,
        actionTypes:
          result.actionTypes,
        counts:
          result.counts,
        targets:
          result.targets.map(
            (target) => ({
              stockCode:
                target.stockCode,
              actionType:
                target.actionType,
              effectiveDate:
                target.effectiveDate,
              staleEvidence:
                target.staleEvidence,
              earliestStoredDate:
                target.earliestStoredDate,
              refreshStartDate:
                target.refreshStartDate,
              refreshEndDate:
                target.refreshEndDate,
              status:
                target.status,
            }),
          ),
        writesPerformed:
          0,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );

    process.exitCode =
      1;
  },
);
`;

function inspectCreate(file, source, rel) {
  if (!fs.existsSync(file)) {
    return {
      file: rel,
      action: 'CREATE',
      expectedSha256: hash(source),
    };
  }

  const current = fs.readFileSync(file, 'utf8');

  return {
    file: rel,
    action:
      current === source
        ? 'ALREADY_EXACT'
        : 'REFUSE_OVERWRITE_DIFFERENT_FILE',
    currentSha256: hash(current),
    expectedSha256: hash(source),
  };
}

function backupAndWrite(file, content, suffix) {
  const backup = file + suffix;

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  const tmp = file + '.tmp-v9727';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);

  return path.relative(root, backup).replaceAll('\\', '/');
}

function createExact(file, source, rel) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== source) {
      throw new Error(`VALIDATOR_FILE_CONFLICT:${rel}`);
    }
    return 'ALREADY_EXACT';
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return 'CREATED';
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  for (const arg of args) {
    if (arg !== '--apply') {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  const refreshBefore = read(refreshFile);
  const eodBefore = read(eodFile);

  const refreshAfter = patchRefresh(refreshBefore);
  const eodAfter = patchEod(eodBefore);

  const validatorPreview =
    inspectCreate(validateFile, validateSource, validateRel);

  if (
    validatorPreview.action ===
    'REFUSE_OVERWRITE_DIFFERENT_FILE'
  ) {
    throw new Error('VALIDATOR_FILE_CONFLICT');
  }

  const verification = {
    refresh: {
      graceFieldPresent:
        refreshAfter.includes('refreshEligibleThroughDate'),
      graceDaysPolicyPresent:
        refreshAfter.includes(
          'minimumPostEffectiveGraceCalendarDays'
        ),
      productionValidationGuardStillPresent:
        refreshAfter.includes(
          'VALIDATION_EVENTS_CANNOT_DRIVE_PRODUCTION_REFRESH'
        ),
      adjustedSyncStillForced:
        refreshAfter.includes('adjustedPrice:') &&
        refreshAfter.includes('true,'),
    },
    eod: {
      importPresent:
        eodAfter.includes(
          'refreshCorporateActionHistoryV9726'
        ),
      hookPresent:
        eodAfter.includes(
          'V9.7.27 corporate-action history refresh'
        ),
      productionOnly:
        /includeValidationEvents:\s*(?:\r?\n)?\s*false/m
          .test(eodAfter),
      applyMode:
        /dryRun:\s*(?:\r?\n)?\s*false/m
          .test(eodAfter),
    },
  };

  const ready =
    Object.values(verification.refresh).every(Boolean) &&
    Object.values(verification.eod).every(Boolean);

  if (!ready) {
    throw new Error('V9_7_27_POST_PATCH_VERIFICATION_FAILED');
  }

  const changes = [
    {
      file: refreshRel,
      changed: refreshBefore !== refreshAfter,
      beforeSha256: hash(refreshBefore),
      afterSha256: hash(refreshAfter),
    },
    {
      file: eodRel,
      changed: eodBefore !== eodAfter,
      beforeSha256: hash(eodBefore),
      afterSha256: hash(eodAfter),
    },
    validatorPreview,
  ];

  const applied = [];

  if (apply) {
    applied.push({
      file: refreshRel,
      backup: backupAndWrite(
        refreshFile,
        refreshAfter,
        '.bak-v9727'
      ),
      result: 'UPDATED',
    });

    applied.push({
      file: eodRel,
      backup: backupAndWrite(
        eodFile,
        eodAfter,
        '.bak-v9727'
      ),
      result: 'UPDATED',
    });

    applied.push({
      file: validateRel,
      result: createExact(
        validateFile,
        validateSource,
        validateRel
      ),
    });
  }

  const report = {
    version: VERSION,
    status: apply
      ? 'FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION_APPLIED'
      : 'FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION_DRY_RUN_READY',
    applyRequested: apply,
    verification,
    changes,
    applied,
    policy: {
      canonicalStorageBasis:
        'KIS_MODE_0_ADJUSTED_ONLY',
      autoRefreshActionTypes: [
        'STOCK_SPLIT',
        'REVERSE_SPLIT',
        'STOCK_DIVIDEND',
      ],
      postEffectiveGraceCalendarDays:
        2,
      productionValidationEvents:
        false,
      staleRefreshFailureFailsEod:
        true,
      genericFactorMutationOfAdjustedBars:
        false,
      cashDividendAutoRefresh:
        false,
    },
    safety: {
      installerNetworkAccess: false,
      installerDatabaseAccess: false,
      databaseWrites: 0,
      sourceFilesModified: apply ? 3 : 0,
    },
    nextCommands: apply
      ? [
          'npx tsc --noEmit',
          'npx tsx .\\scripts\\v9727-validate.ts',
        ]
      : [
          'node .\\scripts\\v9727.cjs --apply',
        ],
  };

  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const reportFile = path.join(
    logDir,
    'final-corporate-action-price-history-integration-v9-7-27.json'
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log(JSON.stringify({
    status: report.status,
    applyRequested: apply,
    verification,
    changes,
    applied,
    sourceFilesModified:
      report.safety.sourceFilesModified,
    databaseWrites: 0,
    nextCommands: report.nextCommands,
  }, null, 2));

  console.log('Report: ' + reportFile);
}

try {
  main();
} catch (err) {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_:\-.,/\\]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
