#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * CORE7 semantic analyzer using locally parsed OpenDART document.xml text.
 *
 * Purpose
 * 1) Resolve / characterize 휴온스글로벌 merger chain from first-party text.
 * 2) Build distinguishing fingerprints for the four 한국카본 original merger filings.
 *
 * READ-ONLY
 * - no network
 * - no DB
 * - no production writes
 *
 * Inputs
 *   logs/v9-8-4-2-evidence/document-text/<receiptNo>.txt
 *
 * Output
 *   logs/v9804-2-core7-semantic-analysis.json
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const TEXT_DIR = path.join(
  root,
  'logs',
  'v9-8-4-2-evidence',
  'document-text',
);

const OUTPUT = path.join(
  root,
  'logs',
  'v9804-2-core7-semantic-analysis.json',
);

const HUONS = {
  roots: [
    '20260422900422',
    '20260518900970',
  ],
  targets: [
    '20260804900492',
    '20260826900706',
    '20260826900708',
  ],
};

const KCARBON_ROOTS = [
  '20260814002642',
  '20260814002685',
  '20260814002795',
  '20260814002868',
];

const KEYWORDS = [
  '정정관련 공시서류제출일',
  '정정관련 공시서류 제출일',
  '정정관련공시서류제출일',
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
  '주주총회',
  '임시주주총회',
  '이사회',
  '자회사',
  '종속회사',
  '회사명',
  '상호',
  '철회',
];

const STOP_TOKENS = new Set([
  '주요사항보고서',
  '회사합병결정',
  '기재정정',
  '첨부정정',
  '정정',
  '공시',
  '제출일',
  '회사',
  '결정',
  '합병',
  '자회사',
  '종속회사',
  '주요경영사항',
  '보고서',
]);

function readText(receiptNo) {
  const file = path.join(
    TEXT_DIR,
    `${receiptNo}.txt`,
  );

  if (!fs.existsSync(file)) {
    return {
      receiptNo,
      available: false,
      file: path.relative(root, file).replaceAll('\\', '/'),
      text: '',
    };
  }

  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    receiptNo,
    available: Boolean(text),
    file: path.relative(root, file).replaceAll('\\', '/'),
    text,
  };
}

function compact(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .trim();
}

function snippets(text, keyword, radius = 220, max = 5) {
  const out = [];
  const lower = text.toLowerCase();
  const needle = keyword.toLowerCase();
  let from = 0;

  while (out.length < max) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;

    const left = Math.max(0, index - radius);
    const right = Math.min(
      text.length,
      index + keyword.length + radius,
    );

    out.push(
      text
        .slice(left, right)
        .replace(/\s+/g, ' ')
        .trim(),
    );

    from = index + keyword.length;
  }

  return [...new Set(out)];
}

function extractKeywordEvidence(text) {
  const out = [];

  for (const keyword of KEYWORDS) {
    const found = snippets(text, keyword);
    if (found.length > 0) {
      out.push({
        keyword,
        snippets: found,
      });
    }
  }

  return out;
}

function extractReferenceDates(text) {
  const windows = [];

  for (const keyword of [
    '정정관련 공시서류제출일',
    '정정관련 공시서류 제출일',
    '정정관련공시서류제출일',
    '최초제출일',
    '최초 제출일',
  ]) {
    for (const s of snippets(text, keyword, 160, 6)) {
      windows.push({
        keyword,
        snippet: s,
      });
    }
  }

  const dates = new Set();

  for (const row of windows) {
    const matches =
      row.snippet.match(
        /20\d{2}[.\-\/년]\s*(?:0?[1-9]|1[0-2])[.\-\/월]\s*(?:0?[1-9]|[12]\d|3[01])(?:일)?/g,
      ) ?? [];

    for (const value of matches) {
      dates.add(value);
    }
  }

  return {
    windows,
    values: [...dates],
  };
}

function extractNames(text) {
  const candidates = new Set();

  const patterns = [
    /(?:합병상대회사|합병 상대회사|피합병회사|존속회사|소멸회사|자회사|종속회사|회사명|상호)\s*[:：]?\s*([가-힣A-Za-z0-9㈜()·._\- ]{2,80})/g,
    /(?:주식회사|㈜)\s*[가-힣A-Za-z0-9·._\-]{2,40}/g,
    /[가-힣A-Za-z0-9·._\-]{2,40}\s*(?:주식회사|㈜)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = compact(match[1] ?? match[0])
        .replace(/[.,;]+$/g, '');

      if (
        value.length >= 2 &&
        value.length <= 80
      ) {
        candidates.add(value);
      }
    }
  }

  return [...candidates].slice(0, 80);
}

function extractDates(text) {
  return [
    ...new Set(
      text.match(
        /20\d{2}[.\-\/년]\s*(?:0?[1-9]|1[0-2])[.\-\/월]\s*(?:0?[1-9]|[12]\d|3[01])(?:일)?/g,
      ) ?? [],
    ),
  ].slice(0, 100);
}

function extractRatios(text) {
  const raw = text.match(
    /\b\d+(?:\.\d+)?\s*(?::|대)\s*\d+(?:\.\d+)?\b/g,
  ) ?? [];

  return [...new Set(raw)].slice(0, 60);
}

function tokenSet(text) {
  const tokens =
    String(text ?? '')
      .toLowerCase()
      .match(
        /[가-힣]{2,}|[a-z][a-z0-9._-]{2,}|\d{4,}/g,
      ) ?? [];

  return new Set(
    tokens.filter(
      (token) =>
        !STOP_TOKENS.has(token),
    ),
  );
}

function weightedSimilarity(targetText, candidates) {
  const targetTokens =
    tokenSet(targetText);

  const candidateSets =
    candidates.map((row) => ({
      receiptNo: row.receiptNo,
      tokens: tokenSet(row.text),
    }));

  const allSets = [
    targetTokens,
    ...candidateSets.map(
      (row) => row.tokens,
    ),
  ];

  const df = new Map();

  for (const set of allSets) {
    for (const token of set) {
      df.set(
        token,
        (df.get(token) ?? 0) + 1,
      );
    }
  }

  const total = allSets.length;

  function weight(token) {
    return (
      Math.log(
        (total + 1) /
          ((df.get(token) ?? 0) + 1),
      ) + 1
    );
  }

  return candidateSets
    .map((candidate) => {
      let intersection = 0;
      let union = 0;

      const unionTokens =
        new Set([
          ...targetTokens,
          ...candidate.tokens,
        ]);

      for (const token of unionTokens) {
        const w = weight(token);
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
          [...targetTokens].filter(
            (token) =>
              candidate.tokens.has(token),
          ).length,
        targetTokenCount:
          targetTokens.size,
        candidateTokenCount:
          candidate.tokens.size,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score,
    );
}

function fingerprint(receiptNo) {
  const doc = readText(receiptNo);

  if (!doc.available) {
    return {
      receiptNo,
      available: false,
      file: doc.file,
    };
  }

  return {
    receiptNo,
    available: true,
    file: doc.file,
    charCount: doc.text.length,
    referenceDates:
      extractReferenceDates(doc.text),
    names:
      extractNames(doc.text),
    ratios:
      extractRatios(doc.text),
    dates:
      extractDates(doc.text),
    keywordEvidence:
      extractKeywordEvidence(doc.text),
  };
}

const huonsRootDocs =
  HUONS.roots.map(
    (receiptNo) =>
      readText(receiptNo),
  );

const huonsRows =
  HUONS.targets.map(
    (receiptNo) => {
      const target =
        readText(receiptNo);

      return {
        receiptNo,
        available:
          target.available,
        charCount:
          target.text.length,
        referenceDates:
          target.available
            ? extractReferenceDates(
                target.text,
              )
            : null,
        names:
          target.available
            ? extractNames(
                target.text,
              )
            : [],
        ratios:
          target.available
            ? extractRatios(
                target.text,
              )
            : [],
        dates:
          target.available
            ? extractDates(
                target.text,
              )
            : [],
        keywordEvidence:
          target.available
            ? extractKeywordEvidence(
                target.text,
              )
            : [],
        rootSimilarity:
          target.available
            ? weightedSimilarity(
                target.text,
                huonsRootDocs.filter(
                  (row) =>
                    row.available,
                ),
              )
            : [],
      };
    },
  );

const report = {
  version:
    'V9_8_4_2_CORE7_SEMANTIC_ANALYSIS',
  status:
    'CORE7_SEMANTIC_ANALYSIS_COMPLETE',
  networkRequests: 0,
  databaseWrites: 0,
  productionApplied: false,

  huonsGlobal: {
    roots:
      HUONS.roots.map(
        fingerprint,
      ),
    targets:
      huonsRows,
  },

  koreaCarbon: {
    note:
      'Only original candidate documents are locally available; correction targets remain provider 014 and are not force-matched.',
    candidateRoots:
      KCARBON_ROOTS.map(
        fingerprint,
      ),
  },
};

fs.writeFileSync(
  OUTPUT,
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
      huonsTargets:
        report.huonsGlobal
          .targets.length,
      koreaCarbonRoots:
        report.koreaCarbon
          .candidateRoots.length,
      networkRequests: 0,
      databaseWrites: 0,
      productionApplied: false,
      outputFile:
        path
          .relative(
            root,
            OUTPUT,
          )
          .replaceAll('\\', '/'),
    },
    null,
    2,
  ),
);
