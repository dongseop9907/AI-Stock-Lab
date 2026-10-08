#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.4.1 - 043910 DART public-viewer first-party evidence probe
 *
 * READ ONLY.
 * DART public viewer network only.
 * DB reads/writes: 0.
 * No canonical assignment.
 * No factor mutation.
 *
 * Target correction:
 *   20261006000033 / 043910 / MERGER / [첨부정정]
 *
 * Prior carry-forward candidate:
 *   20261002000418 / 043910 / MERGER
 *
 * Evidence policy inherited from final V9.8.4.x precision work:
 * - explicit viewer/document reference to unique prior date/receipt > similarity
 * - similarity is supporting evidence only
 * - similarity threshold: 0.62
 * - minimum target tokens: 35
 * - never pair by receipt order
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_4_1_043910_DART_VIEWER_FIRST_PARTY_EVIDENCE_PROBE';

const TARGET = Object.freeze({
  corpCode: '00418379',
  stockCode: '043910',
  actionType: 'MERGER',
  correctionReceiptNo: '20261006000033',
  correctionDate: '20261006',
  priorReceiptNo: '20261002000418',
  priorDate: '20261002',
});

const REQUEST_TIMEOUT_MS = 45000;
const REQUEST_DELAY_MS = 250;
const SIMILARITY_MIN_SCORE = 0.62;
const SIMILARITY_MIN_TARGET_TOKENS = 35;

const STOP_TOKENS = new Set([
  '주요사항보고서',
  '회사합병결정',
  '기재정정',
  '첨부정정',
  '정정',
  '공시',
  '공시서류',
  '제출일',
  '회사',
  '합병',
  '결정',
  '사항',
  '보고서',
  '기준',
  '예정',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function atomicSaveText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, value, 'utf8');
  fs.renameSync(tmp, file);
}

function decodeHtmlEntities(text) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return String(text ?? '')
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-z]+);/gi, (m, name) =>
      Object.prototype.hasOwnProperty.call(named, name.toLowerCase())
        ? named[name.toLowerCase()]
        : m,
    );
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function tokenSet(text) {
  const tokens =
    String(text ?? '')
      .toLowerCase()
      .match(/[가-힣]{2,}|[a-z][a-z0-9._-]{2,}|\d{4,}/g) ?? [];

  return new Set(
    tokens.filter((token) => !STOP_TOKENS.has(token)),
  );
}

function setIntersectionCount(a, b) {
  let count = 0;
  for (const x of a) {
    if (b.has(x)) count += 1;
  }
  return count;
}

function similarity(targetText, candidateText) {
  const a = tokenSet(targetText);
  const b = tokenSet(candidateText);

  const intersection = setIntersectionCount(a, b);
  const union = new Set([...a, ...b]).size;

  const jaccard =
    union > 0 ? intersection / union : 0;

  const targetContainment =
    a.size > 0 ? intersection / a.size : 0;

  const candidateContainment =
    b.size > 0 ? intersection / b.size : 0;

  const cosine =
    a.size > 0 && b.size > 0
      ? intersection / Math.sqrt(a.size * b.size)
      : 0;

  // Diagnostic composite only. Resolution is NOT performed here.
  const score =
    0.45 * cosine +
    0.35 * jaccard +
    0.20 * Math.min(targetContainment, candidateContainment);

  return {
    targetTokenCount: a.size,
    candidateTokenCount: b.size,
    intersectionTokenCount: intersection,
    jaccard,
    cosine,
    targetContainment,
    candidateContainment,
    score,
    threshold: SIMILARITY_MIN_SCORE,
    minTargetTokens: SIMILARITY_MIN_TARGET_TOKENS,
    supportive:
      a.size >= SIMILARITY_MIN_TARGET_TOKENS &&
      score >= SIMILARITY_MIN_SCORE,
  };
}

function parseQueryLike(raw) {
  const cleaned = decodeHtmlEntities(String(raw ?? ''))
    .replace(/^.*?\?/, '')
    .replace(/["'<>\s].*$/, '');

  const params = new URLSearchParams(cleaned);

  const call = {
    rcpNo: params.get('rcpNo'),
    dcmNo: params.get('dcmNo'),
    eleId: params.get('eleId'),
    offset: params.get('offset'),
    length: params.get('length'),
    dtd: params.get('dtd'),
  };

  if (
    /^\d{14}$/.test(call.rcpNo ?? '') &&
    /^\d+$/.test(call.dcmNo ?? '') &&
    /^\d+$/.test(call.eleId ?? '') &&
    /^\d+$/.test(call.offset ?? '') &&
    /^\d+$/.test(call.length ?? '')
  ) {
    return call;
  }

  return null;
}

function extractViewerCalls(mainHtml, expectedReceiptNo) {
  const calls = [];

  function push(call) {
    if (!call) return;

    const normalized = {
      rcpNo: String(call.rcpNo ?? ''),
      dcmNo: String(call.dcmNo ?? ''),
      eleId: String(call.eleId ?? ''),
      offset: String(call.offset ?? ''),
      length: String(call.length ?? ''),
      dtd: String(call.dtd ?? 'dart3.xsd'),
    };

    if (
      normalized.rcpNo !== expectedReceiptNo ||
      !/^\d+$/.test(normalized.dcmNo) ||
      !/^\d+$/.test(normalized.eleId) ||
      !/^\d+$/.test(normalized.offset) ||
      !/^\d+$/.test(normalized.length)
    ) {
      return;
    }

    const key = [
      normalized.rcpNo,
      normalized.dcmNo,
      normalized.eleId,
      normalized.offset,
      normalized.length,
      normalized.dtd,
    ].join('|');

    if (!calls.some((x) => x.key === key)) {
      calls.push({ key, ...normalized });
    }
  }

  // Direct viewer.do URLs embedded in HTML/JS.
  for (const match of mainHtml.matchAll(/viewer\.do\?([^"'<>\\\s]+)/gi)) {
    push(parseQueryLike(`?${match[1]}`));
  }

  // Common DART JavaScript call form:
  // viewDoc('rcpNo','dcmNo','eleId','offset','length','dtd')
  const callRegex =
    /(?:viewDoc|viewDoc2|openViewer)\s*\(\s*['"]?(\d{14})['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?(?:\s*,\s*['"]([^'"]+)['"])?\s*\)/gi;

  for (const match of mainHtml.matchAll(callRegex)) {
    push({
      rcpNo: match[1],
      dcmNo: match[2],
      eleId: match[3],
      offset: match[4],
      length: match[5],
      dtd: match[6] || 'dart3.xsd',
    });
  }

  // Fallback: parse JS object/property blocks near each rcpNo.
  const anchorRegex =
    /(?:\[['"]rcpNo['"]\]|(?:^|[^\w])rcpNo)\s*[:=]\s*['"](\d{14})['"]/gim;

  for (const match of mainHtml.matchAll(anchorRegex)) {
    if (match[1] !== expectedReceiptNo) continue;

    const start = Math.max(0, match.index - 300);
    const block = mainHtml.slice(start, match.index + 1800);

    function field(name) {
      const re = new RegExp(
        String.raw`(?:\[['"]${name}['"]\]|(?:^|[^\w])${name})\s*[:=]\s*['"]?([^'";,\s\]}]+)`,
        'im',
      );
      return block.match(re)?.[1] ?? null;
    }

    push({
      rcpNo: match[1],
      dcmNo: field('dcmNo'),
      eleId: field('eleId'),
      offset: field('offset'),
      length: field('length'),
      dtd: field('dtd') || 'dart3.xsd',
    });
  }

  return calls
    .sort((a, b) =>
      Number(a.offset) - Number(b.offset) ||
      Number(a.eleId) - Number(b.eleId),
    )
    .slice(0, 80);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDartViewerText(receiptNo) {
  const mainUrl =
    `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`;

  const mainResponse = await fetchWithTimeout(mainUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 AI-Stock-Lab/9.11.4.1',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
    },
    redirect: 'follow',
  });

  const mainHtml = await mainResponse.text();
  const calls = extractViewerCalls(mainHtml, receiptNo);

  if (!mainResponse.ok || calls.length === 0) {
    return {
      status: 'DART_VIEWER_TREE_UNAVAILABLE',
      httpStatus: mainResponse.status,
      mainUrl,
      calls,
      text: '',
      networkRequests: 1,
    };
  }

  const texts = [];
  const callResults = [];
  let networkRequests = 1;

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
      dtd: call.dtd || 'dart3.xsd',
    });

    await sleep(REQUEST_DELAY_MS);

    const response = await fetchWithTimeout(viewer, {
      headers: {
        'User-Agent': 'Mozilla/5.0 AI-Stock-Lab/9.11.4.1',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
        Referer: mainUrl,
      },
      redirect: 'follow',
    });

    networkRequests += 1;

    const html = await response.text();
    const text = htmlToText(html);

    callResults.push({
      ...call,
      httpStatus: response.status,
      textLength: text.length,
    });

    if (response.ok && text.length > 20) {
      texts.push(text);
    }
  }

  const text =
    [...new Set(texts)]
      .join('\n')
      .replace(/\n{2,}/g, '\n')
      .trim();

  return {
    status:
      text
        ? 'DART_VIEWER_TEXT_RECEIVED'
        : 'DART_VIEWER_TEXT_EMPTY',
    httpStatus: mainResponse.status,
    mainUrl,
    calls: callResults,
    text,
    networkRequests,
  };
}

function dateVariants(date8) {
  const y = date8.slice(0, 4);
  const m = String(Number(date8.slice(4, 6)));
  const d = String(Number(date8.slice(6, 8)));
  const mm = date8.slice(4, 6);
  const dd = date8.slice(6, 8);

  return [
    date8,
    `${y}-${mm}-${dd}`,
    `${y}.${mm}.${dd}`,
    `${y}. ${mm}. ${dd}`,
    `${y}/${mm}/${dd}`,
    `${y}년 ${m}월 ${d}일`,
    `${y}년${m}월${d}일`,
    `${m}월 ${d}일`,
    `${mm}.${dd}`,
  ];
}

function evidenceSnippets(text, needles, radius = 120) {
  const source = String(text ?? '');
  const normalizedLower = source.toLowerCase();
  const out = [];

  for (const needle of needles) {
    const n = String(needle);
    const idx = normalizedLower.indexOf(n.toLowerCase());

    if (idx < 0) continue;

    out.push({
      needle: n,
      snippet: source
        .slice(
          Math.max(0, idx - radius),
          Math.min(source.length, idx + n.length + radius),
        )
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }

  return out;
}

function referenceEvidence(targetText) {
  const priorReceiptSnippets =
    evidenceSnippets(targetText, [TARGET.priorReceiptNo]);

  const priorDateSnippets =
    evidenceSnippets(targetText, dateVariants(TARGET.priorDate));

  const correctionWords = [
    '정정',
    '첨부정정',
    '정정 전',
    '정정전',
    '정정 후',
    '정정후',
    '최초',
    '원본',
    '기존',
    '제출',
  ];

  const contextualPriorDate =
    priorDateSnippets.filter((row) =>
      correctionWords.some((word) =>
        row.snippet.includes(word),
      ),
    );

  return {
    explicitPriorReceipt:
      priorReceiptSnippets.length > 0,
    explicitPriorReceiptSnippets:
      priorReceiptSnippets,

    priorDateMention:
      priorDateSnippets.length > 0,
    priorDateSnippets,

    contextualPriorDateMention:
      contextualPriorDate.length > 0,
    contextualPriorDateSnippets:
      contextualPriorDate,
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const diagnosticFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-043910-chain-evidence-diagnostic-v9-11-4.json',
  );

  if (!fs.existsSync(diagnosticFile)) {
    throw new Error('V9_11_4_DIAGNOSTIC_NOT_FOUND');
  }

  const diagnostic = JSON.parse(
    fs.readFileSync(diagnosticFile, 'utf8').replace(/^\uFEFF/, ''),
  );

  if (
    diagnostic.status !==
    'V9_11_4_CHAIN_EVIDENCE_DIAGNOSTIC_COMPLETE'
  ) {
    throw new Error(
      `V9_11_4_DIAGNOSTIC_STATUS_INVALID:${diagnostic.status}`,
    );
  }

  if (
    diagnostic.interpretation?.mayResolveFromCarryMatchAlone !== false ||
    diagnostic.interpretation?.receiptOrderPairingAllowed !== false
  ) {
    throw new Error('FAIL_CLOSED_DIAGNOSTIC_CONTRACT_INVALID');
  }

  const cacheDir = path.join(
    root,
    'logs',
    'v9-11-4-1-dart-viewer',
  );

  fs.mkdirSync(cacheDir, { recursive: true });

  console.log(
    `VIEWER_FETCH target=${TARGET.correctionReceiptNo} prior=${TARGET.priorReceiptNo}`,
  );

  const targetViewer =
    await fetchDartViewerText(TARGET.correctionReceiptNo);

  atomicSaveText(
    path.join(
      cacheDir,
      `${TARGET.correctionReceiptNo}.txt`,
    ),
    targetViewer.text || '',
  );

  const priorViewer =
    await fetchDartViewerText(TARGET.priorReceiptNo);

  atomicSaveText(
    path.join(
      cacheDir,
      `${TARGET.priorReceiptNo}.txt`,
    ),
    priorViewer.text || '',
  );

  const reference =
    referenceEvidence(targetViewer.text);

  const sim =
    targetViewer.status === 'DART_VIEWER_TEXT_RECEIVED' &&
    priorViewer.status === 'DART_VIEWER_TEXT_RECEIVED'
      ? similarity(targetViewer.text, priorViewer.text)
      : null;

  let evidenceClass = 'INSUFFICIENT_FIRST_PARTY_EVIDENCE';
  let suggestedConfidence = 'NONE';
  let safeToResolveChain = false;
  let resolutionReason = null;

  if (
    targetViewer.status === 'DART_VIEWER_TEXT_RECEIVED' &&
    reference.explicitPriorReceipt
  ) {
    evidenceClass = 'EXPLICIT_PRIOR_RECEIPT_REFERENCE';
    suggestedConfidence = 'HIGH';
    safeToResolveChain = true;
    resolutionReason =
      'DART_VIEWER_EXPLICIT_PRIOR_RECEIPT_UNIQUE_ROOT';
  } else if (
    targetViewer.status === 'DART_VIEWER_TEXT_RECEIVED' &&
    reference.contextualPriorDateMention &&
    diagnostic.carryForwardMatch?.exactPriorCarryMatch === true
  ) {
    evidenceClass = 'CONTEXTUAL_PRIOR_DATE_REFERENCE_UNIQUE_ROOT';
    suggestedConfidence = 'HIGH';
    safeToResolveChain = true;
    resolutionReason =
      'DART_VIEWER_REFERENCE_DATE_UNIQUE_PRIOR_CARRY_ROOT';
  } else if (
    sim?.supportive === true &&
    diagnostic.carryForwardMatch?.exactPriorCarryMatch === true
  ) {
    evidenceClass = 'DOCUMENT_SIMILARITY_SUPPORTIVE_ONLY';
    suggestedConfidence = 'MEDIUM';
    safeToResolveChain = true;
    resolutionReason =
      'UNIQUE_PRIOR_CARRY_ROOT_WITH_DOCUMENT_SIMILARITY_SUPPORT';
  }

  const networkRequests =
    Number(targetViewer.networkRequests ?? 0) +
    Number(priorViewer.networkRequests ?? 0);

  const report = {
    status:
      safeToResolveChain
        ? 'V9_11_4_1_FIRST_PARTY_CHAIN_EVIDENCE_DECISIVE'
        : 'V9_11_4_1_FIRST_PARTY_CHAIN_EVIDENCE_NOT_DECISIVE',

    version: VERSION,

    target: TARGET,

    viewer: {
      correction: {
        status: targetViewer.status,
        httpStatus: targetViewer.httpStatus,
        nodeCount: targetViewer.calls.length,
        textLength: targetViewer.text.length,
        cacheFile:
          `logs/v9-11-4-1-dart-viewer/${TARGET.correctionReceiptNo}.txt`,
      },
      prior: {
        status: priorViewer.status,
        httpStatus: priorViewer.httpStatus,
        nodeCount: priorViewer.calls.length,
        textLength: priorViewer.text.length,
        cacheFile:
          `logs/v9-11-4-1-dart-viewer/${TARGET.priorReceiptNo}.txt`,
      },
    },

    referenceEvidence: reference,

    similarity: sim,

    decision: {
      evidenceClass,
      suggestedConfidence,
      safeToResolveChain,
      rootReceiptNo:
        safeToResolveChain
          ? TARGET.priorReceiptNo
          : null,
      resolutionReason,
      receiptOrderPairingUsed: false,
      carryMatchAloneUsed: false,
    },

    safety: {
      networkRequests,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      canonicalIdentityAssigned: false,
      factorMutation: false,
    },

    nextGate:
      safeToResolveChain
        ? 'BUILD_V9_11_4_2_READ_ONLY_CHAIN_RESOLUTION'
        : 'KEEP_043910_CORRECTION_QUARANTINED_AND_REVIEW_FIRST_PARTY_EVIDENCE',

    outputFile:
      'logs/opendart-corporate-action-043910-viewer-evidence-v9-11-4-1.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        target: report.target,
        viewer: report.viewer,
        referenceEvidence: report.referenceEvidence,
        similarity: report.similarity,
        decision: report.decision,
      }),
    );

  atomicSaveJson(
    path.join(root, report.outputFile),
    report,
  );

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,
        target: report.target,
        viewer: report.viewer,
        referenceEvidence: {
          explicitPriorReceipt:
            report.referenceEvidence.explicitPriorReceipt,
          priorDateMention:
            report.referenceEvidence.priorDateMention,
          contextualPriorDateMention:
            report.referenceEvidence.contextualPriorDateMention,
          explicitPriorReceiptSnippets:
            report.referenceEvidence.explicitPriorReceiptSnippets,
          contextualPriorDateSnippets:
            report.referenceEvidence.contextualPriorDateSnippets,
        },
        similarity: report.similarity,
        decision: report.decision,
        networkRequests,
        databaseWrites: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'V9_11_4_1_VIEWER_EVIDENCE_PROBE_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
        databaseWrites: 0,
        productionApplied: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
