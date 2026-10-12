#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.7 / 7.2 / 8 common-stock historical reuse audit
 *
 * READ ONLY.
 *
 * Authoritative input branch was already proven:
 *   6.1-common-stock-scope
 *   -> 6.3-common-stock-scope
 *   -> 7-common-stock-scope
 *   -> 7.2-common-stock-scope
 *   -> 8-common-stock-scope
 *
 * This audit validates the 6-row common-stock branch through effective-date
 * finalization and factor validation.
 *
 * Important:
 * Ratio fields are read from canonicalPreview FIRST because V9.8/V9.9 factor
 * validation consumes:
 *   row.canonicalPreview.ratio_from
 *   row.canonicalPreview.ratio_to
 *
 * A top-level ratioFrom/ratioTo value of 0 therefore MUST NOT be treated as
 * authoritative when canonicalPreview contains the real ratio.
 *
 * No network calls are made by THIS audit.
 * Historical artifacts may legitimately report prior read-only network calls.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_7_7_2_8_REPLAY_READ_ONLY_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_6_REPLAY_READ_ONLY_AUTHORITATIVE_COMMON_STOCK_FIELD_EXTRACTION_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_6_COMMON_STOCK_FIELD_EXTRACTION_BRANCH_REUSABLE';

const STRUCTURAL_ACTIONS =
  new Set([
    'MERGER',
    'SPIN_OFF',
  ]);

const RATIO_ACTIONS =
  new Set([
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
  ]);

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

function numOrNull(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
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

function badStatus(value) {
  const text =
    String(value ?? '')
      .toUpperCase();

  return (
    text.includes('FAILED') ||
    text.includes('BLOCKED') ||
    text.includes('ERROR')
  );
}

function safetyWrites(doc) {
  const candidates = [
    doc?.databaseWrites,
    doc?.safety?.databaseWrites,
    doc?.counts?.databaseWrites,
  ];

  for (const value of candidates) {
    if (
      value !== undefined &&
      value !== null
    ) {
      const n = Number(value);

      return Number.isFinite(n)
        ? n
        : null;
    }
  }

  return null;
}

function candidateRows(doc) {
  const preferred = [
    'results',
    'repairedRows',
    'rows',
    'outputRows',
    'events',
    'canonicalRows',
  ];

  for (const key of preferred) {
    if (Array.isArray(doc?.[key])) {
      return doc[key];
    }
  }

  const arrays =
    Object.entries(doc ?? {})
      .filter(
        ([, value]) =>
          Array.isArray(value),
      )
      .map(
        ([key, value]) => ({
          key,
          value,
          score:
            value.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                (
                  row.stockCode ||
                  row.stock_code ||
                  row.canonicalPreview?.stock_code
                ) &&
                (
                  row.actionType ||
                  row.action_type ||
                  row.canonicalPreview?.action_type
                ),
            ).length,
        }),
      )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  if (arrays[0]?.score > 0) {
    return arrays[0].value;
  }

  return [];
}

function identity(row) {
  const cp =
    row?.canonicalPreview ?? {};

  return {
    providerEventId:
      normalizeReceipt(
        firstNonEmpty(
          row.providerEventId,
          row.provider_event_id,
          row.rootReceiptNo,
          row.root_receipt_no,
          cp.provider_event_id,
          cp.providerEventId,
        ),
      ),

    stockCode:
      normalizeStock(
        firstNonEmpty(
          row.stockCode,
          row.stock_code,
          cp.stock_code,
          cp.stockCode,
        ),
      ),

    actionType:
      normalizeAction(
        firstNonEmpty(
          row.actionType,
          row.action_type,
          cp.action_type,
          cp.actionType,
        ),
      ),

    sourceReceiptNo:
      normalizeReceipt(
        firstNonEmpty(
          row.sourceReceiptNo,
          row.source_receipt_no,
          row.receiptNo,
          row.receipt_no,
          cp.metadata?.source_receipt_no,
        ),
      ),
  };
}

function keyOf(row) {
  const id = identity(row);

  return [
    id.providerEventId,
    id.stockCode,
    id.actionType,
  ].join('|');
}

function fieldView(row) {
  const cp =
    row?.canonicalPreview ?? {};

  const id = identity(row);

  const ratioFrom =
    numOrNull(
      firstNonEmpty(
        cp.ratio_from,
        cp.ratioFrom,
        row.ratio_from,
        row.ratioFrom,
        row.facts?.ratio_from,
        row.facts?.ratioFrom,
      ),
    );

  const ratioTo =
    numOrNull(
      firstNonEmpty(
        cp.ratio_to,
        cp.ratioTo,
        row.ratio_to,
        row.ratioTo,
        row.facts?.ratio_to,
        row.facts?.ratioTo,
      ),
    );

  const effectiveDate =
    firstNonEmpty(
      cp.effective_date,
      cp.effectiveDate,
      row.effectiveDate,
      row.effective_date,
      row.resolution?.effectiveDate,
      row.resolution?.effective_date,
    );

  const factorStatus =
    firstNonEmpty(
      row.factorStatus,
      row.factor_status,
      row.factor?.status,
      row.factorPreview?.status,
      row.factor_preview?.status,
      cp.metadata?.factor_status,
    );

  const factorReason =
    firstNonEmpty(
      row.factorReason,
      row.factor_reason,
      row.reason,
      row.factor?.reason,
      row.factorPreview?.reason,
      row.factor_preview?.reason,
    );

  const resolutionStatus =
    firstNonEmpty(
      row.resolution?.status,
      row.resolutionStatus,
      row.resolution_status,
    );

  const resolutionReason =
    firstNonEmpty(
      row.resolution?.reason,
      row.resolutionReason,
      row.resolution_reason,
    );

  return {
    ...id,

    ratioFrom,
    ratioTo,

    effectiveDate:
      effectiveDate === null
        ? null
        : String(effectiveDate),

    factorStatus:
      factorStatus === null
        ? null
        : String(factorStatus),

    factorReason:
      factorReason === null
        ? null
        : String(factorReason),

    resolutionStatus:
      resolutionStatus === null
        ? null
        : String(resolutionStatus),

    resolutionReason:
      resolutionReason === null
        ? null
        : String(resolutionReason),
  };
}

function countActions(rows) {
  const out = {};

  for (const row of rows) {
    const action =
      identity(row).actionType ||
      'UNKNOWN';

    out[action] =
      (out[action] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function collectStrings(
  value,
  prefix = '',
  out = [],
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return out;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const p =
      prefix
        ? `${prefix}.${key}`
        : key;

    if (typeof child === 'string') {
      out.push({
        path: p,
        key,
        value: child,
      });
    } else if (
      child &&
      typeof child === 'object'
    ) {
      collectStrings(
        child,
        p,
        out,
      );
    }
  }

  return out;
}

function lineageProof(
  downstream,
  upstream,
  upstreamFileBasename,
) {
  const strings =
    collectStrings(
      downstream?.source ?? {},
    );

  const byVersion =
    strings.filter(
      (row) =>
        /version/i.test(row.key) &&
        String(row.value) ===
          String(upstream.version),
    );

  const byFile =
    strings.filter(
      (row) =>
        /file|path/i.test(row.key) &&
        String(row.value)
          .replaceAll('\\', '/')
          .endsWith(
            upstreamFileBasename,
          ),
    );

  const byHash =
    strings.filter(
      (row) =>
        /^[0-9a-f]{64}$/i.test(
          String(row.value),
        ) &&
        upstream.outputFingerprint &&
        String(row.value) ===
          String(
            upstream.outputFingerprint,
          ),
    );

  return {
    byVersion,
    byFile,
    byHash,
    proven:
      byVersion.length > 0 ||
      byFile.length > 0 ||
      byHash.length > 0,
  };
}

function topLevelCount(
  doc,
  ...names
) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.counts?.[name],
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

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    upstreamAudit:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-authoritative-field-extraction-reuse-v9-9-6-common-stock-replay.json',
      ),

    common63:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-9-6-3-common-stock-scope.json',
      ),

    common7:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-market-effective-date-v9-9-7-common-stock-scope.json',
      ),

    common72:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-effective-date-finalization-v9-9-7-2-common-stock-scope.json',
      ),

    common8:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
      ),
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay.json',
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
    docs.upstreamAudit.version ===
      UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstreamAudit.version}`,
  );

  assert(
    docs.upstreamAudit.status ===
      UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstreamAudit.status}`,
  );

  assert(
    docs.upstreamAudit.conclusion
      ?.safeToAdvanceToHistoricalV997_7_2_8ReuseAudit ===
      true,
    'UPSTREAM_NOT_READY',
  );

  const rows63Raw =
    candidateRows(docs.common63);

  const rows7Raw =
    candidateRows(docs.common7);

  const rows72Raw =
    candidateRows(docs.common72);

  const rows8Raw =
    candidateRows(docs.common8);

  assert(
    rows63Raw.length === 6,
    `COMMON_6_3_ROW_COUNT:${rows63Raw.length}`,
  );

  assert(
    rows7Raw.length === 6,
    `COMMON_7_ROW_COUNT:${rows7Raw.length}`,
  );

  assert(
    rows72Raw.length === 6,
    `COMMON_7_2_ROW_COUNT:${rows72Raw.length}`,
  );

  assert(
    rows8Raw.length === 6,
    `COMMON_8_ROW_COUNT:${rows8Raw.length}`,
  );

  const stages = {
    common63:
      rows63Raw,
    common7:
      rows7Raw,
    common72:
      rows72Raw,
    common8:
      rows8Raw,
  };

  const sets =
    Object.fromEntries(
      Object.entries(stages)
        .map(
          ([name, rows]) => [
            name,
            new Set(
              rows.map(keyOf),
            ),
          ],
        ),
    );

  const issues = [];

  // ---------------------------------------------------------------
  // Stage health and write safety.
  // Historical networkRequests are NOT blockers because those calls
  // happened in the historical run; this audit itself does not refetch.
  // ---------------------------------------------------------------

  const stageStatus = {};

  for (
    const name of [
      'common7',
      'common72',
      'common8',
    ]
  ) {
    const doc =
      docs[name];

    const writes =
      safetyWrites(doc);

    stageStatus[name] = {
      version:
        doc.version ?? null,

      status:
        doc.status ?? null,

      historicalNetworkRequests:
        topLevelCount(
          doc,
          'networkRequests',
        ),

      databaseWrites:
        writes,

      outputFingerprint:
        doc.outputFingerprint ??
        null,
    };

    if (badStatus(doc.status)) {
      issues.push({
        check:
          `${name}.status`,
        actual:
          doc.status ?? null,
        expected:
          'NON_FAILED_NON_BLOCKED',
      });
    }

    if (
      writes !== null &&
      writes !== 0
    ) {
      issues.push({
        check:
          `${name}.databaseWrites`,
        actual:
          writes,
        expected:
          0,
      });
    }
  }

  // ---------------------------------------------------------------
  // Identity continuity 6.3 -> 7 -> 7.2 -> 8.
  // ---------------------------------------------------------------

  const identityDiffs = {};

  const edges = [
    ['common63', 'common7'],
    ['common7', 'common72'],
    ['common72', 'common8'],
  ];

  for (
    const [from, to]
    of edges
  ) {
    const a =
      sets[from];

    const b =
      sets[to];

    const onlyFrom =
      [...a].filter(
        (key) => !b.has(key),
      );

    const onlyTo =
      [...b].filter(
        (key) => !a.has(key),
      );

    identityDiffs[
      `${from}To${to}`
    ] = {
      onlyFrom,
      onlyTo,
      delta:
        onlyFrom.length +
        onlyTo.length,
    };

    if (
      onlyFrom.length > 0 ||
      onlyTo.length > 0
    ) {
      issues.push({
        check:
          `${from}To${to}.identitySetChanged`,
        onlyFrom,
        onlyTo,
      });
    }
  }

  for (
    const [name, rows]
    of Object.entries(stages)
  ) {
    const duplicateCount =
      rows.length -
      new Set(
        rows.map(keyOf),
      ).size;

    if (duplicateCount !== 0) {
      issues.push({
        check:
          `${name}.duplicateCanonicalIdentities`,
        actual:
          duplicateCount,
        expected:
          0,
      });
    }
  }

  // ---------------------------------------------------------------
  // Explicit lineage proof.
  // ---------------------------------------------------------------

  const lineage = {
    common63To7:
      lineageProof(
        docs.common7,
        docs.common63,
        path.basename(
          files.common63,
        ),
      ),

    common7To72:
      lineageProof(
        docs.common72,
        docs.common7,
        path.basename(
          files.common7,
        ),
      ),

    common72To8:
      lineageProof(
        docs.common8,
        docs.common72,
        path.basename(
          files.common72,
        ),
      ),
  };

  for (
    const [edge, proof]
    of Object.entries(lineage)
  ) {
    if (!proof.proven) {
      issues.push({
        check:
          `${edge}.lineageNotProven`,
      });
    }
  }

  // ---------------------------------------------------------------
  // Row semantic checks.
  // ---------------------------------------------------------------

  const views63 =
    rows63Raw.map(fieldView);

  const views72 =
    rows72Raw.map(fieldView);

  const views8 =
    rows8Raw.map(fieldView);

  const byKey63 =
    new Map(
      views63.map(
        (row) => [
          [
            row.providerEventId,
            row.stockCode,
            row.actionType,
          ].join('|'),
          row,
        ],
      ),
    );

  const byKey72 =
    new Map(
      views72.map(
        (row) => [
          [
            row.providerEventId,
            row.stockCode,
            row.actionType,
          ].join('|'),
          row,
        ],
      ),
    );

  const byKey8 =
    new Map(
      views8.map(
        (row) => [
          [
            row.providerEventId,
            row.stockCode,
            row.actionType,
          ].join('|'),
          row,
        ],
      ),
    );

  const semanticChecks = [];

  for (const key of sets.common8) {
    const row63 =
      byKey63.get(key);

    const row72 =
      byKey72.get(key);

    const row8 =
      byKey8.get(key);

    const action =
      row8.actionType;

    const factorStatus =
      String(
        row8.factorStatus ?? '',
      ).toUpperCase();

    const factorReason =
      String(
        row8.factorReason ?? '',
      ).toUpperCase();

    const effectiveDate =
      row72.effectiveDate ??
      row8.effectiveDate ??
      null;

    const check = {
      key,
      providerEventId:
        row8.providerEventId,
      stockCode:
        row8.stockCode,
      actionType:
        action,

      sourceReceiptNo:
        row8.sourceReceiptNo ||
        row72.sourceReceiptNo ||
        row63.sourceReceiptNo ||
        null,

      ratioFrom:
        row63.ratioFrom,

      ratioTo:
        row63.ratioTo,

      effectiveDate,

      factorStatus:
        row8.factorStatus,

      factorReason:
        row8.factorReason,

      resolutionStatus:
        row72.resolutionStatus,

      resolutionReason:
        row72.resolutionReason,

      valid:
        true,

      problems: [],
    };

    if (
      factorStatus ===
        'FACTOR_READY' &&
      !effectiveDate
    ) {
      check.valid = false;
      check.problems.push(
        'FACTOR_READY_WITHOUT_EFFECTIVE_DATE',
      );
    }

    if (
      STRUCTURAL_ACTIONS.has(
        action,
      ) &&
      factorStatus !==
        'STRUCTURAL_BLOCKED'
    ) {
      check.valid = false;
      check.problems.push(
        'STRUCTURAL_ACTION_NOT_STRUCTURAL_BLOCKED',
      );
    }

    if (
      RATIO_ACTIONS.has(
        action,
      )
    ) {
      const ratioReady =
        row63.ratioFrom !== null &&
        row63.ratioTo !== null &&
        row63.ratioFrom > 0 &&
        row63.ratioTo > 0;

      if (!ratioReady) {
        check.valid = false;
        check.problems.push(
          'RATIO_ACTION_CANONICAL_PREVIEW_RATIO_NOT_POSITIVE',
        );
      }

      if (
        factorStatus !==
          'FACTOR_READY'
      ) {
        check.valid = false;
        check.problems.push(
          'RATIO_ACTION_NOT_FACTOR_READY',
        );
      }

      if (
        factorStatus ===
          'FACTOR_READY' &&
        factorReason &&
        !factorReason.includes(
          'EXPLICIT_EVENT_RATIO',
        )
      ) {
        check.valid = false;
        check.problems.push(
          'RATIO_FACTOR_READY_REASON_NOT_EXPLICIT_EVENT_RATIO',
        );
      }
    }

    if (
      action ===
        'CASH_DIVIDEND' &&
      ![
        'FACTOR_READY',
        'FUTURE_PENDING',
      ].includes(
        factorStatus,
      )
    ) {
      check.valid = false;
      check.problems.push(
        'CASH_DIVIDEND_UNEXPECTED_FACTOR_STATUS',
      );
    }

    semanticChecks.push(check);

    if (!check.valid) {
      issues.push({
        check:
          'rowSemanticContract',
        row:
          check,
      });
    }
  }

  // ---------------------------------------------------------------
  // Dedicated 032080 proof: the previous audit's 0/0 was top-level-only.
  // canonicalPreview is authoritative for ratio factor validation.
  // ---------------------------------------------------------------

  const row032080_63 =
    views63.filter(
      (row) =>
        row.stockCode === '032080' &&
        row.actionType ===
          'REVERSE_SPLIT',
    );

  const row032080_72 =
    views72.filter(
      (row) =>
        row.stockCode === '032080' &&
        row.actionType ===
          'REVERSE_SPLIT',
    );

  const row032080_8 =
    views8.filter(
      (row) =>
        row.stockCode === '032080' &&
        row.actionType ===
          'REVERSE_SPLIT',
    );

  assert(
    row032080_63.length === 1 &&
    row032080_72.length === 1 &&
    row032080_8.length === 1,
    `032080_STAGE_CARDINALITY:${JSON.stringify({
      common63: row032080_63.length,
      common72: row032080_72.length,
      common8: row032080_8.length,
    })}`,
  );

  const proof032080 = {
    providerEventId:
      row032080_63[0]
        .providerEventId,

    sourceReceiptNo:
      row032080_63[0]
        .sourceReceiptNo,

    ratioFrom:
      row032080_63[0]
        .ratioFrom,

    ratioTo:
      row032080_63[0]
        .ratioTo,

    effectiveDate:
      row032080_72[0]
        .effectiveDate ??
      row032080_8[0]
        .effectiveDate,

    factorStatus:
      row032080_8[0]
        .factorStatus,

    factorReason:
      row032080_8[0]
        .factorReason,

    canonicalPreviewRatioPositive:
      (
        row032080_63[0]
          .ratioFrom !== null &&
        row032080_63[0]
          .ratioTo !== null &&
        row032080_63[0]
          .ratioFrom > 0 &&
        row032080_63[0]
          .ratioTo > 0
      ),

    factorReady:
      String(
        row032080_8[0]
          .factorStatus ??
        '',
      ).toUpperCase() ===
        'FACTOR_READY',

    explicitEventRatioReason:
      String(
        row032080_8[0]
          .factorReason ??
        '',
      ).toUpperCase()
        .includes(
          'EXPLICIT_EVENT_RATIO',
        ),
  };

  if (
    !proof032080
      .canonicalPreviewRatioPositive
  ) {
    issues.push({
      check:
        '032080.canonicalPreviewRatioPositive',
      actual: {
        ratioFrom:
          proof032080.ratioFrom,
        ratioTo:
          proof032080.ratioTo,
      },
      expected:
        'BOTH_POSITIVE',
    });
  }

  if (!proof032080.factorReady) {
    issues.push({
      check:
        '032080.factorReady',
      actual:
        proof032080.factorStatus,
      expected:
        'FACTOR_READY',
    });
  }

  if (
    !proof032080
      .explicitEventRatioReason
  ) {
    issues.push({
      check:
        '032080.factorReason',
      actual:
        proof032080.factorReason,
      expected:
        'EXPLICIT_EVENT_RATIO',
    });
  }

  // ---------------------------------------------------------------
  // Top-level factor audit invariants when exposed.
  // ---------------------------------------------------------------

  const factorReviewRequired =
    topLevelCount(
      docs.common8,
      'factorReviewRequired',
    );

  const duplicateCanonicalIdentities =
    topLevelCount(
      docs.common8,
      'duplicateCanonicalIdentities',
    );

  const invalidFactorRows =
    topLevelCount(
      docs.common8,
      'invalidFactorRows',
    );

  if (
    factorReviewRequired !== null &&
    factorReviewRequired !== 0
  ) {
    issues.push({
      check:
        'common8.factorReviewRequired',
      actual:
        factorReviewRequired,
      expected:
        0,
    });
  }

  if (
    duplicateCanonicalIdentities !== null &&
    duplicateCanonicalIdentities !== 0
  ) {
    issues.push({
      check:
        'common8.duplicateCanonicalIdentities',
      actual:
        duplicateCanonicalIdentities,
      expected:
        0,
    });
  }

  if (
    invalidFactorRows !== null &&
    invalidFactorRows !== 0
  ) {
    issues.push({
      check:
        'common8.invalidFactorRows',
      actual:
        invalidFactorRows,
      expected:
        0,
    });
  }

  // 028080 must remain outside V9.9 incremental common-stock branch.
  const contains028080 =
    views8.some(
      (row) =>
        row.stockCode ===
        '028080',
    );

  if (contains028080) {
    issues.push({
      check:
        '028080InjectedIntoV99CommonStockFactorBranch',
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
      ? 'HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      upstreamAuditVersion:
        docs.upstreamAudit.version,

      upstreamAuditFingerprint:
        docs.upstreamAudit
          .outputFingerprint ??
        null,

      common63Version:
        docs.common63.version ??
        null,

      common7Version:
        docs.common7.version ??
        null,

      common72Version:
        docs.common72.version ??
        null,

      common8Version:
        docs.common8.version ??
        null,
    },

    counts: {
      common63Rows:
        rows63Raw.length,

      common7Rows:
        rows7Raw.length,

      common72Rows:
        rows72Raw.length,

      common8Rows:
        rows8Raw.length,

      common63To7IdentityDelta:
        identityDiffs
          .common63Tocommon7
          .delta,

      common7To72IdentityDelta:
        identityDiffs
          .common7Tocommon72
          .delta,

      common72To8IdentityDelta:
        identityDiffs
          .common72Tocommon8
          .delta,

      semanticInvalidRows:
        semanticChecks
          .filter(
            (row) => !row.valid,
          ).length,

      factorReviewRequired,

      duplicateCanonicalIdentities,

      invalidFactorRows,

      issues:
        issues.length,
    },

    actionTypeCounts: {
      common63:
        countActions(
          rows63Raw,
        ),

      common7:
        countActions(
          rows7Raw,
        ),

      common72:
        countActions(
          rows72Raw,
        ),

      common8:
        countActions(
          rows8Raw,
        ),
    },

    lineage,

    identityDiffs,

    semanticChecks,

    proof032080,

    stageStatus,

    issues,

    conclusion: {
      historicalV997EffectiveDateReusable:
        reusable,

      historicalV9972EffectiveDateFinalizationReusable:
        reusable,

      historicalV998FactorValidationReusable:
        reusable,

      identityStableAcross7_7_2_8:
        reusable,

      reverseSplit032080RatioResolvedFromCanonicalPreview:
        reusable &&
        proof032080
          .canonicalPreviewRatioPositive,

      reverseSplit032080FactorReady:
        reusable &&
        proof032080.factorReady,

      safeToAdvanceToHistoricalV999_10ReuseAudit:
        reusable,

      networkRefetchRequiredNow:
        false,

      marketDataRefetchRequiredNow:
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

      coverageWindowAdvancedNow:
        false,
    },

    nextGate:
      reusable
        ? 'AUDIT_HISTORICAL_V9_9_9_10_COMMON_STOCK_REUSE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        counts:
          report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        identityDiffs:
          report.identityDiffs,

        semanticChecks:
          report.semanticChecks,

        proof032080:
          report.proof032080,

        stageStatus:
          report.stageStatus,

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

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        lineageProof: {
          common63To7:
            report.lineage
              .common63To7.proven,

          common7To72:
            report.lineage
              .common7To72.proven,

          common72To8:
            report.lineage
              .common72To8.proven,
        },

        proof032080:
          report.proof032080,

        semanticChecks:
          report.semanticChecks,

        stageStatus:
          report.stageStatus,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow:
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
          'HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_REUSE_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow:
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
