/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.6 - Canonical corporate-action field extraction
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5-1.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6.json
 *
 * IMPORTANT CONTRACT
 * ------------------
 * This stage extracts source facts only.
 *
 * It DOES NOT assign final market effective_date.
 *
 * Why:
 *   - CASH_DIVIDEND: DART dividend record date != KRX market adjustment date.
 *   - STOCK_SPLIT / REVERSE_SPLIT: corporate/legal dates and KRX adjusted-price
 *     transition must be reconciled separately.
 *   - MERGER / SPIN_OFF: structural actions remain excluded from generic factor
 *     computation.
 *
 * Next stage (V9.8.7) will resolve market-effective dates against the existing
 * V9.7 market-date / adjusted-price contract.
 *
 * Ratio contract for a proven split / reverse split:
 *   ratio_from = PRE_ACTION_UNITS
 *   ratio_to   = POST_ACTION_UNITS
 *   share_factor = ratio_to / ratio_from
 *   price_factor = ratio_from / ratio_to
 *
 * Run:
 *   node .\scripts\v9806.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_6_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';

const SOURCE_VERSION =
  'V9_8_5_1_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const PROVIDER =
  'DART_KRX_CANONICAL';

const STRUCTURAL_TYPES =
  new Set([
    'MERGER',
    'SPIN_OFF',
  ]);

const RATIO_TYPES =
  new Set([
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
    'STOCK_DIVIDEND',
  ]);

function readJson(file) {
  return JSON.parse(
    fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2,
    ),
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    source: null,
    evidence: null,
    output: null,
  };

  for (const arg of argv) {
    if (
      arg.startsWith(
        '--source=',
      )
    ) {
      out.source =
        arg.slice(
          '--source='.length,
        );

      continue;
    }

    if (
      arg.startsWith(
        '--evidence=',
      )
    ) {
      out.evidence =
        arg.slice(
          '--evidence='.length,
        );

      continue;
    }

    if (
      arg.startsWith(
        '--output=',
      )
    ) {
      out.output =
        arg.slice(
          '--output='.length,
        );

      continue;
    }

    throw new Error(
      `UNKNOWN_OPTION:${arg}`,
    );
  }

  return out;
}

function countBy(rows, selector) {
  const counts = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    counts[key] =
      (counts[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hex) =>
        String.fromCodePoint(
          parseInt(hex, 16),
        ),
    )
    .replace(
      /&#([0-9]+);/g,
      (_, dec) =>
        String.fromCodePoint(
          parseInt(dec, 10),
        ),
    );
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        ' ',
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        ' ',
      )
      .replace(
        /<!\[CDATA\[([\s\S]*?)\]\]>/g,
        '$1',
      )
      .replace(
        /<br\s*\/?>/gi,
        '\n',
      )
      .replace(
        /<\/(?:p|tr|td|th|div|table|section|title|li|h[1-6])>/gi,
        '\n',
      )
      .replace(
        /<[^>]+>/g,
        ' ',
      ),
  )
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function decodeXmlBuffer(buffer) {
  const head =
    buffer
      .subarray(
        0,
        Math.min(
          buffer.length,
          512,
        ),
      )
      .toString(
        'latin1',
      );

  const match =
    head.match(
      /encoding\s*=\s*["']([^"']+)["']/i,
    );

  const declared =
    String(
      match?.[1] ??
      '',
    ).toLowerCase();

  const candidates = [];

  if (
    declared.includes(
      'euc-kr',
    ) ||
    declared.includes(
      'ks_c_5601',
    ) ||
    declared.includes(
      'ksc5601',
    )
  ) {
    candidates.push(
      'euc-kr',
    );
  }

  candidates.push(
    'utf-8',
    'euc-kr',
  );

  for (
    const encoding of
    [...new Set(candidates)]
  ) {
    try {
      const text =
        new TextDecoder(
          encoding,
          {
            fatal: false,
          },
        ).decode(
          buffer,
        );

      if (text) {
        return text;
      }
    } catch {
      // try next decoder
    }
  }

  return buffer.toString(
    'utf8',
  );
}

function findEocd(buffer) {
  const min =
    Math.max(
      0,
      buffer.length -
        22 -
        65535,
    );

  for (
    let offset =
      buffer.length - 22;
    offset >= min;
    offset -= 1
  ) {
    if (
      buffer.readUInt32LE(
        offset,
      ) ===
      0x06054b50
    ) {
      return offset;
    }
  }

  throw new Error(
    'ZIP_EOCD_NOT_FOUND',
  );
}

function extractZipEntries(buffer) {
  const eocd =
    findEocd(
      buffer,
    );

  const totalEntries =
    buffer.readUInt16LE(
      eocd + 10,
    );

  const centralOffset =
    buffer.readUInt32LE(
      eocd + 16,
    );

  const entries = [];

  let ptr =
    centralOffset;

  for (
    let index = 0;
    index < totalEntries;
    index += 1
  ) {
    if (
      buffer.readUInt32LE(
        ptr,
      ) !==
      0x02014b50
    ) {
      throw new Error(
        'ZIP_CENTRAL_DIRECTORY_INVALID',
      );
    }

    const method =
      buffer.readUInt16LE(
        ptr + 10,
      );

    const compressedSize =
      buffer.readUInt32LE(
        ptr + 20,
      );

    const uncompressedSize =
      buffer.readUInt32LE(
        ptr + 24,
      );

    const fileNameLength =
      buffer.readUInt16LE(
        ptr + 28,
      );

    const extraLength =
      buffer.readUInt16LE(
        ptr + 30,
      );

    const commentLength =
      buffer.readUInt16LE(
        ptr + 32,
      );

    const localOffset =
      buffer.readUInt32LE(
        ptr + 42,
      );

    const fileName =
      buffer
        .subarray(
          ptr + 46,
          ptr +
            46 +
            fileNameLength,
        )
        .toString(
          'utf8',
        );

    if (
      buffer.readUInt32LE(
        localOffset,
      ) !==
      0x04034b50
    ) {
      throw new Error(
        'ZIP_LOCAL_HEADER_INVALID',
      );
    }

    const localNameLength =
      buffer.readUInt16LE(
        localOffset + 26,
      );

    const localExtraLength =
      buffer.readUInt16LE(
        localOffset + 28,
      );

    const dataStart =
      localOffset +
      30 +
      localNameLength +
      localExtraLength;

    const compressed =
      buffer.subarray(
        dataStart,
        dataStart +
          compressedSize,
      );

    let data = null;

    if (method === 0) {
      data =
        Buffer.from(
          compressed,
        );
    } else if (
      method === 8
    ) {
      data =
        zlib.inflateRawSync(
          compressed,
        );
    }

    if (data) {
      if (
        uncompressedSize > 0 &&
        data.length !==
          uncompressedSize
      ) {
        throw new Error(
          'ZIP_UNCOMPRESSED_SIZE_MISMATCH',
        );
      }

      entries.push({
        fileName,
        data,
      });
    }

    ptr +=
      46 +
      fileNameLength +
      extraLength +
      commentLength;
  }

  return entries;
}

function zipToText(file) {
  const buffer =
    fs.readFileSync(
      file,
    );

  const entries =
    extractZipEntries(
      buffer,
    );

  const texts = [];

  for (
    const entry of
    entries
  ) {
    if (
      !/\.(?:xml|html?|txt)$/i.test(
        entry.fileName,
      )
    ) {
      continue;
    }

    const decoded =
      decodeXmlBuffer(
        entry.data,
      );

    const text =
      htmlToText(
        decoded,
      );

    if (text) {
      texts.push(
        text,
      );
    }
  }

  return texts
    .join('\n')
    .replace(
      /\n{2,}/g,
      '\n',
    )
    .trim();
}

function normalizeSpace(value) {
  return String(
    value ??
    '',
  )
    .replace(
      /\u00a0/g,
      ' ',
    )
    .replace(
      /[ \t]+/g,
      ' ',
    )
    .trim();
}

function compact(value) {
  return normalizeSpace(
    value,
  )
    .replace(
      /\s+/g,
      '',
    );
}

function cleanNumberText(value) {
  return String(
    value ??
    '',
  )
    .replace(
      /,/g,
      '',
    )
    .replace(
      /원|주|%|배/g,
      '',
    )
    .trim();
}

function parseNumber(value) {
  const cleaned =
    cleanNumberText(
      value,
    );

  if (
    !cleaned ||
    cleaned === '-' ||
    cleaned === '해당없음'
  ) {
    return null;
  }

  const match =
    cleaned.match(
      /-?\d+(?:\.\d+)?/,
    );

  if (!match) {
    return null;
  }

  const number =
    Number(
      match[0],
    );

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function gcd(a, b) {
  let x =
    Math.abs(
      Math.round(a),
    );

  let y =
    Math.abs(
      Math.round(b),
    );

  while (y) {
    const t =
      x % y;

    x = y;
    y = t;
  }

  return x || 1;
}

function normalizeDateParts(
  year,
  month,
  day,
) {
  const yyyy =
    String(year)
      .padStart(4, '0');

  const mm =
    String(month)
      .padStart(2, '0');

  const dd =
    String(day)
      .padStart(2, '0');

  const iso =
    `${yyyy}-${mm}-${dd}`;

  const date =
    new Date(
      `${iso}T00:00:00Z`,
    );

  if (
    !Number.isFinite(
      date.getTime(),
    ) ||
    date
      .toISOString()
      .slice(0, 10) !==
      iso
  ) {
    return null;
  }

  return iso;
}

function parseDateFromText(value) {
  const text =
    normalizeSpace(
      value,
    );

  const patterns = [
    /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
    /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/,
    /\b(\d{4})(\d{2})(\d{2})\b/,
  ];

  for (
    const pattern of
    patterns
  ) {
    const match =
      text.match(
        pattern,
      );

    if (!match) {
      continue;
    }

    return normalizeDateParts(
      match[1],
      match[2],
      match[3],
    );
  }

  return null;
}

function lines(text) {
  return String(
    text ??
    '',
  )
    .split(/\n+/)
    .map(
      normalizeSpace,
    )
    .filter(Boolean);
}

function findLineIndex(
  textLines,
  matcher,
) {
  return textLines
    .findIndex(
      (line) =>
        matcher.test(
          compact(
            line,
          ),
        ),
    );
}

function findDateNear(
  textLines,
  matchers,
  range = 8,
) {
  for (
    const matcher of
    matchers
  ) {
    const index =
      findLineIndex(
        textLines,
        matcher,
      );

    if (index < 0) {
      continue;
    }

    const slice =
      textLines.slice(
        index,
        index +
          range +
          1,
      );

    for (
      let offset = 0;
      offset <
      slice.length;
      offset += 1
    ) {
      const date =
        parseDateFromText(
          slice[offset],
        );

      if (date) {
        return {
          value:
            date,

          labelLine:
            textLines[index],

          valueLine:
            slice[offset],

          offset,
        };
      }
    }
  }

  return null;
}

function numberCandidatesNear(
  textLines,
  matchers,
  range = 12,
) {
  const found = [];

  for (
    const matcher of
    matchers
  ) {
    const index =
      findLineIndex(
        textLines,
        matcher,
      );

    if (index < 0) {
      continue;
    }

    const slice =
      textLines.slice(
        index,
        index +
          range +
          1,
      );

    for (
      let offset = 0;
      offset <
      slice.length;
      offset += 1
    ) {
      const line =
        slice[offset];

      const matches =
        line.match(
          /-?\d[\d,]*(?:\.\d+)?/g,
        ) ?? [];

      for (
        const raw of
        matches
      ) {
        const value =
          Number(
            raw.replace(
              /,/g,
              '',
            ),
          );

        if (
          Number.isFinite(
            value,
          )
        ) {
          found.push({
            value,
            raw,
            line,
            offset,
            labelLine:
              textLines[index],
          });
        }
      }
    }
  }

  return found;
}

function uniquePositiveNumbers(
  candidates,
  {
    min = 0,
    max = Number.POSITIVE_INFINITY,
  } = {},
) {
  return [
    ...new Set(
      candidates
        .map(
          (row) =>
            row.value,
        )
        .filter(
          (value) =>
            Number.isFinite(
              value,
            ) &&
            value > min &&
            value <= max,
        ),
    ),
  ];
}

function parseCashDividend(
  text,
) {
  const textLines =
    lines(
      text,
    );

  const recordDate =
    findDateNear(
      textLines,
      [
        /배당기준일/,
      ],
      6,
    );

  const paymentDate =
    findDateNear(
      textLines,
      [
        /배당금지급예정일자/,
        /배당금지급예정일/,
        /지급예정일자/,
      ],
      8,
    );

  const amountCandidates =
    numberCandidatesNear(
      textLines,
      [
        /1주당배당금/,
        /주당배당금/,
      ],
      10,
    )
      .filter(
        (row) =>
          row.value >= 0 &&
          row.value <
            100000000,
      );

  /*
   * Dates and percentages can appear near the same table. Prefer numeric
   * values on lines containing common/preferred stock labels or currency.
   */
  const preferred =
    amountCandidates.filter(
      (row) =>
        /보통주|종류주|우선주|원/.test(
          row.line,
        ),
    );

  const pool =
    preferred.length >
      0
      ? preferred
      : amountCandidates;

  const plausibleAmounts =
    uniquePositiveNumbers(
      pool,
      {
        min:
          0,
        max:
          10000000,
      },
    );

  /*
   * Exclude obvious date-like integers and percentage values.
   */
  const filteredAmounts =
    plausibleAmounts.filter(
      (value) =>
        !(
          value >=
            19000101 &&
          value <=
            22001231
        ) &&
        value !==
          100,
    );

  let cashAmount = null;
  let cashStatus =
    'CASH_AMOUNT_UNRESOLVED';

  if (
    filteredAmounts.length ===
    1
  ) {
    cashAmount =
      filteredAmounts[0];

    cashStatus =
      'CASH_AMOUNT_UNIQUE';
  } else if (
    filteredAmounts.length >
    1
  ) {
    /*
     * The nearest plausible value to the label is a preview candidate only.
     * We never declare it canonical when multiple different values exist.
     */
    cashStatus =
      'CASH_AMOUNT_AMBIGUOUS';
  }

  return {
    cashAmount,
    currency:
      cashAmount !== null
        ? 'KRW'
        : null,

    recordDate:
      recordDate?.value ??
      null,

    paymentDate:
      paymentDate?.value ??
      null,

    amountStatus:
      cashStatus,

    evidence: {
      recordDate,
      paymentDate,
      amountCandidates:
        pool.slice(
          0,
          20,
        ),
      distinctPlausibleAmounts:
        filteredAmounts,
    },
  };
}

function parseFaceValuePairs(
  textLines,
) {
  const labels = [
    /1주당액면가액/,
    /액면가액/,
    /1주의금액/,
  ];

  const candidates =
    numberCandidatesNear(
      textLines,
      labels,
      18,
    )
      .filter(
        (row) =>
          row.value > 0 &&
          row.value <=
            1000000,
      );

  /*
   * Remove common share counts/dates by preferring lines containing
   * before/after or face-value wording.
   */
  const preferred =
    candidates.filter(
      (row) =>
        /병합전|병합후|분할전|분할후|액면|1주/.test(
          row.line,
        ),
    );

  const pool =
    preferred.length >=
      2
      ? preferred
      : candidates;

  const values =
    uniquePositiveNumbers(
      pool,
      {
        min:
          0,
        max:
          1000000,
      },
    )
      .filter(
        (value) =>
          value !==
            100000,
      );

  return {
    values,
    candidates:
      pool.slice(
        0,
        30,
      ),
  };
}

function deriveRatioFromFaceValues(
  actionType,
  values,
) {
  if (
    values.length !==
    2
  ) {
    return null;
  }

  const [a, b] =
    values;

  let before;
  let after;

  if (
    actionType ===
    'STOCK_SPLIT'
  ) {
    before =
      Math.max(
        a,
        b,
      );

    after =
      Math.min(
        a,
        b,
      );
  } else if (
    actionType ===
    'REVERSE_SPLIT'
  ) {
    before =
      Math.min(
        a,
        b,
      );

    after =
      Math.max(
        a,
        b,
      );
  } else {
    return null;
  }

  if (
    !(before > 0) ||
    !(after > 0) ||
    before ===
      after
  ) {
    return null;
  }

  /*
   * Shares move inversely to face value:
   *
   * post/pre share factor = before_face / after_face
   *
   * ratio_from = pre-action units
   * ratio_to   = post-action units
   */
  const scale =
    gcd(
      before,
      after,
    );

  const ratioFrom =
    after /
    scale;

  const ratioTo =
    before /
    scale;

  if (
    !(ratioFrom > 0) ||
    !(ratioTo > 0)
  ) {
    return null;
  }

  return {
    beforeFaceValue:
      before,

    afterFaceValue:
      after,

    ratioFrom,

    ratioTo,

    shareFactor:
      ratioTo /
      ratioFrom,

    priceFactor:
      ratioFrom /
      ratioTo,

    derivation:
      'FACE_VALUE_INVERSE_SHARE_RATIO',
  };
}

function parseSplitOrReverse(
  text,
  actionType,
) {
  const textLines =
    lines(
      text,
    );

  const face =
    parseFaceValuePairs(
      textLines,
    );

  const ratio =
    deriveRatioFromFaceValues(
      actionType,
      face.values,
    );

  const recordDate =
    findDateNear(
      textLines,
      [
        /주식병합기준일/,
        /주식분할기준일/,
        /병합기준일/,
        /분할기준일/,
        /기준일/,
      ],
      8,
    );

  const listingDate =
    findDateNear(
      textLines,
      [
        /신주상장예정일/,
        /신주상장일/,
        /상장예정일/,
      ],
      8,
    );

  const tradingStopStart =
    findDateNear(
      textLines,
      [
        /매매거래정지예정기간/,
        /매매거래정지기간/,
        /거래정지예정기간/,
      ],
      10,
    );

  return {
    ratioFrom:
      ratio?.ratioFrom ??
      null,

    ratioTo:
      ratio?.ratioTo ??
      null,

    shareFactor:
      ratio?.shareFactor ??
      null,

    priceFactor:
      ratio?.priceFactor ??
      null,

    recordDate:
      recordDate?.value ??
      null,

    listingDate:
      listingDate?.value ??
      null,

    tradingStopStart:
      tradingStopStart
        ?.value ??
      null,

    ratioStatus:
      ratio
        ? 'RATIO_DERIVED_FROM_FACE_VALUES'
        : 'RATIO_UNRESOLVED',

    evidence: {
      faceValueCandidates:
        face,
      ratio,
      recordDate,
      listingDate,
      tradingStopStart,
    },
  };
}

function parseStockDividend(
  text,
) {
  const textLines =
    lines(
      text,
    );

  const recordDate =
    findDateNear(
      textLines,
      [
        /배당기준일/,
      ],
      8,
    );

  const candidates =
    numberCandidatesNear(
      textLines,
      [
        /1주당주식배당/,
        /주식배당률/,
        /1주당배당주식수/,
      ],
      10,
    );

  const values =
    uniquePositiveNumbers(
      candidates,
      {
        min:
          0,
        max:
          1000,
      },
    )
      .filter(
        (value) =>
          !(
            value >=
              19000101 &&
            value <=
              22001231
          ),
      );

  let dividendSharesPerShare =
    null;

  if (
    values.length ===
    1
  ) {
    dividendSharesPerShare =
      values[0];
  }

  /*
   * 1 existing share + d newly distributed shares.
   * Represent with a rationalized denominator when possible.
   */
  let ratioFrom = null;
  let ratioTo = null;

  if (
    dividendSharesPerShare !==
    null
  ) {
    const textValue =
      String(
        dividendSharesPerShare,
      );

    const decimals =
      textValue.includes('.')
        ? textValue
            .split('.')[1]
            .length
        : 0;

    const scale =
      Math.pow(
        10,
        Math.min(
          decimals,
          8,
        ),
      );

    const dUnits =
      Math.round(
        dividendSharesPerShare *
        scale,
      );

    const divisor =
      gcd(
        scale,
        scale +
          dUnits,
      );

    ratioFrom =
      scale /
      divisor;

    ratioTo =
      (
        scale +
        dUnits
      ) /
      divisor;
  }

  return {
    dividendSharesPerShare,

    ratioFrom,

    ratioTo,

    shareFactor:
      ratioFrom &&
      ratioTo
        ? ratioTo /
          ratioFrom
        : null,

    priceFactor:
      ratioFrom &&
      ratioTo
        ? ratioFrom /
          ratioTo
        : null,

    recordDate:
      recordDate?.value ??
      null,

    ratioStatus:
      ratioFrom &&
      ratioTo
        ? 'RATIO_DERIVED_FROM_STOCK_DIVIDEND_PER_SHARE'
        : 'RATIO_UNRESOLVED',

    evidence: {
      recordDate,
      candidates:
        candidates.slice(
          0,
          20,
        ),
      distinctValues:
        values,
    },
  };
}

function structuredRows(
  file,
) {
  if (
    !file ||
    !fs.existsSync(
      file,
    )
  ) {
    return [];
  }

  const body =
    readJson(
      file,
    );

  return Array.isArray(
    body?.list,
  )
    ? body.list
    : [];
}

function firstDateField(
  row,
  names,
) {
  for (
    const name of names
  ) {
    const raw =
      row?.[name];

    if (
      raw === null ||
      raw ===
        undefined
    ) {
      continue;
    }

    const date =
      parseDateFromText(
        String(raw),
      );

    if (date) {
      return {
        field:
          name,
        raw:
          String(raw),
        value:
          date,
      };
    }
  }

  return null;
}

function parseStructuralStructured(
  actionType,
  rows,
  sourceReceiptNo,
) {
  if (
    rows.length ===
    0
  ) {
    return {
      status:
        'STRUCTURAL_SOURCE_UNAVAILABLE',

      matchedRow:
        null,

      facts: {},
    };
  }

  const exact =
    rows.filter(
      (row) =>
        String(
          row.rcept_no ??
          '',
        ) ===
        sourceReceiptNo,
    );

  const pool =
    exact.length >
      0
      ? exact
      : rows;

  if (
    pool.length !==
    1
  ) {
    return {
      status:
        exact.length >
          1
          ? 'STRUCTURAL_MULTIPLE_EXACT_STRUCTURED_ROWS'
          : 'STRUCTURAL_STRUCTURED_ROW_NOT_UNIQUE',

      matchedRow:
        null,

      facts: {
        exactReceiptMatches:
          exact.length,

        responseRows:
          rows.length,
      },
    };
  }

  const row =
    pool[0];

  if (
    actionType ===
    'MERGER'
  ) {
    return {
      status:
        'STRUCTURAL_FIELDS_EXTRACTED',

      matchedRow:
        row,

      facts: {
        boardDecisionDate:
          firstDateField(
            row,
            [
              'bddd',
              'mgsc_bddd',
            ],
          )?.value ??
          null,

        mergerDate:
          firstDateField(
            row,
            [
              'mgsc_mgdt',
              'mgdt',
            ],
          )?.value ??
          null,

        registrationDate:
          firstDateField(
            row,
            [
              'mgsc_mgrgsprd',
              'mgrgsprd',
            ],
          )?.value ??
          null,

        newListingDate:
          firstDateField(
            row,
            [
              'mgsc_nstklstprd',
              'nstklstprd',
            ],
          )?.value ??
          null,
      },
    };
  }

  if (
    actionType ===
    'SPIN_OFF'
  ) {
    return {
      status:
        'STRUCTURAL_FIELDS_EXTRACTED',

      matchedRow:
        row,

      facts: {
        boardDecisionDate:
          firstDateField(
            row,
            [
              'bddd',
            ],
          )?.value ??
          null,

        splitDate:
          firstDateField(
            row,
            [
              'dvdt',
              'dv_dt',
              'dvsc_dvdt',
              'dvmg_dt',
            ],
          )?.value ??
          null,

        registrationDate:
          firstDateField(
            row,
            [
              'rgsprd',
              'dvsc_rgsprd',
            ],
          )?.value ??
          null,

        newListingDate:
          firstDateField(
            row,
            [
              'nstklstprd',
              'dvsc_nstklstprd',
            ],
          )?.value ??
          null,
      },
    };
  }

  return {
    status:
      'STRUCTURAL_UNEXPECTED_ACTION_TYPE',

    matchedRow:
      null,

    facts: {},
  };
}

function structuralDatesFromText(
  text,
  actionType,
) {
  const textLines =
    lines(
      text,
    );

  if (
    actionType ===
    'MERGER'
  ) {
    return {
      boardDecisionDate:
        findDateNear(
          textLines,
          [
            /이사회결의일/,
            /이사회결의일자/,
          ],
          8,
        )?.value ??
        null,

      mergerDate:
        findDateNear(
          textLines,
          [
            /합병기일/,
          ],
          8,
        )?.value ??
        null,

      registrationDate:
        findDateNear(
          textLines,
          [
            /합병등기예정일/,
            /합병등기일/,
          ],
          8,
        )?.value ??
        null,

      newListingDate:
        findDateNear(
          textLines,
          [
            /신주상장예정일/,
            /신주상장일/,
          ],
          8,
        )?.value ??
        null,
    };
  }

  return {
    boardDecisionDate:
      findDateNear(
        textLines,
        [
          /이사회결의일/,
          /이사회결의일자/,
        ],
        8,
      )?.value ??
      null,

    splitDate:
      findDateNear(
        textLines,
        [
          /분할기일/,
          /분할합병기일/,
        ],
        8,
      )?.value ??
      null,

    registrationDate:
      findDateNear(
        textLines,
        [
          /분할등기예정일/,
          /분할등기일/,
        ],
        8,
      )?.value ??
      null,

    newListingDate:
      findDateNear(
        textLines,
        [
          /신주상장예정일/,
          /변경상장예정일/,
        ],
        8,
      )?.value ??
      null,
  };
}

function sourceStatusFor(
  actionType,
  parsed,
  sourceKind,
) {
  if (
    actionType ===
    'CASH_DIVIDEND'
  ) {
    if (
      parsed.cashAmount !==
        null &&
      parsed.recordDate
    ) {
      return 'SOURCE_FIELDS_READY_MARKET_DATE_PENDING';
    }

    return 'SOURCE_FIELDS_INCOMPLETE';
  }

  if (
    actionType ===
      'STOCK_SPLIT' ||
    actionType ===
      'REVERSE_SPLIT'
  ) {
    if (
      parsed.ratioFrom &&
      parsed.ratioTo &&
      (
        parsed.recordDate ||
        parsed.listingDate
      )
    ) {
      return 'SOURCE_FIELDS_READY_MARKET_DATE_PENDING';
    }

    return 'SOURCE_FIELDS_INCOMPLETE';
  }

  if (
    actionType ===
    'STOCK_DIVIDEND'
  ) {
    if (
      parsed.ratioFrom &&
      parsed.ratioTo &&
      parsed.recordDate
    ) {
      return 'SOURCE_FIELDS_READY_MARKET_DATE_PENDING';
    }

    return 'SOURCE_FIELDS_INCOMPLETE';
  }

  if (
    STRUCTURAL_TYPES.has(
      actionType,
    )
  ) {
    if (
      sourceKind ===
        'STRUCTURED_JSON' &&
      parsed.status ===
        'STRUCTURAL_FIELDS_EXTRACTED'
    ) {
      return 'STRUCTURAL_FIELDS_READY_FACTOR_BLOCKED';
    }

    const hasAny =
      Object.values(
        parsed.facts ??
        parsed,
      ).some(
        (value) =>
          value !== null &&
          value !==
            undefined &&
          typeof value !==
            'object',
      );

    return hasAny
      ? 'STRUCTURAL_FIELDS_READY_FACTOR_BLOCKED'
      : 'STRUCTURAL_FIELDS_INCOMPLETE_FACTOR_BLOCKED';
  }

  return 'UNEXPECTED_ACTION_TYPE';
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

  const sourceFile =
    path.resolve(
      args.source ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-8-5-1.json',
      ),
    );

  const evidenceFile =
    path.resolve(
      args.evidence ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-8-6.json',
      ),
    );

  for (
    const file of [
      sourceFile,
      evidenceFile,
    ]
  ) {
    if (
      !fs.existsSync(
        file,
      )
    ) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const source =
    readJson(
      sourceFile,
    );

  const evidence =
    readJson(
      evidenceFile,
    );

  if (
    source.version !==
    SOURCE_VERSION
  ) {
    throw new Error(
      'SOURCE_VERSION_MISMATCH',
    );
  }

  if (
    evidence.version !==
    EVIDENCE_VERSION
  ) {
    throw new Error(
      'EVIDENCE_VERSION_MISMATCH',
    );
  }

  if (
    source.status !==
    'CANONICAL_SOURCE_SELECTION_READY_WITH_QUARANTINE'
  ) {
    throw new Error(
      'CANONICAL_SOURCE_SELECTION_NOT_READY',
    );
  }

  const evidenceByReceipt =
    new Map(
      evidence.results.map(
        (row) => [
          row.receiptNo,
          row,
        ],
      ),
    );

  const results = [];

  for (
    let index = 0;
    index <
    source.activeChains.length;
    index += 1
  ) {
    const chain =
      source.activeChains[
        index
      ];

    const evidenceRow =
      evidenceByReceipt.get(
        chain.sourceReceiptNo,
      ) ??
      null;

    let sourceKind =
      'NONE';

    let sourceText =
      '';

    let structuredFile =
      null;

    if (
      evidenceRow
        ?.document
        ?.file
    ) {
      const absolute =
        path.join(
          root,
          evidenceRow
            .document
            .file,
        );

      if (
        fs.existsSync(
          absolute,
        )
      ) {
        sourceKind =
          'DOCUMENT_XML_ZIP';

        sourceText =
          zipToText(
            absolute,
          );
      }
    }

    if (
      sourceKind ===
        'NONE' &&
      evidenceRow
        ?.structured
        ?.file
    ) {
      const absolute =
        path.join(
          root,
          evidenceRow
            .structured
            .file,
        );

      if (
        fs.existsSync(
          absolute,
        )
      ) {
        sourceKind =
          'STRUCTURED_JSON';

        structuredFile =
          absolute;
      }
    }

    let parsed = null;

    if (
      chain.actionType ===
      'CASH_DIVIDEND'
    ) {
      parsed =
        sourceText
          ? parseCashDividend(
              sourceText,
            )
          : {
              cashAmount:
                null,
              currency:
                null,
              recordDate:
                null,
              paymentDate:
                null,
              amountStatus:
                'SOURCE_TEXT_UNAVAILABLE',
              evidence: {},
            };
    } else if (
      chain.actionType ===
        'STOCK_SPLIT' ||
      chain.actionType ===
        'REVERSE_SPLIT'
    ) {
      parsed =
        sourceText
          ? parseSplitOrReverse(
              sourceText,
              chain.actionType,
            )
          : {
              ratioFrom:
                null,
              ratioTo:
                null,
              shareFactor:
                null,
              priceFactor:
                null,
              recordDate:
                null,
              listingDate:
                null,
              tradingStopStart:
                null,
              ratioStatus:
                'SOURCE_TEXT_UNAVAILABLE',
              evidence: {},
            };
    } else if (
      chain.actionType ===
      'STOCK_DIVIDEND'
    ) {
      parsed =
        sourceText
          ? parseStockDividend(
              sourceText,
            )
          : {
              dividendSharesPerShare:
                null,
              ratioFrom:
                null,
              ratioTo:
                null,
              shareFactor:
                null,
              priceFactor:
                null,
              recordDate:
                null,
              ratioStatus:
                'SOURCE_TEXT_UNAVAILABLE',
              evidence: {},
            };
    } else if (
      STRUCTURAL_TYPES.has(
        chain.actionType,
      )
    ) {
      if (
        sourceText
      ) {
        parsed = {
          status:
            'STRUCTURAL_FIELDS_EXTRACTED_FROM_DOCUMENT',

          facts:
            structuralDatesFromText(
              sourceText,
              chain.actionType,
            ),
        };
      } else {
        const rows =
          structuredRows(
            structuredFile,
          );

        parsed =
          parseStructuralStructured(
            chain.actionType,
            rows,
            chain.sourceReceiptNo,
          );
      }
    } else {
      throw new Error(
        `UNEXPECTED_ACTION_TYPE:${chain.actionType}`,
      );
    }

    const parseStatus =
      sourceStatusFor(
        chain.actionType,
        parsed,
        sourceKind,
      );

    const sourceFingerprint =
      sha256(
        [
          PROVIDER,
          chain.providerEventId,
          chain.stockCode ??
            '',
          chain.actionType,
        ].join('|'),
      );

    const row = {
      provider:
        PROVIDER,

      providerEventId:
        chain.providerEventId,

      sourceFingerprint,

      stockCode:
        chain.stockCode,

      corpCode:
        chain.corpCode,

      market:
        chain.market,

      actionType:
        chain.actionType,

      rootReceiptNo:
        chain.rootReceiptNo,

      sourceReceiptNo:
        chain.sourceReceiptNo,

      sourceReceiptDate:
        chain.sourceReceiptDate,

      sourceIsCorrection:
        chain.sourceIsCorrection,

      sourceKind,

      parseStatus,

      parsed,

      canonicalPreview: {
        stock_code:
          chain.stockCode,

        action_type:
          chain.actionType,

        /*
         * Intentionally null until V9.8.7 resolves the market date.
         */
        effective_date:
          null,

        ratio_from:
          parsed.ratioFrom ??
          null,

        ratio_to:
          parsed.ratioTo ??
          null,

        cash_amount:
          parsed.cashAmount ??
          null,

        currency:
          parsed.currency ??
          (
            chain.actionType ===
              'CASH_DIVIDEND'
              ? 'KRW'
              : null
          ),

        provider:
          PROVIDER,

        provider_event_id:
          chain.providerEventId,

        source_fingerprint:
          sourceFingerprint,

        status:
          STRUCTURAL_TYPES.has(
            chain.actionType,
          )
            ? 'UNSUPPORTED'
            : 'RECORDED',

        is_validation:
          false,

        production_applied:
          false,

        event_insert_allowed:
          false,
      },

      nextStage: {
        marketEffectiveDateResolutionRequired:
          !STRUCTURAL_TYPES.has(
            chain.actionType,
          ),

        structuralFactorBlocked:
          STRUCTURAL_TYPES.has(
            chain.actionType,
          ),

        sourceFieldReviewRequired:
          parseStatus.includes(
            'INCOMPLETE',
          ),
      },
    };

    results.push(
      row,
    );

    console.log(
      [
        'PARSE',
        `${index + 1}/${source.activeChains.length}`,
        `receipt=${chain.sourceReceiptNo}`,
        `root=${chain.providerEventId}`,
        `action=${chain.actionType}`,
        `source=${sourceKind}`,
        `status=${parseStatus}`,
      ].join(' '),
    );
  }

  const readyMarketDate =
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

  const status =
    duplicateIdentityCount >
      0
      ? 'FIELD_EXTRACTION_INVALID'
      : 'FIELD_EXTRACTION_COMPLETE_WITH_REVIEW';

  const report = {
    version:
      VERSION,

    status,

    source: {
      sourceVersion:
        source.version,

      evidenceVersion:
        evidence.version,

      sourceSelectionFingerprint:
        source.outputFingerprint,

      inputFingerprint:
        sha256(
          JSON.stringify({
            source:
              source.outputFingerprint,

            evidence:
              evidence.outputFingerprint ??
              null,
          }),
        ),
    },

    counts: {
      activeCanonicalChains:
        source.activeChains.length,

      extractedRows:
        results.length,

      readyForMarketDateResolution:
        readyMarketDate.length,

      sourceFieldsIncomplete:
        incomplete.length,

      structuralFieldsReady:
        structuralReady.length,

      structuralFieldsIncomplete:
        structuralIncomplete.length,

      duplicateCanonicalIdentities:
        duplicateIdentityCount,
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

    sourceKindCounts:
      countBy(
        results,
        (row) =>
          row.sourceKind,
      ),

    incompleteActionTypeCounts:
      countBy(
        [
          ...incomplete,
          ...structuralIncomplete,
        ],
        (row) =>
          row.actionType,
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

      sourceSelectionMutated:
        false,
    },

    policy: {
      effectiveDate:
        'DEFER_TO_V9_8_7_MARKET_DATE_RESOLUTION',

      cashDividend:
        'EXTRACT_CASH_PER_SHARE_AND_RECORD_DATE_ONLY',

      splitReverse:
        'DERIVE_RATIO_ONLY_WHEN_FACE_VALUE_PAIR_IS_UNIQUE',

      stockDividend:
        'DERIVE_RATIO_ONLY_WHEN_PER_SHARE_DISTRIBUTION_IS_UNIQUE',

      structural:
        'EXTRACT_TIMELINE_ONLY_GENERIC_FACTOR_BLOCKED',

      providerEventId:
        'ORIGINAL_ROOT_DART_RECEIPT',

      eventInsert:
        'BLOCKED_IN_V9_8_6',
    },

    reviewQueue:
      [
        ...incomplete,
        ...structuralIncomplete,
      ].map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          sourceReceiptNo:
            row.sourceReceiptNo,

          stockCode:
            row.stockCode,

          corpCode:
            row.corpCode,

          actionType:
            row.actionType,

          sourceKind:
            row.sourceKind,

          parseStatus:
            row.parseStatus,

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
        .replaceAll(
          '\\',
          '/',
        ),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report
            .source
            .inputFingerprint,

        rows:
          results.map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
              row.actionType,
              row.parseStatus,
              row.canonicalPreview
                .ratio_from,
              row.canonicalPreview
                .ratio_to,
              row.canonicalPreview
                .cash_amount,
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

        sourceKindCounts:
          report.sourceKindCounts,

        incompleteActionTypeCounts:
          report.incompleteActionTypeCounts,

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

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'FIELD_EXTRACTION_INVALID'
  ) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(
      error?.message ??
      error,
    ),
  );

  process.exitCode = 1;
}
