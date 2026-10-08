/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.6.1 - Proven XML text-node parser restoration
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6-1.json
 *
 * Why this patch exists:
 *   V9.8.6 flattened XML table cells into generic lines and then searched
 *   nearby numbers. That lost DART's table-node ordering and produced
 *   0/122 successful factor-action extractions.
 *
 *   V9.7.3 had already proven a safer parser:
 *     - preserve XML text-node order
 *     - match exact DART table labels
 *     - read values after known labels/sub-labels
 *
 * This version restores that proven contract and applies it to the
 * V9.8 canonical chain output.
 *
 * No final market effective_date is assigned here for CASH_DIVIDEND or
 * STOCK_DIVIDEND. Split/reverse split source effective date is extracted
 * as a SOURCE FACT only; V9.8.7 still owns final market-date reconciliation.
 *
 * Run:
 *   node .\scripts\v9806-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_6_1_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';

const INPUT_VERSION =
  'V9_8_6_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const MAX_ZIP_ENTRIES = 64;
const MAX_XML_BYTES = 16 * 1024 * 1024;

const FACTOR_ACTIONS =
  new Set([
    'CASH_DIVIDEND',
    'STOCK_DIVIDEND',
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
  ]);

const STRUCTURAL_ACTIONS =
  new Set([
    'MERGER',
    'SPIN_OFF',
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

function parseArgs(argv) {
  const out = {
    input: null,
    evidence: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      out.input =
        arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--evidence=')) {
      out.evidence =
        arg.slice('--evidence='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output =
        arg.slice('--output='.length);
      continue;
    }

    throw new Error(`UNKNOWN_OPTION:${arg}`);
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

/* ------------------------------------------------------------------ */
/* ZIP / XML                                                          */
/* ------------------------------------------------------------------ */

function findEocd(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 22
  ) {
    throw new Error('INVALID_ZIP');
  }

  const min =
    Math.max(
      0,
      bytes.length - 65557,
    );

  for (
    let p = bytes.length - 22;
    p >= min;
    p -= 1
  ) {
    if (
      bytes.readUInt32LE(p) !==
      0x06054b50
    ) {
      continue;
    }

    const commentLen =
      bytes.readUInt16LE(p + 20);

    if (
      p + 22 + commentLen !==
      bytes.length
    ) {
      continue;
    }

    const disk =
      bytes.readUInt16LE(p + 4);

    const cdDisk =
      bytes.readUInt16LE(p + 6);

    const countDisk =
      bytes.readUInt16LE(p + 8);

    const count =
      bytes.readUInt16LE(p + 10);

    const cdSize =
      bytes.readUInt32LE(p + 12);

    const cdOffset =
      bytes.readUInt32LE(p + 16);

    if (
      disk !== 0 ||
      cdDisk !== 0 ||
      countDisk !== count
    ) {
      throw new Error(
        'MULTIDISK_ZIP_UNSUPPORTED',
      );
    }

    if (
      !count ||
      count > MAX_ZIP_ENTRIES ||
      count === 0xffff ||
      cdSize === 0xffffffff ||
      cdOffset === 0xffffffff
    ) {
      throw new Error(
        'ZIP64_OR_ENTRY_LIMIT',
      );
    }

    if (
      cdOffset + cdSize !== p
    ) {
      throw new Error(
        'INVALID_CENTRAL_DIRECTORY',
      );
    }

    return {
      count,
      cdOffset,
      cdSize,
    };
  }

  throw new Error(
    'ZIP_EOCD_NOT_FOUND',
  );
}

function readZipEntries(bytes) {
  const eocd =
    findEocd(bytes);

  const entries = [];

  let p =
    eocd.cdOffset;

  for (
    let i = 0;
    i < eocd.count;
    i += 1
  ) {
    if (
      p + 46 > bytes.length ||
      bytes.readUInt32LE(p) !==
        0x02014b50
    ) {
      throw new Error(
        'INVALID_CENTRAL_ENTRY',
      );
    }

    const flags =
      bytes.readUInt16LE(p + 8);

    const method =
      bytes.readUInt16LE(p + 10);

    const compressedSize =
      bytes.readUInt32LE(p + 20);

    const uncompressedSize =
      bytes.readUInt32LE(p + 24);

    const nameLen =
      bytes.readUInt16LE(p + 28);

    const extraLen =
      bytes.readUInt16LE(p + 30);

    const commentLen =
      bytes.readUInt16LE(p + 32);

    const localOffset =
      bytes.readUInt32LE(p + 42);

    if (
      flags & 0x0001
    ) {
      throw new Error(
        'ENCRYPTED_ZIP_UNSUPPORTED',
      );
    }

    if (
      ![0, 8].includes(method)
    ) {
      throw new Error(
        'ZIP_METHOD_UNSUPPORTED',
      );
    }

    if (
      uncompressedSize >
      MAX_XML_BYTES
    ) {
      throw new Error(
        'XML_TOO_LARGE',
      );
    }

    const nameStart =
      p + 46;

    const nameEnd =
      nameStart + nameLen;

    if (
      nameEnd +
        extraLen +
        commentLen >
      bytes.length
    ) {
      throw new Error(
        'INVALID_CENTRAL_ENTRY',
      );
    }

    const name =
      bytes
        .subarray(
          nameStart,
          nameEnd,
        )
        .toString(
          (flags & 0x0800)
            ? 'utf8'
            : 'utf8',
        );

    if (
      localOffset + 30 >
        bytes.length ||
      bytes.readUInt32LE(
        localOffset,
      ) !== 0x04034b50
    ) {
      throw new Error(
        'INVALID_LOCAL_ENTRY',
      );
    }

    const localNameLen =
      bytes.readUInt16LE(
        localOffset + 26,
      );

    const localExtraLen =
      bytes.readUInt16LE(
        localOffset + 28,
      );

    const dataStart =
      localOffset +
      30 +
      localNameLen +
      localExtraLen;

    const dataEnd =
      dataStart +
      compressedSize;

    if (
      dataEnd >
      bytes.length
    ) {
      throw new Error(
        'TRUNCATED_ZIP_ENTRY',
      );
    }

    const compressed =
      bytes.subarray(
        dataStart,
        dataEnd,
      );

    const raw =
      method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(
            compressed,
            {
              maxOutputLength:
                MAX_XML_BYTES,
            },
          );

    if (
      raw.length !==
      uncompressedSize
    ) {
      throw new Error(
        'ZIP_SIZE_MISMATCH',
      );
    }

    entries.push({
      name,
      bytes: raw,
    });

    p =
      nameEnd +
      extraLen +
      commentLen;
  }

  return entries;
}

function decodeXmlBytes(bytes) {
  const head =
    bytes
      .subarray(
        0,
        Math.min(bytes.length, 512),
      )
      .toString('latin1');

  const encodingMatch =
    head.match(
      /encoding\s*=\s*["']([^"']+)["']/i,
    );

  const declared =
    String(
      encodingMatch?.[1] ?? '',
    ).toLowerCase();

  const encodings = [];

  if (
    declared.includes('euc-kr') ||
    declared.includes('ks_c_5601') ||
    declared.includes('ksc5601')
  ) {
    encodings.push('euc-kr');
  }

  encodings.push(
    'utf-8',
    'euc-kr',
  );

  for (
    const encoding of
    [...new Set(encodings)]
  ) {
    try {
      return new TextDecoder(
        encoding,
        { fatal: false },
      ).decode(bytes);
    } catch {
      // try next
    }
  }

  return bytes.toString('utf8');
}

function extractXmlFromZipFile(file) {
  const zip =
    fs.readFileSync(file);

  const entries =
    readZipEntries(zip);

  const xmlEntries =
    entries.filter(
      (entry) =>
        /\.xml$/i.test(
          entry.name,
        ),
    );

  if (
    xmlEntries.length === 0
  ) {
    throw new Error(
      'XML_ENTRY_MISSING',
    );
  }

  /*
   * Most DART document.xml ZIPs have one XML.
   * If more than one exists, use the largest textual XML rather than guessing
   * by filename. The chosen XML is still recorded in evidence.
   */
  const entry =
    xmlEntries
      .slice()
      .sort(
        (a, b) =>
          b.bytes.length -
          a.bytes.length,
      )[0];

  const text =
    decodeXmlBytes(
      entry.bytes,
    )
      .replace(/^\uFEFF/, '');

  if (
    !/^\s*<\?xml\b|^\s*</i.test(
      text,
    )
  ) {
    throw new Error(
      'INVALID_XML_TEXT',
    );
  }

  return {
    entryName:
      entry.name,

    byteLength:
      entry.bytes.length,

    sha256:
      sha256(entry.bytes),

    text,
  };
}

function decodeEntities(s) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return String(s).replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, key) => {
      if (key[0] === '#') {
        const n =
          key[1].toLowerCase() === 'x'
            ? parseInt(
                key.slice(2),
                16,
              )
            : parseInt(
                key.slice(1),
                10,
              );

        return (
          Number.isFinite(n) &&
          n >= 0 &&
          n <= 0x10ffff
        )
          ? String.fromCodePoint(n)
          : match;
      }

      return (
        named[
          key.toLowerCase()
        ] ??
        match
      );
    },
  );
}

function xmlTextNodes(xml) {
  const cleaned =
    String(xml)
      .replace(
        /<!--[\s\S]*?-->/g,
        ' ',
      )
      .replace(
        /<!\[CDATA\[([\s\S]*?)\]\]>/g,
        '>$1<',
      );

  const out = [];

  for (
    const match of
    cleaned.matchAll(
      />([^<>]+)</g,
    )
  ) {
    const text =
      decodeEntities(
        match[1],
      )
        .replace(
          /\u00a0/g,
          ' ',
        )
        .replace(
          /\s+/g,
          ' ',
        )
        .trim();

    if (text) {
      out.push(text);
    }
  }

  if (
    out.length === 0
  ) {
    throw new Error(
      'NO_XML_TEXT_NODES',
    );
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Node helpers - restored from the proven V9.7.3 contract            */
/* ------------------------------------------------------------------ */

function parseDate(value) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const text =
    value.trim();

  let match =
    text.match(
      /\b(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\b/,
    );

  if (!match) {
    match =
      text.match(
        /\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
      );
  }

  if (!match) {
    match =
      text.match(
        /\b(20\d{2})(\d{2})(\d{2})\b/,
      );
  }

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const iso =
    `${String(year).padStart(4, '0')}-` +
    `${String(month).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}`;

  const date =
    new Date(
      `${iso}T00:00:00Z`,
    );

  return (
    Number.isFinite(
      date.getTime(),
    ) &&
    date
      .toISOString()
      .slice(0, 10) ===
      iso
  )
    ? iso
    : null;
}

function parseNumber(value) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const text =
    value
      .replace(/,/g, '')
      .trim();

  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      text,
    )
  ) {
    return null;
  }

  const number =
    Number(text);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function parseIntegerString(value) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const text =
    value
      .replace(/,/g, '')
      .trim();

  return /^-?\d+$/.test(
    text,
  )
    ? text
    : null;
}

function findIndex(
  nodes,
  matcher,
  start = 0,
) {
  for (
    let index = start;
    index < nodes.length;
    index += 1
  ) {
    const matches =
      typeof matcher ===
      'string'
        ? nodes[index] ===
          matcher
        : matcher.test(
            nodes[index],
          );

    if (matches) {
      return index;
    }
  }

  return -1;
}

function findLastIndex(
  nodes,
  matcher,
) {
  for (
    let index =
      nodes.length - 1;
    index >= 0;
    index -= 1
  ) {
    const matches =
      typeof matcher ===
      'string'
        ? nodes[index] ===
          matcher
        : matcher.test(
            nodes[index],
          );

    if (matches) {
      return index;
    }
  }

  return -1;
}

function firstAfter(
  nodes,
  matcher,
  options = {},
) {
  const index =
    findIndex(
      nodes,
      matcher,
      options.start ??
        0,
    );

  if (index < 0) {
    return null;
  }

  const max =
    options.maxLookahead ??
    8;

  for (
    let next = index + 1;
    next <
      nodes.length &&
    next <=
      index + max;
    next += 1
  ) {
    const value =
      nodes[next];

    const accepted =
      options.test
        ? options.test(
            value,
          )
        : (
            value !== '-' &&
            value !== ''
          );

    if (accepted) {
      return value;
    }
  }

  return null;
}

function dateAfter(
  nodes,
  matcher,
  options = {},
) {
  const value =
    firstAfter(
      nodes,
      matcher,
      {
        ...options,

        test:
          (candidate) =>
            Boolean(
              parseDate(
                candidate,
              ),
            ),
      },
    );

  return parseDate(
    value,
  );
}

function intStringAfter(
  nodes,
  matcher,
  options = {},
) {
  const value =
    firstAfter(
      nodes,
      matcher,
      {
        ...options,

        test:
          (candidate) =>
            parseIntegerString(
              candidate,
            ) !== null,
      },
    );

  return parseIntegerString(
    value,
  );
}

function valueAfterSubLabel(
  nodes,
  heading,
  subLabel,
  parser,
  maxWindow = 20,
  start = 0,
) {
  const headingIndex =
    findIndex(
      nodes,
      heading,
      start,
    );

  if (headingIndex < 0) {
    return null;
  }

  const end =
    Math.min(
      nodes.length,
      headingIndex + maxWindow,
    );

  for (
    let index = headingIndex + 1;
    index < end;
    index += 1
  ) {
    const labelMatches =
      typeof subLabel === 'string'
        ? nodes[index] === subLabel
        : subLabel.test(nodes[index]);

    if (!labelMatches) {
      continue;
    }

    const valueIndex = index + 1;

    if (valueIndex >= end) {
      return null;
    }

    return parser(nodes[valueIndex]);
  }

  return null;
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
    const temp =
      x % y;

    x = y;
    y = temp;
  }

  return x || 1;
}

/* ------------------------------------------------------------------ */
/* Factor action parsers                                              */
/* ------------------------------------------------------------------ */

function parseCashDividend(nodes) {
  const main =
    findLastIndex(
      nodes,
      /^현금ㆍ현물배당 결정$/,
    );

  const start =
    main >= 0
      ? main
      : 0;

  const kind =
    firstAfter(
      nodes,
      /^2\.\s*배당종류$/,
      {
        start,
        maxLookahead: 3,
      },
    );

  if (
    !kind ||
    !/현금배당/.test(
      kind,
    )
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'NOT_PURE_CASH_DIVIDEND_OR_KIND_MISSING',

      parsed: {
        cashAmount:
          null,
        currency:
          null,
        recordDate:
          null,
        paymentDate:
          null,
      },
    };
  }

  const perShare =
    valueAfterSubLabel(
      nodes,
      /^3\.\s*1주당 배당금\(원\)$/,
      '보통주식',
      parseNumber,
      12,
      start,
    );

  const recordDate =
    dateAfter(
      nodes,
      /^6\.\s*배당기준일$/,
      {
        start,
        maxLookahead: 3,
      },
    );

  const paymentDate =
    dateAfter(
      nodes,
      /^7\.\s*배당금지급 예정일자$/,
      {
        start,
        maxLookahead: 3,
      },
    );

  const totalCashAmount =
    intStringAfter(
      nodes,
      /^5\.\s*배당금총액\(원\)$/,
      {
        start,
        maxLookahead: 3,
      },
    );

  if (
    perShare === null ||
    !recordDate
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'CASH_DIVIDEND_REQUIRED_FIELD_MISSING',

      parsed: {
        cashAmount:
          perShare,
        currency:
          perShare !== null
            ? 'KRW'
            : null,
        recordDate,
        paymentDate,
        totalCashAmount,
      },
    };
  }

  return {
    status:
      'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

    reason:
      'V9_7_3_EXACT_TABLE_CONTRACT',

    parsed: {
      cashAmount:
        perShare,

      currency:
        'KRW',

      recordDate,

      paymentDate,

      totalCashAmount,

      amountStatus:
        'CASH_AMOUNT_EXACT_TABLE_FIELD',
    },
  };
}

function parseStockDividend(nodes) {
  const main =
    findLastIndex(
      nodes,
      /^주식배당 결정$/,
    );

  const start =
    main >= 0
      ? main
      : 0;

  const stockPerShare =
    valueAfterSubLabel(
      nodes,
      /^1\.\s*1주당 배당주식수\s*\(주\)$/,
      '보통주식',
      parseNumber,
      12,
      start,
    );

  const recordDate =
    dateAfter(
      nodes,
      /^4\.\s*배당기준일$/,
      {
        start,
        maxLookahead: 3,
      },
    );

  const totalDividendShares =
    valueAfterSubLabel(
      nodes,
      /^2\.\s*배당주식총수\s*\(주\)$/,
      '보통주식',
      parseIntegerString,
      12,
      start,
    );

  if (
    stockPerShare === null ||
    !recordDate
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'STOCK_DIVIDEND_REQUIRED_FIELD_MISSING',

      parsed: {
        dividendSharesPerShare:
          stockPerShare,

        recordDate,

        totalDividendShares,

        ratioFrom:
          null,

        ratioTo:
          null,
      },
    };
  }

  const text =
    String(
      stockPerShare,
    );

  const decimals =
    text.includes('.')
      ? text
          .split('.')[1]
          .length
      : 0;

  const scale =
    10 **
    Math.min(
      decimals,
      8,
    );

  const newUnits =
    Math.round(
      stockPerShare *
      scale,
    );

  const divisor =
    gcd(
      scale,
      scale + newUnits,
    );

  const ratioFrom =
    scale /
    divisor;

  const ratioTo =
    (
      scale +
      newUnits
    ) /
    divisor;

  return {
    status:
      'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

    reason:
      'V9_7_3_EXACT_TABLE_CONTRACT',

    parsed: {
      dividendSharesPerShare:
        stockPerShare,

      totalDividendShares,

      recordDate,

      ratioFrom,

      ratioTo,

      shareFactor:
        ratioTo /
        ratioFrom,

      priceFactor:
        ratioFrom /
        ratioTo,

      ratioStatus:
        'RATIO_DERIVED_FROM_EXACT_STOCK_DIVIDEND_PER_SHARE',
    },
  };
}

function parseSplit(
  nodes,
  actionType,
) {
  const heading =
    actionType ===
      'STOCK_SPLIT'
      ? /^1\.\s*주식분할 내용$/
      : /^1\.\s*주식병합 내용$/;

  const headingIndex =
    findIndex(
      nodes,
      heading,
    );

  if (
    headingIndex < 0
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'SPLIT_MAIN_TABLE_NOT_FOUND',

      parsed: {
        ratioFrom:
          null,
        ratioTo:
          null,
      },
    };
  }

  let parBefore =
    null;

  let parAfter =
    null;

  let sharesBefore =
    null;

  let sharesAfter =
    null;

  const parIndex =
    findIndex(
      nodes,
      /^1주당 가액 \(원\)$/,
      headingIndex,
    );

  if (
    parIndex >= 0
  ) {
    parBefore =
      parseNumber(
        nodes[
          parIndex + 1
        ],
      );

    parAfter =
      parseNumber(
        nodes[
          parIndex + 2
        ],
      );
  }

  const issuedIndex =
    findIndex(
      nodes,
      /^발행주식총수$/,
      headingIndex,
    );

  if (
    issuedIndex >= 0
  ) {
    const commonIndex =
      findIndex(
        nodes,
        /^보통주식\(주\)$/,
        issuedIndex,
      );

    if (
      commonIndex >= 0
    ) {
      sharesBefore =
        parseIntegerString(
          nodes[
            commonIndex + 1
          ],
        );

      sharesAfter =
        parseIntegerString(
          nodes[
            commonIndex + 2
          ],
        );
    }
  }

  const sourceEffectiveDate =
    dateAfter(
      nodes,
      /^신주의 효력발생일$/,
      {
        start:
          headingIndex,

        maxLookahead:
          4,
      },
    );

  const listingDate =
    dateAfter(
      nodes,
      /^신주권상장예정일$/,
      {
        start:
          headingIndex,

        maxLookahead:
          4,
      },
    ) ??
    dateAfter(
      nodes,
      /^신주의 상장예정일$/,
      {
        start:
          headingIndex,

        maxLookahead:
          4,
      },
    );

  if (
    parBefore === null ||
    parAfter === null ||
    !(parBefore > 0) ||
    !(parAfter > 0) ||
    !sourceEffectiveDate
  ) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'SPLIT_REQUIRED_FIELD_MISSING',

      parsed: {
        parValueBefore:
          parBefore,

        parValueAfter:
          parAfter,

        commonSharesBefore:
          sharesBefore,

        commonSharesAfter:
          sharesAfter,

        sourceEffectiveDate,

        listingDate,

        ratioFrom:
          null,

        ratioTo:
          null,
      },
    };
  }

  const shareFactor =
    parBefore /
    parAfter;

  const directionOk =
    actionType ===
      'STOCK_SPLIT'
      ? shareFactor > 1
      : shareFactor < 1;

  if (!directionOk) {
    return {
      status:
        'SOURCE_FIELDS_INCOMPLETE',

      reason:
        'SPLIT_DIRECTION_MISMATCH',

      parsed: {
        parValueBefore:
          parBefore,

        parValueAfter:
          parAfter,

        commonSharesBefore:
          sharesBefore,

        commonSharesAfter:
          sharesAfter,

        sourceEffectiveDate,

        listingDate,

        ratioFrom:
          null,

        ratioTo:
          null,
      },
    };
  }

  const divisor =
    gcd(
      parBefore,
      parAfter,
    );

  /*
   * Shares move inversely to par value.
   *
   * ratio_from = PRE_ACTION_UNITS
   * ratio_to   = POST_ACTION_UNITS
   *
   * Example:
   *   split 500 -> 100:
   *     ratio_from = 1
   *     ratio_to   = 5
   *
   *   reverse 500 -> 2500:
   *     ratio_from = 5
   *     ratio_to   = 1
   */
  const ratioFrom =
    parAfter /
    divisor;

  const ratioTo =
    parBefore /
    divisor;

  return {
    status:
      'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',

    reason:
      'V9_7_3_EXACT_TABLE_CONTRACT',

    parsed: {
      parValueBefore:
        parBefore,

      parValueAfter:
        parAfter,

      commonSharesBefore:
        sharesBefore,

      commonSharesAfter:
        sharesAfter,

      sourceEffectiveDate,

      listingDate,

      ratioFrom,

      ratioTo,

      shareFactor:
        ratioTo /
        ratioFrom,

      priceFactor:
        ratioFrom /
        ratioTo,

      ratioStatus:
        'RATIO_DERIVED_FROM_EXACT_PAR_VALUE_TABLE',
    },
  };
}

/* ------------------------------------------------------------------ */

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
        'opendart-corporate-action-field-extraction-v9-8-6.json',
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
        'opendart-corporate-action-field-extraction-v9-8-6-1.json',
      ),
    );

  for (const file of [
    inputFile,
    evidenceFile,
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
    readJson(
      inputFile,
    );

  const evidence =
    readJson(
      evidenceFile,
    );

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'V9_8_6_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    evidence.version !==
    EVIDENCE_VERSION
  ) {
    throw new Error(
      'EVIDENCE_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(
      input.results,
    )
  ) {
    throw new Error(
      'V9_8_6_RESULTS_MISSING',
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

  let xmlDocumentsParsed =
    0;

  let sourceUnavailable =
    0;

  for (
    let index = 0;
    index < input.results.length;
    index += 1
  ) {
    const prior =
      input.results[index];

    if (
      STRUCTURAL_ACTIONS.has(
        prior.actionType,
      )
    ) {
      results.push({
        ...prior,

        parserVersion:
          VERSION,

        parserDisposition:
          'STRUCTURAL_RESULT_PRESERVED_FROM_V9_8_6',
      });

      console.log(
        [
          'REPARSE',
          `${index + 1}/${input.results.length}`,
          `receipt=${prior.sourceReceiptNo}`,
          `action=${prior.actionType}`,
          'status=PRESERVED_STRUCTURAL',
        ].join(' '),
      );

      continue;
    }

    if (
      !FACTOR_ACTIONS.has(
        prior.actionType,
      )
    ) {
      throw new Error(
        `UNEXPECTED_ACTION_TYPE:${prior.actionType}`,
      );
    }

    const evidenceRow =
      evidenceByReceipt.get(
        prior.sourceReceiptNo,
      );

    const relFile =
      evidenceRow
        ?.document
        ?.file;

    if (!relFile) {
      sourceUnavailable += 1;

      results.push({
        ...prior,

        parseStatus:
          'SOURCE_FIELDS_INCOMPLETE',

        parsed: {
          ...(prior.parsed ?? {}),

          reparsedReason:
            'DOCUMENT_XML_FILE_UNAVAILABLE',
        },

        canonicalPreview: {
          ...prior.canonicalPreview,

          effective_date:
            null,

          event_insert_allowed:
            false,
        },

        nextStage: {
          ...prior.nextStage,

          sourceFieldReviewRequired:
            true,
        },

        parserVersion:
          VERSION,

        parserDisposition:
          'DOCUMENT_XML_FILE_UNAVAILABLE',
      });

      console.log(
        [
          'REPARSE',
          `${index + 1}/${input.results.length}`,
          `receipt=${prior.sourceReceiptNo}`,
          `action=${prior.actionType}`,
          'status=SOURCE_FIELDS_INCOMPLETE',
          'reason=DOCUMENT_XML_FILE_UNAVAILABLE',
        ].join(' '),
      );

      continue;
    }

    const absolute =
      path.join(
        root,
        relFile,
      );

    if (
      !fs.existsSync(
        absolute,
      )
    ) {
      sourceUnavailable += 1;

      results.push({
        ...prior,

        parseStatus:
          'SOURCE_FIELDS_INCOMPLETE',

        parsed: {
          ...(prior.parsed ?? {}),

          reparsedReason:
            'DOCUMENT_XML_LOCAL_FILE_MISSING',
        },

        canonicalPreview: {
          ...prior.canonicalPreview,

          effective_date:
            null,

          event_insert_allowed:
            false,
        },

        nextStage: {
          ...prior.nextStage,

          sourceFieldReviewRequired:
            true,
        },

        parserVersion:
          VERSION,

        parserDisposition:
          'DOCUMENT_XML_LOCAL_FILE_MISSING',
      });

      console.log(
        [
          'REPARSE',
          `${index + 1}/${input.results.length}`,
          `receipt=${prior.sourceReceiptNo}`,
          `action=${prior.actionType}`,
          'status=SOURCE_FIELDS_INCOMPLETE',
          'reason=DOCUMENT_XML_LOCAL_FILE_MISSING',
        ].join(' '),
      );

      continue;
    }

    let parsedResult;

    let xmlMeta;

    try {
      const xml =
        extractXmlFromZipFile(
          absolute,
        );

      const nodes =
        xmlTextNodes(
          xml.text,
        );

      xmlDocumentsParsed += 1;

      xmlMeta = {
        validated:
          true,

        entryName:
          xml.entryName,

        byteLength:
          xml.byteLength,

        sha256:
          xml.sha256,

        textNodeCount:
          nodes.length,
      };

      if (
        prior.actionType ===
        'CASH_DIVIDEND'
      ) {
        parsedResult =
          parseCashDividend(
            nodes,
          );
      } else if (
        prior.actionType ===
        'STOCK_DIVIDEND'
      ) {
        parsedResult =
          parseStockDividend(
            nodes,
          );
      } else {
        parsedResult =
          parseSplit(
            nodes,
            prior.actionType,
          );
      }
    } catch (error) {
      parsedResult = {
        status:
          'SOURCE_FIELDS_INCOMPLETE',

        reason:
          String(
            error?.message ??
            error,
          ),

        parsed: {},
      };

      xmlMeta = {
        validated:
          false,

        error:
          String(
            error?.message ??
            error,
          ),
      };
    }

    const parsed =
      {
        ...parsedResult.parsed,

        parserReason:
          parsedResult.reason,

        xml:
          xmlMeta,
      };

    const canonicalPreview = {
      ...prior.canonicalPreview,

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
          prior.actionType ===
          'CASH_DIVIDEND'
            ? 'KRW'
            : null
        ),

      event_insert_allowed:
        false,
    };

    results.push({
      ...prior,

      parseStatus:
        parsedResult.status,

      parsed,

      canonicalPreview,

      nextStage: {
        marketEffectiveDateResolutionRequired:
          true,

        structuralFactorBlocked:
          false,

        sourceFieldReviewRequired:
          parsedResult.status !==
          'SOURCE_FIELDS_READY_MARKET_DATE_PENDING',
      },

      parserVersion:
        VERSION,

      parserDisposition:
        parsedResult.reason,
    });

    console.log(
      [
        'REPARSE',
        `${index + 1}/${input.results.length}`,
        `receipt=${prior.sourceReceiptNo}`,
        `action=${prior.actionType}`,
        `status=${parsedResult.status}`,
        `reason=${parsedResult.reason}`,
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

  /*
   * Strong sanity checks:
   * V9.8.6 had 159 identities and 37 structural rows.
   * This patch must never change identity count or structural disposition.
   */
  const identityCountStable =
    results.length ===
    input.results.length;

  const structuralCountStable =
    (
      structuralReady.length +
      structuralIncomplete.length
    ) ===
    input.results.filter(
      (row) =>
        STRUCTURAL_ACTIONS.has(
          row.actionType,
        ),
    ).length;

  const status =
    duplicateIdentityCount > 0 ||
    !identityCountStable ||
    !structuralCountStable
      ? 'FIELD_EXTRACTION_REPARSE_INVALID'
      : incomplete.length === 0
        ? 'FIELD_EXTRACTION_REPARSE_COMPLETE'
        : 'FIELD_EXTRACTION_REPARSE_COMPLETE_WITH_REVIEW';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      evidenceVersion:
        evidence.version,

      inputFingerprint:
        input.outputFingerprint,

      evidenceFingerprint:
        evidence.outputFingerprint ??
        null,
    },

    counts: {
      inputRows:
        input.results.length,

      outputRows:
        results.length,

      xmlDocumentsParsed,

      sourceUnavailable,

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

    readyActionTypeCounts:
      countBy(
        ready,
        (row) =>
          row.actionType,
      ),

    incompleteActionTypeCounts:
      countBy(
        incomplete,
        (row) =>
          row.actionType,
      ),

    incompleteReasonCounts:
      countBy(
        incomplete,
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

      structuralCountStable,

      oldGenericNearbyNumberParserUsed:
        false,

      provenV973XmlNodeContractUsed:
        true,
    },

    policy: {
      xmlParsing:
        'DART_XML_TEXT_NODE_ORDER',

      cashDividend:
        'EXACT_DART_TABLE_LABELS_AND_COMMON_SHARE_SUBLABEL',

      splitReverse:
        'EXACT_DART_SPLIT_TABLE_AND_PAR_VALUE_BEFORE_AFTER',

      stockDividend:
        'EXACT_DART_TABLE_LABELS_AND_COMMON_SHARE_SUBLABEL',

      ratioContract:
        'PRE_ACTION_UNITS_TO_POST_ACTION_UNITS',

      finalEffectiveDate:
        'DEFER_TO_V9_8_7_MARKET_RECONCILIATION',

      eventInsert:
        'BLOCKED_IN_V9_8_6_1',
    },

    reviewQueue:
      incomplete.map(
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
                ?.recordDate ??
                row.parsed
                ?.sourceEffectiveDate ??
                null,
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

        readyActionTypeCounts:
          report.readyActionTypeCounts,

        incompleteActionTypeCounts:
          report.incompleteActionTypeCounts,

        incompleteReasonCounts:
          report.incompleteReasonCounts,

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

        structuralCountStable,

        provenV973XmlNodeContractUsed:
          true,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'FIELD_EXTRACTION_REPARSE_INVALID'
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
