/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10 - Post-persistence verification + history refresh manifest
 *
 * READ-ONLY. No DB writes. No KIS calls.
 *
 * Inputs:
 *   logs/opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json
 *   logs/opendart-corporate-action-128-event-id-map-v9-8-11-7.json
 *
 * Output:
 *   logs/opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10.json
 *
 * Canonical market-data policy:
 *   - market_daily_bars are canonical KIS ADJUSTED bars.
 *   - Never apply corporate-action factors onto already-adjusted canonical bars.
 *   - CASH_DIVIDEND: keep factor for audit/research; NO history refresh required.
 *   - STOCK_SPLIT / REVERSE_SPLIT: re-query KIS adjusted history.
 *   - MERGER / SPIN_OFF: structural; generic factor/history adjustment blocked.
 *
 * Expected current production-eligible batch:
 *   total events             = 128
 *   factor-ready             = 121
 *     cash dividend          = 79
 *     reverse split          = 40
 *     stock split            = 2
 *   structural blocked       = 7 MERGER
 *
 * Expected refresh manifest:
 *   ratio refresh candidates = 42
 *   cash no-refresh          = 79
 *   structural blocked       = 7
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-10.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_MANIFEST';

const APPLY_VERSION =
  'V9_8_11_9_128_RUN_121_FACTOR_PERSISTENCE_APPLY';

const EVENT_MAP_VERSION =
  'V9_8_11_7_POST_INSERT_128_EVENT_CANONICAL_VERIFICATION_AND_UUID_MAP';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_EVENTS = 128;
const EXPECTED_RUNS = 128;
const EXPECTED_FACTORS = 121;
const EXPECTED_CASH = 79;
const EXPECTED_REVERSE = 40;
const EXPECTED_SPLIT = 2;
const EXPECTED_RATIO_REFRESH = 42;
const EXPECTED_STRUCTURAL = 7;

const RATIO_TYPES = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL_REQUIRED');
  }

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getArray(url, key) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!response.ok) {
    const error = new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
    );

    error.details = {
      status: response.status,
      code: body?.code ?? null,
      message: body?.message ?? null,
      details: body?.details ?? null,
      hint: body?.hint ?? null,
    };

    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error('SUPABASE_ARRAY_RESPONSE_REQUIRED');
  }

  return body;
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(selector(row) ?? 'NULL');

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const applyFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json',
    );

  const eventMapFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-128-event-id-map-v9-8-11-7.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10.json',
    );

  for (const file of [applyFile, eventMapFile]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const apply =
    readJson(applyFile);

  const eventMap =
    readJson(eventMapFile);

  if (
    apply.version !==
    APPLY_VERSION
  ) {
    throw new Error(
      'APPLY_VERSION_MISMATCH',
    );
  }

  if (
    eventMap.version !==
    EVENT_MAP_VERSION
  ) {
    throw new Error(
      'EVENT_MAP_VERSION_MISMATCH',
    );
  }

  if (
    apply.status !==
    'ADJUSTMENT_PERSISTENCE_APPLY_COMPLETE'
  ) {
    throw new Error(
      'PERSISTENCE_APPLY_NOT_COMPLETE',
    );
  }

  if (
    eventMap.status !==
    'POST_INSERT_128_EVENT_VERIFICATION_COMPLETE'
  ) {
    throw new Error(
      'EVENT_MAP_NOT_COMPLETE',
    );
  }

  if (
    apply.runVersion !==
    RUN_VERSION
  ) {
    throw new Error(
      'RUN_VERSION_MISMATCH',
    );
  }

  if (
    apply.counts?.verifiedRuns !==
      EXPECTED_RUNS ||
    apply.counts?.verifiedFactors !==
      EXPECTED_FACTORS ||
    eventMap.counts?.eventMapRows !==
      EXPECTED_EVENTS
  ) {
    throw new Error(
      'UPSTREAM_COUNT_CONTRACT_FAILED',
    );
  }

  const targetEventIds =
    new Set(
      eventMap.eventMap.map(
        (row) => row.eventId,
      ),
    );

  const targetRunIds =
    new Set(
      apply.runMap.map(
        (row) => row.runId,
      ),
    );

  const targetFactorIds =
    new Set(
      apply.factorMap.map(
        (row) => row.factorId,
      ),
    );

  const {
    url,
    key,
  } =
    requireEnv();

  const dbEvents =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(
        [
          'id',
          'stock_code',
          'action_type',
          'effective_date',
          'provider',
          'provider_event_id',
          'source_fingerprint',
          'status',
          'metadata',
          'is_validation',
          'production_applied',
        ].join(','),
      )}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false`,
      key,
    );

  const dbRuns =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(
        [
          'id',
          'stock_code',
          'version',
          'status',
          'event_count',
          'supported_event_count',
          'unsupported_event_count',
          'factor_count',
          'summary',
          'is_validation',
          'production_applied',
          'started_at',
          'finished_at',
          'error_message',
        ].join(','),
      )}` +
      `&is_validation=eq.false`,
      key,
    );

  const dbFactors =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_factors` +
      `?select=${encodeURIComponent(
        [
          'id',
          'adjustment_run_id',
          'stock_code',
          'effective_date',
          'action_event_id',
          'action_type',
          'event_price_factor',
          'event_share_factor',
          'cumulative_price_factor',
          'cumulative_share_factor',
          'metadata',
          'is_validation',
          'production_applied',
          'created_at',
        ].join(','),
      )}` +
      `&is_validation=eq.false`,
      key,
    );

  const targetEvents =
    dbEvents.filter(
      (row) =>
        targetEventIds.has(row.id),
    );

  const targetRuns =
    dbRuns.filter(
      (row) =>
        targetRunIds.has(row.id),
    );

  const targetFactors =
    dbFactors.filter(
      (row) =>
        targetFactorIds.has(row.id),
    );

  const blockers = [];

  if (
    targetEvents.length !==
    EXPECTED_EVENTS
  ) {
    blockers.push(
      'TARGET_EVENT_COUNT_MISMATCH',
    );
  }

  if (
    targetRuns.length !==
    EXPECTED_RUNS
  ) {
    blockers.push(
      'TARGET_RUN_COUNT_MISMATCH',
    );
  }

  if (
    targetFactors.length !==
    EXPECTED_FACTORS
  ) {
    blockers.push(
      'TARGET_FACTOR_COUNT_MISMATCH',
    );
  }

  const runById =
    new Map(
      targetRuns.map(
        (row) => [row.id, row],
      ),
    );

  const eventById =
    new Map(
      targetEvents.map(
        (row) => [row.id, row],
      ),
    );

  const factorByEventId =
    new Map();

  for (const factor of targetFactors) {
    if (
      !factorByEventId.has(
        factor.action_event_id,
      )
    ) {
      factorByEventId.set(
        factor.action_event_id,
        [],
      );
    }

    factorByEventId
      .get(factor.action_event_id)
      .push(factor);
  }

  const rowIssues = [];

  for (const mapped of eventMap.eventMap) {
    const event =
      eventById.get(mapped.eventId);

    const runMapRow =
      apply.runMap.find(
        (row) =>
          row.eventId ===
          mapped.eventId,
      );

    if (!event || !runMapRow) {
      rowIssues.push({
        eventId:
          mapped.eventId,
        providerEventId:
          mapped.providerEventId,
        reason:
          'EVENT_OR_RUN_MAP_MISSING',
      });

      continue;
    }

    const run =
      runById.get(
        runMapRow.runId,
      );

    if (!run) {
      rowIssues.push({
        eventId:
          mapped.eventId,
        providerEventId:
          mapped.providerEventId,
        reason:
          'RUN_DB_ROW_MISSING',
      });

      continue;
    }

    if (
      event.stock_code !==
        mapped.stockCode ||
      event.action_type !==
        mapped.actionType ||
      event.effective_date !==
        mapped.effectiveDate ||
      event.production_applied !==
        false ||
      event.is_validation !==
        false ||
      event.metadata
        ?.canonical_validation_status !==
        'VALIDATED'
    ) {
      rowIssues.push({
        eventId:
          mapped.eventId,
        providerEventId:
          mapped.providerEventId,
        reason:
          'EVENT_DRIFT',
      });
    }

    if (
      run.stock_code !==
        mapped.stockCode ||
      run.version !==
        RUN_VERSION ||
      run.production_applied !==
        false ||
      run.is_validation !==
        false
    ) {
      rowIssues.push({
        eventId:
          mapped.eventId,
        providerEventId:
          mapped.providerEventId,
        runId:
          run.id,
        reason:
          'RUN_DRIFT',
      });
    }

    const factors =
      factorByEventId.get(
        mapped.eventId,
      ) ?? [];

    if (
      mapped.factorStatus ===
      'FACTOR_READY'
    ) {
      if (
        run.status !==
          'READY' ||
        run.factor_count !==
          1 ||
        factors.length !==
          1
      ) {
        rowIssues.push({
          eventId:
            mapped.eventId,
          providerEventId:
            mapped.providerEventId,
          runId:
            run.id,
          reason:
            'READY_EVENT_RUN_FACTOR_ACCOUNTING_FAILED',
          factorCount:
            factors.length,
        });
      } else {
        const factor =
          factors[0];

        if (
          factor.adjustment_run_id !==
            run.id ||
          factor.stock_code !==
            mapped.stockCode ||
          factor.action_type !==
            mapped.actionType ||
          factor.effective_date !==
            mapped.effectiveDate ||
          factor.production_applied !==
            false ||
          factor.is_validation !==
            false ||
          !(num(factor.event_price_factor) > 0) ||
          !(num(factor.event_share_factor) > 0) ||
          !(num(factor.cumulative_price_factor) > 0) ||
          !(num(factor.cumulative_share_factor) > 0)
        ) {
          rowIssues.push({
            eventId:
              mapped.eventId,
            providerEventId:
              mapped.providerEventId,
            factorId:
              factor.id,
            reason:
              'FACTOR_DRIFT_OR_POSITIVE_CHECK_FAILED',
          });
        }
      }
    } else if (
      mapped.factorStatus ===
      'STRUCTURAL_BLOCKED'
    ) {
      if (
        run.status !==
          'BLOCKED_UNSUPPORTED_ACTION' ||
        run.factor_count !==
          0 ||
        factors.length !==
          0
      ) {
        rowIssues.push({
          eventId:
            mapped.eventId,
          providerEventId:
            mapped.providerEventId,
          runId:
            run.id,
          reason:
            'STRUCTURAL_BLOCK_ACCOUNTING_FAILED',
          factorCount:
            factors.length,
        });
      }
    } else {
      rowIssues.push({
        eventId:
          mapped.eventId,
        providerEventId:
          mapped.providerEventId,
        reason:
          `UNEXPECTED_FACTOR_STATUS:${mapped.factorStatus}`,
      });
    }
  }

  if (rowIssues.length > 0) {
    blockers.push(
      'POST_PERSISTENCE_ROW_VERIFICATION_FAILED',
    );
  }

  const cashRows =
    eventMap.eventMap.filter(
      (row) =>
        row.actionType ===
        'CASH_DIVIDEND',
    );

  const ratioRows =
    eventMap.eventMap.filter(
      (row) =>
        RATIO_TYPES.has(
          row.actionType,
        ),
    );

  const structuralRows =
    eventMap.eventMap.filter(
      (row) =>
        row.factorStatus ===
        'STRUCTURAL_BLOCKED',
    );

  const reverseRows =
    ratioRows.filter(
      (row) =>
        row.actionType ===
        'REVERSE_SPLIT',
    );

  const splitRows =
    ratioRows.filter(
      (row) =>
        row.actionType ===
        'STOCK_SPLIT',
    );

  if (
    cashRows.length !==
    EXPECTED_CASH
  ) {
    blockers.push(
      'EXPECTED_79_CASH_DIVIDENDS',
    );
  }

  if (
    reverseRows.length !==
    EXPECTED_REVERSE
  ) {
    blockers.push(
      'EXPECTED_40_REVERSE_SPLITS',
    );
  }

  if (
    splitRows.length !==
    EXPECTED_SPLIT
  ) {
    blockers.push(
      'EXPECTED_2_STOCK_SPLITS',
    );
  }

  if (
    ratioRows.length !==
    EXPECTED_RATIO_REFRESH
  ) {
    blockers.push(
      'EXPECTED_42_RATIO_REFRESH_CANDIDATES',
    );
  }

  if (
    structuralRows.length !==
    EXPECTED_STRUCTURAL
  ) {
    blockers.push(
      'EXPECTED_7_STRUCTURAL_BLOCKED',
    );
  }

  const factorMapByEventId =
    new Map(
      apply.factorMap.map(
        (row) => [
          row.eventId,
          row,
        ],
      ),
    );

  const runMapByEventId =
    new Map(
      apply.runMap.map(
        (row) => [
          row.eventId,
          row,
        ],
      ),
    );

  const ratioRefreshPlan =
    ratioRows
      .map(
        (event) => {
          const factor =
            factorMapByEventId.get(
              event.eventId,
            );

          const run =
            runMapByEventId.get(
              event.eventId,
            );

          return {
            stockCode:
              event.stockCode,

            eventId:
              event.eventId,

            providerEventId:
              event.providerEventId,

            actionType:
              event.actionType,

            effectiveDate:
              event.effectiveDate,

            runId:
              run?.runId ??
              null,

            factorId:
              factor?.factorId ??
              null,

            eventPriceFactor:
              factor?.eventPriceFactor ??
              null,

            eventShareFactor:
              factor?.eventShareFactor ??
              null,

            refreshPolicy:
              'REQUERY_KIS_ADJUSTED_HISTORY',

            adjustedPriceMode:
              true,

            applyCorporateActionFactorToCanonicalBars:
              false,

            reason:
              'KIS_ADJUSTED_SERIES_MAY_RETROACTIVELY_REVISE_AROUND_RATIO_ACTION',
          };
        },
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`.localeCompare(
            `${b.effectiveDate}|${b.stockCode}`,
          ),
      );

  const cashNoRefresh =
    cashRows
      .map(
        (event) => ({
          stockCode:
            event.stockCode,

          eventId:
            event.eventId,

          providerEventId:
            event.providerEventId,

          actionType:
            event.actionType,

          effectiveDate:
            event.effectiveDate,

          refreshPolicy:
            'NO_HISTORY_REFRESH',

          applyCorporateActionFactorToCanonicalBars:
            false,

          reason:
            'CASH_FACTOR_IS_AUDIT_RESEARCH_ARTIFACT_CANONICAL_KIS_BARS_STAY_VENDOR_ADJUSTED',
        }),
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`.localeCompare(
            `${b.effectiveDate}|${b.stockCode}`,
          ),
      );

  const structuralBlockedPlan =
    structuralRows
      .map(
        (event) => ({
          stockCode:
            event.stockCode,

          eventId:
            event.eventId,

          providerEventId:
            event.providerEventId,

          actionType:
            event.actionType,

          effectiveDate:
            event.effectiveDate,

          refreshPolicy:
            'GENERIC_HISTORY_REFRESH_BLOCKED',

          genericFactorApplication:
            false,

          reason:
            'STRUCTURAL_ACTION_REQUIRES_EXPLICIT_MAPPING_NOT_GENERIC_FACTOR',
        }),
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`.localeCompare(
            `${b.effectiveDate}|${b.stockCode}`,
          ),
      );

  const ratioDistinctStocks =
    new Set(
      ratioRefreshPlan.map(
        (row) => row.stockCode,
      ),
    ).size;

  if (
    ratioDistinctStocks !==
    EXPECTED_RATIO_REFRESH
  ) {
    blockers.push(
      'RATIO_REFRESH_STOCK_DUPLICATION',
    );
  }

  const missingRefreshReferences =
    ratioRefreshPlan.filter(
      (row) =>
        !row.runId ||
        !row.factorId ||
        !(num(row.eventPriceFactor) > 0) ||
        !(num(row.eventShareFactor) > 0),
    );

  if (
    missingRefreshReferences.length >
    0
  ) {
    blockers.push(
      'RATIO_REFRESH_REFERENCE_OR_FACTOR_MISSING',
    );
  }

  const status =
    blockers.length === 0
      ? 'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
      : 'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_BLOCKED';

  const report = {
    version:
      VERSION,

    status,

    source: {
      persistenceApplyVersion:
        apply.version,

      persistenceApplyFingerprint:
        apply.outputFingerprint,

      eventMapVersion:
        eventMap.version,

      eventMapFingerprint:
        eventMap.outputFingerprint,
    },

    counts: {
      verifiedEvents:
        targetEvents.length,

      verifiedRuns:
        targetRuns.length,

      verifiedFactors:
        targetFactors.length,

      rowVerificationIssues:
        rowIssues.length,

      cashNoRefresh:
        cashNoRefresh.length,

      ratioRefreshCandidates:
        ratioRefreshPlan.length,

      ratioRefreshDistinctStocks:
        ratioDistinctStocks,

      reverseSplitRefresh:
        reverseRows.length,

      stockSplitRefresh:
        splitRows.length,

      structuralBlocked:
        structuralBlockedPlan.length,

      missingRefreshReferences:
        missingRefreshReferences.length,
    },

    actionTypeCounts:
      countBy(
        eventMap.eventMap,
        (row) => row.actionType,
      ),

    blockers,
    rowIssues,
    missingRefreshReferences,

    marketDataPolicy: {
      canonicalSource:
        'KIS_ADJUSTED_DAILY_BARS',

      adjustedPrice:
        true,

      factorApplicationToCanonicalAdjustedBars:
        'NEVER',

      cashDividend:
        'NO_HISTORY_REFRESH',

      stockSplit:
        'REQUERY_KIS_ADJUSTED_HISTORY',

      reverseSplit:
        'REQUERY_KIS_ADJUSTED_HISTORY',

      mergerSpinOff:
        'GENERIC_HISTORY_REFRESH_BLOCKED',
    },

    ratioRefreshPlan,
    cashNoRefresh,
    structuralBlockedPlan,

    safety: {
      networkRequests:
        3,

      databaseReads:
        3,

      databaseWrites:
        0,

      kisRequests:
        0,

      marketDailyBarsModified:
        0,

      corporateActionFactorsAppliedToCanonicalBars:
        0,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      status ===
      'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
        ? 'INSPECT_EXISTING_KIS_DAILY_SYNC_PATH_AND_BUILD_42_STOCK_REFRESH_APPLY'
        : 'STOP_AND_REVIEW',

    outputFile:
      path
        .relative(root, outputFile)
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        status:
          report.status,

        persistenceApplyFingerprint:
          report.source
            .persistenceApplyFingerprint,

        ratioRefreshPlan:
          ratioRefreshPlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.runId,
              row.factorId,
            ],
          ),

        cashNoRefresh:
          cashNoRefresh.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.effectiveDate,
            ],
          ),

        structuralBlocked:
          structuralBlockedPlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.effectiveDate,
            ],
          ),
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          VERSION,

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        blockers:
          report.blockers,

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
          0,

        coverageWindowAdvanced:
          false,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status !==
    'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        details:
          error?.details ?? null,

        databaseWrites:
          0,

        kisRequests:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
