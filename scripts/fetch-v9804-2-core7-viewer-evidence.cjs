#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.2 CORE7 DART viewer evidence fetcher
 *
 * Purpose:
 * - Fetch first-party DART public viewer text for the 7 hard remaining targets
 *   and their plausible roots.
 * - Cache viewer text locally.
 * - Extract semantic snippets for later chain matching.
 *
 * Safety:
 * - network READ only
 * - no Supabase / DB writes
 * - no production writes
 * - does not modify V9.8.4.2 output
 *
 * Input:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *
 * Cache:
 *   logs/v9-8-4-2-evidence/viewer-text/<receiptNo>.txt
 *
 * Output:
 *   logs/v9804-2-core7-viewer-evidence.json
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const INPUT = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

const CACHE_DIR = path.join(
  root,
  'logs',
  'v9-8-4-2-evidence',
  'viewer-text',
);

const OUTPUT = path.join(
  root,
  'logs',
  'v9804-2-core7-viewer-evidence.json',
);

const TARGET_STOCKS = new Set([
  '084110', // 휴온스글로벌
  '017960', // 한국카본
]);

const REQUEST_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(text) {
  return String(text ?? '')
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
    String(html ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(?:p|tr|td|th|div|table|section|title|li|h[1-6])>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

function parseViewerCalls(mainHtml, receiptNo) {
  const calls = [];
  const seen = new Set();

  /*
   * DART pages have used several variants over time:
   *   viewDoc('rcpNo','dcmNo','eleId','offset','length','dtd')
   *   viewDoc(rcpNo, dcmNo, eleId, offset, length, dtd)
   *
   * We primarily parse quoted arguments because those are stable on
   * current public pages, then use a broader fallback.
   */
  const patterns = [
    /viewDoc\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g,
    /viewDoc\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*['"]([^'"]*)['"]\s*\)/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(mainHtml)) !== null) {
      const call = {
        rcpNo: match[1] || receiptNo,
        dcmNo: match[2],
        eleId: match[3],
        offset: match[4],
        length: match[5],
        dtd: match[6] ?? '',
      };

      const key = [
        call.rcpNo,
        call.dcmNo,
        call.eleId,
        call.offset,
        call.length,
        call.dtd,
      ].join('|');

      if (!seen.has(key)) {
        seen.add(key);
        calls.push(call);
      }
    }
  }

  return calls;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 AI-Stock-Lab/9.8.4.2-core7',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

async function fetchDartViewerText(receiptNo) {
  const mainUrl =
    `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`;

  const main = await fetchText(mainUrl);
  let networkRequests = 1;

  if (!main.ok) {
    return {
      status: 'DART_MAIN_HTTP_ERROR',
      httpStatus: main.status,
      calls: [],
      text: '',
      networkRequests,
    };
  }

  const calls = parseViewerCalls(main.text, receiptNo);

  if (calls.length === 0) {
    return {
      status: 'DART_VIEWER_TREE_UNAVAILABLE',
      httpStatus: main.status,
      calls: [],
      text: '',
      networkRequests,
    };
  }

  /*
   * Fetch all unique nodes. For corporate-action filings the tree is small.
   * This is intentionally evidence collection only; no resolution is forced.
   */
  const texts = [];
  const callResults = [];

  for (const call of calls) {
    const viewer = new URL(
      'https://dart.fss.or.kr/report/viewer.do',
    );

    viewer.search = new URLSearchParams({
      rcpNo: call.rcpNo,
      dcmNo: call.dcmNo,
      eleId: call.eleId,
      offset: call.offset,
      length: call.length,
      dtd: call.dtd,
    }).toString();

    await sleep(REQUEST_DELAY_MS);

    const result = await fetchText(viewer);
    networkRequests += 1;

    const plain = result.ok
      ? htmlToText(result.text)
      : '';

    callResults.push({
      ...call,
      httpStatus: result.status,
      charCount: plain.length,
    });

    if (plain) {
      texts.push(plain);
    }
  }

  return {
    status:
      texts.length > 0
        ? 'DART_VIEWER_TEXT_RECEIVED'
        : 'DART_VIEWER_TEXT_EMPTY',
    httpStatus: main.status,
    calls: callResults,
    text: texts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    networkRequests,
  };
}

const KEYWORDS = [
  '정정관련 공시서류제출일',
  '정정관련 공시서류 제출일',
  '최초제출일',
  '최초 제출일',
  '합병상대회사',
  '합병 상대회사',
  '합병회사',
  '피합병회사',
  '존속회사',
  '소멸회사',
  '합병방법',
  '합병 방법',
  '합병비율',
  '합병 비율',
  '합병기일',
  '합병 기일',
  '합병계약일',
  '합병 계약일',
  '합병목적',
  '합병 목적',
  '자회사',
  '종속회사',
  '회사명',
  '상호',
  '철회',
  '임시주주총회',
];

function snippetAround(text, needle, radius = 220) {
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const out = [];
  let from = 0;

  while (out.length < 5) {
    const index = lower.indexOf(target, from);
    if (index < 0) break;

    const left = Math.max(0, index - radius);
    const right = Math.min(
      text.length,
      index + needle.length + radius,
    );

    out.push(
      text
        .slice(left, right)
        .replace(/\s+/g, ' ')
        .trim(),
    );

    from = index + needle.length;
  }

  return [...new Set(out)];
}

function semanticEvidence(text) {
  const keywordHits = [];

  for (const keyword of KEYWORDS) {
    const snippets = snippetAround(text, keyword);
    if (snippets.length > 0) {
      keywordHits.push({
        keyword,
        snippets,
      });
    }
  }

  const dateMatches =
    text.match(
      /20\d{2}[.\-\/년]\s*(?:0?[1-9]|1[0-2])[.\-\/월]\s*(?:0?[1-9]|[12]\d|3[01])(?:일)?/g,
    ) ?? [];

  const ratios =
    text.match(
      /\b\d+(?:\.\d+)?\s*(?::|대)\s*\d+(?:\.\d+)?\b/g,
    ) ?? [];

  return {
    keywordHits,
    dateLikeValues: [...new Set(dateMatches)].slice(0, 80),
    ratioLikeValues: [...new Set(ratios)].slice(0, 40),
  };
}

async function main() {
  const report = JSON.parse(
    fs.readFileSync(INPUT, 'utf8'),
  );

  const rows = (report.resolutions ?? []).filter(
    (row) =>
      row.resolutionStatus === 'AMBIGUOUS' &&
      TARGET_STOCKS.has(String(row.stockCode)),
  );

  const receiptNos = new Set();

  for (const row of rows) {
    receiptNos.add(String(row.receiptNo));
    for (const rootReceiptNo of row.plausibleRoots ?? []) {
      receiptNos.add(String(rootReceiptNo));
    }
  }

  fs.mkdirSync(CACHE_DIR, {
    recursive: true,
  });

  const documents = {};
  let networkRequests = 0;
  let cacheHits = 0;

  for (const receiptNo of [...receiptNos].sort()) {
    const cacheFile = path.join(
      CACHE_DIR,
      `${receiptNo}.txt`,
    );

    let text = '';
    let source = null;
    let fetchStatus = null;
    let calls = [];

    if (fs.existsSync(cacheFile)) {
      text = fs.readFileSync(
        cacheFile,
        'utf8',
      ).trim();

      if (text) {
        source = 'DART_VIEWER_CACHE';
        fetchStatus = 'CACHE_HIT';
        cacheHits += 1;
      }
    }

    if (!text) {
      const fetched =
        await fetchDartViewerText(
          receiptNo,
        );

      networkRequests +=
        fetched.networkRequests;

      fetchStatus = fetched.status;
      calls = fetched.calls;

      if (fetched.text) {
        text = fetched.text;
        source = 'DART_PUBLIC_VIEWER';

        const temp =
          `${cacheFile}.tmp-${process.pid}`;

        fs.writeFileSync(
          temp,
          text,
          'utf8',
        );

        fs.renameSync(
          temp,
          cacheFile,
        );
      }
    }

    documents[receiptNo] = {
      receiptNo,
      source:
        source ??
        'VIEWER_TEXT_UNAVAILABLE',
      fetchStatus,
      charCount:
        text.length,
      viewerNodeCount:
        calls.length,
      evidence:
        semanticEvidence(
          text,
        ),
    };

    console.log(
      [
        'VIEWER_EVIDENCE',
        `receipt=${receiptNo}`,
        `source=${documents[receiptNo].source}`,
        `chars=${documents[receiptNo].charCount}`,
        `keywords=${documents[receiptNo].evidence.keywordHits.length}`,
        `requests=${networkRequests}`,
      ].join(' '),
    );
  }

  const outputRows =
    rows.map((row) => ({
      receiptNo:
        row.receiptNo,
      receiptDate:
        row.receiptDate,
      stockCode:
        row.stockCode,
      corpCode:
        row.corpCode,
      actionType:
        row.actionType,
      gate:
        row.gate,
      reportName:
        row.targetHistoryRow
          ?.reportName ??
        row.reportName ??
        null,
      correction:
        row.correction,
      withdrawal:
        row.withdrawal,
      otherEntity:
        row.otherEntity,
      plausibleRoots:
        row.plausibleRoots ?? [],
      targetDocument:
        documents[String(
          row.receiptNo,
        )],
      candidateDocuments:
        (row.plausibleRoots ?? [])
          .map(
            (receiptNo) =>
              documents[
                String(receiptNo)
              ],
          ),
    }));

  const output = {
    status:
      'CORE7_DART_VIEWER_EVIDENCE_COMPLETE',
    version:
      'V9_8_4_2_CORE7_DART_VIEWER_EVIDENCE',
    sourceVersion:
      report.version ?? null,
    targetRows:
      outputRows.length,
    uniqueReceipts:
      receiptNos.size,
    cacheHits,
    networkRequests,
    databaseWrites: 0,
    productionApplied: false,
    outputRows,
  };

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      output,
      null,
      2,
    ),
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          output.status,
        targetRows:
          output.targetRows,
        uniqueReceipts:
          output.uniqueReceipts,
        cacheHits:
          output.cacheHits,
        networkRequests:
          output.networkRequests,
        databaseWrites: 0,
        productionApplied: false,
        outputFile:
          path.relative(
            root,
            OUTPUT,
          ).replaceAll('\\', '/'),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    '[CORE7 VIEWER EVIDENCE ERROR]',
    error?.stack ?? error,
  );
  process.exitCode = 1;
});
