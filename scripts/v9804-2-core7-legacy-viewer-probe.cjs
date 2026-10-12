/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.2 - Final precision chain resolver with DART viewer fallback
 *
 * READ-ONLY with respect to Supabase / production.
 *
 * Inputs:
 *   logs/v9804-1-remaining-7.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-1.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *
 * Strategy:
 *   1) Re-read correction evidence with stricter date plausibility.
 *   2) If document.xml is unavailable (provider 014), use the public
 *      DART report viewer as a first-party fallback.
 *   3) For multiple candidate roots, compare the revised report body against
 *      each candidate body using weighted token similarity.
 *   4) Resolve ONLY when evidence is unique and clears conservative thresholds.
 *      Otherwise quarantine as AMBIGUOUS.
 *
 * Safety:
 *   - no DB writes
 *   - no canonical inserts
 *   - no provider_event_id persistence
 *   - no receipt-order pairing
 *   - no forced one-to-one matching for concurrent filings
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9804-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER';

const CHAIN_VERSION =
  'V9_8_4_OPENDART_CORRECTION_WITHDRAWAL_CHAIN_RESOLVER';

const PRECISION_VERSION =
  'V9_8_4_1_PRECISION_CORRECTION_CHAIN_RESOLVER';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const REQUEST_TIMEOUT_MS = 45000;
const REQUEST_DELAY_MS = 250;

const SIMILARITY_MIN_SCORE = 0.62;
const SIMILARITY_MIN_MARGIN = 0.08;
const SIMILARITY_MIN_TARGET_TOKENS = 35;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    remaining: null,
    chain: null,
    precision: null,
    evidence: null,
    output: null,
    refresh: false,
  };

  for (const arg of argv) {
    if (arg === '--refresh') {
      out.refresh = true;
      continue;
    }

    const pairs = [
      ['--remaining=', 'remaining'],
      ['--chain=', 'chain'],
      ['--precision=', 'precision'],
      ['--evidence=', 'evidence'],
      ['--output=', 'output'],
    ];

    let matched = false;

    for (const [prefix, key] of pairs) {
      if (arg.startsWith(prefix)) {
        out[key] = arg.slice(prefix.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      throw new Error(`UNKNOWN_OPTION:${arg}`);
    }
  }

  return out;
}

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

function atomicSaveBuffer(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);
}

function atomicSaveText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readEnvFile(root) {
  const file = path.join(root, '.env.local');
  const out = {};

  if (!fs.existsSync(file)) {
    return out;
  }

  const text =
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

  for (const line of text.split(/\r?\n/)) {
    const match =
      line.match(
        /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/,
      );

    if (!match) {
      continue;
    }

    let value = match[2];

    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);

      if (end < 0) {
        continue;
      }

      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    out[match[1]] = value;
  }

  return out;
}

function requireDartKey(root) {
  const fileEnv = readEnvFile(root);

  for (const name of [
    'OPENDART_API_KEY',
    'OPEN_DART_API_KEY',
    'DART_API_KEY',
    'DART_KEY',
    'OPEN_DART_KEY',
  ]) {
    const value =
      String(process.env[name] ?? fileEnv[name] ?? '').trim();

    if (value) {
      return value;
    }
  }

  throw new Error('DART_API_KEY_REQUIRED');
}

function compactDate(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function validDate8(value) {
  const text = String(value ?? '');

  if (!/^\d{8}$/.test(text)) {
    return false;
  }

  const yyyy = text.slice(0, 4);
  const mm = text.slice(4, 6);
  const dd = text.slice(6, 8);

  const date =
    new Date(
      `${yyyy}-${mm}-${dd}T00:00:00Z`,
    );

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) ===
      `${yyyy}-${mm}-${dd}`
  );
}

function dateLe(a, b) {
  return validDate8(a) &&
    validDate8(b) &&
    a <= b;
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(?:p|tr|td|th|div|table|section|title|li|h[1-6])>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ' '),
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
      .subarray(0, Math.min(buffer.length, 512))
      .toString('latin1');

  const match =
    head.match(
      /encoding\s*=\s*["']([^"']+)["']/i,
    );

  const declared =
    String(match?.[1] ?? '').toLowerCase();

  const decoders = [];

  if (
    declared.includes('euc-kr') ||
    declared.includes('ks_c_5601') ||
    declared.includes('ksc5601')
  ) {
    decoders.push('euc-kr');
  }

  decoders.push('utf-8', 'euc-kr');

  for (const name of [...new Set(decoders)]) {
    try {
      const text =
        new TextDecoder(name, {
          fatal: false,
        }).decode(buffer);

      if (text) {
        return text;
      }
    } catch {
      // try next
    }
  }

  return buffer.toString('utf8');
}

function findEocd(buffer) {
  const min =
    Math.max(
      0,
      buffer.length - 22 - 65535,
    );

  for (
    let offset = buffer.length - 22;
    offset >= min;
    offset -= 1
  ) {
    if (
      buffer.readUInt32LE(offset) ===
      0x06054b50
    ) {
      return offset;
    }
  }

  throw new Error('ZIP_EOCD_NOT_FOUND');
}

function extractZipEntries(buffer) {
  const eocd = findEocd(buffer);
  const totalEntries =
    buffer.readUInt16LE(eocd + 10);
  const centralOffset =
    buffer.readUInt32LE(eocd + 16);

  const entries = [];
  let ptr = centralOffset;

  for (
    let index = 0;
    index < totalEntries;
    index += 1
  ) {
    if (
      buffer.readUInt32LE(ptr) !==
      0x02014b50
    ) {
      throw new Error('ZIP_CENTRAL_DIRECTORY_INVALID');
    }

    const method =
      buffer.readUInt16LE(ptr + 10);
    const compressedSize =
      buffer.readUInt32LE(ptr + 20);
    const uncompressedSize =
      buffer.readUInt32LE(ptr + 24);
    const fileNameLength =
      buffer.readUInt16LE(ptr + 28);
    const extraLength =
      buffer.readUInt16LE(ptr + 30);
    const commentLength =
      buffer.readUInt16LE(ptr + 32);
    const localOffset =
      buffer.readUInt32LE(ptr + 42);

    const fileName =
      buffer
        .subarray(
          ptr + 46,
          ptr + 46 + fileNameLength,
        )
        .toString('utf8');

    if (
      buffer.readUInt32LE(localOffset) !==
      0x04034b50
    ) {
      throw new Error('ZIP_LOCAL_HEADER_INVALID');
    }

    const localFileNameLength =
      buffer.readUInt16LE(localOffset + 26);
    const localExtraLength =
      buffer.readUInt16LE(localOffset + 28);

    const dataStart =
      localOffset +
      30 +
      localFileNameLength +
      localExtraLength;

    const compressed =
      buffer.subarray(
        dataStart,
        dataStart + compressedSize,
      );

    let data;

    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      ptr +=
        46 +
        fileNameLength +
        extraLength +
        commentLength;
      continue;
    }

    if (
      uncompressedSize > 0 &&
      data.length !== uncompressedSize
    ) {
      throw new Error('ZIP_UNCOMPRESSED_SIZE_MISMATCH');
    }

    entries.push({
      fileName,
      data,
    });

    ptr +=
      46 +
      fileNameLength +
      extraLength +
      commentLength;
  }

  return entries;
}

function zipToPlainText(buffer) {
  const entries =
    extractZipEntries(buffer);

  const texts = [];

  for (const entry of entries) {
    if (
      !/\.(?:xml|html?|txt)$/i.test(
        entry.fileName,
      )
    ) {
      continue;
    }

    const decoded =
      decodeXmlBuffer(entry.data);

    texts.push(
      htmlToText(decoded),
    );
  }

  return texts
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function isZip(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (
      (
        buffer[2] === 0x03 &&
        buffer[3] === 0x04
      ) ||
      (
        buffer[2] === 0x05 &&
        buffer[3] === 0x06
      ) ||
      (
        buffer[2] === 0x07 &&
        buffer[3] === 0x08
      )
    )
  );
}

function extractProviderStatus(text) {
  const match =
    String(text).match(
      /<status>\s*([0-9]{3})\s*<\/status>/i,
    ) ??
    String(text).match(
      /"status"\s*:\s*"([0-9]{3})"/i,
    );

  return match?.[1] ?? null;
}

async function fetchDocumentXml({
  key,
  receiptNo,
}) {
  const url =
    new URL(
      'https://opendart.fss.or.kr/api/document.xml',
    );

  url.search =
    new URLSearchParams({
      crtfc_key:
        key,
      rcept_no:
        receiptNo,
    }).toString();

  const response =
    await fetch(
      url,
      {
        method:
          'GET',
        redirect:
          'error',
        cache:
          'no-store',
        signal:
          AbortSignal.timeout(
            REQUEST_TIMEOUT_MS,
          ),
      },
    );

  const buffer =
    Buffer.from(
      await response.arrayBuffer(),
    );

  if (
    response.ok &&
    isZip(buffer)
  ) {
    return {
      status:
        'DOCUMENT_ZIP_RECEIVED',
      httpStatus:
        response.status,
      providerStatus:
        null,
      buffer,
    };
  }

  const text =
    buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '');

  return {
    status:
      'DOCUMENT_SOURCE_UNAVAILABLE',
    httpStatus:
      response.status,
    providerStatus:
      extractProviderStatus(text),
    buffer:
      null,
  };
}

function parseViewDocCalls(html) {
  const pattern =
    /viewDoc\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;

  const rows = [];
  const seen = new Set();

  let match;

  while (
    (match = pattern.exec(html)) !==
    null
  ) {
    const row = {
      rcpNo:
        match[1],
      dcmNo:
        match[2],
      eleId:
        match[3],
      offset:
        match[4],
      length:
        match[5],
      dtd:
        match[6],
    };

    const key =
      [
        row.rcpNo,
        row.dcmNo,
        row.eleId,
        row.offset,
        row.length,
        row.dtd,
      ].join('|');

    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }

  return rows;
}

async function fetchDartViewerText(
  receiptNo,
) {
  const mainUrl =
    `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`;

  const mainResponse =
    await fetch(
      mainUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 AI-Stock-Lab/9.8.4.2',
          'Accept-Language':
            'ko-KR,ko;q=0.9,en;q=0.5',
        },
        redirect:
          'follow',
        cache:
          'no-store',
        signal:
          AbortSignal.timeout(
            REQUEST_TIMEOUT_MS,
          ),
      },
    );

  const mainHtml =
    await mainResponse.text();

  const calls =
    parseViewDocCalls(
      mainHtml,
    );

  if (
    !mainResponse.ok ||
    calls.length === 0
  ) {
    return {
      status:
        'DART_VIEWER_TREE_UNAVAILABLE',
      httpStatus:
        mainResponse.status,
      calls:
        [],
      text:
        '',
    };
  }

  const selected =
    calls.slice(0, 40);

  const texts = [];

  for (const call of selected) {
    const viewer =
      new URL(
        'https://dart.fss.or.kr/report/viewer.do',
      );

    viewer.search =
      new URLSearchParams({
        rcpNo:
          call.rcpNo,
        dcmNo:
          call.dcmNo,
        eleId:
          call.eleId,
        offset:
          call.offset,
        length:
          call.length,
        dtd:
          call.dtd,
      }).toString();

    const response =
      await fetch(
        viewer,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 AI-Stock-Lab/9.8.4.2',
            'Accept-Language':
              'ko-KR,ko;q=0.9,en;q=0.5',
          },
          redirect:
            'follow',
          cache:
            'no-store',
          signal:
            AbortSignal.timeout(
              REQUEST_TIMEOUT_MS,
            ),
        },
      );

    if (!response.ok) {
      continue;
    }

    const html =
      await response.text();

    const text =
      htmlToText(html);

    if (text) {
      texts.push(text);
    }

    await sleep(
      REQUEST_DELAY_MS,
    );
  }

  return {
    status:
      texts.length > 0
        ? 'DART_VIEWER_TEXT_RECEIVED'
        : 'DART_VIEWER_TEXT_EMPTY',
    httpStatus:
      mainResponse.status,
    calls:
      selected,
    text:
      texts.join('\n').replace(/\n{2,}/g, '\n').trim(),
  };
}

function extractCandidateDatesNearKeywords(
  plainText,
) {
  const text =
    String(plainText ?? '');

  const keywords = [
    '정정관련 공시서류제출일',
    '정정관련 공시서류 제출일',
    '정정관련공시서류제출일',
    '최초제출일',
    '최초 제출일',
  ];

  const out = [];

  for (const keyword of keywords) {
    let start = 0;

    for (;;) {
      const index =
        text.indexOf(
          keyword,
          start,
        );

      if (index < 0) {
        break;
      }

      const slice =
        text.slice(
          index,
          index + 700,
        );

      const patterns = [
        /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
        /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g,
        /\b(\d{8})\b/g,
      ];

      for (const pattern of patterns) {
        let match;

        while (
          (match = pattern.exec(slice)) !==
          null
        ) {
          let date;

          if (match.length === 2) {
            date =
              String(match[1]);
          } else {
            date =
              `${String(match[1]).padStart(4, '0')}${String(match[2]).padStart(2, '0')}${String(match[3]).padStart(2, '0')}`;
          }

          out.push({
            keyword,
            date,
            raw:
              match[0],
            distance:
              match.index,
          });
        }
      }

      start =
        index + keyword.length;
    }
  }

  return out;
}

function chooseReferenceDate({
  text,
  targetDate,
  compatiblePriorDates,
  oldExtractedDate,
}) {
  const extracted =
    extractCandidateDatesNearKeywords(
      text,
    );

  const valid =
    extracted.filter(
      (row) =>
        validDate8(row.date) &&
        dateLe(
          row.date,
          targetDate,
        ),
    );

  const priorSet =
    new Set(
      compatiblePriorDates,
    );

  const exactHistory =
    valid.filter(
      (row) =>
        priorSet.has(
          row.date,
        ),
    );

  const exactDates =
    [
      ...new Set(
        exactHistory.map(
          (row) =>
            row.date,
        ),
      ),
    ];

  if (
    exactDates.length === 1
  ) {
    return {
      status:
        'REFERENCE_DATE_CONFIRMED_FROM_DOCUMENT',
      date:
        exactDates[0],
      evidence:
        exactHistory,
    };
  }

  if (
    valid.length > 0
  ) {
    const nearest =
      valid
        .slice()
        .sort(
          (a, b) =>
            a.distance - b.distance,
        )[0];

    return {
      status:
        'REFERENCE_DATE_FOUND_BUT_NOT_IN_COMPATIBLE_HISTORY',
      date:
        nearest.date,
      evidence:
        valid,
    };
  }

  /*
   * Repair a clearly malformed old parse only if exactly one compatible
   * prior filing shares MMDD. Example observed: 26260810 -> 20260810.
   */
  const old =
    compactDate(
      oldExtractedDate,
    );

  if (/^\d{8}$/.test(old)) {
    const mmdd =
      old.slice(4);

    const mmddMatches =
      compatiblePriorDates.filter(
        (date) =>
          date.endsWith(
            mmdd,
          ),
      );

    if (
      mmddMatches.length ===
      1
    ) {
      return {
        status:
          'REFERENCE_DATE_REPAIRED_BY_UNIQUE_MMDD',
        date:
          mmddMatches[0],
        evidence: [{
          malformedDate:
            old,
          repairedDate:
            mmddMatches[0],
        }],
      };
    }
  }

  return {
    status:
      'REFERENCE_DATE_UNRESOLVED',
    date:
      null,
    evidence:
      extracted,
  };
}

const STOP_TOKENS =
  new Set([
    '주요사항보고서',
    '회사합병결정',
    '현금',
    '현물배당결정',
    '기재정정',
    '첨부정정',
    '정정',
    '공시',
    '공시서류',
    '제출일',
    '정정관련',
    '사항',
    '보고서',
    '회사',
    '결정',
    '합병',
    '배당',
    '주식회사',
    '해당',
    '관련',
    '내용',
    '변경',
    '추가',
    '기준',
    '예정',
  ]);

function tokenSet(text) {
  const tokens =
    String(text ?? '')
      .toLowerCase()
      .match(
        /[가-힣]{2,}|[a-z][a-z0-9._-]{2,}|\d{4,}/g,
      ) ??
    [];

  return new Set(
    tokens.filter(
      (token) =>
        !STOP_TOKENS.has(
          token,
        ),
    ),
  );
}

function weightedSimilarity(
  targetText,
  candidates,
) {
  const targetTokens =
    tokenSet(
      targetText,
    );

  const candidateSets =
    candidates.map(
      (row) => ({
        receiptNo:
          row.receiptNo,
        tokens:
          tokenSet(
            row.text,
          ),
      }),
    );

  const allSets =
    [
      targetTokens,
      ...candidateSets.map(
        (row) =>
          row.tokens,
      ),
    ];

  const df =
    new Map();

  for (const set of allSets) {
    for (const token of set) {
      df.set(
        token,
        (df.get(token) ?? 0) + 1,
      );
    }
  }

  const total =
    allSets.length;

  function weight(token) {
    return (
      Math.log(
        (total + 1) /
          ((df.get(token) ?? 0) + 1),
      ) + 1
    );
  }

  const scores =
    candidateSets.map(
      (candidate) => {
        let intersection = 0;
        let union = 0;

        const unionTokens =
          new Set([
            ...targetTokens,
            ...candidate.tokens,
          ]);

        for (const token of unionTokens) {
          const w =
            weight(token);

          union += w;

          if (
            targetTokens.has(token) &&
            candidate.tokens.has(token)
          ) {
            intersection += w;
          }
        }

        return {
          receiptNo:
            candidate.receiptNo,
          score:
            union > 0
              ? intersection / union
              : 0,
          sharedTokens:
            [
              ...targetTokens,
            ].filter(
              (token) =>
                candidate.tokens.has(
                  token,
                ),
            ).length,
        };
      },
    )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  return {
    targetTokenCount:
      targetTokens.size,
    scores,
  };
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error(
      'NODE_18_OR_NEWER_REQUIRED',
    );
  }

  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const remainingFile =
    path.resolve(
      args.remaining ??
      path.join(
        root,
        'logs',
        'v9804-1-remaining-7.json',
      ),
    );

  const chainFile =
    path.resolve(
      args.chain ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4.json',
      ),
    );

  const precisionFile =
    path.resolve(
      args.precision ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4-1.json',
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
        'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
      ),
    );

  const cacheDir =
    path.join(
      root,
      'logs',
      'v9-8-4-2-evidence',
    );

  for (const file of [
    remainingFile,
    chainFile,
    precisionFile,
    evidenceFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const remaining =
    readJson(
      remainingFile,
    );

  const chain =
    readJson(
      chainFile,
    );

  const precision =
    readJson(
      precisionFile,
    );

  const evidence =
    readJson(
      evidenceFile,
    );

  if (
    chain.version !==
    CHAIN_VERSION
  ) {
    throw new Error(
      'V9_8_4_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    precision.version !==
    PRECISION_VERSION
  ) {
    throw new Error(
      'V9_8_4_1_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    evidence.version !==
    EVIDENCE_VERSION
  ) {
    throw new Error(
      'V9_8_3_1_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(
      remaining.rows,
    )
  ) {
    throw new Error(
      'REMAINING_ROWS_MISSING',
    );
  }

  const chainByReceipt =
    new Map(
      chain.resolutions.map(
        (row) => [
          row.receiptNo,
          row,
        ],
      ),
    );

  const evidenceByReceipt =
    new Map(
      evidence.results.map(
        (row) => [
          row.receiptNo,
          row,
        ],
      ),
    );

  const dartKey =
    requireDartKey(
      root,
    );

  let networkRequests = 0;
  let reusedLocalDocuments = 0;
  let viewerFallbacks = 0;

  const textMemo =
    new Map();

  async function getReceiptText(
    receiptNo,
  ) {
    if (
      textMemo.has(
        receiptNo,
      )
    ) {
      return textMemo.get(
        receiptNo,
      );
    }

    const local =
      evidenceByReceipt.get(
        receiptNo,
      );

    const localFile =
      local?.document?.file;

    if (localFile) {
      const absolute =
        path.join(
          root,
          localFile,
        );

      if (
        fs.existsSync(
          absolute,
        )
      ) {
        const buffer =
          fs.readFileSync(
            absolute,
          );

        if (isZip(buffer)) {
          const result = {
            status:
              'TEXT_READY',
            source:
              'V9_8_3_LOCAL_DOCUMENT_XML',
            text:
              zipToPlainText(
                buffer,
              ),
          };

          textMemo.set(
            receiptNo,
            result,
          );

          reusedLocalDocuments += 1;

          return result;
        }
      }
    }

    const zipCache =
      path.join(
        cacheDir,
        'document-xml',
        `${receiptNo}.zip`,
      );

    if (
      !args.refresh &&
      fs.existsSync(
        zipCache,
      )
    ) {
      const buffer =
        fs.readFileSync(
          zipCache,
        );

      if (isZip(buffer)) {
        const result = {
          status:
            'TEXT_READY',
          source:
            'V9_8_4_2_DOCUMENT_XML_CACHE',
          text:
            zipToPlainText(
              buffer,
            ),
        };

        textMemo.set(
          receiptNo,
          result,
        );

        reusedLocalDocuments += 1;

        return result;
      }
    }

    const fetched =
      await fetchDocumentXml({
        key:
          dartKey,
        receiptNo,
      });

    networkRequests += 1;

    if (
      fetched.status ===
        'DOCUMENT_ZIP_RECEIVED'
    ) {
      atomicSaveBuffer(
        zipCache,
        fetched.buffer,
      );

      const result = {
        status:
          'TEXT_READY',
        source:
          'OPENDART_DOCUMENT_XML',
        text:
          zipToPlainText(
            fetched.buffer,
          ),
      };

      textMemo.set(
        receiptNo,
        result,
      );

      await sleep(
        REQUEST_DELAY_MS,
      );

      return result;
    }

    await sleep(
      REQUEST_DELAY_MS,
    );

    const viewerCache =
      path.join(
        cacheDir,
        'viewer-text',
        `${receiptNo}.txt`,
      );

    if (
      !args.refresh &&
      fs.existsSync(
        viewerCache,
      )
    ) {
      const text =
        fs.readFileSync(
          viewerCache,
          'utf8',
        );

      if (text.trim()) {
        const result = {
          status:
            'TEXT_READY',
          source:
            'DART_VIEWER_CACHE',
          text,
          documentXmlProviderStatus:
            fetched.providerStatus,
        };

        textMemo.set(
          receiptNo,
          result,
        );

        viewerFallbacks += 1;

        return result;
      }
    }

    const viewer =
      await fetchDartViewerText(
        receiptNo,
      );

    networkRequests +=
      1 +
      viewer.calls.length;

    if (
      viewer.status ===
      'DART_VIEWER_TEXT_RECEIVED'
    ) {
      atomicSaveText(
        viewerCache,
        viewer.text,
      );

      const result = {
        status:
          'TEXT_READY',
        source:
          'DART_PUBLIC_VIEWER_FALLBACK',
        text:
          viewer.text,
        documentXmlProviderStatus:
          fetched.providerStatus,
        viewerNodeCount:
          viewer.calls.length,
      };

      textMemo.set(
        receiptNo,
        result,
      );

      viewerFallbacks += 1;

      return result;
    }

    const result = {
      status:
        'TEXT_UNAVAILABLE',
      source:
        'NONE',
      text:
        '',
      documentXmlProviderStatus:
        fetched.providerStatus,
      viewerStatus:
        viewer.status,
    };

    textMemo.set(
      receiptNo,
      result,
    );

    return result;
  }

  function fullHistoryFor(
    receiptNo,
  ) {
    const row =
      chainByReceipt.get(
        receiptNo,
      );

    return Array.isArray(
      row?.relevantHistory,
    )
      ? row.relevantHistory
      : [];
  }

  function compatiblePriorRows(
    target,
    history,
  ) {
    return history.filter(
      (row) =>
        row.actionType ===
          target.actionType &&
        Boolean(row.otherEntity) ===
          (
            target.gate ===
              'OTHER_ENTITY_SCOPE_REVIEW' ||
            Boolean(target.otherEntity)
          ) &&
        (
          row.receiptDate <
            target.receiptDate ||
          (
            row.receiptDate ===
              target.receiptDate &&
            row.receiptNo <
              target.receiptNo
          )
        ),
    );
  }

  const finalRows = [];

  for (
    let index = 0;
    index < remaining.rows.length;
    index += 1
  ) {
    const target =
      remaining.rows[
        index
      ];

    const history =
      fullHistoryFor(
        target.receiptNo,
      );

    const priors =
      compatiblePriorRows(
        target,
        history,
      );

    const targetText =
      await getReceiptText(
        target.receiptNo,
      );

    const oldReference =
      target.refinedEvidence
        ?.find(
          (row) =>
            row.type ===
            'CORRECTION_REFERENCE_DATE',
        )
        ?.referencedDate ??
      null;

    const reference =
      chooseReferenceDate({
        text:
          targetText.text,
        targetDate:
          target.receiptDate,
        compatiblePriorDates:
          [
            ...new Set(
              priors.map(
                (row) =>
                  row.receiptDate,
              ),
            ),
          ],
        oldExtractedDate:
          oldReference,
      });

    let candidateRows = [];

    if (
      reference.date
    ) {
      candidateRows =
        priors.filter(
          (row) =>
            row.receiptDate ===
            reference.date,
        );
    }

    if (
      candidateRows.length ===
        0
    ) {
      const plausible =
        new Set(
          target.plausibleRoots ??
          [],
        );

      candidateRows =
        priors.filter(
          (row) =>
            plausible.has(
              row.receiptNo,
            ),
        );
    }

    if (
      candidateRows.length ===
        0
    ) {
      candidateRows =
        priors.filter(
          (row) =>
            !row.correction &&
            !row.withdrawal,
        );
    }

    let resolution = null;

    if (
      candidateRows.length ===
      1 &&
      reference.date &&
      candidateRows[0]
        .receiptDate ===
        reference.date
    ) {
      resolution = {
        status:
          'RESOLVED',
        reason:
          reference.status ===
            'REFERENCE_DATE_REPAIRED_BY_UNIQUE_MMDD'
            ? 'REPAIRED_REFERENCE_DATE_UNIQUE_ROOT'
            : 'VIEWER_OR_DOCUMENT_REFERENCE_DATE_UNIQUE_ROOT',
        rootReceiptNo:
          candidateRows[0]
            .receiptNo,
        confidence:
          reference.status ===
            'REFERENCE_DATE_REPAIRED_BY_UNIQUE_MMDD'
            ? 'MEDIUM'
            : 'HIGH',
        evidence: {
          reference,
          targetTextSource:
            targetText.source,
        },
      };
    }

    let similarity = null;

    if (
      !resolution &&
      targetText.status ===
        'TEXT_READY' &&
      candidateRows.length >
        0
    ) {
      const candidateTexts = [];

      for (
        const candidate of
        candidateRows
      ) {
        const candidateText =
          await getReceiptText(
            candidate.receiptNo,
          );

        candidateTexts.push({
          receiptNo:
            candidate.receiptNo,
          status:
            candidateText.status,
          source:
            candidateText.source,
          text:
            candidateText.text,
        });
      }

      const ready =
        candidateTexts.filter(
          (row) =>
            row.status ===
              'TEXT_READY' &&
            row.text,
        );

      if (
        ready.length ===
        candidateRows.length
      ) {
        similarity =
          weightedSimilarity(
            targetText.text,
            ready,
          );

        const best =
          similarity.scores[0] ??
          null;

        const second =
          similarity.scores[1] ??
          null;

        const margin =
          best
            ? best.score -
              (second?.score ?? 0)
            : 0;

        if (
          best &&
          similarity
            .targetTokenCount >=
            SIMILARITY_MIN_TARGET_TOKENS &&
          best.score >=
            SIMILARITY_MIN_SCORE &&
          margin >=
            SIMILARITY_MIN_MARGIN
        ) {
          resolution = {
            status:
              'RESOLVED',
            reason:
              'UNIQUE_HIGH_MARGIN_DOCUMENT_SIMILARITY',
            rootReceiptNo:
              best.receiptNo,
            confidence:
              'MEDIUM',
            evidence: {
              reference,
              targetTextSource:
                targetText.source,
              targetTokenCount:
                similarity.targetTokenCount,
              bestScore:
                best.score,
              secondScore:
                second?.score ??
                null,
              margin,
              scores:
                similarity.scores,
            },
          };
        }
      }
    }

    if (!resolution) {
      resolution = {
        status:
          'AMBIGUOUS_QUARANTINED',
        reason:
          targetText.status !==
            'TEXT_READY'
            ? 'TARGET_PRIMARY_AND_VIEWER_TEXT_UNAVAILABLE'
            : candidateRows.length ===
                0
              ? 'NO_COMPATIBLE_ROOT_CANDIDATE'
              : similarity
                ? 'DOCUMENT_SIMILARITY_NOT_DECISIVE'
                : 'INSUFFICIENT_FIRST_PARTY_EVIDENCE',
        rootReceiptNo:
          null,
        confidence:
          'NONE',
        evidence: {
          reference,
          targetTextSource:
            targetText.source,
          candidateReceiptNos:
            candidateRows.map(
              (row) =>
                row.receiptNo,
            ),
          similarity,
        },
      };
    }

    finalRows.push({
      receiptNo:
        target.receiptNo,
      receiptDate:
        target.receiptDate,
      corpCode:
        target.corpCode,
      stockCode:
        target.stockCode,
      actionType:
        target.actionType,
      gate:
        target.gate,
      correction:
        target.correction,
      withdrawal:
        target.withdrawal,
      priorReason:
        target.refinedResolutionReason,
      resolutionStatus:
        resolution.status,
      resolutionReason:
        resolution.reason,
      rootReceiptNo:
        resolution.rootReceiptNo,
      confidence:
        resolution.confidence,
      targetTextSource:
        targetText.source,
      candidateReceiptNos:
        candidateRows.map(
          (row) =>
            row.receiptNo,
        ),
      evidence:
        resolution.evidence,
    });

    console.log(
      [
        'FINAL_PASS',
        `${index + 1}/${remaining.rows.length}`,
        `receipt=${target.receiptNo}`,
        `status=${resolution.status}`,
        `root=${resolution.rootReceiptNo ?? '-'}`,
        `reason=${resolution.reason}`,
        `source=${targetText.source}`,
        `requests=${networkRequests}`,
      ].join(' '),
    );
  }

  const resolved =
    finalRows.filter(
      (row) =>
        row.resolutionStatus ===
        'RESOLVED',
    );

  const quarantined =
    finalRows.filter(
      (row) =>
        row.resolutionStatus !==
        'RESOLVED',
    );

  const invalidResolved =
    resolved.filter(
      (row) =>
        !row.rootReceiptNo ||
        row.rootReceiptNo ===
          row.receiptNo ||
        !/^\d{14}$/.test(
          row.rootReceiptNo,
        ),
    );

  const priorResolved =
    Number(
      chain.counts?.resolved ??
      0,
    ) +
    Number(
      precision.counts?.refinedResolved ??
      0,
    );

  const finalResolvedCount =
    priorResolved +
    resolved.length;

  const expectedTargets =
    Number(
      chain.counts?.chainTargets ??
      0,
    );

  const status =
    invalidResolved.length >
      0
      ? 'FINAL_PRECISION_CHAIN_RESOLUTION_INVALID'
      : quarantined.length ===
          0
        ? 'FINAL_PRECISION_CHAIN_RESOLUTION_COMPLETE'
        : 'FINAL_PRECISION_CHAIN_RESOLUTION_QUARANTINE_REQUIRED';

  const report = {
    version:
      VERSION,

    status,

    source: {
      remainingFile:
        path.relative(
          root,
          remainingFile,
        ).replaceAll('\\', '/'),
      chainFile:
        path.relative(
          root,
          chainFile,
        ).replaceAll('\\', '/'),
      precisionFile:
        path.relative(
          root,
          precisionFile,
        ).replaceAll('\\', '/'),
      evidenceFile:
        path.relative(
          root,
          evidenceFile,
        ).replaceAll('\\', '/'),
      inputFingerprint:
        sha256(
          JSON.stringify(
            remaining.rows,
          ),
        ),
    },

    counts: {
      inputRemaining:
        finalRows.length,
      newlyResolved:
        resolved.length,
      quarantined:
        quarantined.length,
      invalidResolved:
        invalidResolved.length,
      priorResolved,
      finalResolvedCount,
      expectedChainTargets:
        expectedTargets,
      finalUnresolvedCount:
        Math.max(
          0,
          expectedTargets -
            finalResolvedCount,
        ),
    },

    resolutionReasonCounts:
      countBy(
        finalRows,
        (row) =>
          row.resolutionReason,
      ),

    confidenceCounts:
      countBy(
        resolved,
        (row) =>
          row.confidence,
      ),

    safety: {
      networkRequests,
      reusedLocalDocuments,
      viewerFallbacks,
      databaseWrites:
        0,
      productionApplied:
        false,
      canonicalEventsCreated:
        0,
      providerEventIdsPersisted:
        0,
      coverageWindowAdvanced:
        false,
      receiptOrderPairingUsed:
        false,
      concurrentEventForcedMatching:
        false,
      similarityThreshold:
        SIMILARITY_MIN_SCORE,
      similarityMarginThreshold:
        SIMILARITY_MIN_MARGIN,
      minimumTargetTokens:
        SIMILARITY_MIN_TARGET_TOKENS,
    },

    policy: {
      documentXml:
        'PRIMARY_FIRST_PARTY_EVIDENCE',
      provider014:
        'DART_PUBLIC_VIEWER_FALLBACK',
      malformedReferenceDate:
        'REPAIR_ONLY_IF_UNIQUE_COMPATIBLE_MMDD_MATCH',
      multipleSameDayRoots:
        'RESOLVE_ONLY_WITH_UNIQUE_REFERENCE_OR_HIGH_MARGIN_DOCUMENT_SIMILARITY',
      unresolved:
        'QUARANTINE_NO_PROVIDER_EVENT_ID_PERSISTENCE',
    },

    resolved,
    quarantineQueue:
      quarantined,
    invalidResolved,
    rows:
      finalRows,

    outputFile:
      path.relative(
        root,
        outputFile,
      ).replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          VERSION,
        input:
          report.source.inputFingerprint,
        rows:
          finalRows.map(
            (row) => [
              row.receiptNo,
              row.resolutionStatus,
              row.rootReceiptNo,
              row.resolutionReason,
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
        resolutionReasonCounts:
          report.resolutionReasonCounts,
        confidenceCounts:
          report.confidenceCounts,
        networkRequests,
        reusedLocalDocuments,
        viewerFallbacks,
        databaseWrites:
          0,
        productionApplied:
          false,
        canonicalEventsCreated:
          0,
        providerEventIdsPersisted:
          0,
        coverageWindowAdvanced:
          false,
        receiptOrderPairingUsed:
          false,
        concurrentEventForcedMatching:
          false,
        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    report.status ===
    'FINAL_PRECISION_CHAIN_RESOLUTION_INVALID'
  ) {
    process.exitCode = 2;
  }
}


async function runCore7LegacyViewerProbe() {
  const root = path.resolve(__dirname, '..');
  const receiptNos = [
    '20260422900422',
    '20260518900970',
    '20260804900492',

    '20260814002642',
    '20260814002685',
    '20260814002795',
    '20260814002868',

    '20260818000018',
    '20260818000019',
    '20260818000020',
    '20260818000021',

    '20260826900706',
    '20260826900708',
  ];

  const cacheDir = path.join(
    root,
    'logs',
    'v9-8-4-2-evidence',
    'viewer-text',
  );

  const reportFile = path.join(
    root,
    'logs',
    'v9804-2-core7-legacy-viewer-probe.json',
  );

  fs.mkdirSync(cacheDir, {
    recursive: true,
  });

  const rows = [];
  let networkRequests = 0;

  for (let index = 0; index < receiptNos.length; index += 1) {
    const receiptNo = receiptNos[index];

    const result =
      await fetchDartViewerText(
        receiptNo,
      );

    const requestCount =
      1 +
      (Array.isArray(result.calls)
        ? result.calls.length
        : 0);

    networkRequests += requestCount;

    const cacheFile = path.join(
      cacheDir,
      receiptNo + '.txt',
    );

    if (
      result.status ===
        'DART_VIEWER_TEXT_RECEIVED' &&
      typeof result.text === 'string' &&
      result.text.trim()
    ) {
      fs.writeFileSync(
        cacheFile,
        result.text,
        'utf8',
      );
    }

    const row = {
      receiptNo,
      status:
        result.status ?? null,
      httpStatus:
        result.httpStatus ?? null,
      viewerNodeCount:
        Array.isArray(result.calls)
          ? result.calls.length
          : 0,
      charCount:
        typeof result.text === 'string'
          ? result.text.length
          : 0,
      cacheWritten:
        fs.existsSync(cacheFile),
      networkRequests:
        requestCount,
    };

    rows.push(row);

    console.log(
      [
        'LEGACY_VIEWER_PROBE',
        (index + 1) + '/' + receiptNos.length,
        'receipt=' + receiptNo,
        'status=' + row.status,
        'http=' + (row.httpStatus ?? '-'),
        'nodes=' + row.viewerNodeCount,
        'chars=' + row.charCount,
        'cache=' + row.cacheWritten,
        'requests=' + networkRequests,
      ].join(' '),
    );

    if (
      typeof REQUEST_DELAY_MS === 'number' &&
      REQUEST_DELAY_MS > 0 &&
      index + 1 < receiptNos.length
    ) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const statusCounts =
    rows.reduce(
      (acc, row) => {
        const key =
          row.status ?? 'UNKNOWN';

        acc[key] =
          (acc[key] ?? 0) + 1;

        return acc;
      },
      {},
    );

  const report = {
    version:
      'V9_8_4_2_CORE7_LEGACY_VIEWER_PROBE',
    status:
      'CORE7_LEGACY_VIEWER_PROBE_COMPLETE',
    sourceImplementation:
      'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER.fetchDartViewerText',
    targetReceipts:
      receiptNos.length,
    textReceived:
      rows.filter(
        (row) =>
          row.status ===
          'DART_VIEWER_TEXT_RECEIVED',
      ).length,
    cacheWritten:
      rows.filter(
        (row) =>
          row.cacheWritten,
      ).length,
    networkRequests,
    databaseWrites: 0,
    productionApplied: false,
    statusCounts,
    rows,
  };

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
        targetReceipts:
          report.targetReceipts,
        textReceived:
          report.textReceived,
        cacheWritten:
          report.cacheWritten,
        networkRequests:
          report.networkRequests,
        databaseWrites: 0,
        productionApplied: false,
        statusCounts:
          report.statusCounts,
        outputFile:
          path
            .relative(
              root,
              reportFile,
            )
            .replaceAll('\\', '/'),
      },
      null,
      2,
    ),
  );
}

runCore7LegacyViewerProbe().catch(
  (error) => {
    console.error(
      '[CORE7 LEGACY VIEWER PROBE ERROR]',
      error?.stack ?? error,
    );
    process.exitCode = 1;
  },
);

