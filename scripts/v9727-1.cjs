'use strict';

// V9.7.27.1 - robust final corporate-action price-history integration.
//
// Fixes V9.7.27 dry-run failure:
//   REFRESH_RETURN_FIELD_MATCH_COUNT_2
//
// Default: dry-run.
// Apply:   node .\scripts\v9727-1.cjs --apply
//
// Installer itself performs no DB/KIS/network access.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_7_27_1_FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION_ROBUST';

const root = path.resolve(__dirname, '..');

const refreshRel =
  'lib/market/refresh-corporate-action-history-v9-7-26.ts';
const eodRel =
  'lib/market/run-market-eod-sync-v7-8.ts';
const validateRel =
  'scripts/v9727-validate.ts';

const refreshFile =
  path.join(root, ...refreshRel.split('/'));
const eodFile =
  path.join(root, ...eodRel.split('/'));
const validateFile =
  path.join(root, ...validateRel.split('/'));

function sha256(text) {
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
}

function readRequired(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `TARGET_NOT_FOUND:${path.relative(root, file)}`
    );
  }

  return fs.readFileSync(file, 'utf8');
}

function eolOf(text) {
  return text.includes('\r\n')
    ? '\r\n'
    : '\n';
}

function matchCount(text, rx) {
  const flags =
    rx.flags.includes('g')
      ? rx.flags
      : rx.flags + 'g';

  return [
    ...text.matchAll(
      new RegExp(
        rx.source,
        flags,
      ),
    ),
  ].length;
}

function replaceExactlyOne(
  text,
  rx,
  replacement,
  label,
) {
  const count =
    matchCount(
      text,
      rx,
    );

  if (count !== 1) {
    throw new Error(
      `${label}_MATCH_COUNT_${count}`
    );
  }

  return text.replace(
    rx,
    replacement,
  );
}

function patchRefreshModule(text) {
  if (
    text.includes(
      'minimumPostEffectiveGraceCalendarDays'
    ) &&
    text.includes(
      'refreshEligibleThroughDate'
    )
  ) {
    return text;
  }

  const eol =
    eolOf(text);

  // 1) Insert grace-date calculation immediately after detectionStartDate.
  const detectionBlockRx =
    /(  const detectionStartDate\s*=\s*\r?\n\s*addCalendarDays\(\s*\r?\n\s*throughDate,\s*\r?\n\s*-detectionLookbackCalendarDays,\s*\r?\n\s*\);\s*\r?\n)(\s*\r?\n  const \{\s*\r?\n    data: eventData,)/m;

  const detectionReplacement =
    [
      '$1',
      '',
      '  /*',
      '   * V9.7.27.1:',
      '   * wait two calendar days after the corporate-action',
      '   * effective date before treating KIS adjusted history',
      '   * as eligible for automatic refresh.',
      '   */',
      '  const refreshEligibleThroughDate =',
      '    addCalendarDays(',
      '      throughDate,',
      '      -2,',
      '    );',
      '$2',
    ].join(eol);

  text =
    replaceExactlyOne(
      text,
      detectionBlockRx,
      detectionReplacement,
      'REFRESH_GRACE_CALCULATION',
    );

  // 2) The corporate-action query must stop at the grace-adjusted date.
  const eventEndRx =
    /(\.lte\(\s*\r?\n\s*"effective_date",\s*\r?\n\s*)throughDate(\s*,\s*\r?\n\s*\))/m;

  text =
    replaceExactlyOne(
      text,
      eventEndRx,
      '$1refreshEligibleThroughDate$2',
      'REFRESH_EVENT_END_DATE',
    );

  // 3) Add the field specifically inside the final returned result object.
  //    This avoids the old generic detectionStartDate anchor which matched twice.
  const resultObjectRx =
    /(  return \{\s*\r?\n\s*version:\s*\r?\n\s*"V9_7_26",\s*\r?\n\s*dryRun,\s*\r?\n\s*includeValidationEvents,\s*\r?\n\s*throughDate,\s*\r?\n\s*detectionStartDate,\s*\r?\n)(\s*actionTypes:)/m;

  text =
    replaceExactlyOne(
      text,
      resultObjectRx,
      `$1    refreshEligibleThroughDate,${eol}$2`,
      'REFRESH_RESULT_OBJECT_FIELD',
    );

  // 4) Record the grace-period policy.
  const cashPolicyRx =
    /(      cashDividendAutoRefresh:\s*\r?\n\s*false,\s*\r?\n)/m;

  text =
    replaceExactlyOne(
      text,
      cashPolicyRx,
      `$1      minimumPostEffectiveGraceCalendarDays:${eol}        2,${eol}`,
      'REFRESH_POLICY_GRACE_DAYS',
    );

  return text;
}

function findCallEnd(
  text,
  token,
  fromIndex = 0,
) {
  const tokenIndex =
    text.indexOf(
      token,
      fromIndex,
    );

  if (tokenIndex < 0) {
    return -1;
  }

  const parenStart =
    text.indexOf(
      '(',
      tokenIndex + token.length - 1,
    );

  if (parenStart < 0) {
    return -1;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = parenStart;
    i < text.length;
    i++
  ) {
    const ch =
      text[i];

    const next =
      text[i + 1] ?? '';

    if (lineComment) {
      if (ch === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (
        ch === '*' &&
        next === '/'
      ) {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === '`'
    ) {
      quote = ch;
      continue;
    }

    if (
      ch === '/' &&
      next === '/'
    ) {
      lineComment = true;
      i++;
      continue;
    }

    if (
      ch === '/' &&
      next === '*'
    ) {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      depth--;

      if (depth === 0) {
        let end = i + 1;

        while (
          end < text.length &&
          /\s/.test(
            text[end],
          )
        ) {
          end++;
        }

        if (
          text[end] === ';'
        ) {
          end++;
        }

        return end;
      }
    }
  }

  return -1;
}

function patchEodSync(text) {
  const eol =
    eolOf(text);

  if (
    !text.includes(
      'refreshCorporateActionHistoryV9726'
    )
  ) {
    const importRx =
      /(import\s*\{\s*\r?\n\s*syncDailyBars,\s*\r?\n\s*\}\s*from\s*"@\/lib\/market\/sync-daily-bars";)/m;

    text =
      replaceExactlyOne(
        text,
        importRx,
        [
          '$1',
          '',
          'import {',
          '  refreshCorporateActionHistoryV9726,',
          '} from "@/lib/market/refresh-corporate-action-history-v9-7-26";',
        ].join(eol),
        'EOD_REFRESH_IMPORT',
      );
  }

  if (
    text.includes(
      'V9.7.27.1 corporate-action history refresh'
    )
  ) {
    return text;
  }

  const stockResultIndex =
    text.search(
      /    const stockResult\s*=/m
    );

  if (
    stockResultIndex <
    0
  ) {
    throw new Error(
      'EOD_STOCK_RESULT_NOT_FOUND'
    );
  }

  const callEnd =
    findCallEnd(
      text,
      'await syncDailyBars',
      stockResultIndex,
    );

  if (
    callEnd <
    0
  ) {
    throw new Error(
      'EOD_SYNC_DAILY_BARS_CALL_END_NOT_FOUND'
    );
  }

  const hook =
    [
      '',
      '',
      '    /*',
      '     * V9.7.27.1 corporate-action history refresh.',
      '     *',
      '     * Normal EOD bars are collected first. Then supported',
      '     * production corporate actions are checked for stale',
      '     * pre-action adjusted history. The refresh module itself',
      '     * forces KIS mode 0 and is idempotent through the',
      '     * updated_at/effective-date freshness gate.',
      '     *',
      '     * Failure is intentionally propagated so an EOD run',
      '     * cannot silently report success with stale history.',
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
    text.slice(
      0,
      callEnd,
    ) +
    hook +
    text.slice(
      callEnd,
    )
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

  console.log(
    JSON.stringify(
      {
        status:
          "V9_7_27_VALIDATION_DRY_RUN_COMPLETE",
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

function inspectNewFile(
  file,
  source,
  rel,
) {
  if (
    !fs.existsSync(
      file,
    )
  ) {
    return {
      file: rel,
      action:
        'CREATE',
      expectedSha256:
        sha256(source),
    };
  }

  const current =
    fs.readFileSync(
      file,
      'utf8',
    );

  return {
    file: rel,
    action:
      current === source
        ? 'ALREADY_EXACT'
        : 'REFUSE_OVERWRITE_DIFFERENT_FILE',
    currentSha256:
      sha256(current),
    expectedSha256:
      sha256(source),
  };
}

function backupAndWrite(
  file,
  content,
) {
  const backup =
    file +
    '.bak-v9727-1';

  if (
    !fs.existsSync(
      backup,
    )
  ) {
    fs.copyFileSync(
      file,
      backup,
    );
  }

  const tmp =
    file +
    '.tmp-v9727-1';

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );

  return path
    .relative(
      root,
      backup,
    )
    .replaceAll(
      '\\',
      '/',
    );
}

function createNewFile(
  file,
  source,
  rel,
) {
  if (
    fs.existsSync(
      file,
    )
  ) {
    const current =
      fs.readFileSync(
        file,
        'utf8',
      );

    if (
      current !==
      source
    ) {
      throw new Error(
        `REFUSE_OVERWRITE_DIFFERENT_FILE:${rel}`
      );
    }

    return 'ALREADY_EXACT';
  }

  fs.mkdirSync(
    path.dirname(
      file,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    file,
    source,
    'utf8',
  );

  return 'CREATED';
}

function main() {
  const args =
    process.argv.slice(2);

  const apply =
    args.includes(
      '--apply',
    );

  for (
    const arg of
    args
  ) {
    if (
      arg !==
      '--apply'
    ) {
      throw new Error(
        'UNKNOWN_OPTION'
      );
    }
  }

  const refreshBefore =
    readRequired(
      refreshFile,
    );

  const eodBefore =
    readRequired(
      eodFile,
    );

  const refreshAfter =
    patchRefreshModule(
      refreshBefore,
    );

  const eodAfter =
    patchEodSync(
      eodBefore,
    );

  const validatorPreview =
    inspectNewFile(
      validateFile,
      validateSource,
      validateRel,
    );

  if (
    validatorPreview.action ===
    'REFUSE_OVERWRITE_DIFFERENT_FILE'
  ) {
    throw new Error(
      'VALIDATOR_FILE_CONFLICT'
    );
  }

  const verification = {
    refresh: {
      graceFieldPresent:
        refreshAfter.includes(
          'refreshEligibleThroughDate'
        ),
      graceDaysPolicyPresent:
        refreshAfter.includes(
          'minimumPostEffectiveGraceCalendarDays'
        ),
      queryUsesGraceDate:
        /\.lte\([\s\S]{0,120}?"effective_date"[\s\S]{0,120}?refreshEligibleThroughDate/m
          .test(
            refreshAfter,
          ),
      productionValidationGuardStillPresent:
        refreshAfter.includes(
          'VALIDATION_EVENTS_CANNOT_DRIVE_PRODUCTION_REFRESH'
        ),
      adjustedSyncStillForced:
        /adjustedPrice:\s*\r?\n\s*true,/m
          .test(
            refreshAfter,
          ),
    },
    eod: {
      importPresent:
        eodAfter.includes(
          'refreshCorporateActionHistoryV9726'
        ),
      hookPresent:
        eodAfter.includes(
          'V9.7.27.1 corporate-action history refresh'
        ),
      productionOnly:
        /includeValidationEvents:\s*\r?\n\s*false,/m
          .test(
            eodAfter,
          ),
      applyMode:
        /dryRun:\s*\r?\n\s*false,/m
          .test(
            eodAfter,
          ),
      normalStockSyncStillPresent:
        eodAfter.includes(
          'await syncDailyBars'
        ),
    },
  };

  const ready =
    Object
      .values(
        verification.refresh,
      )
      .every(Boolean) &&
    Object
      .values(
        verification.eod,
      )
      .every(Boolean);

  if (
    !ready
  ) {
    throw new Error(
      'POST_PATCH_VERIFICATION_FAILED'
    );
  }

  const changes = [
    {
      file:
        refreshRel,
      changed:
        refreshBefore !==
        refreshAfter,
      beforeSha256:
        sha256(
          refreshBefore,
        ),
      afterSha256:
        sha256(
          refreshAfter,
        ),
      lineEnding:
        eolOf(
          refreshBefore,
        ) === '\r\n'
          ? 'CRLF'
          : 'LF',
    },
    {
      file:
        eodRel,
      changed:
        eodBefore !==
        eodAfter,
      beforeSha256:
        sha256(
          eodBefore,
        ),
      afterSha256:
        sha256(
          eodAfter,
        ),
      lineEnding:
        eolOf(
          eodBefore,
        ) === '\r\n'
          ? 'CRLF'
          : 'LF',
    },
    validatorPreview,
  ];

  const applied = [];

  if (
    apply
  ) {
    applied.push({
      file:
        refreshRel,
      result:
        'UPDATED',
      backup:
        backupAndWrite(
          refreshFile,
          refreshAfter,
        ),
    });

    applied.push({
      file:
        eodRel,
      result:
        'UPDATED',
      backup:
        backupAndWrite(
          eodFile,
          eodAfter,
        ),
    });

    applied.push({
      file:
        validateRel,
      result:
        createNewFile(
          validateFile,
          validateSource,
          validateRel,
        ),
    });
  }

  const report = {
    version:
      VERSION,
    status:
      apply
        ? 'FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION_APPLIED'
        : 'FINAL_CORPORATE_ACTION_PRICE_HISTORY_INTEGRATION_DRY_RUN_READY',
    applyRequested:
      apply,
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
      installerNetworkAccess:
        false,
      installerDatabaseAccess:
        false,
      databaseWrites:
        0,
      sourceFilesModified:
        apply
          ? applied.filter(
              x =>
                x.result ===
                  'UPDATED' ||
                x.result ===
                  'CREATED',
            ).length
          : 0,
    },
    nextCommands:
      apply
        ? [
            'npx tsc --noEmit',
            'npx tsx .\\scripts\\v9727-validate.ts',
          ]
        : [
            'node .\\scripts\\v9727-1.cjs --apply',
          ],
  };

  const logDir =
    path.join(
      root,
      'logs',
    );

  fs.mkdirSync(
    logDir,
    {
      recursive: true,
    },
  );

  const reportFile =
    path.join(
      logDir,
      'final-corporate-action-price-history-integration-v9-7-27-1.json',
    );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      report,
      null,
      2,
    ),
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        applyRequested:
          apply,
        verification,
        changes,
        applied,
        sourceFilesModified:
          report
            .safety
            .sourceFilesModified,
        databaseWrites:
          0,
        nextCommands:
          report
            .nextCommands,
      },
      null,
      2,
    ),
  );

  console.log(
    'Report: ' +
    reportFile,
  );
}

try {
  main();
} catch (
  error
) {
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
