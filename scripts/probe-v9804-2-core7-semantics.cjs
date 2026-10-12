#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Probe semantic evidence for the 7 hard remaining chain cases:
 * - 휴온스글로벌 084110: 3 targets
 * - 한국카본 017960: 4 targets
 *
 * READ-ONLY:
 * - no network
 * - no DB
 * - no production writes
 *
 * Reads current V9.8.4.2 ambiguity rows and local cached DART texts only.
 * Sources tried, in order:
 *   1) logs/v9-8-4-2-evidence/viewer-text/<receipt>.txt
 *   2) logs/v9-8-3-dart-documents/<receipt>.zip
 *   3) logs/v9-8-4-2-evidence/document-xml/<receipt>.zip
 *
 * ZIP reading uses Windows PowerShell + System.IO.Compression only.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');

const currentFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

const TARGET_STOCKS = new Set(['084110', '017960']);

const KEYWORDS = [
  // correction-chain identity
  '정정관련 공시서류제출일',
  '정정관련 공시서류 제출일',
  '최초제출일',
  '최초 제출일',

  // merger identity
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

  // other-entity identity
  '자회사',
  '종속회사',
  '회사명',
  '상호',

  // withdrawal identity
  '철회',
  '임시주주총회',
];

function normalizeText(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readViewerText(receiptNo) {
  const file = path.join(
    root,
    'logs',
    'v9-8-4-2-evidence',
    'viewer-text',
    `${receiptNo}.txt`,
  );

  if (!fs.existsSync(file)) {
    return null;
  }

  const text = normalizeText(
    fs.readFileSync(file, 'utf8'),
  );

  return text
    ? {
        source: 'DART_VIEWER_CACHE',
        file: path.relative(root, file).replaceAll('\\', '/'),
        text,
      }
    : null;
}

function powershellReadZipText(zipFile) {
  const escaped = zipFile.replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${escaped}')
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.Length -le 0) { continue }
    $stream = $entry.Open()
    try {
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
      try {
        $content = $reader.ReadToEnd()
        if ($content) {
          Write-Output $content
        }
      } finally {
        $reader.Dispose()
      }
    } finally {
      $stream.Dispose()
    }
  }
} finally {
  $zip.Dispose()
}
`;

  try {
    const text = cp.execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        ps,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      },
    );

    return normalizeText(
      text
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|tr|td|th|div|table|section|title|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'"),
    );
  } catch {
    return '';
  }
}

function readZipCandidate(receiptNo, dir, source) {
  const file = path.join(
    root,
    'logs',
    dir,
    `${receiptNo}.zip`,
  );

  if (!fs.existsSync(file)) {
    return null;
  }

  const text = powershellReadZipText(file);

  return text
    ? {
        source,
        file: path.relative(root, file).replaceAll('\\', '/'),
        text,
      }
    : null;
}

function getLocalText(receiptNo) {
  return (
    readViewerText(receiptNo) ??
    readZipCandidate(
      receiptNo,
      'v9-8-3-dart-documents',
      'V9_8_3_LOCAL_DOCUMENT_XML',
    ) ??
    readZipCandidate(
      receiptNo,
      path.join('v9-8-4-2-evidence', 'document-xml'),
      'V9_8_4_2_DOCUMENT_XML_CACHE',
    ) ?? {
      source: 'LOCAL_TEXT_UNAVAILABLE',
      file: null,
      text: '',
    }
  );
}

function snippets(text, keyword, radius = 180) {
  const out = [];
  let start = 0;
  const lower = text.toLowerCase();
  const needle = keyword.toLowerCase();

  while (out.length < 3) {
    const index = lower.indexOf(needle, start);
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

    start = index + keyword.length;
  }

  return [...new Set(out)];
}

function extractEvidence(text) {
  const hits = [];

  for (const keyword of KEYWORDS) {
    const found = snippets(text, keyword);
    if (found.length > 0) {
      hits.push({
        keyword,
        snippets: found,
      });
    }
  }

  // Also surface date-like strings around the correction header area.
  const dates = [
    ...new Set(
      (text.match(
        /(?:20\d{2})[.\-\/년\s]*(?:0?[1-9]|1[0-2])[.\-\/월\s]*(?:0?[1-9]|[12]\d|3[01])(?:일)?/g,
      ) ?? [])
        .slice(0, 40),
    ),
  ];

  return {
    keywordHits: hits,
    dateLikeValues: dates,
  };
}

const current = JSON.parse(
  fs.readFileSync(currentFile, 'utf8'),
);

const ambiguous = (current.resolutions ?? []).filter(
  (row) =>
    row.resolutionStatus === 'AMBIGUOUS' &&
    TARGET_STOCKS.has(String(row.stockCode)),
);

const receiptNos = new Set();

for (const row of ambiguous) {
  receiptNos.add(String(row.receiptNo));
  for (const candidate of row.plausibleRoots ?? []) {
    receiptNos.add(String(candidate));
  }
}

const documents = {};

for (const receiptNo of [...receiptNos].sort()) {
  const local = getLocalText(receiptNo);

  documents[receiptNo] = {
    source: local.source,
    file: local.file,
    charCount: local.text.length,
    evidence: extractEvidence(local.text),
  };
}

const rows = ambiguous.map((row) => ({
  receiptNo: row.receiptNo,
  receiptDate: row.receiptDate,
  stockCode: row.stockCode,
  corpCode: row.corpCode,
  actionType: row.actionType,
  gate: row.gate,
  reportName: row.targetHistoryRow?.reportName ?? row.reportName ?? null,
  correction: row.correction,
  withdrawal: row.withdrawal,
  otherEntity: row.otherEntity,
  plausibleRoots: row.plausibleRoots ?? [],
  targetDocument: documents[String(row.receiptNo)],
  candidateDocuments: (row.plausibleRoots ?? []).map(
    (receiptNo) => ({
      receiptNo,
      ...documents[String(receiptNo)],
    }),
  ),
}));

console.log(
  JSON.stringify(
    {
      status: 'CORE7_LOCAL_SEMANTIC_EVIDENCE_PROBE_COMPLETE',
      version: current.version ?? null,
      targetRows: rows.length,
      uniqueReceiptsInspected: receiptNos.size,
      networkRequests: 0,
      databaseWrites: 0,
      rows,
    },
    null,
    2,
  ),
);
