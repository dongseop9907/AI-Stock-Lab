'use strict';

// V9.7.26 - install corporate-action stale-history refresh module + API route.
//
// Default: dry-run (no source modification)
// Apply:   node .\scripts\v9726.cjs --apply
//
// This installer does not access DB/KIS.
// It creates:
//   lib/market/refresh-corporate-action-history-v9-7-26.ts
//   app/api/market/corporate-actions/history-refresh/route.ts
//
// Production refresh types:
//   STOCK_SPLIT
//   REVERSE_SPLIT
//   STOCK_DIVIDEND
//
// CASH_DIVIDEND is intentionally excluded because the verified KIS samples
// showed identical mode0/mode1 price history and no stale-price rewrite need.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_26_CORPORATE_ACTION_STALE_HISTORY_REFRESH_INSTALL';
const root = path.resolve(__dirname, '..');

const moduleRel =
  'lib/market/refresh-corporate-action-history-v9-7-26.ts';
const routeRel =
  'app/api/market/corporate-actions/history-refresh/route.ts';

const moduleFile = path.join(root, ...moduleRel.split('/'));
const routeFile = path.join(root, ...routeRel.split('/'));

const moduleSource = `import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  syncDailyBars,
} from "@/lib/market/sync-daily-bars";

const REFRESH_ACTION_TYPES = [
  "STOCK_SPLIT",
  "REVERSE_SPLIT",
  "STOCK_DIVIDEND",
] as const;

type RefreshActionType =
  (typeof REFRESH_ACTION_TYPES)[number];

interface CorporateActionEventRow {
  id: string;
  stock_code: string;
  action_type: string;
  effective_date: string;
  status: string;
  is_validation: boolean;
  production_applied: boolean;
}

export interface RefreshCorporateActionHistoryV9726Input {
  /*
   * Default false.
   * Validation events may be inspected only in dry-run mode.
   */
  includeValidationEvents?: boolean;

  /*
   * Default true. Set false only from an explicit apply path.
   */
  dryRun?: boolean;

  /*
   * How far back to scan corporate-action effective dates.
   * Default 45 days, max 366.
   */
  detectionLookbackCalendarDays?: number;

  /*
   * Optional YYYY-MM-DD clock override for deterministic tests.
   */
  throughDate?: string;
}

interface RefreshTargetResult {
  eventId: string;
  stockCode: string;
  actionType: RefreshActionType;
  effectiveDate: string;
  staleEvidence: boolean;
  earliestStoredDate: string | null;
  refreshStartDate: string | null;
  refreshEndDate: string | null;
  status:
    | "NO_STORED_PRE_ACTION_HISTORY"
    | "ALREADY_REFRESHED_AFTER_ACTION"
    | "WOULD_REFRESH"
    | "REFRESHED"
    | "REFRESH_FAILED";
  syncResult?: unknown;
  error?: string;
}

function parseSqlDate(
  value: string,
) {
  const match =
    /^(\\d{4})-(\\d{2})-(\\d{2})$/
      .exec(
        value.trim(),
      );

  if (!match) {
    throw new Error(
      "INVALID_SQL_DATE",
    );
  }

  const date =
    new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
      ),
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_SQL_DATE",
    );
  }

  return date;
}

function formatSqlDate(
  date: Date,
) {
  return date
    .toISOString()
    .slice(0, 10);
}

function compactDate(
  sqlDate: string,
) {
  return sqlDate
    .replaceAll(
      "-",
      "",
    );
}

function addCalendarDays(
  sqlDate: string,
  days: number,
) {
  const date =
    parseSqlDate(
      sqlDate,
    );

  date.setUTCDate(
    date.getUTCDate() +
      days,
  );

  return formatSqlDate(
    date,
  );
}

function clampLookback(
  value:
    | number
    | undefined,
) {
  if (
    value ===
    undefined
  ) {
    return 45;
  }

  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 45;
  }

  return Math.min(
    366,
    Math.max(
      1,
      Math.trunc(
        value,
      ),
    ),
  );
}

function normalizeThroughDate(
  value:
    | string
    | undefined,
) {
  if (
    value &&
    value.trim()
  ) {
    return formatSqlDate(
      parseSqlDate(
        value,
      ),
    );
  }

  return new Date()
    .toISOString()
    .slice(0, 10);
}

function effectiveBoundaryTimestamp(
  effectiveDate: string,
) {
  return (
    effectiveDate +
    "T00:00:00.000Z"
  );
}

function isRefreshActionType(
  value: string,
): value is RefreshActionType {
  return (
    REFRESH_ACTION_TYPES as
      readonly string[]
  ).includes(
    value,
  );
}

export async function refreshCorporateActionHistoryV9726(
  input:
    RefreshCorporateActionHistoryV9726Input = {},
) {
  const supabase =
    createSupabaseServerClient();

  const dryRun =
    input.dryRun !==
    false;

  const includeValidationEvents =
    input.includeValidationEvents ===
    true;

  if (
    !dryRun &&
    includeValidationEvents
  ) {
    throw new Error(
      "VALIDATION_EVENTS_CANNOT_DRIVE_PRODUCTION_REFRESH",
    );
  }

  const throughDate =
    normalizeThroughDate(
      input.throughDate,
    );

  const detectionLookbackCalendarDays =
    clampLookback(
      input
        .detectionLookbackCalendarDays,
    );

  const detectionStartDate =
    addCalendarDays(
      throughDate,
      -detectionLookbackCalendarDays,
    );

  const {
    data: eventData,
    error: eventError,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .select(\`
        id,
        stock_code,
        action_type,
        effective_date,
        status,
        is_validation,
        production_applied
      \`)
      .eq(
        "is_validation",
        includeValidationEvents,
      )
      .in(
        "action_type",
        [
          ...REFRESH_ACTION_TYPES,
        ],
      )
      .in(
        "status",
        [
          "RECORDED",
          "SUPPORTED",
        ],
      )
      .gte(
        "effective_date",
        detectionStartDate,
      )
      .lte(
        "effective_date",
        throughDate,
      )
      .order(
        "effective_date",
        {
          ascending: true,
        },
      )
      .order(
        "stock_code",
        {
          ascending: true,
        },
      );

  if (
    eventError
  ) {
    throw new Error(
      \`CORPORATE_ACTION_EVENT_READ_FAILED: \${eventError.message}\`,
    );
  }

  const rawEvents =
    (
      eventData ??
      []
    ) as CorporateActionEventRow[];

  /*
   * One refresh per stock/effective-date is enough even when duplicate
   * supported event rows exist for the same stock/date.
   */
  const deduped =
    new Map<
      string,
      CorporateActionEventRow
    >();

  for (
    const event of
    rawEvents
  ) {
    if (
      !isRefreshActionType(
        event.action_type,
      )
    ) {
      continue;
    }

    const key =
      \`\${event.stock_code}|\${event.effective_date}\`;

    if (
      !deduped.has(
        key,
      )
    ) {
      deduped.set(
        key,
        event,
      );
    }
  }

  const targets:
    RefreshTargetResult[] =
    [];

  for (
    const event of
    deduped.values()
  ) {
    const effectiveDate =
      event.effective_date;

    const refreshEndDate =
      addCalendarDays(
        effectiveDate,
        -1,
      );

    const {
      data: earliestData,
      error: earliestError,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "stock_code",
          event.stock_code,
        )
        .lt(
          "trading_date",
          effectiveDate,
        )
        .order(
          "trading_date",
          {
            ascending: true,
          },
        )
        .limit(
          1,
        );

    if (
      earliestError
    ) {
      throw new Error(
        \`EARLIEST_MARKET_BAR_READ_FAILED_\${event.stock_code}: \${earliestError.message}\`,
      );
    }

    const earliestStoredDate =
      earliestData?.[0]
        ?.trading_date ??
      null;

    if (
      !earliestStoredDate
    ) {
      targets.push({
        eventId:
          event.id,
        stockCode:
          event.stock_code,
        actionType:
          event.action_type as RefreshActionType,
        effectiveDate,
        staleEvidence:
          false,
        earliestStoredDate:
          null,
        refreshStartDate:
          null,
        refreshEndDate:
          null,
        status:
          "NO_STORED_PRE_ACTION_HISTORY",
      });

      continue;
    }

    /*
     * Stale evidence:
     * at least one pre-action row whose updated_at predates the event.
     *
     * V9.7.25 has already locked future writers to adjusted-price mode.
     * Therefore, for future events, rows refreshed after the action are
     * considered current while pre-action timestamps trigger a re-query.
     */
    const {
      data: staleData,
      error: staleError,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(
          "trading_date,updated_at",
        )
        .eq(
          "stock_code",
          event.stock_code,
        )
        .lt(
          "trading_date",
          effectiveDate,
        )
        .lt(
          "updated_at",
          effectiveBoundaryTimestamp(
            effectiveDate,
          ),
        )
        .order(
          "trading_date",
          {
            ascending: true,
          },
        )
        .limit(
          1,
        );

    if (
      staleError
    ) {
      throw new Error(
        \`STALE_MARKET_BAR_READ_FAILED_\${event.stock_code}: \${staleError.message}\`,
      );
    }

    const staleEvidence =
      (
        staleData ??
        []
      ).length >
      0;

    if (
      !staleEvidence
    ) {
      targets.push({
        eventId:
          event.id,
        stockCode:
          event.stock_code,
        actionType:
          event.action_type as RefreshActionType,
        effectiveDate,
        staleEvidence:
          false,
        earliestStoredDate,
        refreshStartDate:
          earliestStoredDate,
        refreshEndDate,
        status:
          "ALREADY_REFRESHED_AFTER_ACTION",
      });

      continue;
    }

    if (
      dryRun
    ) {
      targets.push({
        eventId:
          event.id,
        stockCode:
          event.stock_code,
        actionType:
          event.action_type as RefreshActionType,
        effectiveDate,
        staleEvidence:
          true,
        earliestStoredDate,
        refreshStartDate:
          earliestStoredDate,
        refreshEndDate,
        status:
          "WOULD_REFRESH",
      });

      continue;
    }

    try {
      const syncResult =
        await syncDailyBars({
          stockCodes: [
            event.stock_code,
          ],
          startDate:
            compactDate(
              earliestStoredDate,
            ),
          endDate:
            compactDate(
              refreshEndDate,
            ),
          adjustedPrice:
            true,
          chunkDays:
            90,
        });

      targets.push({
        eventId:
          event.id,
        stockCode:
          event.stock_code,
        actionType:
          event.action_type as RefreshActionType,
        effectiveDate,
        staleEvidence:
          true,
        earliestStoredDate,
        refreshStartDate:
          earliestStoredDate,
        refreshEndDate,
        status:
          "REFRESHED",
        syncResult,
      });
    } catch (
      error
    ) {
      targets.push({
        eventId:
          event.id,
        stockCode:
          event.stock_code,
        actionType:
          event.action_type as RefreshActionType,
        effectiveDate,
        staleEvidence:
          true,
        earliestStoredDate,
        refreshStartDate:
          earliestStoredDate,
        refreshEndDate,
        status:
          "REFRESH_FAILED",
        error:
          error instanceof Error
            ? error.message
            : "UNKNOWN_REFRESH_ERROR",
      });
    }
  }

  const counts = {
    eventsRead:
      rawEvents.length,
    dedupedTargets:
      deduped.size,
    noStoredHistory:
      targets.filter(
        (x) =>
          x.status ===
          "NO_STORED_PRE_ACTION_HISTORY",
      ).length,
    alreadyRefreshed:
      targets.filter(
        (x) =>
          x.status ===
          "ALREADY_REFRESHED_AFTER_ACTION",
      ).length,
    wouldRefresh:
      targets.filter(
        (x) =>
          x.status ===
          "WOULD_REFRESH",
      ).length,
    refreshed:
      targets.filter(
        (x) =>
          x.status ===
          "REFRESHED",
      ).length,
    failed:
      targets.filter(
        (x) =>
          x.status ===
          "REFRESH_FAILED",
      ).length,
  };

  return {
    version:
      "V9_7_26",
    dryRun,
    includeValidationEvents,
    throughDate,
    detectionStartDate,
    actionTypes:
      [
        ...REFRESH_ACTION_TYPES,
      ],
    counts,
    targets,
    policy: {
      storageBasis:
        "KIS_MODE_0_ADJUSTED_ONLY",
      staleSignal:
        "PRE_ACTION_ROW_UPDATED_AT_BEFORE_EFFECTIVE_DATE",
      refreshRange:
        "EARLIEST_STORED_PRE_ACTION_DATE_THROUGH_DAY_BEFORE_EFFECTIVE_DATE",
      cashDividendAutoRefresh:
        false,
      genericFactorMutationOfAdjustedBars:
        false,
    },
  };
}
`;

const routeSource = `import {
  NextResponse,
} from "next/server";

import {
  refreshCorporateActionHistoryV9726,
} from "@/lib/market/refresh-corporate-action-history-v9-7-26";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  apply?: unknown;
  includeValidationEvents?: unknown;
  detectionLookbackCalendarDays?: unknown;
  throughDate?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (
        await request
          .json()
          .catch(
            () => ({}),
          )
      ) as RequestBody;

    const apply =
      body.apply ===
      true;

    const includeValidationEvents =
      body.includeValidationEvents ===
      true;

    if (
      apply &&
      includeValidationEvents
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "VALIDATION_EVENTS_CANNOT_DRIVE_PRODUCTION_REFRESH",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await refreshCorporateActionHistoryV9726({
        dryRun:
          !apply,

        includeValidationEvents,

        detectionLookbackCalendarDays:
          typeof body
            .detectionLookbackCalendarDays ===
          "number"
            ? body
                .detectionLookbackCalendarDays
            : undefined,

        throughDate:
          typeof body
            .throughDate ===
          "string"
            ? body
                .throughDate
            : undefined,
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "UNKNOWN_CORPORATE_ACTION_HISTORY_REFRESH_ERROR",
      },
      {
        status: 500,
      },
    );
  }
}
`;

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function inspectTarget(file, source, rel) {
  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      action: 'CREATE',
      expectedSha256: sha(source),
    };
  }

  const current = fs.readFileSync(file, 'utf8');

  return {
    file: rel,
    exists: true,
    action:
      current === source
        ? 'ALREADY_EXACT'
        : 'REFUSE_OVERWRITE_DIFFERENT_FILE',
    currentSha256: sha(current),
    expectedSha256: sha(source),
  };
}

function writeNewOrExact(file, source, rel) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== source) {
      throw new Error(
        `REFUSE_OVERWRITE_DIFFERENT_FILE:${rel}`
      );
    }
    return 'ALREADY_EXACT';
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = file + '.tmp-v9726';
  fs.writeFileSync(tmp, source, 'utf8');
  fs.renameSync(tmp, file);

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

  const preview = [
    inspectTarget(moduleFile, moduleSource, moduleRel),
    inspectTarget(routeFile, routeSource, routeRel),
  ];

  const conflicts = preview.filter(
    x => x.action === 'REFUSE_OVERWRITE_DIFFERENT_FILE'
  );

  if (conflicts.length > 0) {
    throw new Error(
      'TARGET_FILE_CONFLICT:' +
      conflicts.map(x => x.file).join(',')
    );
  }

  const applied = [];

  if (apply) {
    applied.push({
      file: moduleRel,
      result: writeNewOrExact(
        moduleFile,
        moduleSource,
        moduleRel
      ),
    });

    applied.push({
      file: routeRel,
      result: writeNewOrExact(
        routeFile,
        routeSource,
        routeRel
      ),
    });
  }

  const report = {
    version: VERSION,
    status: apply
      ? 'CORPORATE_ACTION_STALE_HISTORY_REFRESH_INSTALLED'
      : 'CORPORATE_ACTION_STALE_HISTORY_REFRESH_DRY_RUN_READY',
    applyRequested: apply,
    preview,
    applied,
    policy: {
      refreshActionTypes: [
        'STOCK_SPLIT',
        'REVERSE_SPLIT',
        'STOCK_DIVIDEND',
      ],
      cashDividendExcluded: true,
      productionUsesValidationEvents: false,
      refreshUsesSyncDailyBarsAdjustedMode: true,
      refreshesOnlyWhenPreActionUpdatedAtIsStale: true,
      refreshRangeStartsAtEarliestStoredPreActionBar: true,
      factorMultiplicationIntoAdjustedBars: false,
    },
    safety: {
      installerNetworkAccess: false,
      installerDatabaseAccess: false,
      sourceFilesModified: apply ? applied.filter(x => x.result === 'CREATED').length : 0,
      databaseWrites: 0,
    },
    nextCommand: apply
      ? 'npx tsc --noEmit'
      : 'node .\\scripts\\v9726.cjs --apply',
    nextGate: apply
      ? 'TYPECHECK_THEN_DRY_RUN_API_WITH_VALIDATION_EVENTS'
      : 'APPLY_V9_7_26',
  };

  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const reportFile = path.join(
    logDir,
    'corporate-action-stale-history-refresh-install-v9-7-26.json'
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log(JSON.stringify({
    status: report.status,
    applyRequested: apply,
    preview,
    applied,
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
      .replace(/[^A-Za-z0-9_:\-.,/\\]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
