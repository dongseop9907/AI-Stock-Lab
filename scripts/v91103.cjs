'use strict';

/**
 * AI Stock Lab
 * V9.8.3 - OpenDART incremental detail evidence collector
 *
 * READ-ONLY with respect to Supabase/production.
 *
 * Input:
 *   logs/opendart-corporate-action-detail-workset-v9-11-2.json
 *
 * Outputs:
 *   logs/opendart-corporate-action-detail-evidence-v9-11-3.json
 *   logs/v9-11-3-dart-documents/<receiptNo>.zip
 *   logs/v9-11-3-dart-structured/<endpoint>/<corpCode>.json
 *
 * For every V9.8.2 detailFetchQueue row:
 *   - fetch official OpenDART document.xml ZIP by receipt number
 *
 * Additional official structured APIs:
 *   MERGER:
 *     cmpMgDecsn.json
 *
 *   SPIN_OFF:
 *     cmpDvDecsn.json
 *
 *   SPLIT_MERGER:
 *     cmpDvmgDecsn.json
 *
 * Structured calls are cached per endpoint + corpCode so a company is not
 * repeatedly queried for the same endpoint.
 *
 * No corporate_action_events write.
 * No coverage-window write.
 * No canonical identity assignment.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9803.cjs
 *
 * Resume:
 *   Run the same command again. Successful existing artifacts are reused.
 *
 * Re-fetch:
 *   node --env-file=.env.local .\scripts\v9803.cjs --refresh
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR';

const INPUT_VERSION =
  'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 45000;
const STRUCTURED_BEGIN_DATE = '20150101';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Buffer(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function sha256Text(text) {
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    input: null,
    output: null,
    refresh: false,
  };

  for (const arg of argv) {
    if (arg === '--refresh') {
      out.refresh = true;
      continue;
    }

    if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output = arg.slice('--output='.length);
      continue;
    }

    throw new Error('UNKNOWN_OPTION');
  }

  return out;
}

function readEnvFile(root) {
  const file =
    path.join(
      root,
      '.env.local',
    );

  const out = {};

  if (!fs.existsSync(file)) {
    return out;
  }

  const text =
    fs
      .readFileSync(
        file,
        'utf8',
      )
      .replace(
        /^\uFEFF/,
        '',
      );

  for (const line of text.split(/\r?\n/)) {
    const match =
      line.match(
        /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/,
      );

    if (!match) {
      continue;
    }

    let value =
      match[2];

    if (
      value.startsWith('"') ||
      value.startsWith("'")
    ) {
      const quote =
        value[0];

      const end =
        value.indexOf(
          quote,
          1,
        );

      if (end < 0) {
        continue;
      }

      value =
        value.slice(
          1,
          end,
        );
    } else {
      value =
        value
          .replace(
            /\s+#.*$/,
            '',
          )
          .trim();
    }

    out[
      match[1]
    ] =
      value;
  }

  return out;
}

function requireDartKey(root) {
  const fileEnv =
    readEnvFile(
      root,
    );

  const names = [
    'OPENDART_API_KEY',
    'OPEN_DART_API_KEY',
    'DART_API_KEY',
    'DART_KEY',
    'OPEN_DART_KEY',
  ];

  for (const name of names) {
    const value =
      String(
        process.env[name] ??
        fileEnv[name] ??
        '',
      ).trim();

    if (value) {
      return value;
    }
  }

  throw new Error(
    'DART_API_KEY_REQUIRED',
  );
}

function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(value) {
  return normalizeTitle(value)
    .replace(/\s+/g, '');
}

function structuredEndpointFor(row) {
  if (
    row.actionType ===
    'MERGER'
  ) {
    return 'cmpMgDecsn.json';
  }

  if (
    row.actionType ===
    'SPIN_OFF'
  ) {
    const title =
      compactTitle(
        row.reportName,
      );

    if (
      /분할합병/.test(
        title,
      )
    ) {
      return 'cmpDvmgDecsn.json';
    }

    return 'cmpDvDecsn.json';
  }

  return null;
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
    },
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

function atomicSaveBuffer(file, buffer) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
    },
  );

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    buffer,
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function safeRelative(root, file) {
  return path
    .relative(
      root,
      file,
    )
    .replaceAll(
      '\\',
      '/',
    );
}

function isZip(buffer) {
  return (
    buffer.length >=
      4 &&
    buffer[0] ===
      0x50 &&
    buffer[1] ===
      0x4b &&
    (
      (
        buffer[2] ===
          0x03 &&
        buffer[3] ===
          0x04
      ) ||
      (
        buffer[2] ===
          0x05 &&
        buffer[3] ===
          0x06
      ) ||
      (
        buffer[2] ===
          0x07 &&
        buffer[3] ===
          0x08
      )
    )
  );
}

function extractProviderStatus(text) {
  const statusMatch =
    text.match(
      /<status>\s*([0-9]{3})\s*<\/status>/i,
    ) ??
    text.match(
      /"status"\s*:\s*"([0-9]{3})"/i,
    );

  const messageMatch =
    text.match(
      /<message>\s*([^<]+)\s*<\/message>/i,
    ) ??
    text.match(
      /"message"\s*:\s*"([^"]+)"/i,
    );

  return {
    providerStatus:
      statusMatch?.[1] ??
      null,

    providerMessage:
      messageMatch?.[1] ??
      null,
  };
}

async function fetchDocument({
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

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(
      arrayBuffer,
    );

  if (
    response.ok &&
    isZip(buffer)
  ) {
    return {
      ok:
        true,

      status:
        'DOCUMENT_ZIP_RECEIVED',

      httpStatus:
        response.status,

      byteLength:
        buffer.length,

      sha256:
        sha256Buffer(
          buffer,
        ),

      buffer,

      providerStatus:
        null,

      providerMessage:
        null,
    };
  }

  const text =
    buffer
      .toString(
        'utf8',
      )
      .replace(
        /^\uFEFF/,
        '',
      )
      .slice(
        0,
        10000,
      );

  const provider =
    extractProviderStatus(
      text,
    );

  return {
    ok:
      false,

    status:
      'DOCUMENT_SOURCE_UNAVAILABLE',

    httpStatus:
      response.status,

    byteLength:
      buffer.length,

    sha256:
      sha256Buffer(
        buffer,
      ),

    buffer:
      null,

    providerStatus:
      provider.providerStatus,

    providerMessage:
      provider.providerMessage,
  };
}

async function fetchStructured({
  key,
  endpoint,
  corpCode,
  endDate,
}) {
  const url =
    new URL(
      `https://opendart.fss.or.kr/api/${endpoint}`,
    );

  url.search =
    new URLSearchParams({
      crtfc_key:
        key,

      corp_code:
        corpCode,

      bgn_de:
        STRUCTURED_BEGIN_DATE,

      end_de:
        endDate,
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

  const text =
    (
      await response.text()
    ).replace(
      /^\uFEFF/,
      '',
    );

  let body = null;

  try {
    body =
      JSON.parse(
        text,
      );
  } catch {
    return {
      ok:
        false,

      status:
        'STRUCTURED_INVALID_JSON',

      httpStatus:
        response.status,

      endpoint,

      corpCode,

      providerStatus:
        null,

      providerMessage:
        null,

      responseRows:
        0,

      sha256:
        sha256Text(
          text,
        ),

      body:
        null,
    };
  }

  const providerStatus =
    String(
      body?.status ??
      '',
    );

  const providerMessage =
    String(
      body?.message ??
      '',
    );

  const list =
    Array.isArray(
      body?.list,
    )
      ? body.list
      : [];

  if (
    response.ok &&
    providerStatus ===
      '000'
  ) {
    return {
      ok:
        true,

      status:
        'STRUCTURED_DATA_RECEIVED',

      httpStatus:
        response.status,

      endpoint,

      corpCode,

      providerStatus,

      providerMessage,

      responseRows:
        list.length,

      sha256:
        sha256Text(
          text,
        ),

      body,
    };
  }

  if (
    providerStatus ===
    '013'
  ) {
    return {
      ok:
        true,

      status:
        'STRUCTURED_NO_DATA',

      httpStatus:
        response.status,

      endpoint,

      corpCode,

      providerStatus,

      providerMessage,

      responseRows:
        0,

      sha256:
        sha256Text(
          text,
        ),

      body,
    };
  }

  return {
    ok:
      false,

    status:
      'STRUCTURED_SOURCE_ERROR',

    httpStatus:
      response.status,

    endpoint,

    corpCode,

    providerStatus:
      providerStatus ||
      null,

    providerMessage:
      providerMessage ||
      null,

    responseRows:
      list.length,

    sha256:
      sha256Text(
        text,
      ),

    body,
  };
}

function findExactStructuredMatches(
  structuredBody,
  receiptNo,
) {
  const rows =
    Array.isArray(
      structuredBody?.list,
    )
      ? structuredBody.list
      : [];

  return rows.filter(
    (row) =>
      String(
        row?.rcept_no ??
        '',
      ) ===
      receiptNo,
  );
}

function loadExistingEvidence(
  outputFile,
  sourceFingerprint,
  refresh,
) {
  if (
    refresh ||
    !fs.existsSync(
      outputFile,
    )
  ) {
    return null;
  }

  const existing =
    JSON.parse(
      fs
        .readFileSync(
          outputFile,
          'utf8',
        )
        .replace(
          /^\uFEFF/,
          '',
        ),
    );

  if (
    existing.version !==
      VERSION ||
    existing.sourceFingerprint !==
      sourceFingerprint
  ) {
    throw new Error(
      'V9_8_3_EXISTING_STATE_MISMATCH_USE_REFRESH',
    );
  }

  return existing;
}

function safeErrorMessage(error) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message
      .replace(
        /[?&]crtfc_key=[^&\s]+/gi,
        '?crtfc_key=REDACTED',
      )
      .slice(
        0,
        500,
      );
  }

  return String(
    error ??
    'UNKNOWN_ERROR',
  ).slice(
    0,
    500,
  );
}

function summarize(results) {
  const out = {
    totalWorkItems:
      results.length,

    documentsReceived:
      0,

    documentUnavailable:
      0,

    structuredRequired:
      0,

    structuredReceived:
      0,

    structuredNoData:
      0,

    structuredErrors:
      0,

    exactStructuredReceiptMatches:
      0,

    exactStructuredReceiptMisses:
      0,

    completed:
      0,

    failed:
      0,
  };

  for (const row of results) {
    if (
      row.document?.status ===
      'DOCUMENT_ZIP_RECEIVED'
    ) {
      out.documentsReceived +=
        1;
    } else {
      out.documentUnavailable +=
        1;
    }

    if (
      row.structuredEndpoint
    ) {
      out.structuredRequired +=
        1;

      if (
        row.structured?.status ===
        'STRUCTURED_DATA_RECEIVED'
      ) {
        out.structuredReceived +=
          1;
      } else if (
        row.structured?.status ===
        'STRUCTURED_NO_DATA'
      ) {
        out.structuredNoData +=
          1;
      } else {
        out.structuredErrors +=
          1;
      }

      if (
        row.structuredExactReceiptMatches >
        0
      ) {
        out.exactStructuredReceiptMatches +=
          1;
      } else {
        out.exactStructuredReceiptMisses +=
          1;
      }
    }

    if (
      row.status ===
      'EVIDENCE_READY'
    ) {
      out.completed +=
        1;
    } else {
      out.failed +=
        1;
    }
  }

  return out;
}

async function main() {
  if (
    typeof fetch !==
    'function'
  ) {
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

  const inputFile =
    path.resolve(
      args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-workset-v9-11-2.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-11-3.json',
      ),
    );

  const documentDir =
    path.join(
      root,
      'logs',
      'v9-11-3-dart-documents',
    );

  const structuredDir =
    path.join(
      root,
      'logs',
      'v9-11-3-dart-structured',
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      'V9_8_2_INPUT_NOT_FOUND',
    );
  }

  const source =
    JSON.parse(
      fs
        .readFileSync(
          inputFile,
          'utf8',
        )
        .replace(
          /^\uFEFF/,
          '',
        ),
    );

  if (
    source.version !==
    INPUT_VERSION ||
    source.status !==
    'DETAIL_WORKSET_READY'
  ) {
    throw new Error(
      'V9_8_2_INPUT_NOT_READY',
    );
  }

  if (
    !Array.isArray(
      source.detailFetchQueue,
    )
  ) {
    throw new Error(
      'V9_8_2_DETAIL_FETCH_QUEUE_MISSING',
    );
  }

  const sourceFingerprint =
    sha256Text(
      JSON.stringify(
        source.detailFetchQueue,
      ),
    );

  const dartKey =
    requireDartKey(
      root,
    );

  const endDate =
    String(
      source?.source?.throughDate ??
      '',
    ).replaceAll(
      '-',
      '',
    );

  if (
    !/^\d{8}$/.test(
      endDate,
    )
  ) {
    throw new Error(
      'V9_8_2_THROUGH_DATE_INVALID',
    );
  }

  const prior =
    loadExistingEvidence(
      outputFile,
      sourceFingerprint,
      args.refresh,
    );

  const priorByWorkId =
    new Map(
      Array.isArray(
        prior?.results,
      )
        ? prior.results.map(
            (row) => [
              row.workId,
              row,
            ],
          )
        : [],
    );

  const structuredCache =
    new Map();

  if (
    prior &&
    Array.isArray(
      prior.structuredCache,
    )
  ) {
    for (
      const entry of
      prior.structuredCache
    ) {
      if (
        entry?.cacheKey
      ) {
        structuredCache.set(
          entry.cacheKey,
          entry,
        );
      }
    }
  }

  const results = [];

  let networkRequests =
    0;

  let reusedWorkItems =
    0;

  for (
    let index = 0;
    index <
      source.detailFetchQueue.length;
    index +=
      1
  ) {
    const item =
      source.detailFetchQueue[
        index
      ];

    const existing =
      priorByWorkId.get(
        item.workId,
      );

    if (
      existing &&
      existing.status ===
        'EVIDENCE_READY' &&
      existing.document?.file &&
      fs.existsSync(
        path.join(
          root,
          existing.document.file,
        ),
      ) &&
      !args.refresh
    ) {
      results.push(
        existing,
      );

      reusedWorkItems +=
        1;

      console.log(
        [
          'REUSED',
          `${index + 1}/${source.detailFetchQueue.length}`,
          `receipt=${item.receiptNo}`,
          `type=${item.actionType}`,
        ].join(' '),
      );

      continue;
    }

    const result = {
      workId:
        item.workId,

      receiptNo:
        item.receiptNo,

      receiptDate:
        item.receiptDate,

      corpCode:
        item.corpCode,

      corpName:
        item.corpName ??
        null,

      stockCode:
        item.stockCode ??
        null,

      market:
        item.market ??
        null,

      reportName:
        item.reportName,

      actionType:
        item.actionType,

      gate:
        item.gate,

      correction:
        Boolean(
          item.correction,
        ),

      withdrawal:
        Boolean(
          item.withdrawal,
        ),

      otherEntity:
        Boolean(
          item.otherEntity,
        ),

      needsChainLookup:
        Boolean(
          item.needsChainLookup,
        ),

      structuredEndpoint:
        structuredEndpointFor(
          item,
        ),

      document:
        null,

      structured:
        null,

      structuredExactReceiptMatches:
        0,

      structuredExactRows:
        [],

      status:
        'RUNNING',

      error:
        null,
    };

    try {
      const documentFile =
        path.join(
          documentDir,
          `${item.receiptNo}.zip`,
        );

      let documentEvidence;

      if (
        !args.refresh &&
        fs.existsSync(
          documentFile,
        )
      ) {
        const existingBuffer =
          fs.readFileSync(
            documentFile,
          );

        if (
          isZip(
            existingBuffer,
          )
        ) {
          documentEvidence = {
            ok:
              true,

            status:
              'DOCUMENT_ZIP_RECEIVED',

            httpStatus:
              200,

            byteLength:
              existingBuffer.length,

            sha256:
              sha256Buffer(
                existingBuffer,
              ),

            buffer:
              null,

            providerStatus:
              null,

            providerMessage:
              null,

            reused:
              true,
          };
        }
      }

      if (
        !documentEvidence
      ) {
        documentEvidence =
          await fetchDocument({
            key:
              dartKey,

            receiptNo:
              item.receiptNo,
          });

        networkRequests +=
          1;

        if (
          documentEvidence.ok &&
          documentEvidence.buffer
        ) {
          atomicSaveBuffer(
            documentFile,
            documentEvidence.buffer,
          );
        }

        await sleep(
          REQUEST_DELAY_MS,
        );
      }

      result.document = {
        status:
          documentEvidence.status,

        httpStatus:
          documentEvidence.httpStatus,

        byteLength:
          documentEvidence.byteLength,

        sha256:
          documentEvidence.sha256,

        providerStatus:
          documentEvidence.providerStatus,

        providerMessage:
          documentEvidence.providerMessage,

        file:
          documentEvidence.ok
            ? safeRelative(
                root,
                documentFile,
              )
            : null,

        reused:
          Boolean(
            documentEvidence.reused,
          ),
      };

      if (
        result.structuredEndpoint
      ) {
        const cacheKey =
          [
            result.structuredEndpoint,
            item.corpCode,
            STRUCTURED_BEGIN_DATE,
            endDate,
          ].join('|');

        let structured =
          structuredCache.get(
            cacheKey,
          );

        if (
          !structured ||
          args.refresh
        ) {
          const fetched =
            await fetchStructured({
              key:
                dartKey,

              endpoint:
                result.structuredEndpoint,

              corpCode:
                item.corpCode,

              endDate,
            });

          networkRequests +=
            1;

          const endpointDir =
            path.join(
              structuredDir,
              result
                .structuredEndpoint
                .replace(
                  '.json',
                  '',
                ),
            );

          const structuredFile =
            path.join(
              endpointDir,
              `${item.corpCode}.json`,
            );

          atomicSaveJson(
            structuredFile,
            fetched.body ??
            {
              status:
                fetched.providerStatus,

              message:
                fetched.providerMessage,

              list:
                [],
            },
          );

          structured = {
            cacheKey,

            endpoint:
              result.structuredEndpoint,

            corpCode:
              item.corpCode,

            beginDate:
              STRUCTURED_BEGIN_DATE,

            endDate,

            status:
              fetched.status,

            httpStatus:
              fetched.httpStatus,

            providerStatus:
              fetched.providerStatus,

            providerMessage:
              fetched.providerMessage,

            responseRows:
              fetched.responseRows,

            sha256:
              fetched.sha256,

            file:
              safeRelative(
                root,
                structuredFile,
              ),

            fetchedAt:
              new Date()
                .toISOString(),

            body:
              fetched.body,
          };

          structuredCache.set(
            cacheKey,
            structured,
          );

          await sleep(
            REQUEST_DELAY_MS,
          );
        }

        const exactMatches =
          findExactStructuredMatches(
            structured.body,
            item.receiptNo,
          );

        result.structured = {
          status:
            structured.status,

          httpStatus:
            structured.httpStatus,

          providerStatus:
            structured.providerStatus,

          providerMessage:
            structured.providerMessage,

          responseRows:
            structured.responseRows,

          sha256:
            structured.sha256,

          file:
            structured.file,

          cacheKey,
        };

        result.structuredExactReceiptMatches =
          exactMatches.length;

        result.structuredExactRows =
          exactMatches;
      }

      /*
       * Original ZIP is the mandatory evidence source for this stage.
       * Structured API data is supplemental and may legitimately have no
       * exact receipt match for corrections/subsidiary disclosures.
       */
      if (
        result.document?.status ===
        'DOCUMENT_ZIP_RECEIVED'
      ) {
        result.status =
          'EVIDENCE_READY';
      } else {
        result.status =
          'EVIDENCE_FAILED';

        result.error =
          'OFFICIAL_DART_DOCUMENT_ZIP_NOT_AVAILABLE';
      }
    } catch (error) {
      result.status =
        'EVIDENCE_FAILED';

      result.error =
        safeErrorMessage(
          error,
        );
    }

    results.push(
      result,
    );

    const partial = {
      version:
        VERSION,

      status:
        'RUNNING',

      sourceFingerprint,

      inputFile:
        safeRelative(
          root,
          inputFile,
        ),

      results,

      structuredCache:
        [
          ...structuredCache.values(),
        ].map(
          ({
            body,
            ...rest
          }) => rest,
        ),

      counts:
        summarize(
          results,
        ),

      networkRequests,

      reusedWorkItems,

      databaseWrites:
        0,

      productionApplied:
        false,
    };

    atomicSaveJson(
      outputFile,
      partial,
    );

    console.log(
      [
        result.status,
        `${index + 1}/${source.detailFetchQueue.length}`,
        `receipt=${item.receiptNo}`,
        `type=${item.actionType}`,
        `doc=${result.document?.status ?? 'NONE'}`,
        result.structuredEndpoint
          ? `structured=${result.structured?.status ?? 'NONE'}`
          : 'structured=N/A',
        `requests=${networkRequests}`,
      ].join(' '),
    );
  }

  const counts =
    summarize(
      results,
    );

  const finalStatus =
    counts.failed ===
      0
      ? 'DETAIL_EVIDENCE_COMPLETE'
      : 'DETAIL_EVIDENCE_COMPLETE_WITH_FAILURES';

  const finalReport = {
    version:
      VERSION,

    status:
      finalStatus,

    sourceFingerprint,

    source: {
      inputVersion:
        source.version,

      inputStatus:
        source.status,

      startDate:
        source?.source?.startDate ??
        null,

      throughDate:
        source?.source?.throughDate ??
        null,

      detailFetchQueue:
        source.detailFetchQueue.length,

      inputFile:
        safeRelative(
          root,
          inputFile,
        ),
    },

    policy: {
      mandatoryEvidence:
        'OFFICIAL_OPENDART_DOCUMENT_XML_ZIP',

      structuredMerger:
        'cmpMgDecsn.json',

      structuredSpinOff:
        'cmpDvDecsn.json',

      structuredSplitMerger:
        'cmpDvmgDecsn.json',

      structuredHistoricalBeginDate:
        STRUCTURED_BEGIN_DATE,

      structuredRole:
        'SUPPLEMENTAL_NOT_AUTHORITATIVE_FOR_CORRECTION_CHAIN_IDENTITY',

      correctionChainResolution:
        'NOT_YET_PERFORMED',

      canonicalInsert:
        false,
    },

    counts,

    networkRequests,

    reusedWorkItems,

    databaseWrites:
      0,

    productionApplied:
      false,

    canonicalEventsCreated:
      0,

    coverageWindowAdvanced:
      false,

    results,

    structuredCache:
      [
        ...structuredCache.values(),
      ].map(
        ({
          body,
          ...rest
        }) => rest,
      ),

    outputFile:
      safeRelative(
        root,
        outputFile,
      ),
  };

  atomicSaveJson(
    outputFile,
    finalReport,
  );

  console.log(
    JSON.stringify(
      {
        status:
          finalStatus,

        version:
          VERSION,

        ...counts,

        networkRequests,

        reusedWorkItems,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        coverageWindowAdvanced:
          false,

        outputFile:
          finalReport.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    counts.failed >
    0
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      safeErrorMessage(
        error,
      ),
    );

    process.exitCode =
      1;
  },
);
