/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.10.2 - Structural review precision evidence probe
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-structural-date-audit-v9-8-10-1.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-structural-date-probe-v9-8-10-2.json
 *
 * Scope:
 *   ONLY reviewQueue rows from V9.8.10.1.
 *
 * For DOCUMENT_XML_ZIP:
 *   - preserve DART XML text-node order
 *   - emit compact windows around structural date labels
 *
 * For STRUCTURED_JSON:
 *   - emit compact matching structured rows
 *   - highlight date-looking key/value fields
 *
 * No canonical date is promoted here.
 *
 * Run:
 *   node .\scripts\v9810-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_2_STRUCTURAL_REVIEW_PRECISION_EVIDENCE_PROBE';

const AUDIT_VERSION =
  'V9_8_10_1_STRUCTURAL_CANONICAL_DATE_AUDIT';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const MAX_ZIP_ENTRIES = 64;
const MAX_XML_BYTES = 16 * 1024 * 1024;

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

function findEocd(bytes) {
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

    const count =
      bytes.readUInt16LE(p + 10);

    const cdSize =
      bytes.readUInt32LE(p + 12);

    const cdOffset =
      bytes.readUInt32LE(p + 16);

    if (
      !count ||
      count >
        MAX_ZIP_ENTRIES
    ) {
      throw new Error(
        'ZIP_ENTRY_LIMIT',
      );
    }

    if (
      cdOffset + cdSize !==
      p
    ) {
      throw new Error(
        'INVALID_CENTRAL_DIRECTORY',
      );
    }

    return {
      count,
      cdOffset,
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
      bytes.readUInt32LE(p) !==
      0x02014b50
    ) {
      throw new Error(
        'INVALID_CENTRAL_ENTRY',
      );
    }

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

    const name =
      bytes
        .subarray(
          nameStart,
          nameEnd,
        )
        .toString('utf8');

    if (
      bytes.readUInt32LE(
        localOffset,
      ) !==
      0x04034b50
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

    const compressed =
      bytes.subarray(
        dataStart,
        dataEnd,
      );

    let raw = null;

    if (method === 0) {
      raw =
        Buffer.from(
          compressed,
        );
    } else if (
      method === 8
    ) {
      raw =
        zlib.inflateRawSync(
          compressed,
          {
            maxOutputLength:
              MAX_XML_BYTES,
          },
        );
    }

    if (raw) {
      entries.push({
        name,
        bytes:
          raw,
      });
    }

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
        Math.min(
          bytes.length,
          512,
        ),
      )
      .toString('latin1');

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
    declared.includes('euc-kr') ||
    declared.includes('ks_c_5601') ||
    declared.includes('ksc5601')
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
      return new TextDecoder(
        encoding,
        {
          fatal:
            false,
        },
      ).decode(bytes);
    } catch {
      // continue
    }
  }

  return bytes.toString(
    'utf8',
  );
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
      if (
        key[0] === '#'
      ) {
        const n =
          key[1]
            .toLowerCase() ===
          'x'
            ? parseInt(
                key.slice(2),
                16,
              )
            : parseInt(
                key.slice(1),
                10,
              );

        return Number.isFinite(
          n,
        )
          ? String.fromCodePoint(
              n,
            )
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

  const nodes = [];

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
      nodes.push(text);
    }
  }

  return nodes;
}

function extractNodesFromZip(file) {
  const bytes =
    fs.readFileSync(file);

  const entries =
    readZipEntries(bytes)
      .filter(
        (entry) =>
          /\.xml$/i.test(
            entry.name,
          ),
      )
      .sort(
        (a, b) =>
          b.bytes.length -
          a.bytes.length,
      );

  if (
    !entries.length
  ) {
    throw new Error(
      'XML_ENTRY_MISSING',
    );
  }

  const entry =
    entries[0];

  const xml =
    decodeXmlBytes(
      entry.bytes,
    );

  return {
    entryName:
      entry.name,

    xmlSha256:
      sha256(
        entry.bytes,
      ),

    nodes:
      xmlTextNodes(xml),
  };
}

function relevantIndexes(nodes) {
  const regex =
    /합병기일|분할기일|분할합병기일|합병등기|분할등기|등기예정|이사회결의|주주총회|상장예정|신주.*상장|합병일정|분할일정|합병.*일자|분할.*일자|효력발생/i;

  const indexes = [];

  for (
    let i = 0;
    i < nodes.length;
    i += 1
  ) {
    if (
      regex.test(
        nodes[i],
      )
    ) {
      indexes.push(i);
    }
  }

  return indexes;
}

function compactWindows(
  nodes,
  indexes,
  radius = 5,
) {
  const ranges = [];

  for (
    const index of
    indexes
  ) {
    const start =
      Math.max(
        0,
        index - radius,
      );

    const end =
      Math.min(
        nodes.length - 1,
        index + radius,
      );

    const previous =
      ranges.at(-1);

    if (
      previous &&
      start <=
        previous.end + 1
    ) {
      previous.end =
        Math.max(
          previous.end,
          end,
        );
    } else {
      ranges.push({
        start,
        end,
      });
    }
  }

  return ranges.map(
    (range) => ({
      startIndex:
        range.start,

      endIndex:
        range.end,

      nodes:
        nodes
          .slice(
            range.start,
            range.end + 1,
          )
          .map(
            (text, offset) => ({
              index:
                range.start +
                offset,
              text,
            }),
          ),
    }),
  );
}

function looksDateLike(value) {
  const text =
    String(
      value ??
      '',
    ).trim();

  return (
    /\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/.test(
      text,
    ) ||
    /\b20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/.test(
      text,
    ) ||
    /^\d{8}$/.test(
      text,
    )
  );
}

function flattenStructured(
  value,
  prefix = '',
  out = [],
  depth = 0,
) {
  if (
    depth >
    6
  ) {
    return out;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return out;
  }

  if (
    Array.isArray(value)
  ) {
    value.forEach(
      (item, index) => {
        flattenStructured(
          item,
          `${prefix}[${index}]`,
          out,
          depth + 1,
        );
      },
    );

    return out;
  }

  if (
    typeof value ===
    'object'
  ) {
    for (
      const [
        key,
        child,
      ] of
      Object.entries(value)
    ) {
      const next =
        prefix
          ? `${prefix}.${key}`
          : key;

      flattenStructured(
        child,
        next,
        out,
        depth + 1,
      );
    }

    return out;
  }

  const text =
    String(value)
      .replace(
        /\s+/g,
        ' ',
      )
      .trim();

  if (!text) {
    return out;
  }

  const key =
    prefix
      .split('.')
      .at(-1) ??
    prefix;

  const keyLooksRelevant =
    /date|dt|dd|bddd|mg|merg|합병|분할|등기|상장|결의|기일/i.test(
      key,
    );

  if (
    looksDateLike(text) ||
    keyLooksRelevant
  ) {
    out.push({
      path:
        prefix,

      key,

      value:
        text.length >
        500
          ? `${text.slice(0, 500)}…`
          : text,

      dateLike:
        looksDateLike(
          text,
        ),
    });
  }

  return out;
}

function compactStructuredRows(structured) {
  if (
    !structured ||
    typeof structured !==
    'object'
  ) {
    return {
      status:
        'NO_STRUCTURED_OBJECT',

      matchingRows:
        [],

      relevantFields:
        [],
    };
  }

  const directRows =
    Array.isArray(
      structured.matchingRows,
    )
      ? structured.matchingRows
      : [];

  const fallbackRows =
    Array.isArray(
      structured.rows,
    )
      ? structured.rows
      : [];

  const matchingRows =
    directRows.length
      ? directRows
      : fallbackRows;

  const compactRows =
    matchingRows.map(
      (row, index) => {
        const primitive = {};

        if (
          row &&
          typeof row ===
          'object' &&
          !Array.isArray(row)
        ) {
          for (
            const [
              key,
              value,
            ] of
            Object.entries(row)
          ) {
            if (
              value === null ||
              value === undefined
            ) {
              continue;
            }

            if (
              typeof value ===
              'string' ||
              typeof value ===
              'number' ||
              typeof value ===
              'boolean'
            ) {
              const text =
                String(value)
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .trim();

              primitive[key] =
                text.length >
                300
                  ? `${text.slice(0, 300)}…`
                  : text;
            }
          }
        }

        return {
          index,
          fields:
            primitive,

          relevantFields:
            flattenStructured(
              row,
            ),
        };
      },
    );

  return {
    status:
      structured.status ??
      null,

    matchingRowCount:
      matchingRows.length,

    matchingRows:
      compactRows,

    relevantFields:
      flattenStructured(
        structured,
      ),
  };
}

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const auditFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-audit-v9-8-10-1.json',
    );

  const evidenceFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-probe-v9-8-10-2.json',
    );

  for (
    const file of
    [
      auditFile,
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

  const audit =
    readJson(
      auditFile,
    );

  const evidence =
    readJson(
      evidenceFile,
    );

  if (
    audit.version !==
    AUDIT_VERSION
  ) {
    throw new Error(
      'AUDIT_VERSION_MISMATCH',
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
    !Array.isArray(
      audit.reviewQueue,
    )
  ) {
    throw new Error(
      'AUDIT_REVIEW_QUEUE_MISSING',
    );
  }

  const evidenceRows =
    Array.isArray(
      evidence.results,
    )
      ? evidence.results
      : [];

  const evidenceByReceipt =
    new Map(
      evidenceRows.map(
        (row) => [
          row.receiptNo,
          row,
        ],
      ),
    );

  const rows = [];

  for (
    let index = 0;
    index <
      audit.reviewQueue.length;
    index += 1
  ) {
    const target =
      audit.reviewQueue[index];

    const evidenceRow =
      evidenceByReceipt.get(
        target.sourceReceiptNo,
      ) ??
      null;

    const structuredProbe =
      compactStructuredRows(
        evidenceRow?.structured,
      );

    const relFile =
      evidenceRow
        ?.document
        ?.file ??
      null;

    const absFile =
      relFile
        ? path.join(
            root,
            relFile,
          )
        : null;

    let documentProbe = {
      available:
        false,
    };

    if (
      absFile &&
      fs.existsSync(
        absFile,
      )
    ) {
      try {
        const extracted =
          extractNodesFromZip(
            absFile,
          );

        const indexes =
          relevantIndexes(
            extracted.nodes,
          );

        documentProbe = {
          available:
            true,

          file:
            relFile,

          entryName:
            extracted.entryName,

          xmlSha256:
            extracted.xmlSha256,

          textNodeCount:
            extracted.nodes.length,

          relevantWindows:
            compactWindows(
              extracted.nodes,
              indexes,
              6,
            ),
        };
      } catch (error) {
        documentProbe = {
          available:
            true,

          file:
            relFile,

          parseError:
            String(
              error?.message ??
              error,
            ),
        };
      }
    }

    rows.push({
      providerEventId:
        target.providerEventId,

      sourceReceiptNo:
        target.sourceReceiptNo,

      stockCode:
        target.stockCode,

      actionType:
        target.actionType,

      sourceKind:
        target.sourceKind,

      parserStatus:
        target.parserStatus,

      previousPrimaryDateField:
        target.primaryDateField,

      previousPrimaryDateCandidate:
        target.primaryDateCandidate,

      previousFacts:
        target.facts,

      previousChronologyWarnings:
        target.chronologyWarnings,

      evidenceDisposition:
        evidenceRow
          ?.evidenceDisposition ??
        null,

      documentStatus:
        evidenceRow
          ?.document
          ?.status ??
        null,

      documentProbe,

      structuredProbe,
    });

    console.log(
      [
        'STRUCTURAL_PROBE',
        `${index + 1}/${audit.reviewQueue.length}`,
        `root=${target.providerEventId}`,
        `stock=${target.stockCode}`,
        `source=${target.sourceKind}`,
        `doc=${documentProbe.available}`,
        `structuredRows=${structuredProbe.matchingRowCount ?? 0}`,
      ].join(' '),
    );
  }

  const documentRows =
    rows.filter(
      (row) =>
        row.documentProbe
          ?.available ===
        true,
    );

  const structuredRows =
    rows.filter(
      (row) =>
        (
          row.structuredProbe
            ?.matchingRowCount ??
          0
        ) >
        0,
    );

  const rowsWithRelevantXml =
    documentRows.filter(
      (row) =>
        (
          row.documentProbe
            ?.relevantWindows
            ?.length ??
          0
        ) >
        0,
    );

  const rowsWithStructuredDateFields =
    rows.filter(
      (row) =>
        (
          row.structuredProbe
            ?.relevantFields ??
          []
        ).some(
          (field) =>
            field.dateLike ===
            true,
        ),
    );

  const status =
    rows.length ===
      audit.reviewQueue.length
      ? 'STRUCTURAL_REVIEW_PRECISION_PROBE_COMPLETE'
      : 'STRUCTURAL_REVIEW_PRECISION_PROBE_COUNT_MISMATCH';

  const report = {
    version:
      VERSION,

    status,

    source: {
      auditVersion:
        audit.version,

      auditFingerprint:
        audit.outputFingerprint,

      evidenceVersion:
        evidence.version,
    },

    counts: {
      reviewTargets:
        audit.reviewQueue.length,

      outputRows:
        rows.length,

      documentRows:
        documentRows.length,

      structuredRows:
        structuredRows.length,

      rowsWithRelevantXml:
        rowsWithRelevantXml.length,

      rowsWithStructuredDateFields:
        rowsWithStructuredDateFields.length,
    },

    rows,

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      structuralEffectiveDatesPromoted:
        0,

      coverageWindowAdvanced:
        false,
    },

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

        auditFingerprint:
          report.source
            .auditFingerprint,

        rows:
          rows.map(
            (row) => [
              row.providerEventId,
              row.sourceReceiptNo,
              row.sourceKind,
              row.documentProbe
                ?.xmlSha256 ??
                null,
              row.structuredProbe
                ?.matchingRowCount ??
                0,
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

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        structuralEffectiveDatesPromoted:
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
    'STRUCTURAL_REVIEW_PRECISION_PROBE_COUNT_MISMATCH'
  ) {
    process.exitCode =
      2;
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

  process.exitCode =
    1;
}
