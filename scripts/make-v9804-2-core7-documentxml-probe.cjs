#!/usr/bin/env node
'use strict';

/**
 * Build a CORE7 OpenDART document.xml probe by reusing the exact legacy
 * V9.8.4.2 final-precision resolver implementation.
 *
 * Output:
 *   scripts/v9804-2-core7-documentxml-probe.cjs
 *
 * The generated probe:
 * - calls the preserved fetchDocumentXml()
 * - parses ZIP bytes with the preserved zipToPlainText()
 * - caches successful ZIP/text locally
 * - writes evidence summary JSON
 * - performs no DB / production writes
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const sourceFile = path.join(
  __dirname,
  'v9804-2-final-precision-backup-20261005-172956.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9804-2-core7-documentxml-probe.cjs',
);

const source = fs.readFileSync(sourceFile, 'utf8');

const marker = '\nmain().catch(';
const markerIndex = source.lastIndexOf(marker);

if (markerIndex < 0) {
  throw new Error('LEGACY_MAIN_ENTRYPOINT_NOT_FOUND');
}

const prefix = source.slice(0, markerIndex);

const injected = String.raw`

function core7ApiKey() {
  const candidates = [
    'DART_API_KEY',
    'OPENDART_API_KEY',
    'OPEN_DART_API_KEY',
    'DART_CRTFC_KEY',
    'OPENDART_CRTFC_KEY',
    'OPEN_DART_CRTFC_KEY',
  ];

  for (const name of candidates) {
    const value = process.env[name];
    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return {
        name,
        value: value.trim(),
      };
    }
  }

  throw new Error(
    'OPENDART_API_KEY_NOT_FOUND:' +
      candidates.join(','),
  );
}

function core7Snippet(text, keyword, radius = 220) {
  const source = String(text ?? '');
  const lower = source.toLowerCase();
  const needle = String(keyword).toLowerCase();

  const out = [];
  let from = 0;

  while (out.length < 5) {
    const index = lower.indexOf(
      needle,
      from,
    );

    if (index < 0) {
      break;
    }

    const left = Math.max(
      0,
      index - radius,
    );

    const right = Math.min(
      source.length,
      index +
        keyword.length +
        radius,
    );

    out.push(
      source
        .slice(left, right)
        .replace(/\s+/g, ' ')
        .trim(),
    );

    from =
      index + keyword.length;
  }

  return [...new Set(out)];
}

function core7Evidence(text) {
  const keywords = [
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

    '자회사',
    '종속회사',
    '회사명',
    '상호',

    '철회',
    '임시주주총회',
  ];

  const keywordHits = [];

  for (const keyword of keywords) {
    const snippets =
      core7Snippet(
        text,
        keyword,
      );

    if (snippets.length > 0) {
      keywordHits.push({
        keyword,
        snippets,
      });
    }
  }

  const normalizedDates =
    [
      ...new Set(
        (
          String(text ?? '').match(
            /20\d{2}[.\-\/년]\s*(?:0?[1-9]|1[0-2])[.\-\/월]\s*(?:0?[1-9]|[12]\d|3[01])(?:일)?/g,
          ) ?? []
        ),
      ),
    ].slice(0, 100);

  const receiptLike =
    [
      ...new Set(
        String(text ?? '').match(
          /20\d{12}/g,
        ) ?? [],
      ),
    ].slice(0, 100);

  const ratioLike =
    [
      ...new Set(
        String(text ?? '').match(
          /\b\d+(?:\.\d+)?\s*(?::|대)\s*\d+(?:\.\d+)?\b/g,
        ) ?? [],
      ),
    ].slice(0, 60);

  return {
    keywordHits,
    normalizedDates,
    receiptLike,
    ratioLike,
  };
}

async function runCore7DocumentXmlProbe() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

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

  const apiKey =
    core7ApiKey();

  const zipDir =
    path.join(
      root,
      'logs',
      'v9-8-4-2-evidence',
      'document-xml',
    );

  const textDir =
    path.join(
      root,
      'logs',
      'v9-8-4-2-evidence',
      'document-text',
    );

  const reportFile =
    path.join(
      root,
      'logs',
      'v9804-2-core7-documentxml-probe.json',
    );

  fs.mkdirSync(
    zipDir,
    {
      recursive: true,
    },
  );

  fs.mkdirSync(
    textDir,
    {
      recursive: true,
    },
  );

  const rows = [];
  let networkRequests = 0;

  for (
    let index = 0;
    index < receiptNos.length;
    index += 1
  ) {
    const receiptNo =
      receiptNos[index];

    let fetched;

    try {
      fetched =
        await fetchDocumentXml({
          key:
            apiKey.value,
          receiptNo,
        });

      networkRequests += 1;
    } catch (error) {
      rows.push({
        receiptNo,
        fetchStatus:
          'FETCH_EXCEPTION',
        providerStatus:
          null,
        httpStatus:
          null,
        bufferBytes: 0,
        textChars: 0,
        cacheWritten: false,
        error:
          String(
            error?.message ??
            error,
          ),
      });

      console.log(
        [
          'DOCUMENT_XML_PROBE',
          (index + 1) +
            '/' +
            receiptNos.length,
          'receipt=' +
            receiptNo,
          'status=FETCH_EXCEPTION',
          'requests=' +
            networkRequests,
        ].join(' '),
      );

      continue;
    }

    const buffer =
      Buffer.isBuffer(
        fetched?.buffer,
      )
        ? fetched.buffer
        : null;

    let text = '';
    let parseError = null;
    let zipWritten = false;
    let textWritten = false;

    if (
      buffer &&
      buffer.length > 0
    ) {
      try {
        text =
          zipToPlainText(
            buffer,
          );

        if (
          typeof text !== 'string'
        ) {
          text =
            String(
              text ?? '',
            );
        }
      } catch (error) {
        parseError =
          String(
            error?.message ??
            error,
          );
      }

      const zipFile =
        path.join(
          zipDir,
          receiptNo + '.zip',
        );

      fs.writeFileSync(
        zipFile,
        buffer,
      );

      zipWritten = true;

      if (
        text.trim()
      ) {
        const textFile =
          path.join(
            textDir,
            receiptNo + '.txt',
          );

        fs.writeFileSync(
          textFile,
          text,
          'utf8',
        );

        textWritten = true;
      }
    }

    const row = {
      receiptNo,
      fetchStatus:
        fetched?.status ??
        fetched?.documentStatus ??
        null,
      providerStatus:
        fetched?.providerStatus ??
        null,
      httpStatus:
        fetched?.httpStatus ??
        fetched?.statusCode ??
        null,
      contentType:
        fetched?.contentType ??
        null,
      bufferBytes:
        buffer?.length ?? 0,
      textChars:
        text.length,
      zipWritten,
      textWritten,
      parseError,
      evidence:
        core7Evidence(
          text,
        ),
    };

    rows.push(row);

    console.log(
      [
        'DOCUMENT_XML_PROBE',
        (index + 1) +
          '/' +
          receiptNos.length,
        'receipt=' +
          receiptNo,
        'status=' +
          (row.fetchStatus ?? '-'),
        'provider=' +
          (row.providerStatus ?? '-'),
        'bytes=' +
          row.bufferBytes,
        'chars=' +
          row.textChars,
        'keywords=' +
          row.evidence.keywordHits.length,
        'zip=' +
          row.zipWritten,
        'text=' +
          row.textWritten,
        'requests=' +
          networkRequests,
      ].join(' '),
    );

    if (
      typeof REQUEST_DELAY_MS === 'number' &&
      REQUEST_DELAY_MS > 0 &&
      index + 1 <
        receiptNos.length
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const statusCounts =
    rows.reduce(
      (acc, row) => {
        const key =
          row.fetchStatus ??
          row.providerStatus ??
          'UNKNOWN';

        acc[key] =
          (acc[key] ?? 0) + 1;

        return acc;
      },
      {},
    );

  const report = {
    version:
      'V9_8_4_2_CORE7_DOCUMENT_XML_PROBE',
    status:
      'CORE7_DOCUMENT_XML_PROBE_COMPLETE',
    sourceImplementation:
      'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER.fetchDocumentXml+zipToPlainText',
    apiKeyEnvironment:
      apiKey.name,
    targetReceipts:
      receiptNos.length,
    buffersReceived:
      rows.filter(
        (row) =>
          row.bufferBytes > 0,
      ).length,
    textsParsed:
      rows.filter(
        (row) =>
          row.textChars > 0,
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
        apiKeyEnvironment:
          report.apiKeyEnvironment,
        targetReceipts:
          report.targetReceipts,
        buffersReceived:
          report.buffersReceived,
        textsParsed:
          report.textsParsed,
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
            .replaceAll(
              '\\',
              '/',
            ),
      },
      null,
      2,
    ),
  );
}

runCore7DocumentXmlProbe().catch(
  (error) => {
    console.error(
      '[CORE7 DOCUMENT XML PROBE ERROR]',
      error?.stack ?? error,
    );

    process.exitCode = 1;
  },
);
`;

fs.writeFileSync(
  outputFile,
  prefix + injected,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'CORE7_DOCUMENT_XML_PROBE_BUILT',
      sourceFile:
        path
          .relative(
            root,
            sourceFile,
          )
          .replaceAll('\\', '/'),
      outputFile:
        path
          .relative(
            root,
            outputFile,
          )
          .replaceAll('\\', '/'),
    },
    null,
    2,
  ),
);
