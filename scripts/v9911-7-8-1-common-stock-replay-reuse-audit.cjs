#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.11.7 / 11.8 / 11.8.1 historical post-persistence reuse audit
 *
 * READ ONLY / LOCAL ARTIFACTS ONLY.
 *
 * IMPORTANT:
 * - V9.9.11.6 historical APPLY is NOT executed.
 * - V9.9.11.9 historical run/factor APPLY is NOT executed.
 * - V9.9.11.8.1 is authoritative because historical V9.9.11.9
 *   explicitly consumes the schema-aware 11.8.1 preflight.
 * - V9.9.11.8 is retained only as a superseded intermediate artifact.
 *
 * Expected V9.9 incremental eligible identities from 11.5.1:
 *   032080 REVERSE_SPLIT
 *   039830 CASH_DIVIDEND
 *
 * Historical 11.7 must map exactly those 2 canonical events to UUIDs.
 * Historical 11.8.1 must build exactly:
 *   2 READY adjustment run previews
 *   2 positive factor previews
 *   0 structural blocked runs
 * with no blockers / duplicates / invalid factor values.
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_7_8_8_1_REPLAY_READ_ONLY_POST_PERSISTENCE_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_11_4_5_5_1_REPLAY_V2_DEFERRED_EFFECTIVE_DATE_FIELD_PATH_AWARE_COMMON_STOCK_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE_AFTER_EFFECTIVE_DATE_FIELD_PATH_FIX';

const EVENT_MAP_STATUS =
  'POST_INSERT_2_EVENT_VERIFICATION_COMPLETE';

const AUTHORITATIVE_PREFLIGHT_VERSION =
  'V9_9_11_8_1_SCHEMA_AWARE_ADJUSTMENT_RUN_FACTOR_PERSISTENCE_PREFLIGHT';

const AUTHORITATIVE_PREFLIGHT_STATUS =
  'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY';

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
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return value;
    }
  }

  return null;
}

function normalizeReceipt(value) {
  const text =
    String(value ?? '').trim();

  return /^\d{14}$/.test(text)
    ? text
    : '';
}

function normalizeStock(value) {
  const text =
    String(value ?? '').trim();

  return text
    ? text.padStart(6, '0')
    : '';
}

function normalizeAction(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value ?? ''));
}

function finitePositive(value) {
  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n > 0
  );
}

function countField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.counts?.[name],
      doc?.summary?.[name],
    ];

    for (const value of values) {
      if (
        value !== undefined &&
        value !== null
      ) {
        const n = Number(value);

        if (Number.isFinite(n)) {
          return n;
        }
      }
    }
  }

  return null;
}

function arrayField(doc, ...names) {
  for (const name of names) {
    if (Array.isArray(doc?.[name])) {
      return doc[name];
    }
  }

  return [];
}

function recursiveObjects(
  value,
  out = [],
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return out;
  }

  if (!Array.isArray(value)) {
    out.push(value);
  }

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === 'object'
    ) {
      recursiveObjects(child, out);
    }
  }

  return out;
}

function rowIdentity(row) {
  return {
    providerEventId:
      normalizeReceipt(
        firstNonEmpty(
          row.providerEventId,
          row.provider_event_id,
          row.event?.providerEventId,
          row.event?.provider_event_id,
        ),
      ),

    stockCode:
      normalizeStock(
        firstNonEmpty(
          row.stockCode,
          row.stock_code,
          row.event?.stockCode,
          row.event?.stock_code,
        ),
      ),

    actionType:
      normalizeAction(
        firstNonEmpty(
          row.actionType,
          row.action_type,
          row.event?.actionType,
          row.event?.action_type,
        ),
      ),
  };
}

function keyFromId(id) {
  return [
    id.providerEventId,
    id.stockCode,
    id.actionType,
  ].join('|');
}

function keyOf(row) {
  return keyFromId(
    rowIdentity(row),
  );
}

function identitySet(rows) {
  return new Set(
    rows
      .map(keyOf)
      .filter(
        (key) =>
          !key.includes('||') &&
          !key.startsWith('|'),
      ),
  );
}

function diffSets(
  expected,
  actual,
) {
  return {
    missing:
      [...expected]
        .filter(
          (key) =>
            !actual.has(key),
        )
        .sort(),

    unexpected:
      [...actual]
        .filter(
          (key) =>
            !expected.has(key),
        )
        .sort(),
  };
}

function findTopLevelArray(
  doc,
  candidates,
) {
  for (const key of candidates) {
    if (Array.isArray(doc?.[key])) {
      return {
        key,
        rows:
          doc[key],
      };
    }
  }

  return {
    key: null,
    rows: [],
  };
}

function findRunPreview(doc) {
  const direct =
    findTopLevelArray(
      doc,
      [
        'runPreview',
        'runPreviews',
        'runRows',
        'plannedRuns',
        'adjustmentRunPreview',
      ],
    );

  if (direct.rows.length > 0) {
    return direct;
  }

  const arrays =
    Object.entries(doc ?? {})
      .filter(
        ([, value]) =>
          Array.isArray(value),
      )
      .map(
        ([key, rows]) => ({
          key,
          rows,
          score:
            rows.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                (
                  row.status === 'READY' ||
                  row.status ===
                    'BLOCKED_UNSUPPORTED_ACTION'
                ) &&
                (
                  row.event_count !== undefined ||
                  row.factor_count !== undefined
                ),
            ).length,
        }),
      )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  if (arrays[0]?.score > 0) {
    return {
      key:
        arrays[0].key,
      rows:
        arrays[0].rows,
    };
  }

  return {
    key: null,
    rows: [],
  };
}

function findFactorPreview(doc) {
  const direct =
    findTopLevelArray(
      doc,
      [
        'factorPreview',
        'factorPreviews',
        'factorRows',
        'plannedFactors',
        'adjustmentFactorPreview',
      ],
    );

  if (direct.rows.length > 0) {
    return direct;
  }

  const arrays =
    Object.entries(doc ?? {})
      .filter(
        ([, value]) =>
          Array.isArray(value),
      )
      .map(
        ([key, rows]) => ({
          key,
          rows,
          score:
            rows.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                (
                  row.event_price_factor !== undefined ||
                  row.eventPriceFactor !== undefined
                ) &&
                (
                  row.event_share_factor !== undefined ||
                  row.eventShareFactor !== undefined
                ),
            ).length,
        }),
      )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  if (arrays[0]?.score > 0) {
    return {
      key:
        arrays[0].key,
      rows:
        arrays[0].rows,
    };
  }

  return {
    key: null,
    rows: [],
  };
}

function factorView(row) {
  return {
    actionEventId:
      firstNonEmpty(
        row.action_event_id,
        row.actionEventId,
        row.event_id,
        row.eventId,
      ),

    stockCode:
      normalizeStock(
        firstNonEmpty(
          row.stock_code,
          row.stockCode,
        ),
      ),

    eventPriceFactor:
      Number(
        firstNonEmpty(
          row.event_price_factor,
          row.eventPriceFactor,
        ),
      ),

    eventShareFactor:
      Number(
        firstNonEmpty(
          row.event_share_factor,
          row.eventShareFactor,
        ),
      ),

    cumulativePriceFactor:
      Number(
        firstNonEmpty(
          row.cumulative_price_factor,
          row.cumulativePriceFactor,
          row.event_price_factor,
          row.eventPriceFactor,
        ),
      ),

    cumulativeShareFactor:
      Number(
        firstNonEmpty(
          row.cumulative_share_factor,
          row.cumulativeShareFactor,
          row.event_share_factor,
          row.eventShareFactor,
        ),
      ),

    productionApplied:
      firstNonEmpty(
        row.production_applied,
        row.productionApplied,
      ),
  };
}

function runView(row) {
  return {
    stockCode:
      normalizeStock(
        firstNonEmpty(
          row.stock_code,
          row.stockCode,
        ),
      ),

    status:
      String(
        row.status ??
        '',
      ),

    eventCount:
      Number(
        firstNonEmpty(
          row.event_count,
          row.eventCount,
        ),
      ),

    supportedEventCount:
      Number(
        firstNonEmpty(
          row.supported_event_count,
          row.supportedEventCount,
        ),
      ),

    unsupportedEventCount:
      Number(
        firstNonEmpty(
          row.unsupported_event_count,
          row.unsupportedEventCount,
        ),
      ),

    factorCount:
      Number(
        firstNonEmpty(
          row.factor_count,
          row.factorCount,
        ),
      ),

    productionApplied:
      firstNonEmpty(
        row.production_applied,
        row.productionApplied,
      ),

    version:
      firstNonEmpty(
        row.version,
      ),
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    upstream:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay-v2.json',
      ),

    eventMap117:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-2-event-id-map-v9-9-11-7-common-stock-scope.json',
      ),

    preflight118:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-adjustment-persistence-preflight-v9-9-11-8-common-stock-scope.json',
      ),

    preflight1181:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-adjustment-persistence-preflight-v9-9-11-8-1-common-stock-scope.json',
      ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-post-persistence-reuse-v9-9-11-7-8-8-1-common-stock-replay.json',
    );

  for (
    const [name, file]
    of Object.entries(files)
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs =
    Object.fromEntries(
      Object.entries(files)
        .map(
          ([name, file]) => [
            name,
            readJson(file),
          ],
        ),
    );

  assert(
    docs.upstream.version ===
      UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstream.version}`,
  );

  assert(
    docs.upstream.status ===
      UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstream.status}`,
  );

  assert(
    docs.upstream.conclusion
      ?.safeToAdvanceToHistoricalV9_9_11_7_8ReadOnlyPostPersistenceReuseAudit ===
      true,
    'UPSTREAM_NOT_READY',
  );

  const expectedEligibleKeys =
    new Set(
      docs.upstream
        .eligibility1151
        ?.eligibleKeys ??
      [],
    );

  assert(
    expectedEligibleKeys.size ===
      2,
    `EXPECTED_2_ELIGIBLE_KEYS_GOT_${expectedEligibleKeys.size}`,
  );

  const issues = [];

  // ---------------------------------------------------------------
  // V9.9.11.7 historical 2-event UUID map.
  // ---------------------------------------------------------------

  if (
    docs.eventMap117.status !==
    EVENT_MAP_STATUS
  ) {
    issues.push({
      check:
        'eventMap117.status',

      actual:
        docs.eventMap117.status ??
        null,

      expected:
        EVENT_MAP_STATUS,
    });
  }

  const eventMap =
    arrayField(
      docs.eventMap117,
      'eventMap',
    );

  if (
    eventMap.length !== 2
  ) {
    issues.push({
      check:
        'eventMap117.eventMapRows',

      actual:
        eventMap.length,

      expected:
        2,
    });
  }

  const eventMapKeys =
    identitySet(
      eventMap,
    );

  const eventMapDiff =
    diffSets(
      expectedEligibleKeys,
      eventMapKeys,
    );

  if (
    eventMapDiff.missing.length > 0 ||
    eventMapDiff.unexpected.length > 0
  ) {
    issues.push({
      check:
        'eventMap117.identitySet',

      ...eventMapDiff,
    });
  }

  const eventMapSemanticIssues = [];

  for (const row of eventMap) {
    const rowIssues = [];

    if (
      !validUuid(
        firstNonEmpty(
          row.eventId,
          row.event_id,
          row.id,
        ),
      )
    ) {
      rowIssues.push(
        'EVENT_UUID_REQUIRED',
      );
    }

    if (
      String(
        row.factorStatus ??
        '',
      ) !==
      'FACTOR_READY'
    ) {
      rowIssues.push(
        'FACTOR_STATUS_MUST_BE_FACTOR_READY',
      );
    }

    if (
      row.isValidation !==
        false &&
      row.is_validation !==
        false
    ) {
      rowIssues.push(
        'IS_VALIDATION_MUST_BE_FALSE',
      );
    }

    if (
      row.productionApplied !==
        false &&
      row.production_applied !==
        false
    ) {
      rowIssues.push(
        'PRODUCTION_APPLIED_MUST_BE_FALSE',
      );
    }

    if (
      firstNonEmpty(
        row.canonicalValidationStatus,
        row.metadata
          ?.canonical_validation_status,
      ) !==
      'VALIDATED'
    ) {
      rowIssues.push(
        'CANONICAL_VALIDATION_STATUS_MUST_BE_VALIDATED',
      );
    }

    if (rowIssues.length > 0) {
      eventMapSemanticIssues.push({
        identity:
          rowIdentity(row),

        issues:
          rowIssues,
      });
    }
  }

  if (
    eventMapSemanticIssues.length >
    0
  ) {
    issues.push({
      check:
        'eventMap117.semanticContract',

      rows:
        eventMapSemanticIssues,
    });
  }

  const duplicateEventIds =
    eventMap.length -
    new Set(
      eventMap.map(
        (row) =>
          String(
            firstNonEmpty(
              row.eventId,
              row.event_id,
              row.id,
            ) ??
            '',
          ),
      ),
    ).size;

  if (duplicateEventIds !== 0) {
    issues.push({
      check:
        'eventMap117.duplicateEventIds',

      actual:
        duplicateEventIds,

      expected:
        0,
    });
  }

  const count117 = {
    factorReadyEvents:
      countField(
        docs.eventMap117,
        'factorReadyEvents',
      ),

    structuralBlockedEvents:
      countField(
        docs.eventMap117,
        'structuralBlockedEvents',
      ),

    multiEventStocks:
      countField(
        docs.eventMap117,
        'multiEventStocks',
      ),

    factorStructuralOverlapStocks:
      countField(
        docs.eventMap117,
        'factorStructuralOverlapStocks',
      ),

    canonicalMismatches:
      Array.isArray(
        docs.eventMap117
          .canonicalMismatches,
      )
        ? docs.eventMap117
            .canonicalMismatches
            .length
        : countField(
            docs.eventMap117,
            'canonicalMismatches',
          ),

    unexpectedFactorStatusRows:
      countField(
        docs.eventMap117,
        'unexpectedFactorStatusRows',
      ),
  };

  const expected117 = {
    factorReadyEvents: 2,
    structuralBlockedEvents: 0,
    multiEventStocks: 0,
    factorStructuralOverlapStocks: 0,
    canonicalMismatches: 0,
    unexpectedFactorStatusRows: 0,
  };

  for (
    const [field, expected]
    of Object.entries(
      expected117,
    )
  ) {
    const actual =
      count117[field];

    if (
      actual !== null &&
      actual !== expected
    ) {
      issues.push({
        check:
          `eventMap117.${field}`,

        actual,
        expected,
      });
    }
  }

  // ---------------------------------------------------------------
  // V9.9.11.8 is historical intermediate only.
  // Do not require it to be authoritative.
  // ---------------------------------------------------------------

  const historical118 = {
    version:
      docs.preflight118.version ??
      null,

    status:
      docs.preflight118.status ??
      null,

    blockers:
      Array.isArray(
        docs.preflight118.blockers,
      )
        ? docs.preflight118
            .blockers.length
        : null,

    classification:
      'SUPERSEDED_BY_V9_9_11_8_1_SCHEMA_AWARE_PREFLIGHT',
  };

  // ---------------------------------------------------------------
  // V9.9.11.8.1 authoritative schema-aware preflight.
  // ---------------------------------------------------------------

  if (
    docs.preflight1181.version !==
    AUTHORITATIVE_PREFLIGHT_VERSION
  ) {
    issues.push({
      check:
        'preflight1181.version',

      actual:
        docs.preflight1181.version ??
        null,

      expected:
        AUTHORITATIVE_PREFLIGHT_VERSION,
    });
  }

  if (
    docs.preflight1181.status !==
    AUTHORITATIVE_PREFLIGHT_STATUS
  ) {
    issues.push({
      check:
        'preflight1181.status',

      actual:
        docs.preflight1181.status ??
        null,

      expected:
        AUTHORITATIVE_PREFLIGHT_STATUS,
    });
  }

  const blockers1181 =
    Array.isArray(
      docs.preflight1181.blockers,
    )
      ? docs.preflight1181.blockers
      : [];

  if (
    blockers1181.length !== 0
  ) {
    issues.push({
      check:
        'preflight1181.blockers',

      blockers:
        blockers1181,
    });
  }

  const runPicked =
    findRunPreview(
      docs.preflight1181,
    );

  const factorPicked =
    findFactorPreview(
      docs.preflight1181,
    );

  const runPreview =
    runPicked.rows
      .map(runView);

  const factorPreview =
    factorPicked.rows
      .map(factorView);

  if (
    runPreview.length !== 2
  ) {
    issues.push({
      check:
        'preflight1181.runPreviewRows',

      arrayKey:
        runPicked.key,

      actual:
        runPreview.length,

      expected:
        2,
    });
  }

  if (
    factorPreview.length !== 2
  ) {
    issues.push({
      check:
        'preflight1181.factorPreviewRows',

      arrayKey:
        factorPicked.key,

      actual:
        factorPreview.length,

      expected:
        2,
    });
  }

  const runIssues = [];

  for (
    const row
    of runPreview
  ) {
    const rowIssues = [];

    if (
      row.status !==
      'READY'
    ) {
      rowIssues.push(
        'RUN_STATUS_MUST_BE_READY',
      );
    }

    if (
      row.eventCount !== 1
    ) {
      rowIssues.push(
        'EVENT_COUNT_MUST_BE_1',
      );
    }

    if (
      row.supportedEventCount !==
      1
    ) {
      rowIssues.push(
        'SUPPORTED_EVENT_COUNT_MUST_BE_1',
      );
    }

    if (
      row.unsupportedEventCount !==
      0
    ) {
      rowIssues.push(
        'UNSUPPORTED_EVENT_COUNT_MUST_BE_0',
      );
    }

    if (
      row.factorCount !== 1
    ) {
      rowIssues.push(
        'FACTOR_COUNT_MUST_BE_1',
      );
    }

    if (
      row.productionApplied !==
        null &&
      row.productionApplied !==
        false
    ) {
      rowIssues.push(
        'PRODUCTION_APPLIED_MUST_BE_FALSE',
      );
    }

    if (
      rowIssues.length > 0
    ) {
      runIssues.push({
        row,
        issues:
          rowIssues,
      });
    }
  }

  if (
    runIssues.length > 0
  ) {
    issues.push({
      check:
        'preflight1181.runPreviewContract',

      rows:
        runIssues,
    });
  }

  const factorIssues = [];

  for (
    const row
    of factorPreview
  ) {
    const rowIssues = [];

    if (
      !finitePositive(
        row.eventPriceFactor,
      )
    ) {
      rowIssues.push(
        'EVENT_PRICE_FACTOR_MUST_BE_POSITIVE',
      );
    }

    if (
      !finitePositive(
        row.eventShareFactor,
      )
    ) {
      rowIssues.push(
        'EVENT_SHARE_FACTOR_MUST_BE_POSITIVE',
      );
    }

    if (
      !finitePositive(
        row.cumulativePriceFactor,
      )
    ) {
      rowIssues.push(
        'CUMULATIVE_PRICE_FACTOR_MUST_BE_POSITIVE',
      );
    }

    if (
      !finitePositive(
        row.cumulativeShareFactor,
      )
    ) {
      rowIssues.push(
        'CUMULATIVE_SHARE_FACTOR_MUST_BE_POSITIVE',
      );
    }

    if (
      row.productionApplied !==
        null &&
      row.productionApplied !==
        false
    ) {
      rowIssues.push(
        'PRODUCTION_APPLIED_MUST_BE_FALSE',
      );
    }

    if (
      rowIssues.length > 0
    ) {
      factorIssues.push({
        row,
        issues:
          rowIssues,
      });
    }
  }

  if (
    factorIssues.length > 0
  ) {
    issues.push({
      check:
        'preflight1181.factorPreviewContract',

      rows:
        factorIssues,
    });
  }

  const eventIds =
    new Set(
      eventMap.map(
        (row) =>
          String(
            firstNonEmpty(
              row.eventId,
              row.event_id,
              row.id,
            ) ??
            '',
          ),
      ),
    );

  const factorActionEventIds =
    factorPreview
      .map(
        (row) =>
          String(
            row.actionEventId ??
            '',
          ),
      )
      .filter(Boolean);

  if (
    factorActionEventIds.length >
    0
  ) {
    const missingFactorEventIds =
      factorActionEventIds
        .filter(
          (id) =>
            !eventIds.has(id),
        );

    if (
      missingFactorEventIds.length >
      0
    ) {
      issues.push({
        check:
          'preflight1181.factorActionEventIdsNotIn117EventMap',

        ids:
          missingFactorEventIds,
      });
    }
  }

  const runStockSet =
    new Set(
      runPreview
        .map(
          (row) =>
            row.stockCode,
        )
        .filter(Boolean),
    );

  const expectedStockSet =
    new Set(
      eventMap
        .map(
          (row) =>
            rowIdentity(row)
              .stockCode,
        )
        .filter(Boolean),
    );

  const runStockDiff =
    diffSets(
      expectedStockSet,
      runStockSet,
    );

  if (
    runStockDiff.missing.length >
      0 ||
    runStockDiff.unexpected.length >
      0
  ) {
    issues.push({
      check:
        'preflight1181.runStockSet',

      ...runStockDiff,
    });
  }

  const factorStockSet =
    new Set(
      factorPreview
        .map(
          (row) =>
            row.stockCode,
        )
        .filter(Boolean),
    );

  if (
    factorStockSet.size > 0
  ) {
    const factorStockDiff =
      diffSets(
        expectedStockSet,
        factorStockSet,
      );

    if (
      factorStockDiff.missing.length >
        0 ||
      factorStockDiff.unexpected.length >
        0
    ) {
      issues.push({
        check:
          'preflight1181.factorStockSet',

        ...factorStockDiff,
      });
    }
  }

  const count1181 = {
    eventMapRows:
      countField(
        docs.preflight1181,
        'eventMapRows',
        'inputEvents',
        'events',
      ),

    factorReadyEvents:
      countField(
        docs.preflight1181,
        'factorReadyEvents',
      ),

    structuralBlockedEvents:
      countField(
        docs.preflight1181,
        'structuralBlockedEvents',
      ),

    runPreviewRows:
      countField(
        docs.preflight1181,
        'runPreviewRows',
      ),

    readyRunRows:
      countField(
        docs.preflight1181,
        'readyRunRows',
      ),

    blockedStructuralRunRows:
      countField(
        docs.preflight1181,
        'blockedStructuralRunRows',
      ),

    factorPreviewRows:
      countField(
        docs.preflight1181,
        'factorPreviewRows',
      ),
  };

  const countExpectations1181 = {
    eventMapRows: 2,
    factorReadyEvents: 2,
    structuralBlockedEvents: 0,
    runPreviewRows: 2,
    readyRunRows: 2,
    blockedStructuralRunRows: 0,
    factorPreviewRows: 2,
  };

  for (
    const [field, expected]
    of Object.entries(
      countExpectations1181,
    )
  ) {
    const actual =
      count1181[field];

    if (
      actual !== null &&
      actual !== expected
    ) {
      issues.push({
        check:
          `preflight1181.${field}`,

        actual,
        expected,
      });
    }
  }

  const preflightRunIssues =
    Array.isArray(
      docs.preflight1181
        .runIssues,
    )
      ? docs.preflight1181
          .runIssues
      : [];

  const preflightFactorIssues =
    Array.isArray(
      docs.preflight1181
        .factorIssues,
    )
      ? docs.preflight1181
          .factorIssues
      : [];

  if (
    preflightRunIssues.length >
    0
  ) {
    issues.push({
      check:
        'preflight1181.reportedRunIssues',

      rows:
        preflightRunIssues,
    });
  }

  if (
    preflightFactorIssues.length >
    0
  ) {
    issues.push({
      check:
        'preflight1181.reportedFactorIssues',

      rows:
        preflightFactorIssues,
    });
  }

  const duplicateRunStocks =
    runPreview.length -
    new Set(
      runPreview
        .map(
          (row) =>
            row.stockCode,
        )
        .filter(Boolean),
    ).size;

  if (
    duplicateRunStocks !== 0
  ) {
    issues.push({
      check:
        'preflight1181.duplicateRunStocks',

      actual:
        duplicateRunStocks,

      expected:
        0,
    });
  }

  // 028080 must not appear in this 2-event incremental branch.
  const contains028080 =
    eventMap.some(
      (row) =>
        rowIdentity(row)
          .stockCode ===
        '028080',
    ) ||
    runPreview.some(
      (row) =>
        row.stockCode ===
        '028080',
    ) ||
    factorPreview.some(
      (row) =>
        row.stockCode ===
        '028080',
    );

  if (contains028080) {
    issues.push({
      check:
        '028080InjectedIntoV99TwoEventPostPersistenceBranch',

      actual:
        true,

      expected:
        false,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_11_7_8_1_TWO_EVENT_POST_PERSISTENCE_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_11_7_8_1_TWO_EVENT_POST_PERSISTENCE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    authoritativeBranch: {
      eventMapStage:
        'V9.9.11.7',

      persistencePreflightStage:
        'V9.9.11.8.1',

      historicalV9911_8:
        historical118,

      v9911_8Authoritative:
        false,

      v9911_8_1Authoritative:
        true,

      reason:
        'HISTORICAL_V9_9_11_9_EXPLICITLY_CONSUMES_V9_9_11_8_1_SCHEMA_AWARE_PREFLIGHT',
    },

    expectedEligibleKeys:
      [...expectedEligibleKeys]
        .sort(),

    eventMap117: {
      status:
        docs.eventMap117.status ??
        null,

      version:
        docs.eventMap117.version ??
        null,

      eventMapRows:
        eventMap.length,

      eventMapKeys:
        [...eventMapKeys]
          .sort(),

      counts:
        count117,

      duplicateEventIds,

      semanticIssues:
        eventMapSemanticIssues,
    },

    preflight1181: {
      status:
        docs.preflight1181.status ??
        null,

      version:
        docs.preflight1181.version ??
        null,

      counts:
        count1181,

      runPreviewArrayKey:
        runPicked.key,

      runPreview,

      factorPreviewArrayKey:
        factorPicked.key,

      factorPreview,

      blockers:
        blockers1181,

      reportedRunIssues:
        preflightRunIssues,

      reportedFactorIssues:
        preflightFactorIssues,
    },

    issues,

    conclusion: {
      historicalV9911_7EventMapReusable:
        reusable,

      historicalV9911_8IntermediateSuperseded:
        true,

      historicalV9911_8_1SchemaAwarePreflightReusable:
        reusable,

      exactTwoEligibleEventIdentitiesPreserved:
        reusable,

      exactTwoCanonicalEventUuidsMapped:
        reusable &&
        eventMap.length === 2,

      exactTwoReadyRunPreviews:
        reusable &&
        runPreview.length === 2,

      exactTwoPositiveFactorPreviews:
        reusable &&
        factorPreview.length === 2,

      historicalV9911_6ApplyMustNotBeExecuted:
        true,

      historicalV9911_9ApplyMustNotBeExecuted:
        true,

      safeToAdvanceToHistoricalV9_9_11_10PlusReadOnlyReplay:
        reusable,

      networkRefetchRequiredNow:
        false,

      databaseReadRequiredNow:
        false,

      databaseWriteRequiredNow:
        false,

      physical028080RepairStillSeparate:
        true,

      physical028080RepairAddedToIncrementalBranch:
        false,
    },

    safety: {
      networkRequestsNow:
        0,

      databaseReadsNow:
        0,

      databaseWritesNow:
        0,

      productionAppliedNow:
        false,

      historicalEventApplyExecutedNow:
        false,

      historicalRunFactorApplyExecutedNow:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_11_10_PLUS_READ_ONLY_REPLAY'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-post-persistence-reuse-v9-9-11-7-8-8-1-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        authoritativeBranch:
          report.authoritativeBranch,

        expectedEligibleKeys:
          report.expectedEligibleKeys,

        eventMap117:
          report.eventMap117,

        preflight1181:
          report.preflight1181,

        issues:
          report.issues,

        conclusion:
          report.conclusion,
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
          report.version,

        authoritativeBranch:
          report.authoritativeBranch,

        expectedEligibleKeys:
          report.expectedEligibleKeys,

        eventMap117: {
          status:
            report.eventMap117.status,

          eventMapRows:
            report.eventMap117
              .eventMapRows,

          eventMapKeys:
            report.eventMap117
              .eventMapKeys,

          counts:
            report.eventMap117
              .counts,

          duplicateEventIds:
            report.eventMap117
              .duplicateEventIds,

          semanticIssues:
            report.eventMap117
              .semanticIssues,
        },

        preflight1181: {
          status:
            report.preflight1181
              .status,

          version:
            report.preflight1181
              .version,

          counts:
            report.preflight1181
              .counts,

          runPreviewRows:
            report.preflight1181
              .runPreview.length,

          factorPreviewRows:
            report.preflight1181
              .factorPreview.length,

          blockers:
            report.preflight1181
              .blockers.length,

          reportedRunIssues:
            report.preflight1181
              .reportedRunIssues
              .length,

          reportedFactorIssues:
            report.preflight1181
              .reportedFactorIssues
              .length,
        },

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow:
          0,

        databaseReadsNow:
          0,

        databaseWritesNow:
          0,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (!reusable) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'HISTORICAL_V9_9_11_7_8_1_POST_PERSISTENCE_REUSE_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow:
          0,

        databaseReadsNow:
          0,

        databaseWritesNow:
          0,

        productionAppliedNow:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
