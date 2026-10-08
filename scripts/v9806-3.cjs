/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.6.3 - Remaining reverse-split recovery
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6-1.json
 *   logs/opendart-corporate-action-reverse-split-probe-v9-8-6-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6-3.json
 *
 * Patch scope:
 *   ONLY the 5 remaining REVERSE_SPLIT rows.
 *
 * Rules:
 *   1) Accept both:
 *        "1. 주식병합 내용"
 *        "1. 주식병합의 내용"
 *
 *   2) Recover par-value before/after from the probed canonical body.
 *
 *   3) Recover common-share before/after as a consistency check.
 *
 *   4) For a source document that exists:
 *        use the LAST exact body label "신주의 효력발생일"
 *        and the LAST exact body listing-date label.
 *      This deliberately avoids correction-summary old/new values that appear
 *      before the full corrected body.
 *
 *   5) If the latest source document is provider-014 unavailable:
 *        allow exactly one earlier same-chain document as FALLBACK.
 *        Ratio may be recovered from that document, but its dates remain
 *        non-authoritative candidates for V9.8.7 market reconciliation.
 *
 *   6) No final effective_date is assigned here.
 *
 * Ratio contract:
 *   ratio_from = PRE_ACTION_UNITS
 *   ratio_to   = POST_ACTION_UNITS
 *
 * Run:
 *   node .\scripts\v9806-3.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_6_3_REMAINING_REVERSE_SPLIT_RECOVERY';

const INPUT_VERSION =
  'V9_8_6_1_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';

const PROBE_VERSION =
  'V9_8_6_2_REMAINING_REVERSE_SPLIT_XML_STRUCTURE_PROBE';

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

function parseArgs(argv) {
  const out = {
    input: null,
    probe: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--probe=')) {
      out.probe = arg.slice('--probe='.length);
    } else if (arg.startsWith('--output=')) {
      out.output = arg.slice('--output='.length);
    } else {
      throw new Error(`UNKNOWN_OPTION:${arg}`);
    }
  }

  return out;
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

function parseNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .replace(/,/g, '')
      .trim();

  if (
    !/^-?\d+(?:\.\d+)?$/.test(text)
  ) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function parseDate(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  const match =
    text.match(
      /\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/,
    ) ??
    text.match(
      /\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
    ) ??
    text.match(
      /\b(20\d{2})(\d{2})(\d{2})\b/,
    );

  if (!match) return null;

  const iso =
    `${String(match[1]).padStart(4, '0')}-` +
    `${String(match[2]).padStart(2, '0')}-` +
    `${String(match[3]).padStart(2, '0')}`;

  const date =
    new Date(`${iso}T00:00:00Z`);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  ) {
    return null;
  }

  return iso;
}

function gcd(a, b) {
  let x =
    Math.abs(Math.round(a));

  let y =
    Math.abs(Math.round(b));

  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }

  return x || 1;
}

function exactLabelRows(document, group, matcher) {
  const rows =
    document?.labelCandidates?.[group] ?? [];

  return rows.filter(
    (row) =>
      matcher.test(
        String(row.text ?? '').replace(/\s+/g, ' ').trim(),
      ),
  );
}

function lastExactDate(document, group, matcher) {
  const rows =
    exactLabelRows(document, group, matcher);

  for (
    let i = rows.length - 1;
    i >= 0;
    i -= 1
  ) {
    for (const value of rows[i].following ?? []) {
      const date = parseDate(value);

      if (date) {
        return {
          date,
          labelText: rows[i].text,
          labelIndex: rows[i].index,
          rawValue: value,
        };
      }
    }
  }

  return null;
}

function firstTwoNumbersAfterLabel(document, group) {
  const rows =
    document?.labelCandidates?.[group] ?? [];

  if (rows.length !== 1) {
    return {
      status:
        rows.length === 0
          ? 'LABEL_MISSING'
          : 'LABEL_NOT_UNIQUE',
      values: [],
      rowCount: rows.length,
    };
  }

  const values = [];

  for (const value of rows[0].following ?? []) {
    const number = parseNumber(value);

    if (number !== null) {
      values.push(number);

      if (values.length === 2) break;
    }
  }

  return {
    status:
      values.length === 2
        ? 'PAIR_READY'
        : 'PAIR_INCOMPLETE',
    values,
    rowCount: 1,
    labelText: rows[0].text,
    labelIndex: rows[0].index,
  };
}

function hasMainHeading(document) {
  return (
    document?.headingCandidates ?? []
  ).some(
    (row) =>
      /^1\.\s*주식병합(?:의)?\s*내용$/.test(
        String(row.text ?? '').replace(/\s+/g, ' ').trim(),
      ),
  );
}

function chooseDocument(probeRow) {
  const source =
    (probeRow.documents ?? [])
      .find(
        (doc) =>
          doc.receiptNo ===
          probeRow.sourceReceiptNo &&
          doc.available === true &&
          !doc.parseError,
      );

  if (source) {
    return {
      status:
        'SOURCE_DOCUMENT',
      document:
        source,
      fallbackUsed:
        false,
    };
  }

  const fallbacks =
    (probeRow.documents ?? [])
      .filter(
        (doc) =>
          doc.receiptNo !==
            probeRow.sourceReceiptNo &&
          doc.available === true &&
          !doc.parseError,
      );

  if (fallbacks.length === 1) {
    return {
      status:
        'SINGLE_CHAIN_FALLBACK_DOCUMENT',
      document:
        fallbacks[0],
      fallbackUsed:
        true,
    };
  }

  return {
    status:
      fallbacks.length === 0
        ? 'NO_USABLE_DOCUMENT'
        : 'MULTIPLE_FALLBACK_DOCUMENTS',
    document:
      null,
    fallbackUsed:
      false,
  };
}

function recoverRow(prior, probeRow) {
  const selected =
    chooseDocument(probeRow);

  if (!selected.document) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        selected.status,
      parsed: {
        ...(prior.parsed ?? {}),
        recovery: {
          version: VERSION,
          selectedDocumentStatus:
            selected.status,
        },
      },
    };
  }

  const doc =
    selected.document;

  if (!hasMainHeading(doc)) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        'MAIN_REVERSE_SPLIT_HEADING_STILL_NOT_FOUND',
      parsed: {
        ...(prior.parsed ?? {}),
        recovery: {
          version: VERSION,
          selectedReceiptNo:
            doc.receiptNo,
          selectedDocumentStatus:
            selected.status,
        },
      },
    };
  }

  const par =
    firstTwoNumbersAfterLabel(
      doc,
      'parValue',
    );

  const shares =
    firstTwoNumbersAfterLabel(
      doc,
      'commonShares',
    );

  if (
    par.status !==
      'PAIR_READY' ||
    !(par.values[0] > 0) ||
    !(par.values[1] > 0) ||
    par.values[1] <=
      par.values[0]
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        'REVERSE_SPLIT_PAR_VALUE_PAIR_INVALID',
      parsed: {
        ...(prior.parsed ?? {}),
        recovery: {
          version: VERSION,
          selectedReceiptNo:
            doc.receiptNo,
          selectedDocumentStatus:
            selected.status,
          par,
          shares,
        },
      },
    };
  }

  const parBefore =
    par.values[0];

  const parAfter =
    par.values[1];

  const divisor =
    gcd(parBefore, parAfter);

  const ratioFrom =
    parAfter / divisor;

  const ratioTo =
    parBefore / divisor;

  const shareFactor =
    ratioTo / ratioFrom;

  const priceFactor =
    ratioFrom / ratioTo;

  if (
    !(ratioFrom > 0) ||
    !(ratioTo > 0) ||
    !(shareFactor > 0) ||
    !(shareFactor < 1) ||
    !(priceFactor > 1)
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        'REVERSE_SPLIT_RATIO_DIRECTION_INVALID',
      parsed: {
        ...(prior.parsed ?? {}),
        recovery: {
          version: VERSION,
          selectedReceiptNo:
            doc.receiptNo,
          par,
          shares,
        },
      },
    };
  }

  /*
   * Common-share counts are a consistency check, not the canonical ratio.
   * Odd-lot cash settlement can cause integer rounding.
   */
  let observedShareFactor =
    null;

  let shareFactorRelativeError =
    null;

  if (
    shares.status ===
      'PAIR_READY' &&
    shares.values[0] > 0 &&
    shares.values[1] > 0
  ) {
    observedShareFactor =
      shares.values[1] /
      shares.values[0];

    shareFactorRelativeError =
      Math.abs(
        observedShareFactor -
        shareFactor,
      ) /
      shareFactor;
  }

  if (
    shareFactorRelativeError !== null &&
    shareFactorRelativeError >
      0.001
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        'PAR_VALUE_RATIO_AND_SHARE_COUNT_CONFLICT',
      parsed: {
        ...(prior.parsed ?? {}),
        recovery: {
          version: VERSION,
          selectedReceiptNo:
            doc.receiptNo,
          par,
          shares,
          observedShareFactor,
          derivedShareFactor:
            shareFactor,
          shareFactorRelativeError,
        },
      },
    };
  }

  const sourceEffectiveDate =
    lastExactDate(
      doc,
      'effectiveDate',
      /^신주의 효력발생일$/,
    );

  const listingDate =
    lastExactDate(
      doc,
      'listingDate',
      /^신주권\s*상장예정일$/,
    );

  const fallbackUsed =
    selected.fallbackUsed;

  const parsed = {
    parValueBefore:
      parBefore,

    parValueAfter:
      parAfter,

    commonSharesBefore:
      shares.status ===
        'PAIR_READY'
        ? shares.values[0]
        : null,

    commonSharesAfter:
      shares.status ===
        'PAIR_READY'
        ? shares.values[1]
        : null,

    ratioFrom,

    ratioTo,

    shareFactor,

    priceFactor,

    ratioStatus:
      fallbackUsed
        ? 'RATIO_RECOVERED_FROM_PRIOR_CHAIN_DOCUMENT'
        : 'RATIO_DERIVED_FROM_EXACT_PAR_VALUE_TABLE',

    /*
     * For a provider-014 latest source, earlier-chain schedule values are
     * preserved as candidates only. They MUST NOT be treated as the final
     * source schedule.
     */
    sourceEffectiveDate:
      fallbackUsed
        ? null
        : (
            sourceEffectiveDate?.date ??
            null
          ),

    listingDate:
      fallbackUsed
        ? null
        : (
            listingDate?.date ??
            null
          ),

    fallbackSourceEffectiveDateCandidate:
      fallbackUsed
        ? (
            sourceEffectiveDate?.date ??
            null
          )
        : null,

    fallbackListingDateCandidate:
      fallbackUsed
        ? (
            listingDate?.date ??
            null
          )
        : null,

    parserReason:
      fallbackUsed
        ? 'PROVIDER_014_SINGLE_PRIOR_CHAIN_DOCUMENT_RATIO_RECOVERY'
        : 'REVERSE_SPLIT_HEADING_VARIANT_RECOVERY',

    recovery: {
      version:
        VERSION,

      selectedReceiptNo:
        doc.receiptNo,

      canonicalSourceReceiptNo:
        probeRow.sourceReceiptNo,

      selectedDocumentStatus:
        selected.status,

      fallbackUsed,

      latestSourceDocumentUnavailable:
        !probeRow.sourceDocumentAvailable,

      headingVariantAccepted:
        '1. 주식병합(?:의)? 내용',

      parValueEvidence: {
        label:
          par.labelText,
        labelIndex:
          par.labelIndex,
        before:
          parBefore,
        after:
          parAfter,
      },

      commonShareEvidence: {
        status:
          shares.status,
        label:
          shares.labelText ??
          null,
        labelIndex:
          shares.labelIndex ??
          null,
        before:
          shares.values[0] ??
          null,
        after:
          shares.values[1] ??
          null,
        observedShareFactor,
        derivedShareFactor:
          shareFactor,
        relativeError:
          shareFactorRelativeError,
      },

      sourceScheduleEvidence:
        fallbackUsed
          ? {
              authoritative:
                false,
              effectiveDateCandidate:
                sourceEffectiveDate,
              listingDateCandidate:
                listingDate,
              reason:
                'LATEST_SOURCE_DOCUMENT_PROVIDER_014_UNAVAILABLE',
            }
          : {
              authoritative:
                true,
              effectiveDate:
                sourceEffectiveDate,
              listingDate,
            },
    },
  };

  if (
    !fallbackUsed &&
    !parsed.sourceEffectiveDate
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',
      reason:
        'AUTHORITATIVE_SOURCE_EFFECTIVE_DATE_MISSING',
      parsed,
    };
  }

  return {
    status:
      'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

    reason:
      fallbackUsed
        ? 'PROVIDER_014_RATIO_RECOVERED_MARKET_DATE_MUST_BE_INDEPENDENTLY_VERIFIED'
        : 'REVERSE_SPLIT_HEADING_VARIANT_RECOVERED',

    parsed,
  };
}

function main() {
  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.resolve(
      args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-8-6-1.json',
      ),
    );

  const probeFile =
    path.resolve(
      args.probe ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-reverse-split-probe-v9-8-6-2.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-8-6-3.json',
      ),
    );

  for (const file of [
    inputFile,
    probeFile,
  ]) {
    if (
      !fs.existsSync(file)
    ) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const input =
    readJson(inputFile);

  const probe =
    readJson(probeFile);

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    probe.version !==
    PROBE_VERSION
  ) {
    throw new Error(
      'PROBE_VERSION_MISMATCH',
    );
  }

  if (
    probe.status !==
    'REMAINING_REVERSE_SPLIT_PROBE_COMPLETE'
  ) {
    throw new Error(
      'PROBE_NOT_COMPLETE',
    );
  }

  const probeByProviderEventId =
    new Map(
      probe.rows.map(
        (row) => [
          row.providerEventId,
          row,
        ],
      ),
    );

  const originalIncomplete =
    input.results.filter(
      (row) =>
        row.parseStatus ===
        'SOURCE_FIELDS_INCOMPLETE',
    );

  if (
    originalIncomplete.length !==
    probe.rows.length
  ) {
    throw new Error(
      'INCOMPLETE_PROBE_COUNT_MISMATCH',
    );
  }

  if (
    originalIncomplete.some(
      (row) =>
        row.actionType !==
        'REVERSE_SPLIT',
    )
  ) {
    throw new Error(
      'NON_REVERSE_SPLIT_IN_REPAIR_SET',
    );
  }

  const repaired = [];
  const results = [];

  for (const row of input.results) {
    if (
      row.parseStatus !==
      'SOURCE_FIELDS_INCOMPLETE'
    ) {
      results.push({
        ...row,
        v9863Disposition:
          'UNCHANGED_FROM_V9_8_6_1',
      });
      continue;
    }

    const probeRow =
      probeByProviderEventId.get(
        row.providerEventId,
      );

    if (!probeRow) {
      throw new Error(
        `PROBE_ROW_MISSING:${row.providerEventId}`,
      );
    }

    const recovery =
      recoverRow(
        row,
        probeRow,
      );

    const patched = {
      ...row,

      parseStatus:
        recovery.status,

      parsed:
        recovery.parsed,

      canonicalPreview: {
        ...row.canonicalPreview,

        effective_date:
          null,

        ratio_from:
          recovery.parsed
            ?.ratioFrom ??
          null,

        ratio_to:
          recovery.parsed
            ?.ratioTo ??
          null,

        event_insert_allowed:
          false,
      },

      nextStage: {
        marketEffectiveDateResolutionRequired:
          recovery.status ===
          'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

        structuralFactorBlocked:
          false,

        sourceFieldReviewRequired:
          recovery.status !==
          'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

        independentMarketVerificationRequired:
          Boolean(
            recovery.parsed
              ?.recovery
              ?.fallbackUsed,
          ),
      },

      parserVersion:
        VERSION,

      parserDisposition:
        recovery.reason,

      v9863Disposition:
        'PATCHED_REVERSE_SPLIT_ONLY',
    };

    repaired.push(patched);
    results.push(patched);

    console.log(
      [
        'RECOVER',
        `${repaired.length}/${probe.rows.length}`,
        `root=${row.providerEventId}`,
        `source=${row.sourceReceiptNo}`,
        `status=${recovery.status}`,
        `reason=${recovery.reason}`,
        `ratio=${patched.canonicalPreview.ratio_from ?? '-'}:${patched.canonicalPreview.ratio_to ?? '-'}`,
        `fallback=${Boolean(recovery.parsed?.recovery?.fallbackUsed)}`,
      ].join(' '),
    );
  }

  const ready =
    results.filter(
      (row) =>
        row.parseStatus ===
        'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',
    );

  const incomplete =
    results.filter(
      (row) =>
        row.parseStatus ===
        'SOURCE_FIELDS_INCOMPLETE',
    );

  const structuralReady =
    results.filter(
      (row) =>
        row.parseStatus ===
        'STRUCTURAL_FIELDS_READY_FACTOR_BLOCKED',
    );

  const structuralIncomplete =
    results.filter(
      (row) =>
        row.parseStatus ===
        'STRUCTURAL_FIELDS_INCOMPLETE_FACTOR_BLOCKED',
    );

  const duplicateIdentityCount =
    results.length -
    new Set(
      results.map(
        (row) =>
          `${row.provider}|${row.providerEventId}`,
      ),
    ).size;

  const fallbackRecovered =
    repaired.filter(
      (row) =>
        row.parsed
          ?.recovery
          ?.fallbackUsed === true &&
        row.parseStatus ===
          'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',
    );

  const directRecovered =
    repaired.filter(
      (row) =>
        row.parsed
          ?.recovery
          ?.fallbackUsed === false &&
        row.parseStatus ===
          'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',
    );

  const untouchedRows =
    results.filter(
      (row) =>
        row.v9863Disposition ===
        'UNCHANGED_FROM_V9_8_6_1',
    );

  const untouchedFingerprintBefore =
    sha256(
      JSON.stringify(
        input.results
          .filter(
            (row) =>
              row.parseStatus !==
              'SOURCE_FIELDS_INCOMPLETE',
          )
          .map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
              row.actionType,
              row.parseStatus,
              row.canonicalPreview,
            ],
          ),
      ),
    );

  const untouchedFingerprintAfter =
    sha256(
      JSON.stringify(
        untouchedRows.map(
          (row) => [
            row.providerEventId,
            row.sourceReceiptNo,
            row.actionType,
            row.parseStatus,
            row.canonicalPreview,
          ],
        ),
      ),
    );

  const untouchedRowsStable =
    untouchedFingerprintBefore ===
    untouchedFingerprintAfter;

  const identityCountStable =
    results.length ===
    input.results.length;

  const status =
    duplicateIdentityCount > 0 ||
    !identityCountStable ||
    !untouchedRowsStable
      ? 'REVERSE_SPLIT_RECOVERY_INVALID'
      : incomplete.length === 0
        ? 'REVERSE_SPLIT_RECOVERY_COMPLETE'
        : 'REVERSE_SPLIT_RECOVERY_COMPLETE_WITH_REVIEW';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      probeVersion:
        probe.version,

      inputFingerprint:
        input.outputFingerprint,

      probeFingerprint:
        probe.outputFingerprint,
    },

    counts: {
      inputRows:
        input.results.length,

      outputRows:
        results.length,

      repairTargets:
        probe.rows.length,

      repairedDirectSource:
        directRecovered.length,

      repairedFallbackSource:
        fallbackRecovered.length,

      repairStillIncomplete:
        repaired.filter(
          (row) =>
            row.parseStatus ===
            'SOURCE_FIELDS_INCOMPLETE',
        ).length,

      readyForMarketDateResolution:
        ready.length,

      sourceFieldsIncomplete:
        incomplete.length,

      structuralFieldsReady:
        structuralReady.length,

      structuralFieldsIncomplete:
        structuralIncomplete.length,

      duplicateCanonicalIdentities:
        duplicateIdentityCount,

      independentMarketVerificationRequired:
        results.filter(
          (row) =>
            row.nextStage
              ?.independentMarketVerificationRequired ===
            true,
        ).length,
    },

    actionTypeCounts:
      countBy(
        results,
        (row) =>
          row.actionType,
      ),

    parseStatusCounts:
      countBy(
        results,
        (row) =>
          row.parseStatus,
      ),

    repairedRatioCounts:
      countBy(
        repaired.filter(
          (row) =>
            row.parseStatus ===
            'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',
        ),
        (row) =>
          `${row.canonicalPreview.ratio_from}:${row.canonicalPreview.ratio_to}`,
      ),

    recoveryReasonCounts:
      countBy(
        repaired,
        (row) =>
          row.parserDisposition,
      ),

    safety: {
      networkRequests:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      finalEffectiveDatesAssigned:
        0,

      marketFactorsComputed:
        0,

      coverageWindowAdvanced:
        false,

      identityCountStable,

      untouchedRowsStable,

      patchedRows:
        repaired.length,

      nonTargetRowsModified:
        0,

      fallbackSchedulePromotedToCanonical:
        false,

      eventInsertAllowed:
        false,
    },

    policy: {
      reverseSplitHeading:
        'ACCEPT_주식병합_내용_AND_주식병합의_내용',

      ratioSource:
        'EXACT_PAR_VALUE_BEFORE_AFTER_PAIR',

      shareCount:
        'CONSISTENCY_CHECK_ONLY_ODD_LOT_ROUNDING_ALLOWED',

      sourceEffectiveDate:
        'LATEST_EXACT_BODY_LABEL_IF_CANONICAL_SOURCE_AVAILABLE',

      provider014Fallback:
        'RATIO_RECOVERY_ONLY_SCHEDULE_IS_NON_AUTHORITATIVE_CANDIDATE',

      finalEffectiveDate:
        'DEFER_TO_V9_8_7_MARKET_RECONCILIATION',

      finalEffectiveDateForFallback:
        'MUST_BE_INDEPENDENTLY_VERIFIED_FROM_MARKET_EVIDENCE',

      eventInsert:
        'BLOCKED_IN_V9_8_6_3',
    },

    repairedRows:
      repaired.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          sourceReceiptNo:
            row.sourceReceiptNo,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          parseStatus:
            row.parseStatus,

          parserDisposition:
            row.parserDisposition,

          ratioFrom:
            row.canonicalPreview
              .ratio_from,

          ratioTo:
            row.canonicalPreview
              .ratio_to,

          sourceEffectiveDate:
            row.parsed
              ?.sourceEffectiveDate ??
            null,

          listingDate:
            row.parsed
              ?.listingDate ??
            null,

          fallbackSourceUsed:
            Boolean(
              row.parsed
                ?.recovery
                ?.fallbackUsed,
            ),

          fallbackSourceReceiptNo:
            row.parsed
              ?.recovery
              ?.fallbackUsed
              ? (
                  row.parsed
                    .recovery
                    .selectedReceiptNo
                )
              : null,

          fallbackSourceEffectiveDateCandidate:
            row.parsed
              ?.fallbackSourceEffectiveDateCandidate ??
            null,

          fallbackListingDateCandidate:
            row.parsed
              ?.fallbackListingDateCandidate ??
            null,

          independentMarketVerificationRequired:
            row.nextStage
              ?.independentMarketVerificationRequired ??
            false,
        }),
      ),

    reviewQueue:
      incomplete.map(
        (row) => ({
          providerEventId:
            row.providerEventId,
          sourceReceiptNo:
            row.sourceReceiptNo,
          stockCode:
            row.stockCode,
          actionType:
            row.actionType,
          parserDisposition:
            row.parserDisposition,
          parsed:
            row.parsed,
        }),
      ),

    results,

    outputFile:
      path
        .relative(
          root,
          outputFile,
        )
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source.inputFingerprint,

        probeFingerprint:
          report.source.probeFingerprint,

        rows:
          results.map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
              row.actionType,
              row.parseStatus,
              row.canonicalPreview
                ?.ratio_from ??
                null,
              row.canonicalPreview
                ?.ratio_to ??
                null,
              row.canonicalPreview
                ?.cash_amount ??
                null,
              row.parsed
                ?.sourceEffectiveDate ??
                row.parsed
                ?.recordDate ??
                null,
              row.parsed
                ?.recovery
                ?.fallbackUsed ??
                false,
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

        parseStatusCounts:
          report.parseStatusCounts,

        repairedRatioCounts:
          report.repairedRatioCounts,

        recoveryReasonCounts:
          report.recoveryReasonCounts,

        repairedRows:
          report.repairedRows,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        providerEventIdsPersisted:
          0,

        finalEffectiveDatesAssigned:
          0,

        marketFactorsComputed:
          0,

        coverageWindowAdvanced:
          false,

        identityCountStable,

        untouchedRowsStable,

        fallbackSchedulePromotedToCanonical:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'REVERSE_SPLIT_RECOVERY_INVALID'
  ) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(error?.message ?? error),
  );

  process.exitCode = 1;
}
